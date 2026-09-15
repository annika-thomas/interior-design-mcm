import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import type { Furniture, Suggestion } from '../types.js';
import { evaluateRoom } from '../mcm/rules.js';
import { suggestForRoom } from '../mcm/suggest.js';
import { CATALOG_BY_KEY } from '../mcm/catalog.js';
import { DESIGN_RULES, PALETTES } from '../mcm/knowledge.js';
import { areaSqm } from '../mcm/geometry.js';
import { structured } from '../services/claude.js';

export const router = Router();

function loadRoom(roomId: string) {
  const room = db.find('rooms', (r) => r.id === roomId);
  if (!room) return null;
  return {
    room,
    furniture: db.filter('furniture', (f) => f.roomId === room.id),
    openings: db.filter('openings', (o) => o.roomId === room.id),
    photos: db.filter('photos', (p) => p.roomId === room.id),
  };
}

/** Score a room against the rule set. Deterministic — no API key involved. */
router.get('/rooms/:id/review', (req, res) => {
  const ctx = loadRoom(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Room not found' });

  const evaluation = evaluateRoom(ctx.room, ctx.furniture, ctx.openings, ctx.photos);
  db.update('rooms', ctx.room.id, {
    analysis: {
      engine: 'heuristic',
      updatedAt: new Date().toISOString(),
      styleScore: evaluation.styleScore,
      summary: evaluation.summary,
      findings: evaluation.findings,
      photoIds: ctx.photos.map((p) => p.id),
    },
  });
  res.json({ ...evaluation, roomId: ctx.room.id, areaSqm: Math.round(areaSqm(ctx.room.polygon) * 10) / 10 });
});

/** Whole-project review, room by room. */
router.get('/projects/:id/review', (req, res) => {
  const rooms = db.filter('rooms', (r) => r.projectId === req.params.id);
  const results = rooms.map((room) => {
    const evaluation = evaluateRoom(
      room,
      db.filter('furniture', (f) => f.roomId === room.id),
      db.filter('openings', (o) => o.roomId === room.id),
      db.filter('photos', (p) => p.roomId === room.id),
    );
    return { roomId: room.id, roomName: room.name, ...evaluation };
  });
  const scored = results.filter((r) => r.styleScore > 0);
  res.json({
    rooms: results,
    projectScore: scored.length ? Math.round(scored.reduce((s, r) => s + r.styleScore, 0) / scored.length) : 0,
  });
});

/**
 * Generate the plan for one room.
 *
 * The heuristic engine decides *what* to suggest and *where* each piece goes,
 * because placement needs real geometry. When a key is configured, Claude then
 * writes the room's design note and sharpens each rationale against the user's
 * own saved inspiration — it edits the plan's prose, never its placements.
 */
router.post('/rooms/:id/suggest', async (req, res) => {
  const ctx = loadRoom(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Room not found' });

  const project = db.find('projects', (p) => p.id === ctx.room.projectId);
  const library = db.filter('library', (l) => l.projectId === ctx.room.projectId);

  const { suggestions, styleScore } = suggestForRoom({
    room: ctx.room,
    furniture: ctx.furniture,
    openings: ctx.openings,
    photos: ctx.photos,
    library,
    paletteKey: project?.paletteKey,
    budgetCents: project?.budgetCents,
  });

  // Replace the room's open suggestions; accepted and dismissed ones survive so
  // regenerating never re-proposes something already rejected.
  const decided = db.filter('suggestions', (s) => s.roomId === ctx.room.id && s.status !== 'open');
  const dismissedTitles = new Set(decided.filter((s) => s.status === 'dismissed').map((s) => s.title));
  const doneKeys = new Set(decided.filter((s) => s.status !== 'dismissed').map((s) => s.catalogKey).filter(Boolean));
  db.remove('suggestions', (s) => s.roomId === ctx.room.id && s.status === 'open');

  let fresh = suggestions.filter((s) => !dismissedTitles.has(s.title) && !(s.catalogKey && doneKeys.has(s.catalogKey)));

  let designNote: string | null = null;
  let engine: 'claude' | 'heuristic' = 'heuristic';

  if (config.hasClaude && req.body?.useClaude !== false) {
    try {
      const enriched = await enrich(ctx, fresh, library, project?.paletteKey ?? null, styleScore);
      if (enriched) {
        designNote = enriched.designNote;
        engine = 'claude';
        const byIndex = new Map(enriched.suggestions.map((s) => [s.index, s]));
        fresh = fresh.map((s, i) => {
          const patch = byIndex.get(i);
          if (!patch) return s;
          return {
            ...s,
            title: patch.title || s.title,
            rationale: patch.rationale || s.rationale,
            priority: ([1, 2, 3].includes(patch.priority) ? patch.priority : s.priority) as Suggestion['priority'],
            engine: 'claude' as const,
          };
        });
        for (const extra of enriched.extraSuggestions) {
          fresh.push({
            id: randomUUID(),
            projectId: ctx.room.projectId,
            roomId: ctx.room.id,
            title: extra.title,
            rationale: extra.rationale,
            ruleKeys: extra.ruleKeys ?? [],
            libraryItemId: extra.libraryItemId ?? null,
            catalogKey: null,
            placement: null,
            priority: ([1, 2, 3].includes(extra.priority) ? extra.priority : 2) as Suggestion['priority'],
            effort: (['free', 'cheap', 'invest'].includes(extra.effort) ? extra.effort : 'free') as Suggestion['effort'],
            status: 'open',
            engine: 'claude',
            createdAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      // A failed enrichment must not lose the plan — the heuristic one stands.
      console.error('[suggest enrich]', err);
    }
  }

  fresh.sort((a, b) => a.priority - b.priority);
  for (const s of fresh) db.insert('suggestions', s);

  res.json({
    suggestions: fresh,
    kept: decided,
    styleScore,
    designNote,
    engine,
    usedLibraryItems: fresh.filter((s) => s.libraryItemId).length,
  });
});

router.get('/projects/:id/suggestions', (req, res) => {
  const suggestions = db.filter('suggestions', (s) => s.projectId === req.params.id);
  res.json(suggestions.sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)));
});

/** Accept a suggestion: place the piece in the room and mark it done. */
router.post('/suggestions/:id/accept', (req, res) => {
  const suggestion = db.find('suggestions', (s) => s.id === req.params.id);
  if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

  let placed: Furniture | null = null;
  if (suggestion.catalogKey && suggestion.roomId) {
    const item = CATALOG_BY_KEY[suggestion.catalogKey];
    if (item) {
      const p = suggestion.placement;
      placed = {
        id: randomUUID(),
        roomId: suggestion.roomId,
        catalogKey: item.key,
        libraryItemId: suggestion.libraryItemId,
        label: item.name,
        x: p?.x ?? 0,
        y: p?.y ?? 0,
        z: p?.z ?? 0,
        rotationDeg: p?.rotationDeg ?? 0,
        widthCm: item.dims.w,
        depthCm: item.dims.d,
        heightCm: item.dims.h,
        color: item.colors.primary,
        source: suggestion.libraryItemId ? 'library' : 'suggested',
        locked: false,
        notes: suggestion.title,
      };
      db.insert('furniture', placed);
    }
  }

  const updated = db.update('suggestions', suggestion.id, { status: placed ? 'done' : 'accepted' });
  res.json({ suggestion: updated, furniture: placed });
});

router.post('/suggestions/:id/dismiss', (req, res) => {
  const updated = db.update('suggestions', req.params.id, { status: 'dismissed' });
  if (!updated) return res.status(404).json({ error: 'Suggestion not found' });
  res.json(updated);
});

router.post('/suggestions/:id/reopen', (req, res) => {
  const updated = db.update('suggestions', req.params.id, { status: 'open' });
  if (!updated) return res.status(404).json({ error: 'Suggestion not found' });
  res.json(updated);
});

// --- Claude enrichment ----------------------------------------------------

const EnrichSchema = z.object({
  designNote: z.string().describe('3-5 sentences: the specific plan for this room, in plain language'),
  suggestions: z.array(z.object({
    index: z.number().describe('Index of the suggestion being rewritten'),
    title: z.string(),
    rationale: z.string(),
    priority: z.number().describe('1 do first, 2 next, 3 eventually'),
  })),
  extraSuggestions: z.array(z.object({
    title: z.string(),
    rationale: z.string(),
    priority: z.number(),
    effort: z.string().describe('free, cheap or invest'),
    ruleKeys: z.array(z.string()),
    libraryItemId: z.string().nullable(),
  })).describe('At most three things the rule engine could not see. Leave empty if there is nothing to add.'),
});

async function enrich(
  ctx: NonNullable<ReturnType<typeof loadRoom>>,
  suggestions: Suggestion[],
  library: ReturnType<typeof db.filter<'library'>>,
  paletteKey: string | null,
  styleScore: number,
) {
  const palette = PALETTES.find((p) => p.key === paletteKey);
  const libraryDigest = library.slice(0, 40).map((l) =>
    `- [${l.id}] "${l.title}" (${l.kind}${l.favorite ? ', favourite' : ''}) — ${l.analysis?.summary ?? (l.notes || 'no description')}${
      l.analysis?.takeaways?.length ? ` Takeaways: ${l.analysis.takeaways.join('; ')}` : ''
    }`).join('\n') || '(the library is empty)';

  const existing = ctx.furniture.map((f) =>
    `- ${f.label} (${f.widthCm}x${f.depthCm}x${f.heightCm} cm${f.source === 'existing' ? ', already owned' : ''})${f.notes ? ` — ${f.notes}` : ''}`,
  ).join('\n') || '(nothing placed yet)';

  const plan = suggestions.map((s, i) =>
    `${i}. [${s.effort}, priority ${s.priority}] ${s.title}\n   ${s.rationale}${
      s.libraryItemId ? `\n   (matched to library item ${s.libraryItemId})` : ''
    }`).join('\n');

  const photoNotes = ctx.photos
    .map((p) => p.analysis?.summary)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');

  const system = `You are an interior designer working in mid-century modern, helping someone plan one room of their own apartment.

A deterministic rule engine has already produced the plan below and worked out where each piece physically fits. Your job is to make it read like advice from someone who has actually looked at this room and at what this person has been saving — not a generic checklist.

Rules you are working against:
${DESIGN_RULES.map((r) => `- ${r.key}: ${r.title}. ${r.rule}`).join('\n')}

Hard constraints:
- Do not invent dimensions or placements. The geometry is already settled.
- Keep every suggestion index you are given; rewrite the wording, do not drop items.
- When a suggestion is matched to something in their library, say what specifically about that saved item works here.
- Priorities: 1 means it unblocks everything else, 3 means it is the last 10%.
- Be direct about tradeoffs. If the room is too small for something on the list, say so.
- No flattery, no "elevate your space" copy. Concrete nouns and measurements.
- Extra suggestions are for things the rule engine structurally cannot see: how the room is actually used, what a photo reveals, a conflict between two saved items. Add nothing if you have nothing.`;

  const prompt = `Room: "${ctx.room.name}", a ${ctx.room.kind} of ${Math.round(areaSqm(ctx.room.polygon) * 10) / 10} sqm with ${ctx.room.heightCm} cm ceilings.
Walls ${ctx.room.wallColor}, floor ${ctx.room.floorColor} (${ctx.room.floorMaterial}).
Openings: ${ctx.openings.map((o) => `${o.kind} ${o.widthCm}x${o.heightCm} cm`).join(', ') || 'none recorded'}.
Current style score: ${styleScore}/100.
${palette ? `Target palette: ${palette.name}. ${palette.notes}` : 'No palette chosen yet.'}

What the survey photos showed: ${photoNotes || '(no photo analysis yet)'}

Already in the room:
${existing}

Their saved inspiration:
${libraryDigest}

The plan to rewrite:
${plan}`;

  return structured({ system, prompt, schema: EnrichSchema, maxTokens: 12000 });
}

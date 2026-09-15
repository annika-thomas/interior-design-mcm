import { randomUUID } from 'node:crypto';
import type { Furniture, LibraryItem, Opening, Photo, Room, Suggestion } from '../types.js';
import { CATALOG_BY_KEY, CATALOG_BY_ROLE, type CatalogItem, fitForRole } from './catalog.js';
import { PALETTES, ROOM_PROGRAMS } from './knowledge.js';
import { areaSqm, centroid, findSpot } from './geometry.js';
import { evaluateRoom } from './rules.js';

export interface SuggestInput {
  room: Room;
  furniture: Furniture[];
  openings: Opening[];
  photos: Photo[];
  library: LibraryItem[];
  paletteKey?: string | null;
  budgetCents?: number | null;
}

const PLACEMENT_FOR_ROLE: Record<string, Parameters<typeof findSpot>[3]> = {
  sofa: 'against-wall',
  'coffee-table': 'in-front-of-seat',
  rug: 'under-group',
  'lounge-chair': 'beside-seat',
  'side-table': 'beside-seat',
  'floor-lamp': 'beside-seat',
  'table-lamp': 'anywhere',
  credenza: 'against-wall',
  bookshelf: 'against-wall',
  dresser: 'against-wall',
  nightstand: 'beside-seat',
  bed: 'against-wall',
  'dining-table': 'floating',
  'dining-chair': 'anywhere',
  desk: 'against-wall',
  console: 'against-wall',
  plant: 'corner',
  'bar-cart': 'corner',
  bench: 'against-wall',
  'room-divider': 'floating',
  'bar-stool': 'against-wall',
  'task-lamp': 'anywhere',
  ceramics: 'anywhere',
};

/** Roles that hang on a wall or ceiling rather than standing on the floor. */
const WALL_ROLES = new Set(['art', 'mirror', 'curtains']);
const CEILING_ROLES = new Set(['pendant']);

function anchorFor(role: string, furniture: Furniture[]): Furniture | undefined {
  const byRole = (r: string) =>
    furniture.find((f) => (f.catalogKey ? CATALOG_BY_KEY[f.catalogKey]?.role : null) === r);
  if (['coffee-table', 'side-table', 'floor-lamp', 'rug'].includes(role)) {
    return byRole('sofa') ?? byRole('lounge-chair');
  }
  if (role === 'nightstand') return byRole('bed');
  if (role === 'dining-chair') return byRole('dining-table');
  return undefined;
}

function placementFor(
  item: CatalogItem,
  room: Room,
  furniture: Furniture[],
): Suggestion['placement'] {
  if (CEILING_ROLES.has(item.role)) {
    const anchor = anchorFor('dining-chair', furniture) ??
      furniture.find((f) => (f.catalogKey ? CATALOG_BY_KEY[f.catalogKey]?.role : null) === 'dining-table');
    const c = anchor ? { x: anchor.x, y: anchor.y } : centroid(room.polygon);
    // Bottom of the shade 80 cm above a 74 cm table, or 200 cm up in open floor.
    const z = anchor ? 74 + 80 : Math.max(180, room.heightCm - 90);
    return { x: c.x, y: c.y, z, rotationDeg: 0 };
  }
  if (WALL_ROLES.has(item.role)) {
    const spot = findSpot(room, furniture, { w: item.dims.w, d: 10 }, 'against-wall');
    const z = item.role === 'curtains' ? room.heightCm - item.dims.h : 145 - item.dims.h / 2;
    if (!spot) return null;
    return { x: spot.x, y: spot.y, z: Math.max(0, z), rotationDeg: spot.rotationDeg };
  }
  const style = PLACEMENT_FOR_ROLE[item.role] ?? 'anywhere';
  const anchor = anchorFor(item.role, furniture);
  const spot = findSpot(room, furniture, { w: item.dims.w, d: item.dims.d }, style, anchor);
  return spot ? { x: spot.x, y: spot.y, z: 0, rotationDeg: spot.rotationDeg } : null;
}

function effortFor(item: CatalogItem): Suggestion['effort'] {
  return item.priceBand <= 1 ? 'cheap' : item.priceBand >= 3 ? 'invest' : 'cheap';
}

/** Score how well a saved library item fits a role we need filled. */
function libraryMatch(items: LibraryItem[], role: string, catalogKey: string): LibraryItem | undefined {
  const scored = items
    .map((it) => {
      const a = it.analysis;
      let score = 0;
      if (a?.roleGuess === role) score += 10;
      if (a?.catalogKeyGuess === catalogKey) score += 6;
      if (it.tags.includes(role)) score += 4;
      const catalogTags = CATALOG_BY_KEY[catalogKey]?.tags ?? [];
      score += it.tags.filter((t) => catalogTags.includes(t)).length;
      if (a?.mcmScore != null) score += a.mcmScore / 50;
      if (it.favorite) score += 2;
      if (it.kind === 'product') score += 1.5;
      return { it, score };
    })
    .filter((s) => s.score >= 5)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.it;
}

function newSuggestion(partial: Omit<Suggestion, 'id' | 'createdAt' | 'status'>): Suggestion {
  return { ...partial, id: randomUUID(), status: 'open', createdAt: new Date().toISOString() };
}

/**
 * Turn a surveyed room plus the user's saved inspiration into an ordered,
 * placeable plan.
 *
 * Suggestions come from three sources, in priority order: pieces the room's
 * program is missing outright, failures against the rule set, and palette or
 * styling refinements. Anything that can be matched to something already in the
 * user's library gets attributed to it, so the plan leans on what they have
 * actually been saving rather than a generic shopping list.
 */
export function suggestForRoom(input: SuggestInput): { suggestions: Suggestion[]; styleScore: number } {
  const { room, furniture, openings, photos, library, paletteKey, budgetCents } = input;
  const out: Suggestion[] = [];
  const area = areaSqm(room.polygon);
  const program = ROOM_PROGRAMS[room.kind] ?? ROOM_PROGRAMS.other;
  const evaluation = evaluateRoom(room, furniture, openings, photos);

  // Roles the room already has covered.
  const haveRoles = new Set(
    furniture.map((f) => (f.catalogKey ? CATALOG_BY_KEY[f.catalogKey]?.role : null)).filter(Boolean) as string[],
  );

  // Track a running copy so successive placements do not land on top of each other.
  const working: Furniture[] = [...furniture];

  const proposePiece = (
    role: string,
    priority: Suggestion['priority'],
    why: string,
    ruleKeys: string[] = [],
  ) => {
    if (haveRoles.has(role)) return;
    let item = fitForRole(role, area);
    if (!item) return;
    // Respect budget by preferring cheaper options when one is set and tight.
    if (budgetCents != null && budgetCents < 200_000) {
      const cheap = (CATALOG_BY_ROLE[role] ?? []).slice().sort((a, b) => a.priceBand - b.priceBand)[0];
      if (cheap) item = cheap;
    }
    const saved = libraryMatch(library, role, item.key);
    const placement = placementFor(item, room, working);
    out.push(newSuggestion({
      projectId: room.projectId,
      roomId: room.id,
      title: saved ? `Use your saved "${saved.title}" as the ${item.role.replace(/-/g, ' ')}` : `Add a ${item.name}`,
      rationale: saved
        ? `${why} You already saved this one — ${saved.analysis?.summary ?? (saved.notes || 'it fits the slot')}. Sized here as ${item.dims.w}x${item.dims.d}x${item.dims.h} cm; adjust to the real product dimensions once you have them.`
        : `${why} ${item.note} Inspired by ${item.inspiredBy} (${item.era}).`,
      ruleKeys,
      libraryItemId: saved?.id ?? null,
      catalogKey: item.key,
      placement,
      priority,
      effort: effortFor(item),
      engine: 'heuristic',
    }));
    haveRoles.add(role);
    if (placement) {
      working.push({
        id: `pending-${item.key}`,
        roomId: room.id,
        catalogKey: item.key,
        libraryItemId: saved?.id ?? null,
        label: item.name,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rotationDeg: placement.rotationDeg,
        widthCm: item.dims.w,
        depthCm: item.dims.d,
        heightCm: item.dims.h,
        color: item.colors.primary,
        source: 'suggested',
        locked: false,
        notes: '',
      });
    }
  };

  // 1. Essentials the room program is missing.
  for (const role of program.essential) {
    proposePiece(role, 1, `Every ${program.label.toLowerCase()} needs this — it is on the essentials list for the room type.`);
  }

  // 2. Fixes for rule failures.
  for (const f of evaluation.findings.filter((x) => x.status === 'fail')) {
    if (f.ruleKey === 'three-light-sources') {
      const have = furniture.filter((x) => x.catalogKey && CATALOG_BY_KEY[x.catalogKey]?.category === 'lighting').length;
      const wanted = ['floor-lamp', 'table-lamp', 'pendant'].filter((r) => !haveRoles.has(r));
      for (const role of wanted.slice(0, Math.max(0, 3 - have))) {
        proposePiece(role, 1, 'The room is short on light layers.', ['three-light-sources']);
      }
      continue;
    }
    if (f.ruleKey === 'organic-counterpoint') {
      proposePiece('plant', 2, 'Everything here is rectilinear and needs one curve.', ['organic-counterpoint']);
      continue;
    }
    if (f.ruleKey === 'rug-anchor' && !haveRoles.has('rug')) {
      proposePiece('rug', 1, 'The seating group has nothing binding it together.', ['rug-anchor']);
      continue;
    }
    if (f.ruleKey === 'texture-count') {
      proposePiece('plant', 3, 'Texture is thin in here.', ['texture-count']);
      continue;
    }
    // Everything else is a move-or-swap instruction rather than a purchase.
    out.push(newSuggestion({
      projectId: room.projectId,
      roomId: room.id,
      title: f.title,
      rationale: `${f.detail} ${f.fix}`,
      ruleKeys: [f.ruleKey],
      libraryItemId: null,
      catalogKey: null,
      placement: null,
      priority: f.severity === 'major' ? 1 : 2,
      effort: 'free',
      engine: 'heuristic',
    }));
  }

  // 3. Enriching pieces once the essentials are covered.
  const essentialsCovered = program.essential.every((r) => haveRoles.has(r));
  if (essentialsCovered) {
    for (const role of program.enriching) {
      if (out.length >= 14) break;
      proposePiece(role, 3, `Not essential, but it is what takes the room from furnished to finished.`);
    }
  }

  // 4. Library items that fit this room but are not yet used anywhere.
  const usedLibraryIds = new Set([
    ...furniture.map((f) => f.libraryItemId),
    ...out.map((s) => s.libraryItemId),
  ].filter(Boolean) as string[]);
  const unused = library
    .filter((it) => !usedLibraryIds.has(it.id) && (it.analysis?.mcmScore ?? 0) >= 60)
    .sort((a, b) => (b.analysis?.mcmScore ?? 0) - (a.analysis?.mcmScore ?? 0))
    .slice(0, 3);
  for (const it of unused) {
    const takeaway = it.analysis?.takeaways?.[0];
    if (!takeaway) continue;
    out.push(newSuggestion({
      projectId: room.projectId,
      roomId: room.id,
      title: `Borrow one idea from "${it.title}"`,
      rationale: `${takeaway} ${it.analysis?.formNotes ?? ''}`.trim(),
      ruleKeys: [],
      libraryItemId: it.id,
      catalogKey: it.analysis?.catalogKeyGuess ?? null,
      placement: null,
      priority: 3,
      effort: 'free',
      engine: 'heuristic',
    }));
  }

  // 5. Palette direction for the room.
  const palette = PALETTES.find((p) => p.key === paletteKey) ?? PALETTES[0];
  const wallIsWhite = /^#(f|e)/i.test(room.wallColor ?? '');
  if (paletteKey) {
    out.push(newSuggestion({
      projectId: room.projectId,
      roomId: room.id,
      title: `Pull ${room.name} toward the ${palette.name} palette`,
      rationale: `${palette.notes} Run ${palette.dominant[0]} across the walls and large upholstery, ${palette.secondary[0]} on the case goods, and save ${palette.accent[0]} for exactly one piece.${wallIsWhite ? '' : ` Your walls currently read ${room.wallColor}, which is darker than this palette wants — repainting is the highest-impact change available to you here.`}`,
      ruleKeys: ['sixty-thirty-ten', 'one-loud-thing'],
      libraryItemId: null,
      catalogKey: null,
      placement: null,
      priority: 2,
      effort: 'cheap',
      engine: 'heuristic',
    }));
  }

  // Within a priority band, free fixes come first (they cost nothing), then the
  // anchor pieces the rest of the room gets arranged around, then accessories.
  const ANCHOR_ROLES = new Set(['sofa', 'bed', 'dining-table', 'desk', 'credenza', 'rug']);
  const rank = (s: Suggestion) => {
    const effort = s.effort === 'free' ? 0 : s.effort === 'cheap' ? 2 : 3;
    const role = s.catalogKey ? CATALOG_BY_KEY[s.catalogKey]?.role : null;
    const anchor = role && ANCHOR_ROLES.has(role) ? -1 : 0;
    return s.priority * 10 + effort + anchor;
  };
  out.sort((a, b) => rank(a) - rank(b));

  return { suggestions: out, styleScore: evaluation.styleScore };
}

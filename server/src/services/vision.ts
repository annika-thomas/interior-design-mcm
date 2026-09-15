import { z } from 'zod';
import type { CaptureTag, LibraryAnalysis, LibraryItem, Photo, PhotoAnalysis, RoomKind } from '../types.js';
import { structured, type ImagePart } from './claude.js';
import { ANTI_PATTERNS, MATERIALS, SCALE_ANCHORS } from '../mcm/knowledge.js';
import { CATALOG } from '../mcm/catalog.js';

const ROOM_KINDS = ['living', 'dining', 'bedroom', 'office', 'entry', 'kitchen', 'studio', 'other'] as const;

const anchorList = SCALE_ANCHORS
  .map((a) => `- ${a.label}: ${[a.heightCm ? `${a.heightCm} cm tall` : '', a.widthCm ? `${a.widthCm} cm wide` : ''].filter(Boolean).join(', ')} (${a.confidence} confidence)`)
  .join('\n');

const catalogKeys = CATALOG.map((c) => `${c.key} (${c.name})`).join(', ');
const antiPatternKeys = ANTI_PATTERNS.map((a) => `${a.key}: ${a.label}`).join('; ');
const materialKeys = MATERIALS.map((m) => m.key).join(', ');

const SURVEY_SYSTEM = `You are surveying a real apartment from photographs so it can be rebuilt as a dimensioned 3D model and then planned in mid-century modern style.

Two jobs, in this order.

1. MEASURE. Estimate real dimensions in centimetres. You must scale from an object of known size that is actually visible in the photo. Reference sizes:
${anchorList}

State which anchor you used. If no anchor is visible, set the dimension to null and say so in warnings — never invent a measurement you cannot support. Interior residential rooms are almost always between 240 and 280 cm tall; if you cannot see floor and ceiling in one frame, estimate height from the door instead. Prefer "null with an explanation" over a confident wrong number: the user can correct a missing number with a tape measure in thirty seconds, but will not think to check a plausible-looking wrong one.

2. INVENTORY. List the furniture actually present. For each piece, judge it against mid-century modern:
- "keeper": genuinely period-correct or period-compatible. Low, on legs, warm wood or period-correct upholstery.
- "workable": not MCM but does not fight it. Can stay.
- "clashes": actively works against the style — bulky rolled arms, furniture sitting flat on the floor, grey-washed wood, glossy chrome-and-glass, anything tall and heavy.
Be honest and specific about why. The user wants a real assessment, not reassurance.

When a piece resembles something in this catalog, name its key: ${catalogKeys}.
Materials vocabulary: ${materialKeys}.
Anti-pattern keys to report when you see them: ${antiPatternKeys}.

Judge colour temperature from the light in the photo: warm (2700K incandescent, yellow cast), neutral (3000-3500K), cool (4000K+, blue-white cast), or unknown if the photo is daylit only.

Report colours as hex. Give the wall and floor colour as the surface actually reads in neutral light, correcting for any colour cast from the bulbs.`;

const PhotoSchema = z.object({
  label: z.string().describe('The image label exactly as given to you'),
  summary: z.string().describe('Two sentences: what this photo shows and what it tells you about the room'),
  estimatedRoomKind: z.enum(ROOM_KINDS).nullable(),
  wallColorHex: z.string().nullable(),
  floorColorHex: z.string().nullable(),
  floorMaterial: z.string().nullable().describe('e.g. oak floorboards, beige carpet, grey LVT, tile'),
  colorTemperature: z.enum(['warm', 'neutral', 'cool', 'unknown']),
  lightingNotes: z.string().nullable().describe('Where light comes from and what is missing'),
  openings: z.array(z.object({
    kind: z.enum(['door', 'window', 'passage']),
    widthCm: z.number().nullable(),
    heightCm: z.number().nullable(),
    sillCm: z.number().nullable().describe('Height of the bottom edge above the floor; 0 for doors'),
    wallHint: z.string().nullable().describe('Which wall it sits on, if the capture tag makes that clear'),
  })),
  existingFurniture: z.array(z.object({
    label: z.string(),
    catalogKeyGuess: z.string().nullable(),
    widthCm: z.number().nullable(),
    depthCm: z.number().nullable(),
    heightCm: z.number().nullable(),
    material: z.string().nullable(),
    color: z.string().nullable().describe('Hex'),
    mcmVerdict: z.enum(['keeper', 'workable', 'clashes']),
    reason: z.string(),
  })),
  antiPatterns: z.array(z.string()).describe('Anti-pattern keys from the list provided'),
  warnings: z.array(z.string()).describe('Anything you could not determine, and why'),
});

const SurveySchema = z.object({
  photos: z.array(PhotoSchema),
  room: z.object({
    widthCm: z.number().nullable(),
    depthCm: z.number().nullable(),
    heightCm: z.number().nullable(),
    scaleAnchor: z.string().nullable().describe('The known-size object you scaled from'),
    confidence: z.enum(['low', 'medium', 'high']),
    kind: z.enum(ROOM_KINDS).nullable(),
    notes: z.string().describe('What would most improve the accuracy of this survey'),
  }),
});

export type SurveyResult = z.infer<typeof SurveySchema>;

export interface SurveyInput {
  roomName: string;
  roomKind: RoomKind;
  images: Array<{ photoId: string; part: ImagePart; captureTag: CaptureTag }>;
  knownDims?: { widthCm?: number | null; depthCm?: number | null; heightCm?: number | null };
}

/**
 * Survey a room from its photographs.
 *
 * Returns per-photo analyses plus a single reconciled room estimate. All photos
 * of a room go in one call on purpose — a door visible in one frame sets the
 * scale for every other frame, which a per-photo call could not do.
 */
export async function surveyRoom(input: SurveyInput): Promise<SurveyResult | null> {
  if (!input.images.length) return null;

  const known = input.knownDims ?? {};
  const knownNote = [
    known.widthCm ? `width ${known.widthCm} cm` : '',
    known.depthCm ? `depth ${known.depthCm} cm` : '',
    known.heightCm ? `ceiling ${known.heightCm} cm` : '',
  ].filter(Boolean).join(', ');

  const prompt = `Room: "${input.roomName}" (the user labelled it as a ${input.roomKind} room).

${input.images.length} photo(s), each labelled with where it was shot:
${input.images.map((i, n) => `${n + 1}. ${i.part.label} — capture angle: ${i.captureTag}`).join('\n')}

${knownNote ? `The user has already measured: ${knownNote}. Treat these as ground truth and scale everything else from them.` : 'No measurements have been taken yet, so every dimension here is your estimate.'}

Return one entry in "photos" for every image, using the exact label given. Then reconcile them into a single "room" estimate. Where photos disagree, prefer the one with the clearest view of a known-size reference and say which in scaleAnchor.`;

  return structured({
    system: SURVEY_SYSTEM,
    prompt,
    schema: SurveySchema,
    images: input.images.map((i) => i.part),
  });
}

/** Fold a Claude survey result back onto a single photo record. */
export function toPhotoAnalysis(entry: z.infer<typeof PhotoSchema>, room: SurveyResult['room']): PhotoAnalysis {
  return {
    engine: 'claude',
    summary: entry.summary,
    estimatedRoomKind: entry.estimatedRoomKind,
    dimensions: {
      widthCm: room.widthCm,
      depthCm: room.depthCm,
      heightCm: room.heightCm,
      scaleAnchor: room.scaleAnchor,
      confidence: room.confidence,
    },
    wallColor: entry.wallColorHex,
    floorColor: entry.floorColorHex,
    floorMaterial: entry.floorMaterial,
    lightingNotes: entry.lightingNotes,
    colorTemperature: entry.colorTemperature,
    openings: entry.openings,
    existingFurniture: entry.existingFurniture,
    antiPatterns: entry.antiPatterns,
    warnings: entry.warnings,
  };
}

/**
 * Deterministic fallback when no API key is set.
 *
 * It uses the dominant colours the browser extracted at upload time plus the
 * capture tag, and is explicit about what it cannot know. This keeps the whole
 * app usable without a key instead of leaving photo analysis as a dead button.
 */
export function heuristicPhotoAnalysis(
  photo: Photo,
  hints: { dominantColors?: string[]; brightness?: number } = {},
): PhotoAnalysis {
  const colors = hints.dominantColors ?? [];
  const warnings = [
    'Estimated without vision analysis — set ANTHROPIC_API_KEY for real dimension and furniture detection.',
  ];
  const tag = photo.captureTag;
  const wallish = tag.startsWith('wall-') || tag === 'corner' || tag === 'wide';

  return {
    engine: 'heuristic',
    summary: wallish
      ? 'Wall shot. Colours below were sampled from the image in your browser; dimensions need a tape measure or an API key.'
      : `Tagged "${tag}". Recorded for reference; no measurements derived.`,
    estimatedRoomKind: null,
    dimensions: null,
    wallColor: wallish ? colors[0] ?? null : null,
    floorColor: tag === 'floor' ? colors[0] ?? null : colors[1] ?? null,
    floorMaterial: null,
    lightingNotes: hints.brightness != null
      ? hints.brightness < 0.35
        ? 'Reads dark — this room is probably under-lit. Check the three-light-sources rule.'
        : 'Reads reasonably bright.'
      : null,
    colorTemperature: null,
    openings: [],
    existingFurniture: [],
    antiPatterns: [],
    warnings,
  };
}

// --- Library item analysis ------------------------------------------------

const LIBRARY_SYSTEM = `You are cataloguing a piece of saved interior-design inspiration for someone furnishing their apartment in mid-century modern style.

Say what is actually worth stealing from it. Concrete and specific: "the credenza floats 20 cm off the floor on brass legs and the wall behind it is a single flat warm white" is useful. "Nice mid-century vibes" is not.

Score mcmScore 0-100 on how squarely the piece or image sits in the 1945-1969 idiom — low-slung, tapered or hairpin legs, warm woods, restrained palette with one saturated accent, organic curve against the grid. A beautiful room that is Japandi, industrial or contemporary should score low; that is useful information, not a criticism.

If the item is a single product or a piece of furniture that could be placed in a room, name the catalog role it fills and the closest catalog key.
Catalog keys: ${catalogKeys}.
Roles: sofa, lounge-chair, dining-chair, bench, bar-stool, coffee-table, side-table, dining-table, desk, console, bar-cart, credenza, dresser, nightstand, bookshelf, room-divider, bed, floor-lamp, table-lamp, pendant, task-lamp, rug, curtains, art, mirror, plant, ceramics.
If the item is a whole room or a mood shot rather than one product, leave roleGuess and catalogKeyGuess null and put the value in takeaways.`;

const LibrarySchema = z.object({
  summary: z.string().describe('One or two sentences on what this is'),
  roleGuess: z.string().nullable(),
  catalogKeyGuess: z.string().nullable(),
  paletteHexes: z.array(z.string()).describe('Three to five hex colours that define it'),
  materials: z.array(z.string()),
  mcmScore: z.number().describe('0-100'),
  era: z.string().nullable(),
  formNotes: z.string().nullable().describe('Silhouette, proportion, leg style, how it sits in space'),
  takeaways: z.array(z.string()).describe('Two to four specific, actionable things to steal from this'),
  tags: z.array(z.string()).describe('Short lowercase tags for filtering'),
});

export async function analyzeLibraryItem(
  item: Pick<LibraryItem, 'kind' | 'title' | 'url' | 'notes' | 'tags'>,
  image?: ImagePart,
): Promise<(LibraryAnalysis & { tags: string[] }) | null> {
  const context = [
    `Kind: ${item.kind}`,
    `Title: ${item.title}`,
    item.url ? `URL: ${item.url}` : '',
    item.notes ? `The user's own note: ${item.notes}` : '',
    item.tags.length ? `Existing tags: ${item.tags.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const prompt = image
    ? `${context}\n\nAnalyze the attached image.`
    : `${context}\n\nNo image is attached — work from the title, URL and note above. If the URL names a recognizable product or designer, use that. Be explicit in the summary about how much you are inferring, and keep mcmScore conservative when you are working from a title alone.`;

  const result = await structured({
    system: LIBRARY_SYSTEM,
    prompt,
    schema: LibrarySchema,
    images: image ? [image] : undefined,
    maxTokens: 4000,
  });
  if (!result) return null;

  return {
    engine: 'claude',
    summary: result.summary,
    roleGuess: result.roleGuess,
    catalogKeyGuess: result.catalogKeyGuess,
    paletteHexes: result.paletteHexes,
    materials: result.materials,
    mcmScore: Math.max(0, Math.min(100, Math.round(result.mcmScore))),
    era: result.era,
    formNotes: result.formNotes,
    takeaways: result.takeaways,
    tags: result.tags,
  };
}

/** Keyword fallback that reads the title, URL and note for catalog roles. */
export function heuristicLibraryAnalysis(
  item: Pick<LibraryItem, 'kind' | 'title' | 'url' | 'notes' | 'tags'>,
  dominantColors: string[] = [],
): LibraryAnalysis {
  const haystack = `${item.title} ${item.url ?? ''} ${item.notes} ${item.tags.join(' ')}`.toLowerCase();

  let best: { key: string; role: string; score: number } | null = null;
  for (const c of CATALOG) {
    const words = new Set([
      ...c.name.toLowerCase().split(/\W+/),
      ...c.role.split('-'),
      ...c.tags,
      ...c.inspiredBy.toLowerCase().split(/\W+/),
    ].filter((w) => w.length > 3));
    let score = 0;
    for (const w of words) if (haystack.includes(w)) score += 1;
    if (score && (!best || score > best.score)) best = { key: c.key, role: c.role, score };
  }

  const mcmWords = ['mid-century', 'midcentury', 'mcm', 'eames', 'saarinen', 'nelson', 'wegner',
    'danish', 'walnut', 'teak', 'tapered', 'hairpin', 'atomic', 'sputnik', '1950', '1960'];
  const hits = mcmWords.filter((w) => haystack.includes(w)).length;

  return {
    engine: 'heuristic',
    summary: best
      ? `Matched to "${best.key}" by keyword. Add an API key for a real read of the image.`
      : 'Saved. Without an API key this is filed by keyword only.',
    roleGuess: best?.role ?? null,
    catalogKeyGuess: best?.key ?? null,
    paletteHexes: dominantColors.slice(0, 5),
    materials: MATERIALS.filter((m) => haystack.includes(m.key) || haystack.includes(m.name.toLowerCase())).map((m) => m.key),
    mcmScore: Math.min(90, 40 + hits * 12 + (best ? 10 : 0)),
    era: null,
    formNotes: null,
    takeaways: [],
  };
}

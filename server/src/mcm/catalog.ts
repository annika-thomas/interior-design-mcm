/**
 * Parametric furniture catalog.
 *
 * Nothing here is a downloaded 3D asset. Each entry is a set of real-world
 * dimensions plus a `shape` descriptor that the browser turns into geometry
 * procedurally. That keeps the repo tiny, makes every piece resizable to match
 * something you actually own, and still exports as clean glTF for Blender.
 */

export type LegStyle = 'tapered' | 'hairpin' | 'splayed' | 'pedestal' | 'tripod' | 'plinth' | 'sled' | 'none';

export type ShapeKind =
  | 'sofa'
  | 'lounge-chair'
  | 'shell-chair'
  | 'chair'
  | 'table'
  | 'case'
  | 'shelf'
  | 'bed'
  | 'floor-lamp'
  | 'arc-lamp'
  | 'table-lamp'
  | 'pendant'
  | 'sputnik'
  | 'rug'
  | 'art'
  | 'mirror'
  | 'plant'
  | 'divider'
  | 'cart'
  | 'box';

export type Placement =
  | 'against-wall'
  | 'floating'
  | 'corner'
  | 'beside-seat'
  | 'in-front-of-seat'
  | 'under-group'
  | 'over-table'
  | 'ceiling'
  | 'wall-mounted'
  | 'anywhere';

export interface CatalogItem {
  key: string;
  name: string;
  /** Functional slot used by the room program matcher. */
  role: string;
  category: 'seating' | 'tables' | 'storage' | 'lighting' | 'soft' | 'decor' | 'sleeping' | 'work';
  /** Centimetres: width (x), depth (z), height (y). */
  dims: { w: number; d: number; h: number };
  shape: ShapeKind;
  legs: LegStyle;
  /** Height of the clear gap under the piece, in cm. Drives the "leg lift" rule. */
  legClearanceCm: number;
  materials: string[];
  /** Default render colors, overridable per placed instance. */
  colors: { primary: string; secondary?: string; accent?: string };
  placement: Placement[];
  /** Clear floor the piece needs in front of it, in cm. */
  clearanceCm: number;
  priceBand: 1 | 2 | 3 | 4;
  era: string;
  inspiredBy: string;
  note: string;
  tags: string[];
}

const C = (
  key: string,
  name: string,
  role: string,
  category: CatalogItem['category'],
  w: number,
  d: number,
  h: number,
  shape: ShapeKind,
  legs: LegStyle,
  legClearanceCm: number,
  materials: string[],
  colors: CatalogItem['colors'],
  placement: Placement[],
  clearanceCm: number,
  priceBand: CatalogItem['priceBand'],
  era: string,
  inspiredBy: string,
  note: string,
  tags: string[],
): CatalogItem => ({
  key, name, role, category, dims: { w, d, h }, shape, legs, legClearanceCm,
  materials, colors, placement, clearanceCm, priceBand, era, inspiredBy, note, tags,
});

export const CATALOG: CatalogItem[] = [
  // ---- Seating ---------------------------------------------------------
  C('sofa-3seat', 'Low Tapered Three-Seat Sofa', 'sofa', 'seating', 213, 84, 76, 'sofa', 'tapered', 18,
    ['tweed', 'walnut'], { primary: '#8C8578', secondary: '#5C4033' },
    ['floating', 'against-wall'], 45, 3, '1955-1965', 'Florence Knoll / Adrian Pearsall lounge sofas',
    'The anchor of the room. Keep the back under 80 cm so it never crosses the low horizon line.',
    ['sofa', 'seating', 'living', 'hero']),

  C('sofa-loveseat', 'Two-Seat Loveseat', 'sofa', 'seating', 152, 80, 76, 'sofa', 'tapered', 18,
    ['tweed', 'walnut'], { primary: '#7A8B7A', secondary: '#5C4033' },
    ['floating', 'against-wall'], 45, 2, '1955-1965', 'Danish two-seaters',
    'For rooms under about 14 sqm where a full three-seater would eat the circulation path.',
    ['sofa', 'seating', 'small-space']),

  C('lounge-chair', 'Molded Lounge Chair & Ottoman', 'lounge-chair', 'seating', 84, 90, 82, 'lounge-chair', 'splayed', 14,
    ['bentply', 'leather'], { primary: '#7B4A2D', secondary: '#5C4033' },
    ['corner', 'beside-seat', 'floating'], 60, 4, '1956', 'Eames Lounge Chair 670',
    'The one piece worth saving for. Needs about 60 cm of breathing room behind it to recline.',
    ['chair', 'seating', 'icon', 'leather', 'hero']),

  C('shell-chair', 'Fiberglass Shell Armchair', 'lounge-chair', 'seating', 62, 60, 79, 'shell-chair', 'splayed', 34,
    ['fiberglass', 'blackened-steel'], { primary: '#E4572E' },
    ['beside-seat', 'corner', 'anywhere'], 40, 2, '1950', 'Eames DAW / RAR shell',
    'The cheapest way to introduce a saturated period accent. Excellent as the room’s one loud thing.',
    ['chair', 'accent', 'icon', 'budget']),

  C('womb-chair', 'Womb Lounge Chair', 'lounge-chair', 'seating', 106, 94, 92, 'lounge-chair', 'splayed', 20,
    ['wool-boucle', 'chrome'], { primary: '#D8D2C4', secondary: '#C6C8CA' },
    ['corner', 'beside-seat'], 55, 4, '1948', 'Saarinen Womb Chair 70',
    'Your organic counterpoint in one move — the curve that keeps a rectilinear room from reading cold.',
    ['chair', 'curve', 'icon', 'organic']),

  C('slipper-chair', 'Armless Slipper Chair', 'lounge-chair', 'seating', 66, 72, 74, 'chair', 'tapered', 16,
    ['tweed', 'walnut'], { primary: '#C97B4A', secondary: '#5C4033' },
    ['beside-seat', 'corner', 'anywhere'], 40, 2, '1955-1965', 'Milo Baughman slipper chairs',
    'Armless keeps sightlines open. Good second seat in a room too tight for a lounge chair.',
    ['chair', 'small-space']),

  C('dining-chair', 'Wishbone Dining Chair', 'dining-chair', 'seating', 55, 52, 76, 'chair', 'tapered', 42,
    ['oak', 'rattan'], { primary: '#C4A77D', secondary: '#C9A66B' },
    ['anywhere'], 45, 2, '1949', 'Hans Wegner CH24',
    'Woven paper-cord seat adds texture at the table where everything else is hard surface.',
    ['chair', 'dining', 'icon']),

  C('dining-chair-shell', 'Shell Dining Chair', 'dining-chair', 'seating', 54, 52, 80, 'shell-chair', 'tapered', 40,
    ['fiberglass', 'oak'], { primary: '#EDE7DC', secondary: '#C4A77D' },
    ['anywhere'], 45, 1, '1950', 'Eames DSW',
    'Budget dining seating that is genuinely period-correct. Mixing shell colors around one table is authentic.',
    ['chair', 'dining', 'budget']),

  C('bench', 'Slatted Wood Bench', 'bench', 'seating', 122, 47, 36, 'table', 'plinth', 0,
    ['walnut'], { primary: '#5C4033' },
    ['against-wall', 'anywhere'], 40, 2, '1946', 'Nelson Platform Bench',
    'Doubles as entry seating, coffee table, or a landing strip at the foot of a bed.',
    ['bench', 'entry', 'flexible']),

  C('bar-stool', 'Walnut Counter Stool', 'bar-stool', 'seating', 42, 42, 76, 'chair', 'tapered', 60,
    ['walnut', 'leather'], { primary: '#5C4033', secondary: '#7B4A2D' },
    ['against-wall'], 35, 2, '1955-1965', 'Danish counter stools',
    'Backless keeps a small kitchen visually open. 76 cm seat for a 107 cm counter.',
    ['stool', 'kitchen']),

  // ---- Tables ----------------------------------------------------------
  C('coffee-table', 'Boomerang Coffee Table', 'coffee-table', 'tables', 122, 61, 40, 'table', 'tapered', 34,
    ['walnut'], { primary: '#5C4033' },
    ['in-front-of-seat'], 45, 2, '1955-1965', 'Kagan / Pearsall biomorphic tables',
    'Sit it 45 cm off the sofa and keep the top no higher than the seat cushion.',
    ['table', 'living', 'curve']),

  C('coffee-table-travertine', 'Travertine Oval Coffee Table', 'coffee-table', 'tables', 130, 70, 38, 'table', 'plinth', 8,
    ['travertine', 'blackened-steel'], { primary: '#D9CDBA', secondary: '#3A3A3C' },
    ['in-front-of-seat'], 45, 3, '1960-1969', 'Late-period stone-top tables',
    'The hard cool surface the texture rule asks for, without adding another wood tone.',
    ['table', 'stone', 'texture']),

  C('side-table', 'Tripod Side Table', 'side-table', 'tables', 46, 46, 55, 'table', 'tripod', 48,
    ['teak'], { primary: '#8B5A2B' },
    ['beside-seat'], 25, 1, '1955-1965', 'Danish tripod tables',
    'Top should land within 5 cm of the arm height of the chair it serves.',
    ['table', 'small', 'budget']),

  C('nesting-tables', 'Nesting Side Tables', 'side-table', 'tables', 56, 40, 52, 'table', 'tapered', 44,
    ['teak'], { primary: '#8B5A2B' },
    ['beside-seat', 'corner'], 25, 2, '1955-1965', 'Danish nesting tables',
    'Three surfaces in one footprint — the right answer when floor area is genuinely tight.',
    ['table', 'small-space', 'flexible']),

  C('dining-table-tulip', 'Tulip Pedestal Dining Table', 'dining-table', 'tables', 137, 137, 73, 'table', 'pedestal', 0,
    ['travertine', 'chrome'], { primary: '#EDE7DC', secondary: '#C6C8CA' },
    ['floating'], 90, 4, '1957', 'Saarinen Tulip Table',
    'The pedestal kills the "slum of legs" under a table — worth it in a tight dining corner.',
    ['table', 'dining', 'icon', 'curve']),

  C('dining-table-walnut', 'Walnut Draw-Leaf Dining Table', 'dining-table', 'tables', 180, 90, 74, 'table', 'tapered', 66,
    ['walnut'], { primary: '#5C4033' },
    ['floating', 'against-wall'], 90, 3, '1955-1965', 'Danish draw-leaf tables',
    'Extends for guests, shrinks daily. Leave 90 cm behind each chair for pulling out.',
    ['table', 'dining', 'flexible']),

  C('desk', 'Walnut Tapered-Leg Desk', 'desk', 'work', 152, 71, 74, 'case', 'tapered', 20,
    ['walnut', 'brass'], { primary: '#5C4033', secondary: '#B08D3F' },
    ['against-wall', 'floating'], 90, 3, '1955-1965', 'Jens Risom / Nelson home desks',
    'Float it facing into the room if you can. A desk shoved at a wall reads like an office cubicle.',
    ['desk', 'work']),

  C('console', 'Narrow Entry Console', 'console', 'tables', 110, 33, 78, 'case', 'tapered', 22,
    ['teak', 'brass'], { primary: '#8B5A2B', secondary: '#B08D3F' },
    ['against-wall'], 80, 2, '1955-1965', 'Danish hall consoles',
    'Under 35 cm deep so it never narrows the entry path below 75 cm.',
    ['console', 'entry', 'small-space']),

  C('bar-cart', 'Brass & Glass Bar Cart', 'bar-cart', 'tables', 76, 41, 79, 'cart', 'none', 12,
    ['brass', 'smoked-glass'], { primary: '#B08D3F', secondary: '#6B6560' },
    ['corner', 'against-wall'], 40, 2, '1955-1965', 'Period bar carts',
    'Adds brass and glass in one small footprint, and moves when you need the floor back.',
    ['cart', 'accent', 'small-space']),

  // ---- Storage ---------------------------------------------------------
  C('credenza', 'Walnut Credenza', 'credenza', 'storage', 183, 46, 76, 'case', 'tapered', 18,
    ['walnut', 'brass'], { primary: '#5C4033', secondary: '#B08D3F' },
    ['against-wall'], 80, 3, '1955-1965', 'Kofod-Larsen / Broyhill Brasilia sideboards',
    'The workhorse. Holds the TV, the records and the clutter, and gives one wall a long horizontal line.',
    ['storage', 'hero', 'living', 'walnut']),

  C('credenza-cane', 'Cane-Front Sideboard', 'credenza', 'storage', 160, 42, 74, 'case', 'tapered', 18,
    ['oak', 'rattan'], { primary: '#C4A77D', secondary: '#C9A66B' },
    ['against-wall'], 80, 2, '1955-1965', 'Cane-front Danish sideboards',
    'Lighter than walnut in both color and visual weight — better in a small or north-facing room.',
    ['storage', 'rattan', 'texture', 'budget']),

  C('record-cabinet', 'Record Cabinet', 'credenza', 'storage', 91, 42, 71, 'case', 'tapered', 18,
    ['teak'], { primary: '#8B5A2B' },
    ['against-wall', 'beside-seat'], 70, 2, '1955-1965', 'Period record consoles',
    'Sized for LPs. Sits comfortably beside a lounge chair as an oversized side table.',
    ['storage', 'records', 'small-space']),

  C('dresser', 'Nine-Drawer Lowboy Dresser', 'dresser', 'storage', 168, 46, 79, 'case', 'tapered', 18,
    ['walnut', 'brass'], { primary: '#5C4033', secondary: '#B08D3F' },
    ['against-wall'], 90, 3, '1955-1965', 'Broyhill / Lane lowboy dressers',
    'Low and wide rather than tall — it keeps the bedroom horizon under the window line.',
    ['storage', 'bedroom']),

  C('nightstand', 'Floating Nightstand', 'nightstand', 'storage', 50, 38, 56, 'case', 'tapered', 22,
    ['walnut'], { primary: '#5C4033' },
    ['beside-seat', 'against-wall'], 30, 1, '1955-1965', 'Danish bedside tables',
    'Top within 5 cm of the mattress height, or reaching for the lamp at night is awkward.',
    ['storage', 'bedroom', 'small']),

  C('bookshelf', 'Wall-Mounted Shelving System', 'bookshelf', 'storage', 180, 30, 200, 'shelf', 'none', 35,
    ['teak', 'blackened-steel'], { primary: '#8B5A2B', secondary: '#3A3A3C' },
    ['against-wall', 'wall-mounted'], 70, 3, '1949', 'String shelving / Nelson CSS',
    'Wall-hung storage that leaves the floor clear — the best storage answer for a small apartment.',
    ['storage', 'shelving', 'small-space', 'icon']),

  C('bookshelf-low', 'Low Open Bookcase', 'bookshelf', 'storage', 120, 32, 84, 'shelf', 'tapered', 16,
    ['walnut'], { primary: '#5C4033' },
    ['against-wall'], 70, 2, '1955-1965', 'Danish open bookcases',
    'Stays under the 90 cm case-good ceiling, so it can run beneath a window without blocking it.',
    ['storage', 'shelving']),

  C('room-divider', 'Open Slat Room Divider', 'room-divider', 'storage', 120, 35, 180, 'divider', 'none', 14,
    ['walnut'], { primary: '#5C4033' },
    ['floating'], 80, 3, '1955-1965', 'Period slat dividers',
    'Splits a studio into zones without building a wall or killing the light.',
    ['divider', 'studio', 'small-space']),

  // ---- Sleeping --------------------------------------------------------
  C('bed', 'Walnut Platform Bed (Queen)', 'bed', 'sleeping', 160, 212, 90, 'bed', 'tapered', 20,
    ['walnut', 'tweed'], { primary: '#5C4033', secondary: '#EDE7DC' },
    ['against-wall'], 70, 3, '1955-1965', 'Nelson thin-edge platform beds',
    'Low platform, slim headboard, visible legs. Skirted divan bases are the enemy of this style.',
    ['bed', 'bedroom', 'hero']),

  C('bed-full', 'Walnut Platform Bed (Full)', 'bed', 'sleeping', 137, 200, 90, 'bed', 'tapered', 20,
    ['walnut', 'tweed'], { primary: '#5C4033', secondary: '#EDE7DC' },
    ['against-wall'], 70, 3, '1955-1965', 'Nelson thin-edge platform beds',
    'For bedrooms under about 11 sqm, where a queen leaves no room to walk past.',
    ['bed', 'bedroom', 'small-space']),

  C('daybed', 'Teak Daybed', 'bed', 'sleeping', 190, 80, 72, 'sofa', 'tapered', 18,
    ['teak', 'wool-boucle'], { primary: '#8B5A2B', secondary: '#D8D2C4' },
    ['against-wall', 'floating'], 45, 3, '1955-1965', 'Wegner / Borge Mogensen daybeds',
    'Sofa by day, guest bed by night. The standard studio-apartment answer of the period.',
    ['bed', 'studio', 'flexible']),

  // ---- Lighting --------------------------------------------------------
  C('arc-lamp', 'Marble-Base Arc Floor Lamp', 'floor-lamp', 'lighting', 200, 35, 215, 'arc-lamp', 'plinth', 0,
    ['brass', 'travertine'], { primary: '#B08D3F', secondary: '#D9CDBA' },
    ['beside-seat', 'corner'], 30, 3, '1962', 'Castiglioni Arco',
    'Puts light over the seating group without wiring a ceiling fixture — ideal in a rental.',
    ['lighting', 'ambient', 'icon', 'renter-friendly']),

  C('floor-lamp', 'Tripod Floor Lamp', 'floor-lamp', 'lighting', 45, 45, 155, 'floor-lamp', 'tripod', 0,
    ['walnut', 'wool-boucle'], { primary: '#5C4033', secondary: '#EDE7DC' },
    ['beside-seat', 'corner'], 25, 2, '1955-1965', 'Danish tripod lamps',
    'Task light beside a reading chair. Shade bottom should sit near eye level when seated.',
    ['lighting', 'task', 'budget']),

  C('table-lamp', 'Mushroom Table Lamp', 'table-lamp', 'lighting', 36, 36, 46, 'table-lamp', 'none', 0,
    ['brass', 'smoked-glass'], { primary: '#B08D3F', secondary: '#E8DCC8' },
    ['anywhere'], 0, 2, '1960-1969', 'Period mushroom / dome lamps',
    'Your accent layer. Two small warm pools beat one bright overhead every time.',
    ['lighting', 'accent']),

  C('pendant', 'Globe Pendant', 'pendant', 'lighting', 40, 40, 40, 'pendant', 'none', 0,
    ['smoked-glass', 'brass'], { primary: '#E8DCC8', secondary: '#B08D3F' },
    ['over-table', 'ceiling'], 0, 2, '1955-1965', 'Nelson Bubble / opal globes',
    'Hang the bottom 75-85 cm above the tabletop so it lights faces, not the backs of heads.',
    ['lighting', 'ambient', 'dining']),

  C('sputnik', 'Sputnik Chandelier', 'pendant', 'lighting', 80, 80, 60, 'sputnik', 'none', 0,
    ['brass'], { primary: '#B08D3F' },
    ['ceiling', 'over-table'], 0, 3, '1957', 'Stilnovo / Sciolari sputniks',
    'A whole ceiling’s worth of personality. Needs 240 cm clearance below — check your ceiling first.',
    ['lighting', 'ambient', 'icon', 'statement']),

  C('task-lamp', 'Brass Task Lamp', 'task-lamp', 'lighting', 30, 45, 55, 'table-lamp', 'none', 0,
    ['brass'], { primary: '#B08D3F' },
    ['anywhere'], 0, 2, '1955-1965', 'Period articulated desk lamps',
    'Articulated arm, warm bulb. Essential on a desk and it stops the overhead from being the only source.',
    ['lighting', 'task', 'work']),

  // ---- Soft goods ------------------------------------------------------
  C('rug', 'Geometric Wool Rug', 'rug', 'soft', 240, 300, 2, 'rug', 'none', 0,
    ['wool-boucle'], { primary: '#C97B4A', secondary: '#EDE6D8', accent: '#3F5E4E' },
    ['under-group'], 0, 3, '1955-1965', 'Period geometric flatweaves',
    'Big enough that the front legs of every seat land on it. Undersized rugs shrink a room.',
    ['rug', 'texture', 'color']),

  C('rug-shag', 'Ivory Shag Rug', 'rug', 'soft', 200, 290, 4, 'rug', 'none', 0,
    ['wool-boucle'], { primary: '#EDE7DC' },
    ['under-group'], 0, 2, '1960-1969', 'Late-period shag',
    'The soft-pile texture layer. Quiet enough to sit under a bold sofa without competing.',
    ['rug', 'texture', 'neutral']),

  C('curtains', 'Ceiling-Hung Linen Curtains', 'curtains', 'soft', 200, 12, 260, 'divider', 'none', 0,
    ['wool-boucle'], { primary: '#EDE7DC' },
    ['wall-mounted'], 0, 2, '1955-1965', 'Period floor-length drapery',
    'Rod at the ceiling, panels wider than the window. Makes the glass — and the room — read taller.',
    ['soft', 'window', 'budget']),

  // ---- Decor -----------------------------------------------------------
  C('art', 'Large Abstract Canvas', 'art', 'decor', 120, 4, 90, 'art', 'none', 0,
    ['bentply'], { primary: '#D94F30', secondary: '#EDE6D8', accent: '#2E8B8B' },
    ['wall-mounted'], 0, 2, '1955-1965', 'Period abstract expressionism',
    'One large piece, center at 145 cm. Beats a scatter of small frames in every MCM room.',
    ['art', 'wall', 'hero', 'color']),

  C('starburst-clock', 'Starburst Wall Clock', 'art', 'decor', 60, 8, 60, 'art', 'none', 0,
    ['walnut', 'brass'], { primary: '#5C4033', secondary: '#B08D3F' },
    ['wall-mounted'], 0, 1, '1950-1960', 'Nelson Sunburst Clock',
    'The most recognizable MCM object there is. Exactly one per apartment.',
    ['decor', 'wall', 'icon', 'budget']),

  C('mirror', 'Round Sunburst Mirror', 'mirror', 'decor', 80, 6, 80, 'mirror', 'none', 0,
    ['brass'], { primary: '#B08D3F', secondary: '#C6C8CA' },
    ['wall-mounted'], 0, 2, '1955-1965', 'Period convex sunburst mirrors',
    'A round mirror is an easy organic counterpoint, and it bounces light into a dim entry.',
    ['decor', 'wall', 'entry', 'curve']),

  C('plant-large', 'Large Rubber Plant', 'plant', 'decor', 90, 90, 180, 'plant', 'none', 0,
    ['rattan'], { primary: '#3F5E4E', secondary: '#C9A66B' },
    ['corner', 'anywhere'], 20, 1, 'timeless', 'Period houseplants',
    'Fills a dead corner and supplies the organic curve for almost nothing.',
    ['plant', 'organic', 'budget', 'corner']),

  C('plant-small', 'Monstera in Ceramic Pot', 'plant', 'decor', 55, 55, 95, 'plant', 'none', 0,
    ['rattan'], { primary: '#3F5E4E', secondary: '#E8DCC8' },
    ['anywhere'], 15, 1, 'timeless', 'Period houseplants',
    'Sits on a credenza or the floor beside a chair. Breaks up long horizontal lines.',
    ['plant', 'organic', 'budget']),

  C('ceramics', 'Ceramic Vessel Group', 'ceramics', 'decor', 40, 25, 35, 'box', 'none', 0,
    ['travertine'], { primary: '#C97B4A', secondary: '#E8DCC8' },
    ['anywhere'], 0, 1, '1955-1965', 'Studio pottery of the period',
    'Group in odd numbers at varying heights. The cheapest way to finish a credenza top.',
    ['decor', 'styling', 'budget']),
];

export const CATALOG_BY_KEY: Record<string, CatalogItem> = Object.fromEntries(
  CATALOG.map((c) => [c.key, c]),
);

export const CATALOG_BY_ROLE: Record<string, CatalogItem[]> = CATALOG.reduce(
  (acc, item) => {
    (acc[item.role] ||= []).push(item);
    return acc;
  },
  {} as Record<string, CatalogItem[]>,
);

/** Cheapest catalog option that fills a role, used when budget is the constraint. */
export function cheapestForRole(role: string): CatalogItem | undefined {
  return (CATALOG_BY_ROLE[role] || []).slice().sort((a, b) => a.priceBand - b.priceBand)[0];
}

/** Best-fitting option for a role given the floor area available, in square metres. */
export function fitForRole(role: string, areaSqm: number): CatalogItem | undefined {
  const options = CATALOG_BY_ROLE[role] || [];
  if (!options.length) return undefined;
  const small = areaSqm < 14;
  const ranked = options.slice().sort((a, b) => {
    const footprint = (i: CatalogItem) => i.dims.w * i.dims.d;
    return small ? footprint(a) - footprint(b) : footprint(b) - footprint(a);
  });
  return ranked[0];
}

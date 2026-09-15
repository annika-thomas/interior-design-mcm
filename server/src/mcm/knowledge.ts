/**
 * Mid-century modern design knowledge.
 *
 * This is the deterministic core of the app. Every palette, ratio and rule here
 * comes from the conventions of the 1945-1969 period (Eames/Saarinen/Nelson/Wegner
 * era American + Scandinavian modernism) rather than from a model's guess, so the
 * planner gives useful, consistent advice with or without an API key attached.
 */

export interface Palette {
  key: string;
  name: string;
  era: string;
  /** Large surfaces: walls, big rugs, primary upholstery. 60% of the room. */
  dominant: string[];
  /** Secondary mass: case goods, secondary seating. 30%. */
  secondary: string[];
  /** Accents: pillows, art, ceramics, a single bold chair. 10%. */
  accent: string[];
  notes: string;
}

export const PALETTES: Palette[] = [
  {
    key: 'palm-springs',
    name: 'Palm Springs Desert',
    era: '1955-1965',
    dominant: ['#F2EDE4', '#E8DCC8', '#FFFFFF'],
    secondary: ['#8C6A4A', '#C97B4A', '#7A8B7A'],
    accent: ['#D94F30', '#F2B134', '#2E8B8B'],
    notes:
      'Sun-bleached plaster and walnut with hot accents. Built for bright rooms with lots of glass; the white keeps the saturated accents from reading as costume.',
  },
  {
    key: 'scandinavian',
    name: 'Scandinavian Modern',
    era: '1950-1965',
    dominant: ['#F7F4EF', '#EDE7DC', '#FFFFFF'],
    secondary: ['#C9A227', '#B08D57', '#9AA5A0'],
    accent: ['#3D5A5B', '#A65E46', '#2B2B2B'],
    notes:
      'Teak and oak against near-white walls. Lower contrast and warmer than the American version — leans on grain and wool texture rather than color for interest.',
  },
  {
    key: 'walnut-olive',
    name: 'Walnut & Olive',
    era: '1958-1968',
    dominant: ['#EDE6D8', '#DCD3C1', '#F5F1E8'],
    secondary: ['#5C4033', '#6B7145', '#8A7A5C'],
    accent: ['#C25A28', '#D9A441', '#3F5E4E'],
    notes:
      'The classic American living-room palette. Olive and ochre do the heavy lifting; works beautifully in north-facing rooms where cooler palettes go grey.',
  },
  {
    key: 'atomic',
    name: 'Atomic Ranch',
    era: '1952-1962',
    dominant: ['#F4F1E9', '#E4E9EC', '#FFFFFF'],
    secondary: ['#2E5E6E', '#B5651D', '#6E6E6E'],
    accent: ['#E4572E', '#F2C14E', '#17BEBB'],
    notes:
      'Higher contrast and more playful — turquoise, orange, charcoal. Best used where you have one large blank wall to hold a single graphic gesture.',
  },
  {
    key: 'moody-modern',
    name: 'Moody Modern',
    era: '1960-1969',
    dominant: ['#2F3336', '#3E4448', '#E9E4DA'],
    secondary: ['#7A5C3E', '#55603F', '#8C8071'],
    accent: ['#D08C3E', '#B5443A', '#C9C3B6'],
    notes:
      'Late-period, darker and more masculine. Needs generous layered lighting — at least three sources — or it collapses into gloom after sunset.',
  },
];

export interface MaterialNote {
  key: string;
  name: string;
  role: string;
  hex: string;
  authentic: boolean;
  notes: string;
}

export const MATERIALS: MaterialNote[] = [
  { key: 'walnut', name: 'American Walnut', role: 'primary wood', hex: '#5C4033', authentic: true, notes: 'The default MCM wood. Warm chocolate with open grain; darkens with age.' },
  { key: 'teak', name: 'Teak', role: 'primary wood', hex: '#8B5A2B', authentic: true, notes: 'Danish work. Golden-brown, oily, ages to honey. Pairs with wool and leather.' },
  { key: 'oak', name: 'White Oak', role: 'primary wood', hex: '#C4A77D', authentic: true, notes: 'Lighter Scandinavian option. Good in small or dim rooms where walnut would close things in.' },
  { key: 'rosewood', name: 'Rosewood', role: 'statement wood', hex: '#65332B', authentic: true, notes: 'Reserved for one hero piece — a credenza or desk. Too much reads heavy.' },
  { key: 'bentply', name: 'Bent Plywood', role: 'seating shell', hex: '#B08054', authentic: true, notes: 'Eames-era molded ply. Reads light because you see through and under it.' },
  { key: 'fiberglass', name: 'Fiberglass Shell', role: 'seating shell', hex: '#E0DCCF', authentic: true, notes: 'Speckled shell chairs. Cheap way to get period-correct silhouettes at the dining table.' },
  { key: 'wool-boucle', name: 'Wool Bouclé', role: 'upholstery', hex: '#D8D2C4', authentic: true, notes: 'Nubby, light-catching. Softens a room full of hard wood edges.' },
  { key: 'tweed', name: 'Wool Tweed', role: 'upholstery', hex: '#8C8578', authentic: true, notes: 'Period-correct sofa fabric. Flecked neutrals hide wear better than flat weave.' },
  { key: 'leather', name: 'Aniline Leather', role: 'upholstery', hex: '#7B4A2D', authentic: true, notes: 'Cognac or chocolate on a lounge chair. Develops patina; avoid corrected-grain shine.' },
  { key: 'brass', name: 'Brushed Brass', role: 'metal', hex: '#B08D3F', authentic: true, notes: 'Lighting and hardware. Brushed, not polished — polished reads 2015 rather than 1955.' },
  { key: 'blackened-steel', name: 'Blackened Steel', role: 'metal', hex: '#3A3A3C', authentic: true, notes: 'Hairpin legs, shelving uprights, lamp stems. Keeps heavy pieces visually light.' },
  { key: 'travertine', name: 'Travertine', role: 'stone', hex: '#D9CDBA', authentic: true, notes: 'Coffee and side table tops. Warmer and more period-correct than white marble.' },
  { key: 'smoked-glass', name: 'Smoked Glass', role: 'glass', hex: '#6B6560', authentic: true, notes: 'Late-period tabletops and pendant shades. Adds depth without visual weight.' },
  { key: 'rattan', name: 'Rattan / Cane', role: 'weave', hex: '#C9A66B', authentic: true, notes: 'Cabinet door fronts and chair backs. The cheapest way to add warmth and texture.' },
  { key: 'chrome', name: 'Polished Chrome', role: 'metal', hex: '#C6C8CA', authentic: false, notes: 'Bauhaus-adjacent, not really MCM. One piece maximum, or the room drifts toward 1980s.' },
  { key: 'greywash', name: 'Grey-Washed Wood', role: 'wood', hex: '#9A9A94', authentic: false, notes: 'A 2010s finish. Reads farmhouse; it will fight everything else in the room.' },
];

export interface DesignRule {
  key: string;
  title: string;
  category: 'proportion' | 'layout' | 'color' | 'material' | 'lighting' | 'styling';
  rule: string;
  why: string;
  /** Machine-checkable thresholds where the rule can be evaluated against a room. */
  check?: { metric: string; min?: number; max?: number; unit?: string };
}

export const DESIGN_RULES: DesignRule[] = [
  {
    key: 'leg-lift',
    title: 'Everything stands on legs',
    category: 'proportion',
    rule: 'Sofas, chairs, credenzas and beds should sit on visible legs with at least 12 cm of clear floor beneath them.',
    why: 'Seeing the floor run underneath furniture is the single strongest mid-century cue. It makes a small apartment read noticeably larger because the floor plane stays continuous.',
    check: { metric: 'leg_clearance_cm', min: 12, unit: 'cm' },
  },
  {
    key: 'low-horizon',
    title: 'Keep the horizon low',
    category: 'proportion',
    rule: 'Seat heights around 38-43 cm, sofa backs under 80 cm, and case goods under 90 cm. Nothing but shelving and art goes above eye level.',
    why: 'The period was designed around low ceilings and long horizontal sightlines. A tall sectional or a 2 m armoire breaks the horizon and instantly reads contemporary.',
    check: { metric: 'case_good_height_cm', max: 90, unit: 'cm' },
  },
  {
    key: 'walk-path',
    title: 'Leave a real walking path',
    category: 'layout',
    rule: 'Maintain 75-90 cm of clear circulation through the main route of every room, and 45 cm between a sofa and its coffee table.',
    why: 'Mid-century plans were open but not empty. Crowding is the most common way a well-furnished MCM room starts to feel like a showroom you have to edge around.',
    check: { metric: 'circulation_cm', min: 75, unit: 'cm' },
  },
  {
    key: 'float-the-seating',
    title: 'Float the seating group',
    category: 'layout',
    rule: 'Pull the sofa 10-25 cm off the wall and anchor the group on a rug rather than pushing everything to the perimeter.',
    why: 'Perimeter-pushed furniture creates a dead pool in the middle of the room. Floating defines a conversation zone, which is what the open plans of the era were organized around.',
  },
  {
    key: 'rug-anchor',
    title: 'The rug carries the front legs',
    category: 'layout',
    rule: 'Size the rug so at least the front legs of every seat in the group land on it. In a living room that usually means 200x300 cm minimum.',
    why: 'An undersized rug reads as a bath mat adrift in the room and visually shrinks the seating group instead of binding it.',
    check: { metric: 'rug_area_ratio', min: 0.3 },
  },
  {
    key: 'sixty-thirty-ten',
    title: '60 / 30 / 10 color split',
    category: 'color',
    rule: 'One dominant neutral across 60% of visible surface, a secondary wood or muted tone at 30%, and a saturated period accent at 10%.',
    why: 'MCM color is bold but rationed. The saturated oranges and teals only work because they sit against a large quiet field.',
    check: { metric: 'accent_coverage', max: 0.15 },
  },
  {
    key: 'one-loud-thing',
    title: 'One loud thing per room',
    category: 'color',
    rule: 'Exactly one piece per room is allowed to shout — a tangerine lounge chair, a graphic rug, or a large abstract canvas. Everything else supports it.',
    why: 'Two competing heroes cancel each other out and the room reads as a furniture store rather than a home.',
  },
  {
    key: 'wood-consistency',
    title: 'Two wood tones, maximum',
    category: 'material',
    rule: 'Pick one primary wood (walnut or teak) and at most one secondary. Match undertone — do not mix a cool grey-oak with a warm teak.',
    why: 'Mixed, mismatched wood tones are the fastest way to make a genuinely good set of pieces look accidental.',
    check: { metric: 'wood_tone_count', max: 2 },
  },
  {
    key: 'texture-count',
    title: 'At least four textures',
    category: 'material',
    rule: 'Every room needs wood, a woven textile, a soft pile, and one hard cool surface (stone, glass or metal).',
    why: 'MCM palettes are restrained, so texture is what keeps a room from going flat. Restraint in color has to be paid for in material variety.',
    check: { metric: 'texture_count', min: 4 },
  },
  {
    key: 'three-light-sources',
    title: 'Three light sources per room',
    category: 'lighting',
    rule: 'Ambient (pendant or arc lamp), task (reading lamp by the seat), and accent (table lamp, sconce or uplight on a plant).',
    why: 'Single-overhead lighting flattens everything. Layered pools of warm light are what make the period photographs look the way they do.',
    check: { metric: 'light_source_count', min: 3 },
  },
  {
    key: 'warm-bulbs',
    title: 'Warm bulbs only',
    category: 'lighting',
    rule: 'Use 2700K or warmer everywhere. Never mix color temperatures within one room.',
    why: 'Walnut, brass and wool all depend on warm light to show their color. Cool white turns the whole palette grey and muddy.',
  },
  {
    key: 'negative-space',
    title: 'Protect the negative space',
    category: 'styling',
    rule: 'Leave at least one wall and one horizontal surface genuinely empty.',
    why: 'The style is as much about what is absent as present. An empty wall gives the eye somewhere to rest and makes the pieces you did choose register.',
  },
  {
    key: 'art-height',
    title: 'Hang art at 145 cm to center',
    category: 'styling',
    rule: 'Center of the artwork at 145 cm from the floor, or 20-25 cm above a sofa back.',
    why: 'Art hung too high is the most common styling mistake and it breaks the low horizontal line the furniture works so hard to establish.',
    check: { metric: 'art_center_cm', min: 135, max: 155, unit: 'cm' },
  },
  {
    key: 'organic-counterpoint',
    title: 'One organic curve per room',
    category: 'styling',
    rule: 'Against all the straight lines and tapered legs, add one genuinely curved element — a womb chair, a kidney table, a round mirror, or a large leafy plant.',
    why: 'Pure rectilinear MCM reads cold and office-like. The period always paired the grid with a biomorphic counterpoint.',
  },
  {
    key: 'window-clearance',
    title: 'Do not block the glass',
    category: 'layout',
    rule: 'Keep furniture above 90 cm away from windows, and hang curtains from ceiling to floor outside the frame.',
    why: 'Indoor-outdoor connection is central to the era. A credenza under a window is fine; a bookshelf across one fights the architecture.',
  },
];

/** Room archetypes with the pieces a complete MCM version of that room needs. */
export const ROOM_PROGRAMS: Record<
  string,
  { label: string; essential: string[]; enriching: string[]; minAreaSqm: number }
> = {
  living: {
    label: 'Living Room',
    essential: ['sofa', 'coffee-table', 'rug', 'floor-lamp', 'lounge-chair'],
    enriching: ['credenza', 'side-table', 'art', 'plant', 'bookshelf', 'table-lamp'],
    minAreaSqm: 12,
  },
  dining: {
    label: 'Dining Room',
    essential: ['dining-table', 'dining-chair', 'pendant'],
    enriching: ['sideboard', 'rug', 'art', 'bar-cart', 'plant'],
    minAreaSqm: 8,
  },
  bedroom: {
    label: 'Bedroom',
    essential: ['bed', 'nightstand', 'dresser', 'table-lamp'],
    enriching: ['rug', 'lounge-chair', 'art', 'plant', 'bench'],
    minAreaSqm: 9,
  },
  office: {
    label: 'Office / Studio',
    essential: ['desk', 'desk-chair', 'task-lamp'],
    enriching: ['bookshelf', 'rug', 'art', 'plant', 'lounge-chair'],
    minAreaSqm: 6,
  },
  entry: {
    label: 'Entry',
    essential: ['console', 'mirror'],
    enriching: ['bench', 'rug', 'plant', 'art'],
    minAreaSqm: 2,
  },
  kitchen: {
    label: 'Kitchen',
    essential: [],
    enriching: ['bar-stool', 'pendant', 'art', 'plant'],
    minAreaSqm: 6,
  },
  studio: {
    label: 'Studio / Open Plan',
    essential: ['sofa', 'coffee-table', 'rug', 'bed', 'dining-table', 'floor-lamp'],
    enriching: ['credenza', 'room-divider', 'bookshelf', 'plant', 'art', 'pendant'],
    minAreaSqm: 18,
  },
  other: { label: 'Other', essential: [], enriching: ['rug', 'art', 'plant'], minAreaSqm: 4 },
};

/** Real reference dimensions used to scale estimates out of photographs. */
export const SCALE_ANCHORS = [
  { key: 'interior-door', label: 'Interior door', heightCm: 203, widthCm: 81, confidence: 'high' },
  { key: 'outlet', label: 'Wall outlet', heightCm: 11.5, widthCm: 7, confidence: 'high' },
  { key: 'light-switch-height', label: 'Light switch center', heightCm: 122, widthCm: 7, confidence: 'high' },
  { key: 'baseboard', label: 'Baseboard', heightCm: 10, widthCm: 0, confidence: 'medium' },
  { key: 'counter', label: 'Kitchen counter', heightCm: 91, widthCm: 0, confidence: 'high' },
  { key: 'doorknob-height', label: 'Doorknob center', heightCm: 91, widthCm: 6, confidence: 'high' },
  { key: 'floor-plank', label: 'Floor plank width', heightCm: 0, widthCm: 12, confidence: 'low' },
  { key: 'standard-sofa', label: 'Three-seat sofa', heightCm: 80, widthCm: 213, confidence: 'medium' },
];

/** Signals that a room is drifting away from the period. */
export const ANTI_PATTERNS = [
  { key: 'bulky-sectional', label: 'Oversized rolled-arm sectional', fix: 'Swap for a low tapered-leg sofa; keep the back under 80 cm.' },
  { key: 'floor-hugging', label: 'Furniture sitting flat on the floor', fix: 'Raise it on legs, or replace. Visible floor beneath is the defining cue.' },
  { key: 'cool-white-light', label: 'Cool white (4000K+) bulbs', fix: 'Replace every bulb in the room with 2700K. Cheapest high-impact change available.' },
  { key: 'greywash', label: 'Grey-washed or whitewashed wood', fix: 'Reads farmhouse. Move it out of the main sightline or refinish toward walnut.' },
  { key: 'gallery-wall-clutter', label: 'Dense gallery wall', fix: 'MCM prefers one large graphic piece to twelve small ones. Consolidate.' },
  { key: 'tv-dominance', label: 'TV as the room’s focal point', fix: 'Mount lower and off-center, or set it on a credenza so the wood carries the wall.' },
  { key: 'matched-set', label: 'Matched furniture suite', fix: 'The era mixed makers freely. Break the set with one contrasting chair or table.' },
  { key: 'no-contrast', label: 'All-neutral, no accent', fix: 'Add exactly one saturated period accent — tangerine, teal, mustard or olive.' },
];

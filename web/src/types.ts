export type RoomKind = 'living' | 'dining' | 'bedroom' | 'office' | 'entry' | 'kitchen' | 'studio' | 'other';

/** A floor-plan vertex in centimetres, origin at the room's top-left in plan view. */
export interface Point { x: number; y: number }

export interface Project {
  id: string;
  name: string;
  unitSystem: 'metric' | 'imperial';
  paletteKey: string | null;
  budgetCents: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Opening {
  id: string;
  roomId: string;
  kind: 'door' | 'window' | 'passage';
  /** Index of the wall segment in the room polygon (vertex i -> i+1). */
  wallIndex: number;
  /** Distance in cm from the start vertex of that wall to the opening's left edge. */
  offsetCm: number;
  widthCm: number;
  heightCm: number;
  /** Height of the bottom edge above the floor, in cm. 0 for doors. */
  sillCm: number;
  faces: string | null;
}

export type FurnitureSource = 'existing' | 'suggested' | 'library' | 'manual';

export interface Furniture {
  id: string;
  roomId: string;
  catalogKey: string | null;
  libraryItemId: string | null;
  label: string;
  /** Centre of the piece in plan coordinates, cm. */
  x: number;
  y: number;
  /** Height of the piece's base above the floor, cm. Non-zero for wall-mounted items. */
  z: number;
  rotationDeg: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  color: string | null;
  source: FurnitureSource;
  locked: boolean;
  notes: string;
}

export interface Room {
  id: string;
  projectId: string;
  name: string;
  kind: RoomKind;
  /** Floor outline in cm. At least 3 points; rectangles are the common case. */
  polygon: Point[];
  heightCm: number;
  wallColor: string;
  floorColor: string;
  floorMaterial: string;
  notes: string;
  analysis: RoomAnalysis | null;
  createdAt: string;
  updatedAt: string;
  openings?: Opening[];
  furniture?: Furniture[];
  photos?: Photo[];
}

export type CaptureTag =
  | 'wall-north' | 'wall-east' | 'wall-south' | 'wall-west'
  | 'corner' | 'floor' | 'ceiling' | 'window' | 'door' | 'detail' | 'wide' | 'untagged';

export interface Photo {
  id: string;
  roomId: string | null;
  projectId: string;
  filename: string;
  originalName: string;
  mime: string;
  bytes: number;
  captureTag: CaptureTag;
  analysis: PhotoAnalysis | null;
  createdAt: string;
}

export interface PhotoAnalysis {
  /** How the estimates were produced. */
  engine: 'claude' | 'heuristic';
  summary: string;
  estimatedRoomKind: RoomKind | null;
  /** Dimension estimates, with the real-world object used to set the scale. */
  dimensions: {
    widthCm: number | null;
    depthCm: number | null;
    heightCm: number | null;
    scaleAnchor: string | null;
    confidence: 'low' | 'medium' | 'high';
  } | null;
  wallColor: string | null;
  floorColor: string | null;
  floorMaterial: string | null;
  lightingNotes: string | null;
  colorTemperature: 'warm' | 'neutral' | 'cool' | 'unknown' | null;
  openings: Array<{ kind: 'door' | 'window' | 'passage'; widthCm: number | null; heightCm: number | null; sillCm: number | null; wallHint: string | null }>;
  existingFurniture: Array<{
    label: string;
    catalogKeyGuess: string | null;
    widthCm: number | null;
    depthCm: number | null;
    heightCm: number | null;
    material: string | null;
    color: string | null;
    mcmVerdict: 'keeper' | 'workable' | 'clashes';
    reason: string;
  }>;
  antiPatterns: string[];
  warnings: string[];
}

export interface RoomAnalysis {
  engine: 'claude' | 'heuristic';
  updatedAt: string;
  styleScore: number;
  summary: string;
  findings: Finding[];
  photoIds: string[];
}

export interface Finding {
  ruleKey: string;
  title: string;
  category: string;
  severity: 'info' | 'minor' | 'major';
  status: 'pass' | 'fail' | 'unknown';
  detail: string;
  fix: string;
}

export type LibraryKind = 'image' | 'video' | 'product' | 'note';

export interface LibraryItem {
  id: string;
  projectId: string;
  kind: LibraryKind;
  title: string;
  url: string | null;
  filename: string | null;
  mime: string | null;
  notes: string;
  tags: string[];
  priceCents: number | null;
  vendor: string | null;
  dims: { w: number | null; d: number | null; h: number | null } | null;
  analysis: LibraryAnalysis | null;
  favorite: boolean;
  createdAt: string;
}

export interface LibraryAnalysis {
  engine: 'claude' | 'heuristic';
  summary: string;
  /** Catalog role this item could fill in a room, e.g. "sofa" or "floor-lamp". */
  roleGuess: string | null;
  catalogKeyGuess: string | null;
  paletteHexes: string[];
  materials: string[];
  /** 0-100: how squarely this sits in the mid-century idiom. */
  mcmScore: number;
  era: string | null;
  formNotes: string | null;
  takeaways: string[];
}

export interface Suggestion {
  id: string;
  projectId: string;
  roomId: string | null;
  title: string;
  rationale: string;
  ruleKeys: string[];
  libraryItemId: string | null;
  catalogKey: string | null;
  /** Where to put it if accepted. */
  placement: { x: number; y: number; z: number; rotationDeg: number } | null;
  priority: 1 | 2 | 3;
  effort: 'free' | 'cheap' | 'invest';
  status: 'open' | 'accepted' | 'dismissed' | 'done';
  engine: 'claude' | 'heuristic';
  createdAt: string;
}

// --- Client-only view types ------------------------------------------------

export interface CatalogItem {
  key: string;
  name: string;
  role: string;
  category: 'seating' | 'tables' | 'storage' | 'lighting' | 'soft' | 'decor' | 'sleeping' | 'work';
  dims: { w: number; d: number; h: number };
  shape: string;
  legs: string;
  legClearanceCm: number;
  materials: string[];
  colors: { primary: string; secondary?: string; accent?: string };
  placement: string[];
  clearanceCm: number;
  priceBand: 1 | 2 | 3 | 4;
  era: string;
  inspiredBy: string;
  note: string;
  tags: string[];
}

export interface Palette {
  key: string; name: string; era: string;
  dominant: string[]; secondary: string[]; accent: string[]; notes: string;
}

export interface DesignRule {
  key: string; title: string; category: string; rule: string; why: string;
  check?: { metric: string; min?: number; max?: number; unit?: string };
}

export interface RoomProgram {
  label: string; essential: string[]; enriching: string[]; minAreaSqm: number;
}

export interface Reference {
  catalog: CatalogItem[];
  palettes: Palette[];
  materials: Array<{ key: string; name: string; role: string; hex: string; authentic: boolean; notes: string }>;
  rules: DesignRule[];
  roomPrograms: Record<string, RoomProgram>;
  scaleAnchors: Array<{ key: string; label: string; heightCm: number; widthCm: number; confidence: string }>;
  antiPatterns: Array<{ key: string; label: string; fix: string }>;
}

export interface RoomDetail extends Room {
  areaSqm: number;
  walls: Array<{ index: number; lengthCm: number; compass: string; angleDeg: number }>;
}

export interface ProjectDetail extends Project {
  rooms: Room[];
  library: LibraryItem[];
  suggestions: Suggestion[];
  totals: { areaSqm: number; photos: number };
}

export interface ProjectSummary extends Project {
  roomCount: number;
  photoCount: number;
  libraryCount: number;
}

export interface RoomEvaluation {
  roomId: string;
  styleScore: number;
  summary: string;
  findings: Finding[];
  metrics: Record<string, number>;
  areaSqm?: number;
}

export interface CapturePlanStep {
  tag: string; label: string; why: string; min: number;
}

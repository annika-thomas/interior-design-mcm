import type { Furniture, Opening, Point, Room } from '../types.js';

export interface Wall {
  index: number;
  a: Point;
  b: Point;
  lengthCm: number;
  /** Unit vector pointing from a to b. */
  dir: Point;
  /** Unit normal pointing into the room. */
  inward: Point;
  angleDeg: number;
  /** Rough compass label, useful for matching photos tagged "wall-north". */
  compass: 'north' | 'east' | 'south' | 'west';
}

export function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Floor area in square metres. */
export function areaSqm(poly: Point[]): number {
  return polygonArea(poly) / 10_000;
}

export function centroid(poly: Point[]): Point {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) {
    // Degenerate polygon: fall back to the average of the vertices.
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function bounds(poly: Point[]) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, depth: maxY - minY };
}

/** True when the polygon winds counter-clockwise in screen coordinates (y down). */
export function isCCW(poly: Point[]): boolean {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += (b.x - a.x) * (b.y + a.y);
  }
  return sum < 0;
}

export function walls(poly: Point[]): Wall[] {
  const ccw = isCCW(poly);
  const c = centroid(poly);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / len, y: dy / len };
    // Two candidate normals; keep whichever points toward the interior.
    let inward = ccw ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((c.x - mid.x) * inward.x + (c.y - mid.y) * inward.y < 0) {
      inward = { x: -inward.x, y: -inward.y };
    }
    // Compass from the inward normal: a wall whose inside faces south is the north wall.
    const compass: Wall['compass'] =
      Math.abs(inward.y) >= Math.abs(inward.x)
        ? inward.y > 0 ? 'north' : 'south'
        : inward.x > 0 ? 'west' : 'east';
    return {
      index: i,
      a,
      b,
      lengthCm: len,
      dir,
      inward,
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      compass,
    };
  });
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const intersects = a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** The four plan-view corners of a placed piece, accounting for rotation. */
export function footprint(f: Pick<Furniture, 'x' | 'y' | 'rotationDeg' | 'widthCm' | 'depthCm'>): Point[] {
  const rad = (f.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const hw = f.widthCm / 2, hd = f.depthCm / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((c) => ({ x: f.x + c.x * cos - c.y * sin, y: f.y + c.x * sin + c.y * cos }));
}

function project(poly: Point[], axis: Point) {
  const dots = poly.map((p) => p.x * axis.x + p.y * axis.y);
  return { min: Math.min(...dots), max: Math.max(...dots) };
}

/** Separating-axis overlap test between two rotated rectangles. */
export function overlaps(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const axis = { x: -(q.y - p.y), y: q.x - p.x };
      const len = Math.hypot(axis.x, axis.y) || 1;
      const norm = { x: axis.x / len, y: axis.y / len };
      const pa = project(a, norm);
      const pb = project(b, norm);
      if (pa.max <= pb.min + 1e-6 || pb.max <= pa.min + 1e-6) return false;
    }
  }
  return true;
}

/** Shortest distance from a point to a wall segment. */
export function distanceToWall(p: Point, wall: Wall): number {
  const vx = wall.b.x - wall.a.x;
  const vy = wall.b.y - wall.a.y;
  const lenSq = vx * vx + vy * vy || 1;
  let t = ((p.x - wall.a.x) * vx + (p.y - wall.a.y) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = wall.a.x + t * vx;
  const cy = wall.a.y + t * vy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Distance from a placed piece to the nearest wall, measured from its footprint. */
export function distanceToNearestWall(f: Furniture, poly: Point[]): number {
  const ws = walls(poly);
  const corners = footprint(f);
  let best = Infinity;
  for (const w of ws) {
    for (const c of corners) best = Math.min(best, distanceToWall(c, w));
  }
  return best;
}

/** Plan-view position of an opening's centre, projected onto its wall. */
export function openingCenter(opening: Opening, poly: Point[]): Point | null {
  const ws = walls(poly);
  const w = ws[opening.wallIndex];
  if (!w) return null;
  const t = (opening.offsetCm + opening.widthCm / 2) / (w.lengthCm || 1);
  return { x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t };
}

/**
 * Sample the floor on a grid and report how much of it stays walkable once
 * furniture is placed. `clearCells / totalCells` approximates open floor, and
 * `widestGapCm` approximates the tightest point of the main circulation route.
 */
export function circulation(room: Room, furniture: Furniture[], step = 15) {
  const b = bounds(room.polygon);
  const blockers = furniture
    // Wall-mounted and overhead pieces do not obstruct the floor.
    .filter((f) => f.z < 60 && f.heightCm > 12)
    .map((f) => footprint(f));

  let total = 0;
  let clear = 0;
  const clearPoints: Point[] = [];
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      const p = { x, y };
      if (!pointInPolygon(p, room.polygon)) continue;
      total++;
      const blocked = blockers.some((fp) => pointInPolygon(p, fp));
      if (!blocked) {
        clear++;
        clearPoints.push(p);
      }
    }
  }

  // Width of the largest fully-clear horizontal or vertical run, as a proxy
  // for whether you can actually walk through the room.
  let widestGapCm = 0;
  const clearSet = new Set(clearPoints.map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`));
  const has = (x: number, y: number) => clearSet.has(`${Math.round(x)}:${Math.round(y)}`);
  for (let y = b.minY + step / 2; y < b.maxY; y += step) {
    let run = 0;
    for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      run = has(x, y) ? run + step : 0;
      widestGapCm = Math.max(widestGapCm, run);
    }
  }
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    let run = 0;
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      run = has(x, y) ? run + step : 0;
      widestGapCm = Math.max(widestGapCm, run);
    }
  }

  return {
    openFloorRatio: total ? clear / total : 1,
    widestGapCm,
    totalCells: total,
    clearCells: clear,
  };
}

/** Find an unoccupied spot for a new piece, preferring its declared placement style. */
export function findSpot(
  room: Room,
  existing: Furniture[],
  size: { w: number; d: number },
  style: 'against-wall' | 'corner' | 'floating' | 'in-front-of-seat' | 'beside-seat' | 'under-group' | 'anywhere',
  anchor?: Furniture,
): { x: number; y: number; rotationDeg: number } | null {
  const ws = walls(room.polygon);
  const taken = existing.filter((f) => f.z < 60).map((f) => footprint(f));
  const fits = (x: number, y: number, rot: number) => {
    const fp = footprint({ x, y, rotationDeg: rot, widthCm: size.w, depthCm: size.d });
    if (!fp.every((c) => pointInPolygon(c, room.polygon))) return false;
    return !taken.some((t) => overlaps(fp, t));
  };

  if (anchor && (style === 'in-front-of-seat' || style === 'beside-seat')) {
    const rad = (anchor.rotationDeg * Math.PI) / 180;
    // Anchor's local +z (front) direction in plan coordinates.
    const front = { x: Math.sin(rad), y: -Math.cos(rad) };
    const side = { x: Math.cos(rad), y: Math.sin(rad) };
    const dir = style === 'in-front-of-seat' ? front : side;
    for (const sign of style === 'beside-seat' ? [1, -1] : [1]) {
      for (let gap = 45; gap <= 130; gap += 10) {
        const dist = anchor.depthCm / 2 + size.d / 2 + gap;
        const x = anchor.x + dir.x * dist * sign;
        const y = anchor.y + dir.y * dist * sign;
        if (fits(x, y, anchor.rotationDeg)) return { x, y, rotationDeg: anchor.rotationDeg };
      }
    }
  }

  if (style === 'under-group' || style === 'floating' || style === 'anywhere') {
    const c = anchor ? { x: anchor.x, y: anchor.y } : centroid(room.polygon);
    for (let r = 0; r <= 300; r += 25) {
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        const x = c.x + Math.cos(rad) * r;
        const y = c.y + Math.sin(rad) * r;
        for (const rot of [0, 90]) {
          // A rug sits under everything, so ignore collisions for it.
          if (style === 'under-group') {
            const fp = footprint({ x, y, rotationDeg: rot, widthCm: size.w, depthCm: size.d });
            if (fp.every((cn) => pointInPolygon(cn, room.polygon))) return { x, y, rotationDeg: rot };
          } else if (fits(x, y, rot)) return { x, y, rotationDeg: rot };
        }
      }
    }
    return null;
  }

  // Against-wall and corner: slide along each wall looking for a clear run.
  const ordered = style === 'corner'
    ? ws.slice().sort((a, b) => a.lengthCm - b.lengthCm)
    : ws.slice().sort((a, b) => b.lengthCm - a.lengthCm);

  for (const w of ordered) {
    const rot = normalizeAngle(-(Math.atan2(w.inward.y, w.inward.x) * 180) / Math.PI - 90);
    const steps = Math.max(1, Math.floor((w.lengthCm - size.w) / 20));
    const order = style === 'corner'
      ? [0, steps]
      : Array.from({ length: steps + 1 }, (_, i) => Math.round(steps / 2) + (i % 2 ? 1 : -1) * Math.ceil(i / 2))
          .filter((i) => i >= 0 && i <= steps);
    for (const i of order) {
      const t = (size.w / 2 + i * 20) / (w.lengthCm || 1);
      if (t > 1) continue;
      const px = w.a.x + (w.b.x - w.a.x) * t;
      const py = w.a.y + (w.b.y - w.a.y) * t;
      // Pull off the wall by half the depth plus a 15 cm float, so the piece
      // satisfies the "float the seating group" rule rather than sitting flush.
      const off = size.d / 2 + 15;
      const x = px + w.inward.x * off;
      const y = py + w.inward.y * off;
      if (fits(x, y, rot)) return { x, y, rotationDeg: rot };
    }
  }
  return null;
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return Math.round(a * 10) / 10;
}

export function rectPolygon(widthCm: number, depthCm: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: widthCm, y: 0 },
    { x: widthCm, y: depthCm },
    { x: 0, y: depthCm },
  ];
}

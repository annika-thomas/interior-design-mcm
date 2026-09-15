import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogItem, Furniture, Opening, Point, Room } from '../types';

interface Props {
  room: Room;
  catalog: Map<string, CatalogItem>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveFurniture: (id: string, x: number, y: number, commit: boolean) => void;
  onRotateFurniture: (id: string, rotationDeg: number, commit: boolean) => void;
  onMoveVertex: (index: number, point: Point, commit: boolean) => void;
  onMoveOpening: (id: string, offsetCm: number, commit: boolean) => void;
}

type Drag =
  | { kind: 'furniture'; id: string; grabX: number; grabY: number }
  | { kind: 'rotate'; id: string; centerX: number; centerY: number }
  | { kind: 'vertex'; index: number }
  | { kind: 'opening'; id: string; wallIndex: number };

const PAD = 46;

const COLORS = {
  wall: '#3A3632',
  floor: '#FBF9F4',
  grid: '#E5DFD1',
  dim: '#8C8477',
  furniture: '#8A7A5C',
  selected: '#D94F30',
  window: '#2E8B8B',
  door: '#D9A441',
};

/**
 * The floor plan.
 *
 * This is where the survey gets corrected — drag a corner to match a tape
 * measure, slide a window along its wall, push the sofa where it really goes.
 * Everything here writes straight through to the same model the 3D view and
 * the rule engine read, so a correction made once is a correction everywhere.
 */
export function FloorPlan(props: Props) {
  const { room, catalog, selectedId } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const dragRef = useRef<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Keep the canvas matched to its container so the plan never stretches.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.max(320, width), height: Math.max(320, height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Centimetres to canvas pixels, fitted with padding. */
  const transform = useCallback(() => {
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 50);
    const spanY = Math.max(maxY - minY, 50);
    const scale = Math.min((size.width - PAD * 2) / spanX, (size.height - PAD * 2) / spanY);
    const offsetX = (size.width - spanX * scale) / 2 - minX * scale;
    const offsetY = (size.height - spanY * scale) / 2 - minY * scale;
    return {
      scale,
      toPx: (p: Point) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY }),
      toCm: (x: number, y: number) => ({ x: (x - offsetX) / scale, y: (y - offsetY) / scale }),
    };
  }, [room.polygon, size]);

  /** Corners of a piece in plan space, honouring its rotation. */
  const corners = (f: Furniture): Point[] => {
    const rad = (f.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const hw = f.widthCm / 2, hd = f.depthCm / 2;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([cx, cy]) => ({
      x: f.x + cx * cos - cy * sin,
      y: f.y + cx * sin + cy * cos,
    }));
  };

  const openingCenter = (o: Opening): Point | null => {
    const a = room.polygon[o.wallIndex];
    const b = room.polygon[(o.wallIndex + 1) % room.polygon.length];
    if (!a || !b) return null;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = (o.offsetCm + o.widthCm / 2) / len;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  /** A piece at rotation 0 faces +y; see the facing convention in geometry.ts. */
  const frontDir = (rotationDeg: number): Point => {
    const rad = (rotationDeg * Math.PI) / 180;
    return { x: -Math.sin(rad), y: Math.cos(rad) };
  };

  const rotateHandle = (f: Furniture): Point => {
    // Sits off the front edge — the direction the piece faces.
    const dist = f.depthCm / 2 + 34;
    const dir = frontDir(f.rotationDeg);
    return { x: f.x + dir.x * dist, y: f.y + dir.y * dist };
  };

  // --- Rendering ----------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const { scale, toPx } = transform();
    const px = (cm: number) => cm * scale;

    // Grid at 50 cm, which is about the granularity you can actually judge.
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    for (let x = Math.floor(Math.min(...xs) / 50) * 50; x <= Math.max(...xs) + 50; x += 50) {
      const a = toPx({ x, y: Math.min(...ys) - 40 });
      const b = toPx({ x, y: Math.max(...ys) + 40 });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let y = Math.floor(Math.min(...ys) / 50) * 50; y <= Math.max(...ys) + 50; y += 50) {
      const a = toPx({ x: Math.min(...xs) - 40, y });
      const b = toPx({ x: Math.max(...xs) + 40, y });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Floor
    ctx.beginPath();
    room.polygon.forEach((p, i) => {
      const q = toPx(p);
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.fillStyle = room.floorColor || COLORS.floor;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Wall lengths
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i];
      const b = room.polygon[(i + 1) % room.polygon.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = toPx({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      // Nudge the label outside the wall line.
      const nx = -(b.y - a.y) / (len || 1), ny = (b.x - a.x) / (len || 1);
      const cx = room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length;
      const cy = room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length;
      const sign = (cx - (a.x + b.x) / 2) * nx + (cy - (a.y + b.y) / 2) * ny > 0 ? -1 : 1;
      const label = `${Math.round(len)} cm`;
      const lx = mid.x + nx * sign * 17, ly = mid.y + ny * sign * 17;
      ctx.fillStyle = 'rgba(244,240,231,.92)';
      const w = ctx.measureText(label).width + 8;
      ctx.fillRect(lx - w / 2, ly - 8, w, 16);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(label, lx, ly);
    }

    // Openings drawn on top of the wall line
    for (const o of room.openings ?? []) {
      const a = room.polygon[o.wallIndex];
      const b = room.polygon[(o.wallIndex + 1) % room.polygon.length];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      const start = toPx({ x: a.x + ux * o.offsetCm, y: a.y + uy * o.offsetCm });
      const end = toPx({ x: a.x + ux * (o.offsetCm + o.widthCm), y: a.y + uy * (o.offsetCm + o.widthCm) });
      ctx.strokeStyle = o.kind === 'door' ? COLORS.door : COLORS.window;
      ctx.lineWidth = 7;
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      // A door gets its swing arc, the way a real plan would draw it.
      if (o.kind === 'door') {
        ctx.strokeStyle = COLORS.door;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(start.x, start.y, px(o.widthCm), Math.atan2(uy, ux) - Math.PI / 2, Math.atan2(uy, ux));
        ctx.stroke();
      }
    }

    // Furniture, drawn floor-up: a rug has to end up underneath the sofa
    // standing on it, and overhead pieces on top of everything.
    const drawOrder = [...(room.furniture ?? [])].sort((a, b) => (a.z - b.z) || (a.heightCm - b.heightCm));
    for (const f of drawOrder) {
      const item = f.catalogKey ? catalog.get(f.catalogKey) : undefined;
      const isSelected = f.id === selectedId;
      const pts = corners(f).map(toPx);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = f.color || item?.colors.primary || COLORS.furniture;
      // Wall-mounted and ceiling pieces read as outlines, not solid footprints.
      const isSurface = (f.heightCm <= 6 && f.z < 60);
      ctx.globalAlpha = f.z > 60 ? 0.22 : isSurface ? 0.55 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = isSelected ? COLORS.selected : hover === f.id ? '#5E594F' : 'rgba(43,41,38,.35)';
      ctx.lineWidth = isSelected ? 2.5 : 1.2;
      ctx.stroke();

      // A tick on the front edge so orientation is readable at a glance.
      const rad = (f.rotationDeg * Math.PI) / 180;
      const dir = frontDir(f.rotationDeg);
      const front = toPx({ x: f.x + dir.x * (f.depthCm / 2), y: f.y + dir.y * (f.depthCm / 2) });
      const centre = toPx(f);
      ctx.strokeStyle = isSelected ? COLORS.selected : 'rgba(43,41,38,.5)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(centre.x, centre.y); ctx.lineTo(front.x, front.y); ctx.stroke();

      if (isSelected) {
        const h = toPx(rotateHandle(f));
        ctx.beginPath(); ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.selected; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      }

      // Labels only for pieces on the floor; ceiling and wall items would
      // otherwise pile their text on top of the furniture underneath them.
      if (f.z < 60 && px(Math.min(f.widthCm, f.depthCm)) > 34) {
        ctx.fillStyle = 'rgba(43,41,38,.78)';
        ctx.font = '500 10px system-ui, sans-serif';
        const name = f.label.length > 22 ? `${f.label.slice(0, 20)}…` : f.label;
        ctx.save();
        ctx.translate(centre.x, centre.y);
        // Keep labels upright even when the piece is rotated past vertical.
        ctx.rotate(Math.abs(((f.rotationDeg % 360) + 360) % 360 - 180) < 90 ? rad + Math.PI : rad);
        ctx.fillText(name, 0, 0);
        ctx.restore();
      }
    }

    // Vertex handles
    for (const p of room.polygon) {
      const q = toPx(p);
      ctx.beginPath(); ctx.arc(q.x, q.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FBF9F4'; ctx.fill();
      ctx.strokeStyle = COLORS.wall; ctx.lineWidth = 2; ctx.stroke();
    }
  }, [room, catalog, selectedId, size, hover, transform]);

  // --- Interaction --------------------------------------------------------

  const hitTest = (cx: number, cy: number): Drag | null => {
    const { scale } = transform();
    const grabPx = 11 / scale;

    const selected = (room.furniture ?? []).find((f) => f.id === selectedId);
    if (selected) {
      const h = rotateHandle(selected);
      if (Math.hypot(cx - h.x, cy - h.y) < grabPx * 1.3) {
        return { kind: 'rotate', id: selected.id, centerX: selected.x, centerY: selected.y };
      }
    }

    for (let i = 0; i < room.polygon.length; i++) {
      const p = room.polygon[i];
      if (Math.hypot(cx - p.x, cy - p.y) < grabPx) return { kind: 'vertex', index: i };
    }

    for (const o of room.openings ?? []) {
      const c = openingCenter(o);
      if (c && Math.hypot(cx - c.x, cy - c.y) < Math.max(grabPx, o.widthCm / 2)) {
        return { kind: 'opening', id: o.id, wallIndex: o.wallIndex };
      }
    }

    // Topmost first, mirroring the draw order, so a lamp standing on a rug is
    // what you grab rather than the rug underneath it.
    const pieces = [...(room.furniture ?? [])]
      .sort((a, b) => (a.z - b.z) || (a.heightCm - b.heightCm))
      .reverse();
    for (const f of pieces) {
      if (pointInPoly({ x: cx, y: cy }, corners(f))) {
        return { kind: 'furniture', id: f.id, grabX: cx - f.x, grabY: cy - f.y };
      }
    }
    return null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const { toCm } = transform();
    const { x, y } = toCm(event.clientX - rect.left, event.clientY - rect.top);
    const hit = hitTest(x, y);
    dragRef.current = hit;
    if (hit?.kind === 'furniture' || hit?.kind === 'rotate') props.onSelect(hit.id);
    else if (!hit) props.onSelect(null);
    if (hit) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const { toCm } = transform();
    const { x, y } = toCm(event.clientX - rect.left, event.clientY - rect.top);
    const drag = dragRef.current;

    if (!drag) {
      const hit = hitTest(x, y);
      setHover(hit && (hit.kind === 'furniture' || hit.kind === 'rotate') ? hit.id : null);
      return;
    }

    // Hold shift to move freely; otherwise snap to a 5 cm grid.
    const snap = (v: number) => (event.shiftKey ? Math.round(v) : Math.round(v / 5) * 5);

    if (drag.kind === 'furniture') {
      props.onMoveFurniture(drag.id, snap(x - drag.grabX), snap(y - drag.grabY), false);
    } else if (drag.kind === 'rotate') {
      const raw = (Math.atan2(-(x - drag.centerX), y - drag.centerY) * 180) / Math.PI;
      // Snap to 15° unless shift is held — furniture almost always wants to be square.
      const deg = event.shiftKey ? raw : Math.round(raw / 15) * 15;
      props.onRotateFurniture(drag.id, ((deg % 360) + 360) % 360, false);
    } else if (drag.kind === 'vertex') {
      props.onMoveVertex(drag.index, { x: snap(x), y: snap(y) }, false);
    } else if (drag.kind === 'opening') {
      const a = room.polygon[drag.wallIndex];
      const b = room.polygon[(drag.wallIndex + 1) % room.polygon.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const t = ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (len * len);
      const opening = (room.openings ?? []).find((o) => o.id === drag.id);
      const maxOffset = Math.max(0, len - (opening?.widthCm ?? 0));
      props.onMoveOpening(drag.id, Math.max(0, Math.min(maxOffset, snap(t * len - (opening?.widthCm ?? 0) / 2))), false);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    if (!drag) return;

    // Commit the final value so it is written once rather than on every frame.
    if (drag.kind === 'furniture') {
      const f = (room.furniture ?? []).find((x) => x.id === drag.id);
      if (f) props.onMoveFurniture(f.id, f.x, f.y, true);
    } else if (drag.kind === 'rotate') {
      const f = (room.furniture ?? []).find((x) => x.id === drag.id);
      if (f) props.onRotateFurniture(f.id, f.rotationDeg, true);
    } else if (drag.kind === 'vertex') {
      props.onMoveVertex(drag.index, room.polygon[drag.index], true);
    } else if (drag.kind === 'opening') {
      const o = (room.openings ?? []).find((x) => x.id === drag.id);
      if (o) props.onMoveOpening(o.id, o.offsetCm, true);
    }
  };

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 360 }}>
      <canvas
        ref={canvasRef}
        className="plan-canvas"
        style={{ cursor: hover ? 'grab' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}

function pointInPoly(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

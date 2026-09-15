import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import type { Furniture, Opening, Point, Project, Room, RoomKind } from '../types.js';
import { CATALOG, CATALOG_BY_KEY } from '../mcm/catalog.js';
import { ANTI_PATTERNS, DESIGN_RULES, MATERIALS, PALETTES, ROOM_PROGRAMS, SCALE_ANCHORS } from '../mcm/knowledge.js';
import { areaSqm, rectPolygon, walls } from '../mcm/geometry.js';

export const router = Router();

const now = () => new Date().toISOString();

/** Reference data the browser needs to render and reason about rooms. */
router.get('/catalog', (_req, res) => {
  res.json({
    catalog: CATALOG,
    palettes: PALETTES,
    materials: MATERIALS,
    rules: DESIGN_RULES,
    roomPrograms: ROOM_PROGRAMS,
    scaleAnchors: SCALE_ANCHORS,
    antiPatterns: ANTI_PATTERNS,
  });
});

// --- Projects -------------------------------------------------------------

router.get('/projects', (_req, res) => {
  const projects = db.table('projects').slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(projects.map((p) => ({
    ...p,
    roomCount: db.filter('rooms', (r) => r.projectId === p.id).length,
    photoCount: db.filter('photos', (r) => r.projectId === p.id).length,
    libraryCount: db.filter('library', (r) => r.projectId === p.id).length,
  })));
});

router.post('/projects', (req, res) => {
  const project: Project = {
    id: randomUUID(),
    name: String(req.body?.name || 'My Apartment').slice(0, 120),
    unitSystem: req.body?.unitSystem === 'imperial' ? 'imperial' : 'metric',
    paletteKey: req.body?.paletteKey ?? null,
    budgetCents: req.body?.budgetCents ?? null,
    notes: String(req.body?.notes ?? ''),
    createdAt: now(),
    updatedAt: now(),
  };
  db.insert('projects', project);
  res.status(201).json(project);
});

router.get('/projects/:id', (req, res) => {
  const project = db.find('projects', (p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const rooms = db.filter('rooms', (r) => r.projectId === project.id).map(hydrateRoom);
  res.json({
    ...project,
    rooms,
    library: db.filter('library', (l) => l.projectId === project.id),
    suggestions: db.filter('suggestions', (s) => s.projectId === project.id),
    totals: {
      areaSqm: Math.round(rooms.reduce((s, r) => s + areaSqm(r.polygon), 0) * 10) / 10,
      photos: db.filter('photos', (p) => p.projectId === project.id).length,
    },
  });
});

router.patch('/projects/:id', (req, res) => {
  const allowed = ['name', 'unitSystem', 'paletteKey', 'budgetCents', 'notes'] as const;
  const patch: Partial<Project> = { updatedAt: now() };
  for (const k of allowed) if (k in req.body) (patch as Record<string, unknown>)[k] = req.body[k];
  const updated = db.update('projects', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Project not found' });
  res.json(updated);
});

router.delete('/projects/:id', (req, res) => {
  const id = req.params.id;
  const roomIds = new Set(db.filter('rooms', (r) => r.projectId === id).map((r) => r.id));
  db.remove('furniture', (f) => roomIds.has(f.roomId));
  db.remove('openings', (o) => roomIds.has(o.roomId));
  db.remove('photos', (p) => p.projectId === id);
  db.remove('library', (l) => l.projectId === id);
  db.remove('suggestions', (s) => s.projectId === id);
  db.remove('rooms', (r) => r.projectId === id);
  const removed = db.remove('projects', (p) => p.id === id);
  if (!removed) return res.status(404).json({ error: 'Project not found' });
  res.status(204).end();
});

// --- Rooms ----------------------------------------------------------------

export function hydrateRoom(room: Room): Room {
  return {
    ...room,
    openings: db.filter('openings', (o) => o.roomId === room.id),
    furniture: db.filter('furniture', (f) => f.roomId === room.id),
    photos: db.filter('photos', (p) => p.roomId === room.id),
  };
}

function validPolygon(input: unknown): Point[] | null {
  if (!Array.isArray(input) || input.length < 3) return null;
  const poly = input.map((p) => ({ x: Number((p as Point)?.x), y: Number((p as Point)?.y) }));
  if (poly.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  return poly;
}

router.post('/projects/:id/rooms', (req, res) => {
  const project = db.find('projects', (p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const widthCm = Number(req.body?.widthCm) || 400;
  const depthCm = Number(req.body?.depthCm) || 350;
  const polygon = validPolygon(req.body?.polygon) ?? rectPolygon(widthCm, depthCm);

  const room: Room = {
    id: randomUUID(),
    projectId: project.id,
    name: String(req.body?.name || 'New Room').slice(0, 120),
    kind: (ROOM_PROGRAMS[req.body?.kind as RoomKind] ? req.body.kind : 'living') as RoomKind,
    polygon,
    heightCm: Number(req.body?.heightCm) || 260,
    wallColor: String(req.body?.wallColor || '#EDE6D8'),
    floorColor: String(req.body?.floorColor || '#C4A77D'),
    floorMaterial: String(req.body?.floorMaterial || 'oak floorboards'),
    notes: String(req.body?.notes ?? ''),
    analysis: null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.insert('rooms', room);
  db.update('projects', project.id, { updatedAt: now() });
  res.status(201).json(hydrateRoom(room));
});

router.get('/rooms/:id', (req, res) => {
  const room = db.find('rooms', (r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const hydrated = hydrateRoom(room);
  res.json({
    ...hydrated,
    areaSqm: Math.round(areaSqm(room.polygon) * 10) / 10,
    walls: walls(room.polygon).map((w) => ({
      index: w.index, lengthCm: Math.round(w.lengthCm), compass: w.compass, angleDeg: Math.round(w.angleDeg),
    })),
  });
});

router.patch('/rooms/:id', (req, res) => {
  const room = db.find('rooms', (r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const patch: Partial<Room> = { updatedAt: now() };
  if ('name' in req.body) patch.name = String(req.body.name).slice(0, 120);
  if ('kind' in req.body && ROOM_PROGRAMS[req.body.kind]) patch.kind = req.body.kind;
  if ('polygon' in req.body) {
    const poly = validPolygon(req.body.polygon);
    if (!poly) return res.status(400).json({ error: 'A room outline needs at least 3 valid points.' });
    patch.polygon = poly;
  }
  for (const k of ['heightCm'] as const) if (k in req.body && Number.isFinite(Number(req.body[k]))) patch[k] = Number(req.body[k]);
  for (const k of ['wallColor', 'floorColor', 'floorMaterial', 'notes'] as const) if (k in req.body) patch[k] = String(req.body[k]);

  const updated = db.update('rooms', room.id, patch);
  db.update('projects', room.projectId, { updatedAt: now() });
  res.json(hydrateRoom(updated!));
});

router.delete('/rooms/:id', (req, res) => {
  const room = db.find('rooms', (r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  db.remove('furniture', (f) => f.roomId === room.id);
  db.remove('openings', (o) => o.roomId === room.id);
  db.remove('suggestions', (s) => s.roomId === room.id);
  // Photos survive the room so a mis-assigned upload is not destroyed with it.
  for (const p of db.filter('photos', (p) => p.roomId === room.id)) db.update('photos', p.id, { roomId: null });
  db.remove('rooms', (r) => r.id === room.id);
  res.status(204).end();
});

// --- Openings -------------------------------------------------------------

router.post('/rooms/:id/openings', (req, res) => {
  const room = db.find('rooms', (r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const kind = ['door', 'window', 'passage'].includes(req.body?.kind) ? req.body.kind : 'window';
  const wallIndex = Math.max(0, Math.min(room.polygon.length - 1, Number(req.body?.wallIndex) || 0));
  const opening: Opening = {
    id: randomUUID(),
    roomId: room.id,
    kind,
    wallIndex,
    offsetCm: Number(req.body?.offsetCm) || 0,
    widthCm: Number(req.body?.widthCm) || (kind === 'door' ? 81 : 120),
    heightCm: Number(req.body?.heightCm) || (kind === 'door' ? 203 : 120),
    sillCm: kind === 'door' ? 0 : Number(req.body?.sillCm ?? 90),
    faces: req.body?.faces ?? null,
  };
  db.insert('openings', opening);
  res.status(201).json(opening);
});

router.patch('/openings/:id', (req, res) => {
  const patch: Partial<Opening> = {};
  for (const k of ['wallIndex', 'offsetCm', 'widthCm', 'heightCm', 'sillCm'] as const) {
    if (k in req.body && Number.isFinite(Number(req.body[k]))) patch[k] = Number(req.body[k]);
  }
  if ('kind' in req.body) patch.kind = req.body.kind;
  const updated = db.update('openings', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Opening not found' });
  res.json(updated);
});

router.delete('/openings/:id', (req, res) => {
  const removed = db.remove('openings', (o) => o.id === req.params.id);
  if (!removed) return res.status(404).json({ error: 'Opening not found' });
  res.status(204).end();
});

// --- Furniture ------------------------------------------------------------

router.post('/rooms/:id/furniture', (req, res) => {
  const room = db.find('rooms', (r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const catalogKey = req.body?.catalogKey ? String(req.body.catalogKey) : null;
  const item = catalogKey ? CATALOG_BY_KEY[catalogKey] : undefined;
  if (catalogKey && !item) return res.status(400).json({ error: `Unknown catalog key "${catalogKey}"` });

  const piece: Furniture = {
    id: randomUUID(),
    roomId: room.id,
    catalogKey,
    libraryItemId: req.body?.libraryItemId ?? null,
    label: String(req.body?.label || item?.name || 'Untitled piece').slice(0, 120),
    x: Number(req.body?.x) || 0,
    y: Number(req.body?.y) || 0,
    z: Number(req.body?.z) || 0,
    rotationDeg: Number(req.body?.rotationDeg) || 0,
    widthCm: Number(req.body?.widthCm) || item?.dims.w || 100,
    depthCm: Number(req.body?.depthCm) || item?.dims.d || 50,
    heightCm: Number(req.body?.heightCm) || item?.dims.h || 75,
    color: req.body?.color ?? item?.colors.primary ?? null,
    source: req.body?.source ?? 'manual',
    locked: Boolean(req.body?.locked),
    notes: String(req.body?.notes ?? ''),
  };
  db.insert('furniture', piece);
  db.update('rooms', room.id, { updatedAt: now() });
  res.status(201).json(piece);
});

router.patch('/furniture/:id', (req, res) => {
  const piece = db.find('furniture', (f) => f.id === req.params.id);
  if (!piece) return res.status(404).json({ error: 'Furniture not found' });

  const patch: Partial<Furniture> = {};
  for (const k of ['x', 'y', 'z', 'rotationDeg', 'widthCm', 'depthCm', 'heightCm'] as const) {
    if (k in req.body && Number.isFinite(Number(req.body[k]))) patch[k] = Number(req.body[k]);
  }
  for (const k of ['label', 'notes'] as const) if (k in req.body) patch[k] = String(req.body[k]);
  if ('color' in req.body) patch.color = req.body.color;
  if ('locked' in req.body) patch.locked = Boolean(req.body.locked);
  const updated = db.update('furniture', piece.id, patch);
  db.update('rooms', piece.roomId, { updatedAt: now() });
  res.json(updated);
});

router.delete('/furniture/:id', (req, res) => {
  const removed = db.remove('furniture', (f) => f.id === req.params.id);
  if (!removed) return res.status(404).json({ error: 'Furniture not found' });
  res.status(204).end();
});

import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import type { CaptureTag, Photo, Room } from '../types.js';
import { deleteUpload, readUpload, readUploadBase64, storeUpload } from '../services/storage.js';
import { heuristicPhotoAnalysis, surveyRoom, toPhotoAnalysis } from '../services/vision.js';
import { visionMediaType } from '../services/claude.js';
import { rectPolygon } from '../mcm/geometry.js';

export const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 40 },
});

const CAPTURE_TAGS: CaptureTag[] = [
  'wall-north', 'wall-east', 'wall-south', 'wall-west',
  'corner', 'floor', 'ceiling', 'window', 'door', 'detail', 'wide', 'untagged',
];

/**
 * The guided capture checklist.
 *
 * Coverage is what makes the survey worth anything, and people naturally shoot
 * four pretty corners and stop. This is the list the UI walks you through.
 */
export const CAPTURE_PLAN = [
  { tag: 'wide', label: 'Two wide shots from opposite corners', why: 'Establishes the overall shape and proportion of the room.', min: 2 },
  { tag: 'wall-north', label: 'Each wall, straight on', why: 'Square-on shots are what let dimensions be read off door and outlet sizes.', min: 1 },
  { tag: 'corner', label: 'Every corner', why: 'Corners resolve where the walls actually meet, including alcoves and returns.', min: 2 },
  { tag: 'window', label: 'Each window, with the frame fully visible', why: 'Sets window width, height and sill height for the model.', min: 1 },
  { tag: 'door', label: 'Each door and doorway', why: 'A standard interior door is the single most reliable thing to measure from.', min: 1 },
  { tag: 'floor', label: 'One floor shot', why: 'Captures floor colour and material for the model.', min: 1 },
  { tag: 'ceiling', label: 'One ceiling shot', why: 'Shows existing light fixtures and ceiling height cues.', min: 1 },
  { tag: 'detail', label: 'Anything you want kept or matched', why: 'Existing pieces, hardware, a wood tone you need new things to sit beside.', min: 0 },
] as const;

router.get('/capture-plan', (_req, res) => res.json(CAPTURE_PLAN));

router.post('/projects/:id/photos', upload.array('photos', 40), async (req, res) => {
  const project = db.find('projects', (p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded.' });

  const roomId = req.body?.roomId || null;
  if (roomId && !db.find('rooms', (r) => r.id === roomId)) {
    return res.status(400).json({ error: 'That room does not exist.' });
  }

  // The browser sends one tag and one colour sample per file, in upload order.
  const tags = asArray(req.body?.captureTags);
  const colorSamples = asArray(req.body?.dominantColors);
  const brightness = asArray(req.body?.brightness);

  const created: Photo[] = [];
  files.forEach((file, i) => {
    const tag = (CAPTURE_TAGS.includes(tags[i] as CaptureTag) ? tags[i] : 'untagged') as CaptureTag;
    const filename = storeUpload(file.buffer, file.mimetype, file.originalname);
    const photo: Photo = {
      id: randomUUID(),
      roomId,
      projectId: project.id,
      filename,
      originalName: file.originalname,
      mime: file.mimetype,
      bytes: file.size,
      captureTag: tag,
      analysis: null,
      createdAt: new Date().toISOString(),
    };
    // Seed with the browser-side colour read so the photo is useful immediately,
    // before any vision call is made.
    photo.analysis = heuristicPhotoAnalysis(photo, {
      dominantColors: parseColors(colorSamples[i]),
      brightness: Number(brightness[i]) || undefined,
    });
    db.insert('photos', photo);
    created.push(photo);
  });

  db.update('projects', project.id, { updatedAt: new Date().toISOString() });
  res.status(201).json(created);
});

router.get('/projects/:id/photos', (req, res) => {
  const photos = db.filter('photos', (p) => p.projectId === req.params.id);
  res.json(photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
});

router.get('/photos/:id/file', (req, res) => {
  const photo = db.find('photos', (p) => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const buf = readUpload(photo.filename);
  if (!buf) return res.status(410).json({ error: 'The file behind this record is gone.' });
  res.type(photo.mime).set('Cache-Control', 'private, max-age=86400').send(buf);
});

router.patch('/photos/:id', (req, res) => {
  const patch: Partial<Photo> = {};
  if ('captureTag' in req.body && CAPTURE_TAGS.includes(req.body.captureTag)) patch.captureTag = req.body.captureTag;
  if ('roomId' in req.body) patch.roomId = req.body.roomId || null;
  const updated = db.update('photos', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Photo not found' });
  res.json(updated);
});

router.delete('/photos/:id', (req, res) => {
  const photo = db.find('photos', (p) => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  deleteUpload(photo.filename);
  db.remove('photos', (p) => p.id === photo.id);
  res.status(204).end();
});

/**
 * Run the survey for one room: analyze every photo assigned to it, reconcile a
 * dimension estimate, and optionally resize the room to match.
 */
router.post('/rooms/:id/survey', async (req, res) => {
  const room = db.find('rooms', (r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const photos = db.filter('photos', (p) => p.roomId === room.id);
  if (!photos.length) {
    return res.status(400).json({ error: 'Assign some photos to this room first.' });
  }

  if (!config.hasClaude) {
    return res.status(503).json({
      error: 'Photo survey needs an Anthropic API key.',
      detail:
        'Set ANTHROPIC_API_KEY in .env and restart the server. Without it the photos are still stored and colour-sampled, and you can enter the room dimensions by hand on the Plan tab.',
      needsKey: true,
    });
  }

  // Cap the batch: vision quality does not improve past a good spread of angles,
  // and the request has a hard size limit.
  const chosen = pickRepresentative(photos, 12);
  const images = [];
  for (const p of chosen) {
    const mediaType = visionMediaType(p.mime);
    if (!mediaType) continue;
    const base64 = readUploadBase64(p.filename);
    if (!base64) continue;
    images.push({
      photoId: p.id,
      part: { mediaType, base64, label: `${p.captureTag} — ${p.originalName}` },
      captureTag: p.captureTag,
    });
  }
  if (!images.length) {
    return res.status(400).json({ error: 'None of the photos in this room are in a format the vision API can read (JPEG, PNG, WebP or GIF).' });
  }

  try {
    const survey = await surveyRoom({
      roomName: room.name,
      roomKind: room.kind,
      images,
      knownDims: req.body?.trustExistingDims ? { heightCm: room.heightCm } : undefined,
    });
    if (!survey) return res.status(502).json({ error: 'The survey came back empty. Try again.' });

    // Attach per-photo results by label.
    for (const entry of survey.photos) {
      const match = images.find((i) => i.part.label === entry.label)
        ?? images.find((i) => entry.label.length > 3 && i.part.label.includes(entry.label));
      if (match) db.update('photos', match.photoId, { analysis: toPhotoAnalysis(entry, survey.room) });
    }

    const patch: Partial<Room> = { updatedAt: new Date().toISOString() };
    const applyDims = req.body?.applyDimensions !== false;
    if (applyDims && survey.room.widthCm && survey.room.depthCm) {
      patch.polygon = rectPolygon(Math.round(survey.room.widthCm), Math.round(survey.room.depthCm));
    }
    if (applyDims && survey.room.heightCm) patch.heightCm = Math.round(survey.room.heightCm);
    if (survey.room.kind) patch.kind = survey.room.kind;

    // Take the wall and floor colours from the photo that actually shows them.
    const wallHex = survey.photos.find((p) => p.wallColorHex)?.wallColorHex;
    const floorHex = survey.photos.find((p) => p.floorColorHex)?.floorColorHex;
    if (wallHex) patch.wallColor = wallHex;
    if (floorHex) patch.floorColor = floorHex;
    const mat = survey.photos.find((p) => p.floorMaterial)?.floorMaterial;
    if (mat) patch.floorMaterial = mat;

    db.update('rooms', room.id, patch);

    // Openings the survey found, replacing any it previously created.
    if (req.body?.applyOpenings !== false) {
      db.remove('openings', (o) => o.roomId === room.id && o.faces === 'survey');
      const wallCount = (patch.polygon ?? room.polygon).length;
      let placed = 0;
      for (const entry of survey.photos) {
        for (const o of entry.openings) {
          if (!o.widthCm || !o.heightCm || placed >= 12) continue;
          db.insert('openings', {
            id: randomUUID(),
            roomId: room.id,
            kind: o.kind,
            wallIndex: wallIndexFor(entry.label, o.wallHint, wallCount),
            // Spread them along the wall rather than stacking at the origin;
            // you drag them to the right spot on the Plan tab.
            offsetCm: 60 + (placed % 3) * 110,
            widthCm: Math.round(o.widthCm),
            heightCm: Math.round(o.heightCm),
            sillCm: o.kind === 'door' ? 0 : Math.round(o.sillCm ?? 90),
            faces: 'survey',
          });
          placed++;
        }
      }
    }

    // Record what the survey found that you already own.
    if (req.body?.importFurniture) {
      const found = survey.photos.flatMap((p) => p.existingFurniture);
      const seen = new Set<string>();
      for (const f of found) {
        const key = f.label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        db.insert('furniture', {
          id: randomUUID(),
          roomId: room.id,
          catalogKey: f.catalogKeyGuess,
          libraryItemId: null,
          label: f.label,
          x: 0, y: 0, z: 0, rotationDeg: 0,
          widthCm: Math.round(f.widthCm ?? 100),
          depthCm: Math.round(f.depthCm ?? 50),
          heightCm: Math.round(f.heightCm ?? 75),
          color: f.color ?? null,
          source: 'existing',
          locked: false,
          notes: `${f.mcmVerdict}: ${f.reason}`,
        });
      }
    }

    const updated = db.find('rooms', (r) => r.id === room.id)!;
    res.json({
      room: updated,
      survey: survey.room,
      photos: db.filter('photos', (p) => p.roomId === room.id),
      openings: db.filter('openings', (o) => o.roomId === room.id),
      furniture: db.filter('furniture', (f) => f.roomId === room.id),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The survey failed.';
    console.error('[survey]', err);
    res.status(502).json({ error: message });
  }
});

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v == null) return [];
  return [String(v)];
}

function parseColors(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 6) : [];
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  }
}

/** Guess a wall index from a capture tag like "wall-north" or a model hint. */
function wallIndexFor(label: string, hint: string | null, wallCount: number): number {
  const text = `${label} ${hint ?? ''}`.toLowerCase();
  // Matches how rectPolygon is wound: 0 top, 1 right, 2 bottom, 3 left.
  const order = ['north', 'east', 'south', 'west'];
  for (let i = 0; i < order.length; i++) {
    if (text.includes(order[i])) return Math.min(i, wallCount - 1);
  }
  return 0;
}

/** Spread the batch across capture tags so every angle is represented. */
function pickRepresentative(photos: Photo[], limit: number): Photo[] {
  if (photos.length <= limit) return photos;
  const byTag = new Map<string, Photo[]>();
  for (const p of photos) {
    const list = byTag.get(p.captureTag) ?? [];
    list.push(p);
    byTag.set(p.captureTag, list);
  }
  const out: Photo[] = [];
  let round = 0;
  while (out.length < limit) {
    let added = false;
    for (const list of byTag.values()) {
      if (list[round]) {
        out.push(list[round]);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
    round++;
  }
  return out;
}

import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import type { LibraryItem, LibraryKind } from '../types.js';
import { deleteUpload, readUpload, readUploadBase64, storeUpload } from '../services/storage.js';
import { analyzeLibraryItem, heuristicLibraryAnalysis } from '../services/vision.js';
import { visionMediaType } from '../services/claude.js';

export const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 40 },
});

const KINDS: LibraryKind[] = ['image', 'video', 'product', 'note'];

/** Pull a usable title and vendor out of a pasted product or video URL. */
function fromUrl(url: string): { kind: LibraryKind; title: string; vendor: string | null } {
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, '');
    path = parsed.pathname;
  } catch {
    return { kind: 'note', title: url.slice(0, 120), vendor: null };
  }
  const videoHosts = ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'instagram.com'];
  const kind: LibraryKind = videoHosts.some((h) => host.endsWith(h)) ? 'video' : 'product';
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  const title = slug
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 120);
  return { kind, title: title || host, vendor: host };
}

router.get('/projects/:id/library', (req, res) => {
  const items = db.filter('library', (l) => l.projectId === req.params.id);
  const { tag, kind, q } = req.query as Record<string, string | undefined>;
  const needle = q?.toLowerCase();
  const filtered = items.filter((it) => {
    if (kind && it.kind !== kind) return false;
    if (tag && !it.tags.includes(tag)) return false;
    if (needle) {
      const hay = `${it.title} ${it.notes} ${it.tags.join(' ')} ${it.analysis?.summary ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  res.json({
    items: filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    allTags: [...new Set(items.flatMap((i) => i.tags))].sort(),
  });
});

/** Add saved inspiration: uploaded files, pasted links, or a plain note. */
router.post('/projects/:id/library', upload.array('files', 40), (req, res) => {
  const project = db.find('projects', (p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const urls: string[] = parseList(req.body?.urls);
  const sharedTags: string[] = parseList(req.body?.tags);
  const notes = String(req.body?.notes ?? '');
  const colorSamples = parseList(req.body?.dominantColors);

  if (!files.length && !urls.length && !notes) {
    return res.status(400).json({ error: 'Add a file, a link, or a note.' });
  }

  const created: LibraryItem[] = [];
  const base = {
    projectId: project.id,
    notes,
    tags: sharedTags,
    priceCents: req.body?.priceCents ? Number(req.body.priceCents) : null,
    vendor: null as string | null,
    dims: parseDims(req.body),
    favorite: false,
  };

  files.forEach((file, i) => {
    const isVideo = file.mimetype.startsWith('video/');
    const filename = storeUpload(file.buffer, file.mimetype, file.originalname);
    const item: LibraryItem = {
      ...base,
      id: randomUUID(),
      kind: isVideo ? 'video' : 'image',
      title: String(req.body?.title || file.originalname.replace(/\.[^.]+$/, '')).slice(0, 120),
      url: null,
      filename,
      mime: file.mimetype,
      analysis: null,
      createdAt: new Date().toISOString(),
    };
    item.analysis = heuristicLibraryAnalysis(item, safeColors(colorSamples[i]));
    db.insert('library', item);
    created.push(item);
  });

  for (const url of urls) {
    const meta = fromUrl(url);
    const item: LibraryItem = {
      ...base,
      id: randomUUID(),
      kind: (KINDS.includes(req.body?.kind) ? req.body.kind : meta.kind) as LibraryKind,
      title: String(req.body?.title || meta.title).slice(0, 120),
      url,
      filename: null,
      mime: null,
      vendor: meta.vendor,
      analysis: null,
      createdAt: new Date().toISOString(),
    };
    item.analysis = heuristicLibraryAnalysis(item);
    db.insert('library', item);
    created.push(item);
  }

  if (!files.length && !urls.length && notes) {
    const item: LibraryItem = {
      ...base,
      id: randomUUID(),
      kind: 'note',
      title: String(req.body?.title || notes.slice(0, 60)),
      url: null,
      filename: null,
      mime: null,
      analysis: null,
      createdAt: new Date().toISOString(),
    };
    item.analysis = heuristicLibraryAnalysis(item);
    db.insert('library', item);
    created.push(item);
  }

  db.update('projects', project.id, { updatedAt: new Date().toISOString() });
  res.status(201).json(created);
});

router.get('/library/:id/file', (req, res) => {
  const item = db.find('library', (l) => l.id === req.params.id);
  if (!item?.filename) return res.status(404).json({ error: 'No file for this item' });
  const buf = readUpload(item.filename);
  if (!buf) return res.status(410).json({ error: 'The file behind this record is gone.' });
  res.type(item.mime ?? 'application/octet-stream').set('Cache-Control', 'private, max-age=86400').send(buf);
});

router.patch('/library/:id', (req, res) => {
  const patch: Partial<LibraryItem> = {};
  for (const k of ['title', 'notes'] as const) if (k in req.body) patch[k] = String(req.body[k]);
  if ('tags' in req.body) patch.tags = parseList(req.body.tags);
  if ('favorite' in req.body) patch.favorite = Boolean(req.body.favorite);
  if ('priceCents' in req.body) patch.priceCents = req.body.priceCents == null ? null : Number(req.body.priceCents);
  if ('dims' in req.body) patch.dims = req.body.dims;
  const updated = db.update('library', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Item not found' });
  res.json(updated);
});

router.delete('/library/:id', (req, res) => {
  const item = db.find('library', (l) => l.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.filename) deleteUpload(item.filename);
  db.remove('library', (l) => l.id === item.id);
  res.status(204).end();
});

/** Read one saved item properly, with vision when the item has an image. */
router.post('/library/:id/analyze', async (req, res) => {
  const item = db.find('library', (l) => l.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  if (!config.hasClaude) {
    return res.status(503).json({
      error: 'Analysis needs an Anthropic API key.',
      detail: 'Set ANTHROPIC_API_KEY in .env and restart. Until then items are filed by keyword, which still drives matching and search.',
      needsKey: true,
    });
  }

  try {
    let image;
    if (item.filename && item.mime) {
      const mediaType = visionMediaType(item.mime);
      const base64 = mediaType ? readUploadBase64(item.filename) : null;
      if (mediaType && base64) image = { mediaType, base64, label: item.title };
    }

    const analysis = await analyzeLibraryItem(item, image);
    if (!analysis) return res.status(502).json({ error: 'Analysis came back empty.' });

    const { tags, ...rest } = analysis;
    const merged = [...new Set([...item.tags, ...tags])].slice(0, 20);
    const updated = db.update('library', item.id, { analysis: rest, tags: merged });
    res.json(updated);
  } catch (err) {
    console.error('[library analyze]', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Analysis failed.' });
  }
});

/** Analyze everything that has not had a real read yet. */
router.post('/projects/:id/library/analyze-all', async (req, res) => {
  if (!config.hasClaude) {
    return res.status(503).json({ error: 'Analysis needs an Anthropic API key.', needsKey: true });
  }
  const pending = db
    .filter('library', (l) => l.projectId === req.params.id && l.analysis?.engine !== 'claude')
    .slice(0, Number(req.body?.limit) || 25);

  const results = { analyzed: 0, failed: 0, errors: [] as string[] };
  for (const item of pending) {
    try {
      let image;
      if (item.filename && item.mime) {
        const mediaType = visionMediaType(item.mime);
        const base64 = mediaType ? readUploadBase64(item.filename) : null;
        if (mediaType && base64) image = { mediaType, base64, label: item.title };
      }
      const analysis = await analyzeLibraryItem(item, image);
      if (!analysis) throw new Error('empty result');
      const { tags, ...rest } = analysis;
      db.update('library', item.id, { analysis: rest, tags: [...new Set([...item.tags, ...tags])].slice(0, 20) });
      results.analyzed++;
    } catch (err) {
      results.failed++;
      results.errors.push(`${item.title}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }
  res.json({ ...results, remaining: db.filter('library', (l) => l.projectId === req.params.id && l.analysis?.engine !== 'claude').length });
});

function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch { /* fall through to comma splitting */ }
  return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function safeColors(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function parseDims(body: Record<string, unknown>): LibraryItem['dims'] {
  const w = Number(body?.widthCm), d = Number(body?.depthCm), h = Number(body?.heightCm);
  if (!Number.isFinite(w) && !Number.isFinite(d) && !Number.isFinite(h)) return null;
  return {
    w: Number.isFinite(w) ? w : null,
    d: Number.isFinite(d) ? d : null,
    h: Number.isFinite(h) ? h : null,
  };
}

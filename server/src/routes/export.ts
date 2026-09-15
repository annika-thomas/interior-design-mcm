import { Router } from 'express';
import { db } from '../db.js';
import { buildBlenderScript } from '../services/blender.js';
import { CATALOG_BY_KEY } from '../mcm/catalog.js';
import { areaSqm, walls } from '../mcm/geometry.js';

export const router = Router();

function loadProject(projectId: string) {
  const project = db.find('projects', (p) => p.id === projectId);
  if (!project) return null;
  const rooms = db.filter('rooms', (r) => r.projectId === project.id).map((room) => ({
    ...room,
    openings: db.filter('openings', (o) => o.roomId === room.id),
    furniture: db.filter('furniture', (f) => f.roomId === room.id),
  }));
  return { project, rooms };
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'apartment';
}

/** A Blender Python script that rebuilds the apartment as named, editable objects. */
router.get('/projects/:id/export/blender', (req, res) => {
  const loaded = loadProject(req.params.id);
  if (!loaded) return res.status(404).json({ error: 'Project not found' });

  const script = buildBlenderScript(loaded.project.name, loaded.rooms);
  res
    .type('text/x-python')
    .set('Content-Disposition', `attachment; filename="${slug(loaded.project.name)}.py"`)
    .send(script);
});

/** The full model as plain JSON, for scripting against or backing up. */
router.get('/projects/:id/export/json', (req, res) => {
  const loaded = loadProject(req.params.id);
  if (!loaded) return res.status(404).json({ error: 'Project not found' });

  res
    .type('application/json')
    .set('Content-Disposition', `attachment; filename="${slug(loaded.project.name)}.json"`)
    .send(JSON.stringify({
      project: loaded.project,
      rooms: loaded.rooms,
      library: db.filter('library', (l) => l.projectId === loaded.project.id),
      suggestions: db.filter('suggestions', (s) => s.projectId === loaded.project.id),
      exportedAt: new Date().toISOString(),
    }, null, 2));
});

/** The plan as a markdown shopping and to-do list you can take to a store. */
router.get('/projects/:id/export/plan', (req, res) => {
  const loaded = loadProject(req.params.id);
  if (!loaded) return res.status(404).json({ error: 'Project not found' });
  const { project, rooms } = loaded;

  const library = new Map(db.filter('library', (l) => l.projectId === project.id).map((l) => [l.id, l]));
  const suggestions = db.filter('suggestions', (s) => s.projectId === project.id);

  const lines: string[] = [`# ${project.name} — mid-century modern plan`, ''];
  lines.push(`_Generated ${new Date().toLocaleDateString()}. ${rooms.length} room(s), ${Math.round(rooms.reduce((s, r) => s + areaSqm(r.polygon), 0) * 10) / 10} sqm total._`, '');

  for (const room of rooms) {
    const area = Math.round(areaSqm(room.polygon) * 10) / 10;
    lines.push(`## ${room.name}`, '');
    lines.push(`${area} sqm · ${room.heightCm} cm ceilings · walls \`${room.wallColor}\` · floor \`${room.floorColor}\` (${room.floorMaterial})`);
    const ws = walls(room.polygon);
    lines.push(`Walls: ${ws.map((w) => `${w.compass} ${Math.round(w.lengthCm)} cm`).join(', ')}`);
    if (room.analysis) lines.push('', `**Style score ${room.analysis.styleScore}/100.** ${room.analysis.summary}`);
    lines.push('');

    const roomSuggestions = suggestions.filter((s) => s.roomId === room.id && s.status !== 'dismissed');
    if (roomSuggestions.length) {
      for (const priority of [1, 2, 3] as const) {
        const group = roomSuggestions.filter((s) => s.priority === priority);
        if (!group.length) continue;
        lines.push(`### ${priority === 1 ? 'Do first' : priority === 2 ? 'Then' : 'Eventually'}`, '');
        for (const s of group) {
          const item = s.catalogKey ? CATALOG_BY_KEY[s.catalogKey] : undefined;
          const saved = s.libraryItemId ? library.get(s.libraryItemId) : undefined;
          const check = s.status === 'done' || s.status === 'accepted' ? 'x' : ' ';
          lines.push(`- [${check}] **${s.title}**${item ? ` — ${item.dims.w}×${item.dims.d}×${item.dims.h} cm` : ''}`);
          lines.push(`  ${s.rationale}`);
          if (saved) lines.push(`  From your library: ${saved.title}${saved.url ? ` (${saved.url})` : ''}`);
        }
        lines.push('');
      }
    }

    if (room.furniture.length) {
      lines.push('### Currently placed', '');
      for (const f of room.furniture) {
        lines.push(`- ${f.label} — ${f.widthCm}×${f.depthCm}×${f.heightCm} cm at (${Math.round(f.x)}, ${Math.round(f.y)}) cm, ${Math.round(f.rotationDeg)}°${f.source === 'existing' ? ' _(already owned)_' : ''}`);
      }
      lines.push('');
    }
  }

  res
    .type('text/markdown')
    .set('Content-Disposition', `attachment; filename="${slug(project.name)}-plan.md"`)
    .send(lines.join('\n'));
});

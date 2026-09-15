import type { Furniture, Opening, Room } from '../types.js';
import { CATALOG_BY_KEY } from '../mcm/catalog.js';
import { walls } from '../mcm/geometry.js';

/**
 * Emit a Blender Python script that rebuilds the apartment parametrically.
 *
 * A mesh export (glTF) is also available from the 3D view, but this is the more
 * useful artifact for actually working on the model: every wall, opening and
 * piece of furniture comes through as a separately named object inside a
 * per-room collection, with real materials, so you can select "Living Room /
 * Walnut Credenza" in the outliner and move it. Walls are solid geometry with
 * doors and windows cut out by boolean, so the model is watertight enough to
 * render.
 *
 * Run it with:  blender --python apartment.py
 * or paste it into Blender's Scripting tab and press Run.
 */
export function buildBlenderScript(
  projectName: string,
  rooms: Array<Room & { openings: Opening[]; furniture: Furniture[] }>,
): string {
  const lines: string[] = [];
  const M = (cm: number) => (cm / 100).toFixed(4); // Blender works in metres.

  lines.push(`# ${projectName} — generated apartment model`);
  lines.push('# Run with:  blender --python this_file.py');
  lines.push('# Units are metres. Plan +Y in the app maps to Blender -Y so the model reads');
  lines.push('# the same way round as the floor plan when viewed from the top.');
  lines.push('import bpy, math');
  lines.push('');
  lines.push('WALL_THICKNESS = 0.12');
  lines.push('');
  lines.push(`# Start from an empty scene so re-running the script does not stack duplicates.`);
  lines.push('for obj in list(bpy.data.objects):');
  lines.push('    bpy.data.objects.remove(obj, do_unlink=True)');
  lines.push('for coll in list(bpy.data.collections):');
  lines.push('    bpy.data.collections.remove(coll)');
  lines.push('');
  lines.push('def hex_to_rgba(h, alpha=1.0):');
  lines.push('    h = h.lstrip("#")');
  lines.push('    if len(h) == 3:');
  lines.push('        h = "".join(c * 2 for c in h)');
  lines.push('    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))');
  lines.push('    # sRGB -> linear, so colours look right in Cycles and EEVEE.');
  lines.push('    def lin(c):');
  lines.push('        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4');
  lines.push('    return (lin(r), lin(g), lin(b), alpha)');
  lines.push('');
  lines.push('_materials = {}');
  lines.push('def material(name, hex_color, roughness=0.6, metallic=0.0):');
  lines.push('    key = (name, hex_color, roughness, metallic)');
  lines.push('    if key in _materials:');
  lines.push('        return _materials[key]');
  lines.push('    mat = bpy.data.materials.new(name=name)');
  lines.push('    mat.use_nodes = True');
  lines.push('    bsdf = mat.node_tree.nodes.get("Principled BSDF")');
  lines.push('    if bsdf:');
  lines.push('        bsdf.inputs["Base Color"].default_value = hex_to_rgba(hex_color)');
  lines.push('        bsdf.inputs["Roughness"].default_value = roughness');
  lines.push('        bsdf.inputs["Metallic"].default_value = metallic');
  lines.push('    _materials[key] = mat');
  lines.push('    return mat');
  lines.push('');
  lines.push('def collection(name, parent=None):');
  lines.push('    coll = bpy.data.collections.new(name)');
  lines.push('    (parent or bpy.context.scene.collection).children.link(coll)');
  lines.push('    return coll');
  lines.push('');
  lines.push('def box(name, coll, size, location, rotation_z=0.0, mat=None):');
  lines.push('    """Axis-aligned cube scaled to `size` (x, y, z) with its origin at the centre."""');
  lines.push('    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)');
  lines.push('    obj = bpy.context.active_object');
  lines.push('    obj.name = name');
  lines.push('    obj.scale = size');
  lines.push('    obj.rotation_euler[2] = rotation_z');
  lines.push('    for c in obj.users_collection:');
  lines.push('        c.objects.unlink(obj)');
  lines.push('    coll.objects.link(obj)');
  lines.push('    if mat:');
  lines.push('        obj.data.materials.append(mat)');
  lines.push('    return obj');
  lines.push('');
  lines.push('def cut(target, cutters):');
  lines.push('    """Boolean-subtract each cutter from target, then remove the cutter."""');
  lines.push('    for c in cutters:');
  lines.push('        mod = target.modifiers.new(name="opening", type="BOOLEAN")');
  lines.push('        mod.operation = "DIFFERENCE"');
  lines.push('        mod.object = c');
  lines.push('        mod.solver = "FAST"');
  lines.push('    bpy.context.view_layer.objects.active = target');
  lines.push('    for mod in list(target.modifiers):');
  lines.push('        bpy.ops.object.modifier_apply(modifier=mod.name)');
  lines.push('    for c in cutters:');
  lines.push('        bpy.data.objects.remove(c, do_unlink=True)');
  lines.push('');
  lines.push(`root = collection(${py(projectName)})`);
  lines.push('');

  for (const room of rooms) {
    const ws = walls(room.polygon);
    const safe = room.name.replace(/"/g, "'");
    lines.push(`# ${'='.repeat(66)}`);
    lines.push(`# ${safe}`);
    lines.push(`# ${'='.repeat(66)}`);
    lines.push(`room = collection(${py(safe)}, root)`);
    lines.push(`shell = collection(${py(`${safe} / Shell`)}, room)`);
    lines.push(`furn = collection(${py(`${safe} / Furniture`)}, room)`);
    lines.push(`wall_mat = material(${py(`${safe} Wall`)}, ${py(room.wallColor || '#EDE6D8')}, roughness=0.9)`);
    lines.push(`floor_mat = material(${py(`${safe} Floor`)}, ${py(room.floorColor || '#C4A77D')}, roughness=0.5)`);
    lines.push('');

    // Floor: a flat plane from the polygon, so non-rectangular rooms come through.
    const verts = room.polygon.map((p) => `(${M(p.x)}, ${M(-p.y)}, 0.0)`).join(', ');
    const faceIdx = room.polygon.map((_, i) => i).join(', ');
    lines.push('mesh = bpy.data.meshes.new("Floor")');
    lines.push(`mesh.from_pydata([${verts}], [], [[${faceIdx}]])`);
    lines.push('mesh.update()');
    lines.push('floor_obj = bpy.data.objects.new("Floor", mesh)');
    lines.push('shell.objects.link(floor_obj)');
    lines.push('floor_obj.data.materials.append(floor_mat)');
    lines.push('');

    for (const w of ws) {
      const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      // Nudge the wall outward by half its thickness so the interior keeps the
      // floor-plan dimensions the user measured.
      const cx = mid.x - w.inward.x * 6;
      const cy = mid.y - w.inward.y * 6;
      const rot = Math.atan2(-(w.b.y - w.a.y), w.b.x - w.a.x);
      const name = `Wall ${w.index + 1} (${w.compass})`;
      lines.push(`wall = box(${py(name)}, shell, (${M(w.lengthCm)}, WALL_THICKNESS * 100 / 100, ${M(room.heightCm)}), (${M(cx)}, ${M(-cy)}, ${M(room.heightCm / 2)}), rotation_z=${rot.toFixed(5)}, mat=wall_mat)`);

      const wallOpenings = room.openings.filter((o) => o.wallIndex === w.index);
      if (wallOpenings.length) {
        lines.push('cutters = []');
        for (const o of wallOpenings) {
          const t = (o.offsetCm + o.widthCm / 2) / (w.lengthCm || 1);
          const ox = w.a.x + (w.b.x - w.a.x) * t - w.inward.x * 6;
          const oy = w.a.y + (w.b.y - w.a.y) * t - w.inward.y * 6;
          const oz = o.sillCm + o.heightCm / 2;
          lines.push(`cutters.append(box(${py(`cut ${o.kind}`)}, shell, (${M(o.widthCm)}, 0.6, ${M(o.heightCm)}), (${M(ox)}, ${M(-oy)}, ${M(oz)}), rotation_z=${rot.toFixed(5)}))`);
        }
        lines.push('cut(wall, cutters)');
      }
    }
    lines.push('');

    for (const f of room.furniture) {
      const item = f.catalogKey ? CATALOG_BY_KEY[f.catalogKey] : undefined;
      const color = f.color || item?.colors.primary || '#8A7A5C';
      // Shade from the piece's *primary* material. A travertine table with steel
      // legs is stone, not metal — keying off any listed material made most of
      // the catalog come through looking chrome-plated.
      const primary = item?.materials[0];
      const metal = primary && ['brass', 'chrome', 'blackened-steel'].includes(primary) ? 0.8 : 0.0;
      const rough = primary === 'smoked-glass' ? 0.1
        : primary === 'travertine' ? 0.35
        : primary && ['brass', 'chrome'].includes(primary) ? 0.3
        : primary === 'leather' ? 0.45
        : ['tweed', 'wool-boucle', 'rattan'].includes(primary ?? '') ? 0.85
        : 0.6;
      const rot = (-f.rotationDeg * Math.PI) / 180;
      const name = `${f.label}${item ? '' : ' (custom)'}`;
      lines.push(`box(${py(name)}, furn, (${M(f.widthCm)}, ${M(f.depthCm)}, ${M(f.heightCm)}), (${M(f.x)}, ${M(-f.y)}, ${M(f.z + f.heightCm / 2)}), rotation_z=${rot.toFixed(5)}, mat=material(${py(name)}, ${py(color)}, roughness=${rough}, metallic=${metal}))`);
    }
    lines.push('');
  }

  lines.push('# A warm key light, because the whole palette depends on 2700K light to read right.');
  lines.push('bpy.ops.object.light_add(type="AREA", location=(2.0, -2.0, 2.4))');
  lines.push('key = bpy.context.active_object');
  lines.push('key.name = "Key Light 2700K"');
  lines.push('key.data.energy = 400');
  lines.push('key.data.size = 2.0');
  lines.push('key.data.color = (1.0, 0.78, 0.55)');
  lines.push('');
  lines.push('print("Apartment rebuilt. Furniture is blocked out as named boxes at true dimensions —")');
  lines.push('print("replace any box with a real model and it will already be the right size and place.")');

  return lines.join('\n') + '\n';
}

/** Python string literal with quoting handled. */
function py(s: string): string {
  return JSON.stringify(String(s));
}

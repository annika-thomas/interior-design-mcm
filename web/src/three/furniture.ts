import * as THREE from 'three';
import type { CatalogItem, Furniture } from '../types';

/**
 * Procedural mid-century furniture.
 *
 * Every piece is generated from its real dimensions rather than loaded as an
 * asset. That keeps the repo free of a model pipeline, lets you resize anything
 * to match a product you actually found, and still exports as clean glTF.
 *
 * The silhouettes matter more than the detail here: low seat heights, visible
 * tapered legs and a clear gap of floor beneath everything are what make a room
 * read as mid-century, and those are exactly the things this models faithfully.
 *
 * All builders work in metres. Callers convert from the stored centimetres.
 */

const MATERIAL_PROPS: Record<string, { roughness: number; metalness: number }> = {
  walnut: { roughness: 0.62, metalness: 0 },
  teak: { roughness: 0.58, metalness: 0 },
  oak: { roughness: 0.65, metalness: 0 },
  rosewood: { roughness: 0.55, metalness: 0 },
  bentply: { roughness: 0.5, metalness: 0 },
  fiberglass: { roughness: 0.42, metalness: 0 },
  'wool-boucle': { roughness: 0.94, metalness: 0 },
  tweed: { roughness: 0.92, metalness: 0 },
  leather: { roughness: 0.46, metalness: 0 },
  brass: { roughness: 0.32, metalness: 0.85 },
  'blackened-steel': { roughness: 0.42, metalness: 0.75 },
  chrome: { roughness: 0.1, metalness: 0.95 },
  travertine: { roughness: 0.4, metalness: 0 },
  'smoked-glass': { roughness: 0.08, metalness: 0.2 },
  rattan: { roughness: 0.8, metalness: 0 },
  greywash: { roughness: 0.72, metalness: 0 },
};

const cache = new Map<string, THREE.MeshStandardMaterial>();

function mat(
  color: string,
  materialKey?: string,
  opts: { transparent?: boolean; opacity?: number; emissive?: string; doubleSide?: boolean } = {},
) {
  // Materials are shared across every piece in the scene, so the cache key has
  // to cover every property a caller can vary. Mutating a returned material
  // would silently change unrelated furniture.
  const key = `${color}|${materialKey ?? ''}|${opts.opacity ?? 1}|${opts.emissive ?? ''}|${opts.doubleSide ?? false}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const props = MATERIAL_PROPS[materialKey ?? ''] ?? { roughness: 0.65, metalness: 0 };
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: props.roughness,
    metalness: props.metalness,
    transparent: Boolean(opts.transparent),
    opacity: opts.opacity ?? 1,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissive ? 0.9 : 0,
  });
  cache.set(key, m);
  return m;
}

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rTop: number, rBottom: number, h: number, material: THREE.Material, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material);
  m.castShadow = true;
  return m;
}

/**
 * Legs, in the style that defines the period.
 *
 * `clearance` is the height of the clear gap under the piece — the thing the
 * "everything stands on legs" rule measures — so the geometry and the rule
 * engine are describing the same distance.
 */
function addLegs(
  group: THREE.Group,
  style: string,
  w: number,
  d: number,
  clearance: number,
  material: THREE.Material,
  inset = 0.06,
) {
  if (clearance <= 0.001 || style === 'none') return;
  const hx = w / 2 - inset;
  const hz = d / 2 - inset;
  const corners: Array<[number, number]> = [[hx, hz], [-hx, hz], [hx, -hz], [-hx, -hz]];

  switch (style) {
    case 'tapered': {
      for (const [x, z] of corners) {
        const leg = cyl(0.022, 0.012, clearance, material, 10);
        leg.position.set(x, clearance / 2, z);
        group.add(leg);
      }
      break;
    }
    case 'splayed': {
      for (const [x, z] of corners) {
        const leg = cyl(0.02, 0.011, clearance, material, 10);
        leg.position.set(x, clearance / 2, z);
        // Kick the foot outward — the splay that reads instantly as 1950s.
        leg.rotation.z = -Math.sign(x) * 0.17;
        leg.rotation.x = Math.sign(z) * 0.17;
        group.add(leg);
      }
      break;
    }
    case 'hairpin': {
      for (const [x, z] of corners) {
        for (const lean of [-1, 1]) {
          const rod = cyl(0.007, 0.007, clearance * 1.02, material, 8);
          rod.position.set(x, clearance / 2, z - lean * 0.03);
          rod.rotation.x = lean * 0.1;
          group.add(rod);
        }
      }
      break;
    }
    case 'tripod': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const r = Math.min(w, d) / 2 - inset;
        const leg = cyl(0.019, 0.011, clearance, material, 10);
        leg.position.set(Math.cos(a) * r * 0.8, clearance / 2, Math.sin(a) * r * 0.8);
        leg.rotation.z = -Math.cos(a) * 0.19;
        leg.rotation.x = Math.sin(a) * 0.19;
        group.add(leg);
      }
      break;
    }
    case 'pedestal': {
      const column = cyl(0.055, 0.075, clearance, material, 24);
      column.position.y = clearance / 2;
      group.add(column);
      const foot = cyl(Math.min(w, d) * 0.3, Math.min(w, d) * 0.32, 0.025, material, 32);
      foot.position.y = 0.012;
      group.add(foot);
      break;
    }
    case 'sled': {
      for (const z of [hz, -hz]) {
        const runner = box(w * 0.92, 0.018, 0.018, material, 0, 0.009, z);
        group.add(runner);
        for (const x of [hx, -hx]) {
          const post = cyl(0.009, 0.009, clearance, material, 8);
          post.position.set(x, clearance / 2, z);
          group.add(post);
        }
      }
      break;
    }
    case 'plinth':
    default: {
      // A recessed base block: the piece reads as floating on a shadow line.
      group.add(box(w * 0.82, clearance, d * 0.82, material, 0, clearance / 2, 0));
    }
  }
}

interface BuildContext {
  w: number; h: number; d: number;
  primary: THREE.Material;
  secondary: THREE.Material;
  /** Double-sided variants, for shells and shades you can see the inside of. */
  primaryOpen: THREE.Material;
  secondaryOpen: THREE.Material;
  accent: THREE.Material;
  legMat: THREE.Material;
  legs: string;
  clearance: number;
  /** Elliptical rather than rectangular top, for the curved pieces. */
  roundTop: boolean;
}

type Builder = (g: THREE.Group, c: BuildContext) => void;

const BUILDERS: Record<string, Builder> = {
  sofa: (g, c) => {
    const { w, h, d, primary, legMat } = c;
    const seatTop = c.clearance + 0.18;
    const armW = Math.min(0.14, w * 0.08);
    g.add(box(w, 0.18, d, primary, 0, c.clearance + 0.09, 0));                    // seat platform
    g.add(box(w - armW * 2, 0.14, d - 0.14, primary, 0, seatTop + 0.07, 0.03));   // cushions
    const backH = h - seatTop;
    const back = box(w, backH, 0.16, primary, 0, seatTop + backH / 2, -d / 2 + 0.08);
    back.rotation.x = -0.06;                                                       // slight recline
    g.add(back);
    for (const s of [1, -1]) g.add(box(armW, h - c.clearance - 0.16, d - 0.06, primary, (s * (w - armW)) / 2, c.clearance + (h - c.clearance) / 2 - 0.05, 0.02));
    addLegs(g, c.legs, w, d, c.clearance, legMat, 0.1);
  },

  'lounge-chair': (g, c) => {
    const { w, h, d, primary, secondary, legMat } = c;
    const seatY = c.clearance + 0.19;
    g.add(box(w * 0.94, 0.16, d * 0.82, primary, 0, c.clearance + 0.08, 0.02));
    const backH = h - seatY;
    const back = box(w * 0.94, backH, 0.17, primary, 0, seatY + backH / 2 - 0.03, -d / 2 + 0.12);
    back.rotation.x = -0.24;                                                       // a real recline
    g.add(back);
    for (const s of [1, -1]) {
      const arm = box(0.09, 0.1, d * 0.62, secondary, (s * w * 0.94) / 2, seatY + 0.11, 0.02);
      g.add(arm);
    }
    addLegs(g, c.legs, w * 0.72, d * 0.66, c.clearance, legMat, 0.02);
  },

  'shell-chair': (g, c) => {
    const { w, h, d, primary, legMat } = c;
    // A hollowed hemisphere makes a far better shell than any box arrangement.
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      c.primaryOpen,
    );
    shell.scale.set(w, (h - c.clearance) * 1.05, d);
    shell.rotation.x = Math.PI;                                                    // open side up
    shell.position.y = c.clearance + (h - c.clearance);
    shell.castShadow = true;
    g.add(shell);
    g.add(box(w * 0.78, 0.07, d * 0.72, primary, 0, c.clearance + 0.04, 0.02));    // seat pad
    addLegs(g, c.legs, w * 0.7, d * 0.68, c.clearance, legMat, 0.02);
  },

  chair: (g, c) => {
    const { w, h, d, primary, secondary, legMat } = c;
    const seatY = c.clearance + 0.04;
    g.add(box(w * 0.92, 0.055, d * 0.9, secondary, 0, seatY, 0));
    // Two horizontal rails read as a Wegner-style back without the cost of a loft.
    const backH = h - seatY;
    for (const [frac, thick] of [[0.95, 0.055], [0.62, 0.035]] as const) {
      g.add(box(w * 0.86, thick, 0.035, primary, 0, seatY + backH * frac, -d / 2 + 0.05));
    }
    for (const s of [1, -1]) {
      const post = box(0.03, backH, 0.03, primary, (s * w * 0.86) / 2, seatY + backH / 2, -d / 2 + 0.05);
      post.rotation.x = -0.07;
      g.add(post);
    }
    addLegs(g, c.legs, w * 0.88, d * 0.86, c.clearance, legMat, 0.03);
  },

  table: (g, c) => {
    const { w, h, d, primary, legMat } = c;
    const topH = 0.04;
    if (c.roundTop) {
      // One cylinder scaled on z covers both the round and the oval cases —
      // a tulip table and a kidney-shaped coffee table are the same primitive.
      const top = cyl(w / 2, w / 2, topH, primary, 48);
      top.scale.z = d / w;
      top.position.y = h - topH / 2;
      top.receiveShadow = true;
      g.add(top);
    } else {
      g.add(box(w, topH, d, primary, 0, h - topH / 2, 0));
    }
    const legGroup = new THREE.Group();
    addLegs(legGroup, c.legs, w, d, h - topH, legMat, 0.07);
    g.add(legGroup);
  },

  case: (g, c) => {
    const { w, h, d, primary, secondary, legMat } = c;
    const bodyH = h - c.clearance;
    g.add(box(w, bodyH, d, primary, 0, c.clearance + bodyH / 2, 0));
    // Score the front into doors, and add the slim pulls that date the piece.
    const doors = Math.max(2, Math.round(w / 0.55));
    const doorW = w / doors;
    for (let i = 0; i < doors; i++) {
      const x = -w / 2 + doorW * (i + 0.5);
      g.add(box(doorW - 0.012, bodyH - 0.024, 0.008, secondary, x, c.clearance + bodyH / 2, d / 2 + 0.002));
      const pull = box(doorW * 0.34, 0.016, 0.016, secondary, x, c.clearance + bodyH * 0.72, d / 2 + 0.012);
      g.add(pull);
    }
    addLegs(g, c.legs, w * 0.92, d, c.clearance, legMat, 0.07);
  },

  shelf: (g, c) => {
    const { w, h, d, primary, secondary } = c;
    const bays = Math.max(2, Math.round(w / 0.9));
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + (w / bays) * i;
      g.add(box(0.03, h - c.clearance, 0.035, secondary, x, c.clearance + (h - c.clearance) / 2, -d / 2 + 0.03));
    }
    const shelves = Math.max(3, Math.round((h - c.clearance) / 0.36));
    for (let i = 0; i < shelves; i++) {
      const y = c.clearance + ((h - c.clearance) / shelves) * (i + 0.5);
      g.add(box(w, 0.024, d, primary, 0, y, 0));
    }
  },

  bed: (g, c) => {
    const { w, h, d, primary, secondary, legMat } = c;
    const platformY = c.clearance + 0.09;
    g.add(box(w, 0.18, d, primary, 0, platformY, 0));
    g.add(box(w - 0.08, 0.22, d - 0.1, secondary, 0, platformY + 0.2, 0.02));       // mattress
    g.add(box(w - 0.1, 0.14, 0.5, secondary, 0, platformY + 0.36, -d / 2 + 0.3));   // pillows
    const headH = h - platformY - 0.09;
    g.add(box(w, headH, 0.05, primary, 0, platformY + 0.09 + headH / 2, -d / 2 + 0.02));
    addLegs(g, c.legs, w * 0.9, d * 0.9, c.clearance, legMat, 0.1);
  },

  'floor-lamp': (g, c) => {
    const { w, h, accent, legMat } = c;
    const stemH = h * 0.72;
    const stem = cyl(0.014, 0.018, stemH, legMat, 10);
    stem.position.y = stemH / 2;
    g.add(stem);
    const shadeH = h - stemH;
    const shade = cyl(w * 0.34, w * 0.5, shadeH, c.secondaryOpen, 28);
    shade.position.y = stemH + shadeH / 2;
    g.add(shade);
    g.add(glow(accent, w * 0.3, stemH + shadeH * 0.35));
    addLegs(g, c.legs === 'tripod' ? 'tripod' : 'tripod', w, w, 0.02, legMat, 0);
  },

  'arc-lamp': (g, c) => {
    const { w, h, primary, secondary, accent } = c;
    // The base is a solid block of stone and the arm is a real swept curve —
    // both are the whole point of the silhouette.
    g.add(box(0.22, 0.16, 0.22, secondary, -w / 2 + 0.11, 0.08, 0));
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(-w / 2 + 0.11, 0.16, 0),
      new THREE.Vector3(-w / 2 + 0.11, h * 0.92, 0),
      new THREE.Vector3(w * 0.1, h, 0),
      new THREE.Vector3(w / 2, h * 0.78, 0),
    );
    const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.017, 10, false), primary);
    arm.castShadow = true;
    g.add(arm);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), c.primaryOpen);
    dome.rotation.x = Math.PI;
    dome.position.set(w / 2, h * 0.78, 0);
    g.add(dome);
    g.add(glow(accent, 0.09, h * 0.75, w / 2));
  },

  'table-lamp': (g, c) => {
    const { w, h, primary, accent } = c;
    const baseH = h * 0.42;
    const base = cyl(0.035, w * 0.28, baseH, primary, 20);
    base.position.y = baseH / 2;
    g.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), c.secondaryOpen);
    dome.rotation.x = Math.PI;
    dome.position.y = h;
    dome.castShadow = true;
    g.add(dome);
    g.add(glow(accent, w * 0.3, h - w * 0.28));
  },

  pendant: (g, c) => {
    const { w, primary, accent } = c;
    // Hangs from the ceiling, so the cord runs up out of the group.
    const cord = cyl(0.005, 0.005, 1.2, primary, 6);
    cord.position.y = w / 2 + 0.6;
    g.add(cord);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 28, 20), primary);
    globe.position.y = 0;
    globe.castShadow = true;
    g.add(globe);
    g.add(glow(accent, w * 0.36, 0));
  },

  sputnik: (g, c) => {
    const { w, primary, accent } = c;
    const r = w / 2;
    g.add(cyl(0.005, 0.005, 0.5, primary, 6).translateY(r + 0.25));
    const hub = new THREE.Mesh(new THREE.SphereGeometry(r * 0.17, 16, 12), primary);
    g.add(hub);
    // Points distributed on a sphere, which is what gives the real thing its
    // even, slightly random-looking burst.
    const arms = 16;
    for (let i = 0; i < arms; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / arms);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );
      const rod = cyl(0.004, 0.004, r * 0.92, primary, 6);
      rod.position.copy(dir.clone().multiplyScalar(r * 0.46));
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(rod);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(r * 0.1, 10, 8), accent);
      bulb.position.copy(dir.clone().multiplyScalar(r * 0.95));
      g.add(bulb);
    }
  },

  rug: (g, c) => {
    const { w, d, primary, secondary, accent } = c;
    // Filled panels stacked outermost-first, so each one reads as a band of the
    // concentric border pattern the period used. The largest area is the inner
    // field, which is what keeps a bold rug from overwhelming the room.
    const bands: Array<[number, THREE.Material]> = [
      [0, primary],
      [Math.min(w, d) * 0.09, accent],
      [Math.min(w, d) * 0.17, secondary],
    ];
    bands.forEach(([inset, material], i) => {
      const panel = box(
        Math.max(w - inset * 2, 0.1), 0.004, Math.max(d - inset * 2, 0.1),
        material, 0, 0.004 + i * 0.002, 0,
      );
      panel.castShadow = false;
      g.add(panel);
    });
  },

  art: (g, c) => {
    const { w, h, primary, secondary, accent } = c;
    g.add(box(w, h, 0.03, secondary, 0, 0, 0));
    g.add(box(w - 0.06, h - 0.06, 0.012, primary, 0, 0, 0.018));
    // Two offset blocks: an abstract that reads at a glance without a texture.
    g.add(box(w * 0.34, h * 0.42, 0.006, accent, -w * 0.14, h * 0.1, 0.026));
    g.add(box(w * 0.22, h * 0.26, 0.006, secondary, w * 0.2, -h * 0.14, 0.026));
  },

  mirror: (g, c) => {
    const { w, primary, secondary } = c;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(w / 2 - 0.02, 0.022, 12, 40), primary);
    g.add(ring);
    const glass = cyl(w / 2 - 0.03, w / 2 - 0.03, 0.01, secondary, 40);
    glass.rotation.x = Math.PI / 2;
    g.add(glass);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const ray = box(0.012, 0.012, w * 0.16, primary, Math.cos(a) * (w / 2 + 0.05), Math.sin(a) * (w / 2 + 0.05), 0);
      ray.rotation.z = a;
      g.add(ray);
    }
  },

  plant: (g, c) => {
    const { w, h, primary, secondary } = c;
    const potH = h * 0.26;
    const pot = cyl(w * 0.3, w * 0.22, potH, secondary, 20);
    pot.position.y = potH / 2;
    g.add(pot);
    const stemH = h - potH;
    g.add(cyl(0.012, 0.018, stemH, primary, 6).translateY(potH + stemH / 2));
    // Irregular leaf clusters — a plant that is too symmetrical looks fake.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + i * 0.7;
      const t = 0.35 + (i % 3) * 0.22;
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(w * (0.17 + (i % 2) * 0.07), 0), primary);
      leaf.position.set(Math.cos(a) * w * 0.26, potH + stemH * t, Math.sin(a) * w * 0.26);
      leaf.scale.y = 0.55;
      leaf.castShadow = true;
      g.add(leaf);
    }
  },

  divider: (g, c) => {
    const { w, h, d, primary } = c;
    g.add(box(w, 0.05, d, primary, 0, c.clearance, 0));
    g.add(box(w, 0.05, d, primary, 0, h - 0.025, 0));
    const slats = Math.max(4, Math.round(w / 0.16));
    for (let i = 0; i < slats; i++) {
      const x = -w / 2 + (w / (slats - 1)) * i;
      g.add(box(0.035, h - c.clearance - 0.05, d * 0.55, primary, x, c.clearance + (h - c.clearance) / 2, 0));
    }
  },

  cart: (g, c) => {
    const { w, h, d, primary, secondary } = c;
    for (const y of [c.clearance + 0.02, h * 0.58, h - 0.04]) {
      g.add(box(w, 0.016, d, secondary, 0, y, 0));
    }
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      g.add(cyl(0.01, 0.01, h - c.clearance, primary, 8).translateX((sx * (w - 0.06)) / 2).translateY(c.clearance + (h - c.clearance) / 2).translateZ((sz * (d - 0.06)) / 2));
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(c.clearance * 0.45, 0.012, 8, 14), primary);
      wheel.position.set((sx * (w - 0.06)) / 2, c.clearance * 0.45, (sz * (d - 0.06)) / 2);
      wheel.rotation.y = Math.PI / 2;
      g.add(wheel);
    }
  },

  box: (g, c) => {
    g.add(box(c.w, c.h, c.d, c.primary, 0, c.h / 2, 0));
  },
};

/** A soft emissive blob standing in for a lit bulb. */
function glow(material: THREE.Material, radius: number, y: number, x = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), material);
  m.position.set(x, y, 0);
  return m;
}

export interface BuiltPiece {
  group: THREE.Group;
  /** Whether the piece emits light, so the scene can add a real light source. */
  isLight: boolean;
}

/**
 * Build one placed piece, positioned and rotated in the room.
 *
 * Plan coordinates are (x right, y down) in centimetres; the 3D scene is
 * (x right, z toward the viewer) in metres, so plan-y maps to scene-z directly
 * and the plan reads the same way round when you look down at the model.
 */
export function buildPiece(piece: Furniture, item: CatalogItem | null): BuiltPiece {
  const group = new THREE.Group();
  const w = piece.widthCm / 100;
  const h = piece.heightCm / 100;
  const d = piece.depthCm / 100;

  const shape = item?.shape ?? 'box';
  const materials = item?.materials ?? [];
  const primaryColor = piece.color ?? item?.colors.primary ?? '#8A7A5C';
  const secondaryColor = item?.colors.secondary ?? primaryColor;
  const accentColor = item?.colors.accent ?? '#F2D9A8';
  const isLight = item?.category === 'lighting';

  const ctx: BuildContext = {
    w, h, d,
    primary: mat(primaryColor, materials[0]),
    secondary: mat(secondaryColor, materials[1] ?? materials[0]),
    primaryOpen: mat(primaryColor, materials[0], { doubleSide: true }),
    secondaryOpen: mat(secondaryColor, materials[1] ?? materials[0], { doubleSide: true }),
    // Lit elements glow; everything else uses the accent as a plain colour.
    accent: isLight
      ? mat(accentColor, undefined, { emissive: '#FFD9A0' })
      : mat(accentColor, materials[2] ?? materials[0]),
    legMat: mat(
      materials.includes('blackened-steel') ? '#3A3A3C' : materials.includes('brass') ? '#B08D3F' : secondaryColor,
      materials.find((m) => ['blackened-steel', 'brass', 'chrome'].includes(m)) ?? materials[0],
    ),
    legs: item?.legs ?? 'none',
    clearance: Math.min((item?.legClearanceCm ?? 0) / 100, h * 0.55),
    roundTop: Boolean(item?.tags.includes('curve')) || item?.legs === 'pedestal',
  };

  (BUILDERS[shape] ?? BUILDERS.box)(group, ctx);

  group.position.set(piece.x / 100, piece.z / 100, piece.y / 100);
  group.rotation.y = (-piece.rotationDeg * Math.PI) / 180;
  group.userData = { furnitureId: piece.id, kind: 'furniture', height: h };

  return { group, isLight };
}

export function disposeGroup(group: THREE.Object3D) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    // Materials are shared through the cache, so they are not disposed here.
  });
}

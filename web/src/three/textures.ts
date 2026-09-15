import * as THREE from 'three';

/**
 * Procedural surface textures, generated in the browser on a canvas.
 *
 * The difference between a room that reads as CAD and one that reads as a game
 * is almost entirely surface detail: wood that has grain running along it,
 * upholstery you can see the weave of, plaster with some tooth. None of that
 * needs downloaded image assets — it can be drawn, and drawing it keeps the
 * repo free of a texture pipeline and lets every material be tinted to the
 * exact colour the catalog asks for.
 *
 * Each generator paints a greyscale height field, which is used both as a
 * subtle albedo variation and as the source for a derived normal map, so
 * surfaces catch light instead of reading flat.
 */

const SIZE = 256;

export type SurfaceKind =
  | 'wood' | 'wood-fine' | 'fabric' | 'boucle' | 'leather' | 'plaster'
  | 'floorboards' | 'stone' | 'metal' | 'rattan' | 'glass' | 'pile';

interface Surface {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
}

const surfaceCache = new Map<SurfaceKind, Surface>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Deterministic value noise, so a reload produces the same room. */
function makeRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Derive a normal map from a greyscale height canvas using a Sobel gradient.
 * Cheaper and more controllable than authoring normals directly, and it means
 * every height field automatically gets matching relief.
 */
function normalFromHeight(height: HTMLCanvasElement, strength = 2.2): HTMLCanvasElement {
  const src = height.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data;
  const [out, ctx] = canvas();
  const img = ctx.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) => {
    // Wrap, so the normal map tiles as seamlessly as the height field does.
    const px = ((x % SIZE) + SIZE) % SIZE;
    const py = ((y % SIZE) + SIZE) % SIZE;
    return src[(py * SIZE + px) * 4] / 255;
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const n = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize();
      const i = (y * SIZE + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// --- Height field painters -------------------------------------------------

function paintWood(ctx: CanvasRenderingContext2D, seed: number, tightness: number) {
  const rnd = makeRandom(seed);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Growth rings: wavy lines running the length of the board.
  const rings = Math.round(18 * tightness);
  for (let i = 0; i < rings; i++) {
    const base = (i / rings) * SIZE + rnd() * 6;
    const amp = 3 + rnd() * 11;
    const period = 90 + rnd() * 150;
    const phase = rnd() * Math.PI * 2;
    ctx.strokeStyle = `rgba(${40 + rnd() * 50}, ${40 + rnd() * 50}, ${40 + rnd() * 50}, ${0.35 + rnd() * 0.45})`;
    ctx.lineWidth = 0.6 + rnd() * 2.4;
    ctx.beginPath();
    for (let x = 0; x <= SIZE; x += 3) {
      const y = base + Math.sin((x / period) * Math.PI * 2 + phase) * amp;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  // Fine pore texture across the grain.
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    ctx.fillStyle = `rgba(90,90,90,${rnd() * 0.3})`;
    ctx.fillRect(x, y, 1 + rnd() * 3, 0.7);
  }
}

function paintWeave(ctx: CanvasRenderingContext2D, seed: number, pitch: number, slub: number) {
  const rnd = makeRandom(seed);
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Over-under warp and weft, which is what makes upholstery read as cloth.
  for (let y = 0; y < SIZE; y += pitch) {
    for (let x = 0; x < SIZE; x += pitch) {
      const over = ((x / pitch | 0) + (y / pitch | 0)) % 2 === 0;
      const v = over ? 150 + rnd() * 50 : 70 + rnd() * 40;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, pitch - 0.4, pitch - 0.4);
    }
  }

  // Slubs: the irregular thicker threads that stop a weave looking printed.
  for (let i = 0; i < slub; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const len = 4 + rnd() * 20;
    ctx.strokeStyle = `rgba(210,210,210,${0.25 + rnd() * 0.4})`;
    ctx.lineWidth = 1 + rnd() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(rnd() > 0.5 ? x + len : x, rnd() > 0.5 ? y : y + len);
    ctx.stroke();
  }
}

function paintSpeckle(ctx: CanvasRenderingContext2D, seed: number, density: number, contrast: number, base = 128) {
  const rnd = makeRandom(seed);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < density; i++) {
    const v = base + (rnd() - 0.5) * contrast;
    ctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    const r = 0.5 + rnd() * 2.2;
    ctx.beginPath();
    ctx.arc(rnd() * SIZE, rnd() * SIZE, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintFloorboards(ctx: CanvasRenderingContext2D) {
  const rnd = makeRandom(7);
  const boardH = SIZE / 6;
  for (let row = 0; row < 6; row++) {
    const offset = (row % 2) * (SIZE / 3);
    // Each board gets its own grain, so the floor does not visibly repeat.
    const sub = document.createElement('canvas');
    sub.width = SIZE;
    sub.height = boardH;
    const sctx = sub.getContext('2d')!;
    sctx.fillStyle = `rgb(${120 + rnd() * 26 | 0},${120 + rnd() * 26 | 0},${120 + rnd() * 26 | 0})`;
    sctx.fillRect(0, 0, SIZE, boardH);
    for (let i = 0; i < 26; i++) {
      sctx.strokeStyle = `rgba(80,80,80,${rnd() * 0.4})`;
      sctx.lineWidth = 0.5 + rnd();
      const y = rnd() * boardH;
      sctx.beginPath();
      for (let x = 0; x <= SIZE; x += 6) sctx.lineTo(x, y + Math.sin(x / 40 + i) * 1.6);
      sctx.stroke();
    }
    ctx.save();
    ctx.translate(offset, row * boardH);
    ctx.drawImage(sub, 0, 0);
    ctx.drawImage(sub, -SIZE, 0);
    ctx.restore();
    // Board seam.
    ctx.fillStyle = 'rgba(40,40,40,.75)';
    ctx.fillRect(0, row * boardH, SIZE, 1.4);
    ctx.fillRect(offset - 1, row * boardH, 1.6, boardH);
  }
}

function paintRattan(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#6e6e6e';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const pitch = SIZE / 14;
  for (let i = 0; i < 14; i++) {
    const p = i * pitch;
    ctx.fillStyle = 'rgba(200,200,200,.65)';
    ctx.fillRect(p, 0, pitch * 0.55, SIZE);
    ctx.fillStyle = 'rgba(40,40,40,.5)';
    ctx.fillRect(p + pitch * 0.55, 0, pitch * 0.45, SIZE);
  }
  // Second pass at 90 degrees, punched through, gives the open cane grid.
  ctx.globalCompositeOperation = 'overlay';
  for (let i = 0; i < 14; i++) {
    const p = i * pitch;
    ctx.fillStyle = 'rgba(210,210,210,.6)';
    ctx.fillRect(0, p, SIZE, pitch * 0.55);
    ctx.fillStyle = 'rgba(30,30,30,.45)';
    ctx.fillRect(0, p + pitch * 0.55, SIZE, pitch * 0.45);
  }
  ctx.globalCompositeOperation = 'source-over';
}

const PAINTERS: Record<SurfaceKind, (ctx: CanvasRenderingContext2D) => void> = {
  wood: (ctx) => paintWood(ctx, 11, 1),
  'wood-fine': (ctx) => paintWood(ctx, 29, 1.8),
  fabric: (ctx) => paintWeave(ctx, 3, 4, 220),
  boucle: (ctx) => paintWeave(ctx, 91, 6, 900),
  leather: (ctx) => paintSpeckle(ctx, 5, 5200, 44),
  plaster: (ctx) => paintSpeckle(ctx, 17, 3400, 16, 132),
  floorboards: paintFloorboards,
  stone: (ctx) => paintSpeckle(ctx, 23, 2400, 70, 140),
  metal: (ctx) => {
    // Brushed: fine scratches running one way only.
    const rnd = makeRandom(41);
    ctx.fillStyle = '#8c8c8c';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 1800; i++) {
      const y = rnd() * SIZE;
      ctx.strokeStyle = `rgba(${140 + rnd() * 90 | 0},${140 + rnd() * 90 | 0},${140 + rnd() * 90 | 0},.35)`;
      ctx.lineWidth = 0.4 + rnd() * 0.9;
      ctx.beginPath();
      ctx.moveTo(rnd() * SIZE, y);
      ctx.lineTo(rnd() * SIZE, y + (rnd() - 0.5));
      ctx.stroke();
    }
  },
  rattan: paintRattan,
  glass: (ctx) => paintSpeckle(ctx, 61, 400, 8, 128),
  pile: (ctx) => {
    // Shag: dense short strokes in random directions.
    const rnd = makeRandom(83);
    ctx.fillStyle = '#6f6f6f';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      const a = rnd() * Math.PI * 2;
      const len = 2 + rnd() * 5;
      ctx.strokeStyle = `rgba(${90 + rnd() * 140 | 0},${90 + rnd() * 140 | 0},${90 + rnd() * 140 | 0},.5)`;
      ctx.lineWidth = 0.8 + rnd();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
  },
};

/**
 * Flatten a height field toward mid-grey for use as an albedo map.
 *
 * The height field needs full contrast to derive a good normal map, but using
 * that same contrast as colour makes every surface read as harsh stripes —
 * floorboards especially. Real grain modulates colour subtly and relief
 * strongly, so the two maps are generated at different contrasts.
 */
function flatten(height: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const [out, ctx] = canvas();
  ctx.fillStyle = '#b4b4b4';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = amount;
  ctx.drawImage(height, 0, 0);
  ctx.globalAlpha = 1;
  return out;
}

/** How much of the height field shows through as colour, per surface. */
const ALBEDO_CONTRAST: Record<SurfaceKind, number> = {
  wood: 0.3, 'wood-fine': 0.24, fabric: 0.26, boucle: 0.3, leather: 0.16,
  plaster: 0.12, floorboards: 0.28, stone: 0.18, metal: 0.22, rattan: 0.42,
  glass: 0.06, pile: 0.34,
};

function buildSurface(kind: SurfaceKind): Surface {
  const cached = surfaceCache.get(kind);
  if (cached) return cached;

  const [heightCanvas, ctx] = canvas();
  PAINTERS[kind](ctx);

  const map = new THREE.CanvasTexture(flatten(heightCanvas, ALBEDO_CONTRAST[kind]));
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const normalStrength = kind === 'glass' ? 0.4 : kind === 'pile' ? 3.2 : kind === 'boucle' ? 2.8 : 2;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(heightCanvas, normalStrength));
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;

  const surface: Surface = { map, normalMap };
  surfaceCache.set(kind, surface);
  return surface;
}

/** Which surface a catalog material key should be rendered with. */
export const SURFACE_FOR_MATERIAL: Record<string, SurfaceKind> = {
  walnut: 'wood',
  teak: 'wood',
  oak: 'wood-fine',
  rosewood: 'wood',
  bentply: 'wood-fine',
  greywash: 'wood-fine',
  fiberglass: 'leather',
  'wool-boucle': 'boucle',
  tweed: 'fabric',
  leather: 'leather',
  brass: 'metal',
  'blackened-steel': 'metal',
  chrome: 'metal',
  travertine: 'stone',
  'smoked-glass': 'glass',
  rattan: 'rattan',
};

export interface SurfaceMaterialOptions {
  color: string;
  kind: SurfaceKind;
  /** How many times the texture tiles across one metre of surface. */
  repeat?: number;
  roughness?: number;
  metalness?: number;
  doubleSide?: boolean;
  emissive?: string;
  /** 0 disables the texture entirely, for flat accent panels. */
  textureStrength?: number;
}

/**
 * A textured standard material, cached by its full configuration.
 *
 * The albedo texture is blended toward white by `textureStrength` so the
 * catalog's colour still dominates — the grain modulates the colour rather
 * than replacing it, which is what lets one wood texture serve walnut, teak
 * and oak without any of them looking wrong.
 */
export function surfaceMaterial(opts: SurfaceMaterialOptions): THREE.MeshStandardMaterial {
  const {
    color, kind, repeat = 1, roughness = 0.6, metalness = 0,
    doubleSide = false, emissive, textureStrength = 1,
  } = opts;
  const key = `${color}|${kind}|${repeat}|${roughness}|${metalness}|${doubleSide}|${emissive ?? ''}|${textureStrength}`;
  const hit = materialCache.get(key);
  if (hit) return hit;

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    emissive: emissive ? new THREE.Color(emissive) : new THREE.Color(0x000000),
    emissiveIntensity: emissive ? 1 : 0,
  });

  if (textureStrength > 0) {
    const surface = buildSurface(kind);
    // Clone so each material can tile at its own scale without fighting others.
    const map = surface.map.clone();
    map.needsUpdate = true;
    map.repeat.set(repeat, repeat);
    const normalMap = surface.normalMap.clone();
    normalMap.needsUpdate = true;
    normalMap.repeat.set(repeat, repeat);

    material.map = map;
    material.normalMap = normalMap;
    material.normalScale = new THREE.Vector2(textureStrength, textureStrength);
    // The albedo map averages around mid-grey, so the colour is lifted to
    // compensate and land back on the hex the catalog asked for.
    material.color.multiplyScalar(1.4);
  }

  materialCache.set(key, material);
  return material;
}

export function disposeTextures() {
  for (const surface of surfaceCache.values()) {
    surface.map.dispose();
    surface.normalMap.dispose();
  }
  for (const material of materialCache.values()) material.dispose();
  surfaceCache.clear();
  materialCache.clear();
}

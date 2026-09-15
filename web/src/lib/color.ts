/**
 * Sample an image in the browser before upload.
 *
 * Doing this client-side means every photo arrives with real wall and floor
 * colours attached even when no API key is configured, and it costs the server
 * nothing. The image is downsampled to a small canvas first, then colours are
 * bucketed in a coarse RGB grid so near-identical shades group together.
 */
export interface ImageSample {
  dominantColors: string[];
  brightness: number;
  width: number;
  height: number;
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

export async function sampleImage(file: File, maxSide = 96): Promise<ImageSample | null> {
  if (!file.type.startsWith('image/')) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC and some camera formats cannot be decoded by the browser. The file
    // still uploads fine; it just arrives without a colour sample.
    return null;
  }

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();

  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  let luma = 0;
  let counted = 0;

  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128) continue;
    counted++;
    luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    // 24 levels per channel: fine enough to tell greige from cream, coarse
    // enough that lighting noise does not split one wall into ten colours.
    const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++;
    buckets.set(key, bucket);
  }

  const dominantColors = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((c) => toHex(c.r / c.n, c.g / c.n, c.b / c.n));

  return {
    dominantColors,
    brightness: counted ? luma / counted : 0,
    width: size.width,
    height: size.height,
  };
}

/** Readable text colour for a given background. */
export function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#2B2B2B' : '#F7F4EF';
}

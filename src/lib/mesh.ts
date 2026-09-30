/**
 * BitChord web — the Apple Music "Now Playing" backdrop.
 *
 * Ported from MeshGradient.kt: four luminous colour blobs sampled from the
 * album art, drawn as soft radial gradients and blurred into a mesh. The blobs
 * drift when the track changes and then come to rest (the app stopped orbiting
 * forever for the battery; the web does the same), and colour changes
 * crossfade over ~1.4s instead of snapping.
 */

export interface MeshPalette {
  colors: [string, string, string, string];
}

const FALLBACK: MeshPalette = {
  colors: ['#3a1c71', '#d76d77', '#2b5876', '#ffaf7b'],
};

// ---- colour helpers ----------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToCss([h, s, l]: [number, number, number]): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255);
  return `rgb(${to(r)}, ${to(g)}, ${to(b)})`;
}

/** Boost saturation and clamp lightness so any artwork yields a rich mesh. */
function tuned(r: number, g: number, b: number): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);
  return [h, Math.min(1, s * 1.35), Math.min(0.58, Math.max(0.28, l))];
}

/** Drop near-duplicates so the four blobs don't collapse into one wash. */
function closeHsl(a: [number, number, number], b: [number, number, number]): boolean {
  const hueGap = Math.abs(a[0] - b[0]);
  const d = Math.min(hueGap, 360 - hueGap);
  return d < 15 && Math.abs(a[2] - b[2]) < 0.12;
}

/**
 * Samples the artwork into four mesh colours: a coarse histogram (like the
 * app's Palette swatches, sorted by population), de-duplicated by hue and
 * lightness, shortfalls fanned out from the art's own colours rather than
 * borrowed from the fallback.
 */
export async function extractMeshPalette(url: string): Promise<MeshPalette> {
  if (!url) return FALLBACK;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const loaded = new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
    });
    img.src = url;
    if (!(await loaded)) return FALLBACK;

    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return FALLBACK;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
    const sorted = [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .map((bucket) => {
        const hsl = tuned(
          Math.round(bucket.r / bucket.count),
          Math.round(bucket.g / bucket.count),
          Math.round(bucket.b / bucket.count),
        );
        return hsl;
      });

    const distinct: Array<[number, number, number]> = [];
    for (const hsl of sorted) {
      if (distinct.length >= 4) break;
      if (distinct.every((kept) => !closeHsl(kept, hsl))) distinct.push(hsl);
    }
    if (distinct.length === 0) return FALLBACK;

    // Fan hue and lightness out to fill the empty slots.
    const all = [...distinct];
    let step = 1;
    while (all.length < 4) {
      const base = distinct[(all.length) % distinct.length];
      all.push([
        (base[0] + 24 * step) % 360,
        base[1],
        Math.min(0.7, Math.max(0.2, base[2] + 0.12 * step)),
      ]);
      step += 1;
    }
    return { colors: all.slice(0, 4).map(hslToCss) as MeshPalette['colors'] };
  } catch {
    return FALLBACK;
  }
}

/** The blob anchors and irrational relative speeds from MeshGradient.kt. */
const ANCHORS: Array<[number, number]> = [
  [0.2, 0.25],
  [0.8, 0.2],
  [0.75, 0.8],
  [0.25, 0.75],
];
const SPEEDS = [1, -0.7, 0.85, -1.15];

/**
 * Where the blobs sit at [phase] radians. Returned as CSS background strings
 * for four absolutely-positioned divs — a blurred layer with four radial
 * gradients, crossfaded by the CSS transition on background changes.
 */
export function blobStyle(color: string, phase: number, index: number): React.CSSProperties {
  const [ax, ay] = ANCHORS[index % ANCHORS.length];
  const speed = SPEEDS[index % SPEEDS.length];
  const x = (ax + 0.16 * Math.cos(phase * speed + index * 1.7)) * 100;
  const y = (ay + 0.16 * Math.sin(phase * speed * 0.9 + index * 2.3)) * 100;
  return {
    left: `${x.toFixed(2)}%`,
    top: `${y.toFixed(2)}%`,
    background: `radial-gradient(circle, ${color} 0%, transparent 68%)`,
  };
}

/** How far the blobs travel on a track change: just under half a turn. */
export const DRIFT_RADIANS = Math.PI * 0.45;

export { FALLBACK as fallbackMeshPalette };

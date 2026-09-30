/**
 * BitChord web — artwork palette extraction.
 *
 * Ported from the app's rememberArtworkPalette: sample the artwork, pick a
 * dominant colour for the mesh gradient, and answer whether the palette is
 * light (so the player can flip status glyphs). A small canvas does the whole
 * job; no dependency.
 *
 * youtube thumbnails serve CORS headers, so canvas sampling works on them.
 */

export interface ArtworkPalette {
  r: number;
  g: number;
  b: number;
  isLight: boolean;
}

const FALLBACK: ArtworkPalette = { r: 28, g: 28, b: 30, isLight: false };

const cache = new Map<string, ArtworkPalette>();

export function paletteOf(url: string | null | undefined): ArtworkPalette | null {
  if (!url) return null;
  return cache.get(url) ?? null;
}

/** Kick off extraction; resolves with the palette or null on any failure. */
export function extractPalette(url: string): Promise<ArtworkPalette | null> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  if (cache.has(url)) return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        // Dominant colour by coarse 4-bit-per-channel histogram, the same
        // idea as the app's palette: the most common bucket wins, averaged
        // inside the bucket so the answer is a colour, not a bucket edge.
        const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
          bucket.count += 1;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          buckets.set(key, bucket);
        }
        let best: { count: number; r: number; g: number; b: number } | null = null;
        for (const bucket of buckets.values()) {
          if (!best || bucket.count > best.count) best = bucket;
        }
        if (!best || best.count === 0) {
          resolve(null);
          return;
        }
        const r = Math.round(best.r / best.count);
        const g = Math.round(best.g / best.count);
        const b = Math.round(best.b / best.count);
        // Relative luminance, WCAG form — the same threshold the app uses to
        // decide whether the player's glyphs go dark.
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const palette: ArtworkPalette = { r, g, b, isLight: luminance > 0.6 };
        cache.set(url, palette);
        resolve(palette);
      } catch {
        // Tainted canvas (no CORS) or decode failure.
        resolve(null);
      }
    };
    img.onerror = () => {
      cache.set(url, FALLBACK);
      resolve(null);
    };
    img.src = url;
  });
}

export { FALLBACK as fallbackPalette };

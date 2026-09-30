/**
 * BitChord web — the mesh backdrop.
 *
 * Four colour blobs sampled from the artwork, drawn as radial gradients on a
 * dimmed base, blurred into a mesh, drifted a shade under half a turn when
 * the track changes and then settled. Colour changes crossfade over 1.4s
 * (CSS transition on the background properties), the way MeshGradient.kt's
 * animateColorAsState does.
 */

import { useEffect, useRef, useState } from 'react';
import { blobStyle, DRIFT_RADIANS, extractMeshPalette } from '../lib/mesh';
import type { MeshPalette } from '../lib/mesh';

const DRIFT_MS = 8000;

export function MeshBackdrop({ imageUrl, trackKey }: { imageUrl: string | null; trackKey: string }) {
  const [palette, setPalette] = useState<MeshPalette | null>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let cancelled = false;
    extractMeshPalette(imageUrl ?? '').then((p) => {
      if (!cancelled) setPalette(p);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // Drift once per track change, then settle.
  useEffect(() => {
    const start = performance.now();
    const from = phase;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DRIFT_MS);
      // FastOutSlowIn, the app's settle curve.
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setPhase(from + DRIFT_RADIANS * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // phase deliberately excluded: each run starts from where the last ended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  const colors = palette?.colors;

  return (
    <div className="mesh-backdrop" aria-hidden="true">
      <div className="mesh-blobs" key={trackKey}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="mesh-blob"
            style={blobStyle(colors?.[i] ?? '#241a3a', phase, i)}
          />
        ))}
      </div>
      <div className="mesh-scrim" />
    </div>
  );
}

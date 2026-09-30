/**
 * BitChord web — resilient artwork.
 *
 * The Piped proxy thumbnails come and go, which is where every blank tile in
 * the old port came from. YouTube serves `i.ytimg.com/vi/:id` directly with
 * CORS and a ladder of sizes, so when the pooled thumbnail dies the art falls
 * back to the video's own stills and retries the ladder on error.
 */

import { useEffect, useState } from 'react';
import { artworkAt } from '../api/models';

/** Proxy URL first, then YouTube's own stills, biggest first. */
function candidatesFor(src: string | null | undefined, videoId?: string | null): string[] {
  const urls: string[] = [];
  if (src) urls.push(src);
  if (videoId) {
    urls.push(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
    urls.push(`https://i.ytimg.com/vi/${videoId}/sddefault.jpg`);
    urls.push(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  }
  return urls.slice(0, 4);
}

interface SmartArtProps {
  src: string | null | undefined;
  videoId?: string | null;
  /** Rendered square size in px. */
  size?: number;
  /** Radius override, px. */
  radius?: number;
  className?: string;
  /** Load eagerly (above the fold) instead of lazily. */
  eager?: boolean;
  /** Skip w<h>-h<n> rewriting (proxy hosts 404 on rewritten URLs). */
  keepOriginalSize?: boolean;
}

export function SmartArt({
  src,
  videoId,
  size = 52,
  radius = 8,
  className,
  eager = false,
  keepOriginalSize = false,
}: SmartArtProps) {
  const initial = keepOriginalSize ? src ?? null : artworkAt(src, size);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // A new artwork: forget the ladder position and the fade-in.
  useEffect(() => {
    setAttempt(0);
    setLoaded(false);
  }, [src, videoId]);

  const candidates = candidatesFor(src, videoId);
  const url = attempt === 0 ? initial ?? candidates[0] ?? null : candidates[attempt] ?? null;

  return (
    <span
      className={`smart-art${className ? ` ${className}` : ''}${loaded ? ' smart-art-loaded' : ''}`}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {url && (
        <img
          src={url}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setAttempt((n) => n + 1)}
        />
      )}
    </span>
  );
}

/**
 * BitChord web — LRCLIB lyrics.
 *
 * Mirrors the Android app's lyrics pipeline (synced source first, plain text
 * as the fallback). LRCLIB answers CORS-enabled GETs and needs no key, so it
 * is the sole provider here; the app's timed-transcript fallback rides
 * Innertube, which a web page cannot reach (see sources.ts).
 */

import type { Song } from '../api/models';
import { songDurationMs } from '../api/models';

export interface LyricLine {
  /** Milliseconds from track start. */
  at: number;
  text: string;
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
  provider: string;
}

// ---- LRC parsing -----------------------------------------------------------

/** `[mm:ss.xx]` / `[mm:ss.xxx]` timestamps, several per line allowed. */
const LRC_TIME = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(LRC_TIME)];
    if (stamps.length === 0) continue;
    const body = raw.replace(LRC_TIME, '').trim();
    if (!body) continue;
    for (const stamp of stamps) {
      const minutes = parseInt(stamp[1], 10);
      const seconds = parseInt(stamp[2], 10);
      const fraction = stamp[3] ? parseInt(stamp[3].padEnd(3, '0'), 10) : 0;
      const at = minutes * 60_000 + seconds * 1_000 + fraction;
      lines.push({ at, text: body });
    }
  }
  return lines.sort((x, y) => x.at - y.at);
}

// ---- LRCLIB ------------------------------------------------------------------

async function fromLrclib(song: Song, durationMs: number): Promise<Lyrics | null> {
  const params = new URLSearchParams({
    track_name: song.title,
    artist_name: song.artist,
  });
  if (song.albumName) params.set('album_name', song.albumName);
  if (durationMs > 0) params.set('duration', String(Math.round(durationMs / 1000)));
  try {
    const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { syncedLyrics?: unknown; plainLyrics?: unknown };
    const synced = typeof body.syncedLyrics === 'string' ? body.syncedLyrics : null;
    if (synced) {
      const lines = parseLrc(synced);
      if (lines.length > 0) return { synced: true, lines, provider: 'LRCLIB' };
    }
    const plain = typeof body.plainLyrics === 'string' ? body.plainLyrics : null;
    if (plain) {
      return {
        synced: false,
        lines: plain
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0)
          .map((text: string) => ({ at: 0, text })),
        provider: 'LRCLIB',
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Entry point ---------------------------------------------------------------

export async function fetchLyrics(song: Song, durationMs: number): Promise<Lyrics | null> {
  return fromLrclib(song, durationMs || songDurationMs(song));
}

/** Line index active at [positionMs], or -1 before the first line. */
export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].at <= positionMs) index = i;
    else break;
  }
  return index;
}

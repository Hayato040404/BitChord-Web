/**
 * BitChord web — data model.
 * Mirrors app/src/main/java/com/music/bitchord/data/model/Models.kt (web subset).
 */

export type BrowseType = 'ALBUM' | 'ARTIST' | 'PLAYLIST' | 'OTHER';

export interface Song {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  durationText?: string | null;
  artistId?: string | null;
  albumId?: string | null;
  albumName?: string | null;
  isVideo?: boolean;
  setVideoId?: string | null;
  /** Album-page playlist context, when the row came from a playlist. */
  playlistId?: string | null;
}

export interface ShelfItem {
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  /** videoId for a track card, browseId for a collection card. */
  videoId?: string | null;
  browseId?: string | null;
  type?: BrowseType;
}

export interface HomeShelf {
  title: string;
  items: ShelfItem[];
}

export interface BrowseItem {
  browseId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  type: BrowseType;
}

export type SearchResult =
  | { kind: 'topTrack'; song: Song }
  | { kind: 'track'; song: Song }
  | { kind: 'browse'; item: BrowseItem };

export interface SearchPage {
  rows: SearchResult[];
  continuation: string | null;
}

export interface DetailPage {
  browseId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  type: BrowseType;
  songs: Song[];
  /** Artist-page shelves (Albums, Singles, Fans might also like…). */
  shelves?: HomeShelf[];
  /** Playlist id for the save / radio buttons. */
  playlistId?: string | null;
  channelId?: string | null;
  shelf?: string | null;
}

export type UiState<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'error'; message: string };

export const ready = <T,>(data: T): UiState<T> => ({ state: 'ready', data });
export const loading = <T,>(): UiState<T> => ({ state: 'loading' });
export const errored = <T,>(message: string): UiState<T> => ({ state: 'error', message });

export interface MoodGenre {
  title: string;
  browseId: string;
  params: string | null;
}

// ---- Artwork sizing (Models.kt's ladder) -----------------------------------

const SIZE_HINT = /w\d+-h\d+/;

export const ROW_ART_PX = 160;
export const CARD_ART_PX = 480;
export const HEADER_ART_PX = 720;
export const PLAYER_ART_PX = 1200;

/** YouTube serves every size from one URL via a `w<n>-h<n>` hint. */
export function artworkAt(url: string | null | undefined, px: number): string | null {
  if (!url) return null;
  return url.replace(SIZE_HINT, `w${px}-h${px}`);
}

/** `M:SS` / `H:MM:SS` display string to milliseconds; 0 when unparseable. */
export function durationMillis(text: string | null | undefined): number {
  if (!text) return 0;
  const parts = text.trim().split(':');
  const numbers = parts.map((p) => parseInt(p.trim(), 10));
  if (numbers.some((n) => isNaN(n))) return 0;
  const seconds =
    numbers.length === 2
      ? numbers[0] * 60 + numbers[1]
      : numbers.length === 3
        ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
        : 0;
  return Math.max(0, seconds * 1000);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function songDurationMs(song: Song): number {
  return durationMillis(song.durationText);
}

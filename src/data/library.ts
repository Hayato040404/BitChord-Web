/**
 * BitChord web — local library.
 *
 * The Android app keeps likes, playlists, history and recents on YouTube's
 * account. A static web build has no Google session to borrow, so this port
 * keeps a guest library in localStorage with the same user-facing surface:
 * Liked songs, user playlists, listening history, recents, and the settings
 * the UI reads. Settings mirror AppSettings.kt's keys where the UI uses them.
 */

import type { Song } from '../api/models';
import { loadSources, saveSources } from '../api/sources';
import type { StreamSource } from '../api/sources';

// ---- generic localStorage helpers -----------------------------------------

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    /* fall through */
  }
  return fallback;
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

// ---- keys -------------------------------------------------------------------

const K_LIKED = 'bitchord.liked';
const K_PLAYLISTS = 'bitchord.playlists';
const K_HISTORY = 'bitchord.history';
const K_RECENTS = 'bitchord.recents';
const K_SETTINGS = 'bitchord.settings';

// ---- settings ----------------------------------------------------------------

export interface Settings {
  themeMode: 'system' | 'light' | 'dark';
  crossfadeSeconds: number;
  autoplay: boolean;
  syncedLyrics: boolean;
  sleepTimerMinutes: number | null;
  playbackSpeed: number;
  sources: StreamSource[];
  dataSaver: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'dark',
  crossfadeSeconds: 0,
  autoplay: true,
  syncedLyrics: true,
  sleepTimerMinutes: null,
  playbackSpeed: 1,
  sources: [],
  dataSaver: false,
};

export function loadSettings(): Settings {
  const stored = load<Partial<Settings>>(K_SETTINGS, {});
  const sources = stored.sources !== undefined ? stored.sources : loadSources();
  return { ...DEFAULT_SETTINGS, ...stored, sources };
}

export function saveSettings(settings: Settings): void {
  save(K_SETTINGS, settings);
  saveSources(settings.sources);
}

// ---- library records -----------------------------------------------------------

export interface UserPlaylist {
  id: string;
  title: string;
  createdAt: number;
  songs: Song[];
}

/** A "liked" record keeps the song at the moment it was liked. */
export type LibrarySnapshot = {
  liked: Song[];
  playlists: UserPlaylist[];
  history: { song: Song; at: number }[];
  recents: Song[];
};

export function loadLibrary(): LibrarySnapshot {
  return {
    liked: load<Song[]>(K_LIKED, []),
    playlists: load<UserPlaylist[]>(K_PLAYLISTS, []),
    history: load<{ song: Song; at: number }[]>(K_HISTORY, []),
    recents: load<Song[]>(K_RECENTS, []),
  };
}

export function saveLiked(songs: Song[]): void {
  save(K_LIKED, songs.slice(0, 2000));
}

export function savePlaylists(playlists: UserPlaylist[]): void {
  save(K_PLAYLISTS, playlists.slice(0, 200));
}

export function saveHistory(history: { song: Song; at: number }[]): void {
  save(K_HISTORY, history.slice(0, 1000));
}

export function saveRecents(songs: Song[]): void {
  save(K_RECENTS, songs.slice(0, 60));
}

export function newPlaylistId(): string {
  return `local:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

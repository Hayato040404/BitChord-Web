/**
 * BitChord web — app state.
 *
 * Navigation follows MainActivity's model: four tabs, one detail stack on
 * top, sheets for the player and queue. Library records and settings live in
 * localStorage (see data/library.ts) and are mirrored into React state here.
 */

import { useSyncExternalStore } from 'react';
import { player } from '../player/player';
import type { PlayerState } from '../player/player';
import {
  loadLibrary,
  loadSettings,
  saveLiked,
  saveHistory,
  savePlaylists,
  saveRecents,
  saveSettings,
} from '../data/library';
import type { Settings, UserPlaylist } from '../data/library';
import type { BrowseType, DetailPage, Song } from '../api/models';

export type TabId = 'home' | 'explore' | 'library' | 'search';

export interface DetailRef {
  browseId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  type: BrowseType;
}

interface AppState {
  tab: TabId;
  detailStack: DetailRef[];
  showNowPlaying: boolean;
  showQueue: boolean;
  showSources: boolean;
  settings: Settings;
  liked: Song[];
  playlists: UserPlaylist[];
  history: { song: Song; at: number }[];
  recents: Song[];
  toast: { id: number; message: string } | null;
  detailPages: Record<string, DetailPage>;
}

type Listener = () => void;

let state: AppState = {
  tab: 'home',
  detailStack: [],
  showNowPlaying: false,
  showQueue: false,
  showSources: false,
  settings: loadSettings(),
  ...loadLibrary(),
  toast: null,
  detailPages: {},
};

const listeners = new Set<Listener>();

function emit(): void {
  state = { ...state };
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState(): AppState {
  return state;
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
}

// ---- actions -----------------------------------------------------------------

export const actions = {
  setTab(tab: TabId): void {
    state.tab = tab;
    // Tab taps clear the detail stack, exactly as MainActivity's onTabSelected.
    state.detailStack = [];
    emit();
  },

  openDetail(ref: DetailRef): void {
    state.detailStack = [...state.detailStack, ref];
    state.showNowPlaying = false;
    emit();
    void actions.loadDetail(ref.browseId);
  },

  popDetail(): void {
    state.detailStack = state.detailStack.slice(0, -1);
    emit();
  },

  async loadDetail(browseId: string): Promise<void> {
    if (state.detailPages[browseId]) return;
    const { fetchDetail } = await import('../api/repository');
    try {
      const page = await fetchDetail(browseId);
      state.detailPages = { ...state.detailPages, [browseId]: page };
      emit();
    } catch (e) {
      state.toast = {
        id: Date.now(),
        message: e instanceof Error ? e.message : 'Could not load this page',
      };
      emit();
    }
  },

  setShowNowPlaying(show: boolean): void {
    state.showNowPlaying = show;
    emit();
  },

  setShowQueue(show: boolean): void {
    state.showQueue = show;
    emit();
  },

  setShowSources(show: boolean): void {
    state.showSources = show;
    emit();
  },

  showToast(message: string): void {
    state.toast = { id: Date.now(), message };
    emit();
    window.setTimeout(() => {
      if (state.toast?.message === message) {
        state.toast = null;
        emit();
      }
    }, 3000);
  },

  // ---- playback entry points ---------------------------------------------------

  playSongs(songs: Song[], index: number, sourceName: string): void {
    void player.playQueue(songs, index);
    state.showNowPlaying = true;
    emit();
    actions.recordPlay(songs[index], sourceName);
  },

  addToQueue(song: Song): void {
    void player.addToQueue(song);
    actions.showToast('Added to queue');
  },

  playNext(song: Song): void {
    player.playNext(song);
    actions.showToast('Playing next');
  },

  toggleLiked(song: Song): void {
    const exists = state.liked.some((s) => s.videoId === song.videoId);
    const liked = exists
      ? state.liked.filter((s) => s.videoId !== song.videoId)
      : [song, ...state.liked];
    state.liked = liked;
    saveLiked(liked);
    emit();
    actions.showToast(exists ? 'Removed from Liked songs' : 'Added to Liked songs');
  },

  isLiked(videoId: string): boolean {
    return state.liked.some((s) => s.videoId === videoId);
  },

  createPlaylist(title: string, songs: Song[] = []): void {
    const playlist: UserPlaylist = {
      id: `local:${Date.now().toString(36)}`,
      title,
      createdAt: Date.now(),
      songs,
    };
    state.playlists = [playlist, ...state.playlists];
    savePlaylists(state.playlists);
    emit();
  },

  addToPlaylist(playlistId: string, song: Song): void {
    state.playlists = state.playlists.map((pl) =>
      pl.id === playlistId ? { ...pl, songs: [...pl.songs, song] } : pl,
    );
    savePlaylists(state.playlists);
    emit();
    actions.showToast(`Added to ${state.playlists.find((p) => p.id === playlistId)?.title ?? 'playlist'}`);
  },

  removeFromPlaylist(playlistId: string, videoId: string): void {
    state.playlists = state.playlists.map((pl) =>
      pl.id === playlistId ? { ...pl, songs: pl.songs.filter((s) => s.videoId !== videoId) } : pl,
    );
    savePlaylists(state.playlists);
    emit();
  },

  deletePlaylist(playlistId: string): void {
    state.playlists = state.playlists.filter((pl) => pl.id !== playlistId);
    savePlaylists(state.playlists);
    emit();
  },

  recordPlay(song: Song | null, sourceName: string): void {
    if (!song) return;
    const entry = { song: { ...song, playbackSource: sourceName }, at: Date.now() };
    state.history = [entry, ...state.history.filter((h) => h.song.videoId !== song.videoId)].slice(0, 500);
    saveHistory(state.history);
    state.recents = [song, ...state.recents.filter((s) => s.videoId !== song.videoId)].slice(0, 30);
    saveRecents(state.recents);
    emit();
  },

  updateSettings(patch: Partial<Settings>): void {
    state.settings = { ...state.settings, ...patch };
    saveSettings(state.settings);
    if (patch.playbackSpeed !== undefined) player.setSpeed(patch.playbackSpeed);
    emit();
  },
};

// Record plays when the current song changes.
let lastPlayedVideoId: string | null = null;
export function notePlayForCurrentSong(): void {
  const song = player.currentSong();
  if (song && song.videoId !== lastPlayedVideoId) {
    lastPlayedVideoId = song.videoId;
    actions.recordPlay(song, 'Now playing');
  }
}

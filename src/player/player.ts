/**
 * BitChord web — audio player.
 *
 * The Android app runs a foreground Media3 service with crossfade and automix.
 * The web port keeps the same user-facing controls — queue with shuffle and
 * repeat, seek, playback speed, sleep timer, MediaSession integration and a
 * wake lock — on a single page-lifetime service class. Playback continues
 * while the tab is hidden; a MediaSession notification appears on mobile.
 *
 * The <audio> element is deliberately left without `crossOrigin`: googlevideo
 * serves no Access-Control-Allow-Origin header, and a plain (no-cors) media
 * element plays cross-origin URLs perfectly well. Setting crossOrigin would
 * enable a Web Audio graph (crossfade, visualisers) but mute playback
 * entirely — the wrong trade for a music app, so the graph is left out and
 * crossfade is handled by overlapping elements if it is wanted later.
 */

import type { Song } from '../api/models';
import { songDurationMs } from '../api/models';
import { resolveStream } from '../api/sources';
import type { StreamHandle } from '../api/sources';

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  queue: Song[];
  index: number;
  playing: boolean;
  loading: boolean;
  positionMs: number;
  durationMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
  speed: number;
  /** Why nothing is audible, when a track failed to open. */
  error: string | null;
  stream: StreamHandle | null;
}

type Listener = () => void;

class BitChordPlayer {
  private audioA: HTMLAudioElement;
  private audioB: HTMLAudioElement;
  /** The element currently audible. */
  private active: HTMLAudioElement;
  private listeners = new Set<Listener>();
  private ticking: number | null = null;
  private sleepUntil: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private token = 0;

  state: PlayerState = {
    queue: [],
    index: -1,
    playing: false,
    loading: false,
    positionMs: 0,
    durationMs: 0,
    shuffle: false,
    repeat: 'off',
    speed: 1,
    error: null,
    stream: null,
  };

  constructor() {
    this.audioA = new Audio();
    this.audioB = new Audio();
    for (const el of [this.audioA, this.audioB]) {
      el.preload = 'auto';
      // No crossOrigin: see the header comment.
    }
    this.active = this.audioA;
    this.audioA.addEventListener('ended', () => this.onEnded());
    this.audioB.addEventListener('ended', () => this.onEnded());
    this.audioA.addEventListener('loadedmetadata', () => this.syncDuration());
    this.audioB.addEventListener('loadedmetadata', () => this.syncDuration());
    this.audioA.addEventListener('waiting', () => this.setLoading(true));
    this.audioB.addEventListener('waiting', () => this.setLoading(true));
    this.audioA.addEventListener('playing', () => this.setLoading(false));
    this.audioB.addEventListener('playing', () => this.setLoading(false));
    this.bindMediaSession();
  }

  // ---- store plumbing --------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PlayerState => this.state;

  private emit(): void {
    this.state = { ...this.state };
    for (const listener of this.listeners) listener();
  }

  private setLoading(loading: boolean): void {
    if (this.state.loading === loading) return;
    this.state.loading = loading;
    this.emit();
  }

  // ---- transport --------------------------------------------------------------

  currentSong(): Song | null {
    return this.state.queue[this.state.index] ?? null;
  }

  /** Live media clock in ms, for animations smoother than the 250 ms tick. */
  currentAudioTimeMs(): number | null {
    const audio = this.active;
    if (!audio.src || audio.paused) return null;
    const ms = audio.currentTime * 1000;
    return Number.isFinite(ms) ? ms : null;
  }

  async playQueue(songs: Song[], startIndex = 0): Promise<void> {
    this.state.queue = [...songs];
    this.state.index = startIndex;
    this.state.error = null;
    this.emit();
    await this.openCurrent();
  }

  async playAt(index: number): Promise<void> {
    if (index < 0 || index >= this.state.queue.length) return;
    this.state.index = index;
    this.state.error = null;
    this.emit();
    await this.openCurrent();
  }

  togglePlayPause(): void {
    const audio = this.active;
    if (audio.paused) {
      if (audio.src) void audio.play();
      else if (this.currentSong()) void this.openCurrent();
    } else {
      audio.pause();
    }
  }

  pause(): void {
    this.active.pause();
  }

  seek(positionMs: number): void {
    const audio = this.active;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.max(0, Math.min(positionMs / 1000, audio.duration - 0.25));
      this.state.positionMs = positionMs;
      this.emit();
    }
  }

  next(): void {
    const { queue, index, repeat, shuffle } = this.state;
    if (queue.length === 0) return;
    if (shuffle && queue.length > 1) {
      let candidate = index;
      while (candidate === index) {
        candidate = Math.floor(Math.random() * queue.length);
      }
      void this.playAt(candidate);
      return;
    }
    if (index + 1 < queue.length) {
      void this.playAt(index + 1);
    } else if (repeat === 'all') {
      void this.playAt(0);
    } else {
      this.state.playing = false;
      this.emit();
    }
  }

  previous(): void {
    // Restart the current track before jumping back — the universal convention.
    if (this.state.positionMs > 3000) {
      this.seek(0);
      return;
    }
    if (this.state.index > 0) void this.playAt(this.state.index - 1);
    else this.seek(0);
  }

  setQueue(songs: Song[]): void {
    this.state.queue = [...songs];
    this.emit();
  }

  /** "Play next": insert after the current entry. */
  playNext(song: Song): void {
    const queue = [...this.state.queue];
    queue.splice(this.state.index + 1, 0, song);
    this.state.queue = queue;
    this.emit();
  }

  /** "Add to queue": append, or start playing when idle. */
  async addToQueue(song: Song): Promise<void> {
    if (this.state.queue.length === 0) {
      await this.playQueue([song], 0);
      return;
    }
    this.state.queue = [...this.state.queue, song];
    this.emit();
  }

  removeFromQueue(index: number): void {
    const queue = [...this.state.queue];
    if (index < 0 || index >= queue.length) return;
    queue.splice(index, 1);
    this.state.queue = queue;
    if (index < this.state.index) {
      this.state.index -= 1;
    }
    this.emit();
  }

  toggleShuffle(): void {
    this.state.shuffle = !this.state.shuffle;
    this.emit();
  }

  cycleRepeat(): void {
    this.state.repeat =
      this.state.repeat === 'off' ? 'all' : this.state.repeat === 'all' ? 'one' : 'off';
    this.emit();
  }

  setSpeed(speed: number): void {
    this.state.speed = speed;
    this.audioA.playbackRate = speed;
    this.audioB.playbackRate = speed;
    this.emit();
  }

  // ---- sleep timer -------------------------------------------------------------

  startSleepTimer(minutes: number): void {
    this.sleepUntil = Date.now() + minutes * 60_000;
  }

  cancelSleepTimer(): void {
    this.sleepUntil = null;
  }

  sleepRemainingMs(): number | null {
    return this.sleepUntil ? Math.max(0, this.sleepUntil - Date.now()) : null;
  }

  // ---- internals -----------------------------------------------------------------

  private async openCurrent(): Promise<void> {
    const song = this.currentSong();
    if (!song) return;
    const myToken = ++this.token;
    this.state.loading = true;
    this.state.error = null;
    this.state.durationMs = songDurationMs(song);
    this.emit();

    let handle: StreamHandle;
    try {
      handle = await resolveStream(song.videoId);
    } catch (e) {
      if (myToken !== this.token) return;
      this.state.loading = false;
      this.state.playing = false;
      this.state.error =
        e instanceof Error ? e.message : 'Could not open this track — every source failed.';
      this.emit();
      return;
    }
    if (myToken !== this.token) return;

    const audio = this.active;
    audio.src = handle.url;
    audio.playbackRate = this.state.speed;
    this.state.stream = handle;
    this.updateMediaSession(song);
    try {
      await audio.play();
      if (myToken !== this.token) return;
      this.state.playing = true;
      this.state.loading = false;
      this.emit();
      this.startTicking();
      void this.requestWakeLock();
    } catch {
      if (myToken !== this.token) return;
      this.state.playing = false;
      this.state.loading = false;
      // Autoplay policy: needs a user gesture. The tap that started playback
      // is usually enough; surface the state rather than an error.
      this.emit();
    }
  }

  private onEnded(): void {
    const { repeat } = this.state;
    if (repeat === 'one') {
      this.seek(0);
      void this.active.play();
      return;
    }
    this.next();
  }

  private syncDuration(): void {
    const audio = this.active;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      this.state.durationMs = audio.duration * 1000;
      this.emit();
    }
  }

  private startTicking(): void {
    if (this.ticking !== null) return;
    this.ticking = window.setInterval(() => {
      const audio = this.active;
      if (!audio.paused) {
        this.state.positionMs = audio.currentTime * 1000;
        // Sleep timer fires only while playing, the way the app treats it.
        if (this.sleepUntil && Date.now() >= this.sleepUntil) {
          this.pause();
          this.sleepUntil = null;
        }
      }
      this.emit();
    }, 250);
  }

  // ---- MediaSession -----------------------------------------------------------------

  private bindMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => this.togglePlayPause());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') this.seek(details.seekTime * 1000);
    });
  }

  private updateMediaSession(song: Song): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.albumName ?? 'BitChord',
      artwork: song.thumbnailUrl
        ? [{ src: song.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
  }

  private async requestWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator && this.wakeLock === null) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      }
    } catch {
      /* denied: nothing to do */
    }
  }
}

export const player = new BitChordPlayer();
export type { BitChordPlayer };

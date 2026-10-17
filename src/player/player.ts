/**
 * BitChord web — audio player.
 *
 * The Android app runs a foreground Media3 service with crossfade and automix.
 * The web port keeps the same user-facing controls — queue with shuffle and
 * repeat, seek, playback speed, sleep timer, MediaSession integration and a
 * wake lock — on a single page-lifetime service class. Playback continues
 * while the tab is hidden; a MediaSession notification appears on mobile.
 *
 * The <audio> elements are deliberately left without `crossOrigin`: googlevideo
 * serves no Access-Control-Allow-Origin header, and a plain (no-cors) media
 * element plays cross-origin URLs perfectly well. Setting crossOrigin would
 * enable a Web Audio graph (visualisers) but mute playback entirely — the
 * wrong trade for a music app. Crossfade is instead done by overlapping the
 * two pool elements, which is why there are two of them.
 */

import type { Song } from '../api/models';
import { songDurationMs } from '../api/models';
import { resolveStream } from '../api/sources';
import type { StreamHandle } from '../api/sources';
import { fetchRadio } from '../api/repository';

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
  /** Output volume, 0..1. */
  volume: number;
  /** Why nothing is audible, when a track failed to open. */
  error: string | null;
  stream: StreamHandle | null;
}

type Listener = () => void;

const K_VOLUME = 'bitchord.volume';

/** The volume survives reloads; anything unreadable falls back to full. */
function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(K_VOLUME);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) return Math.max(0, Math.min(1, value));
    }
  } catch {
    /* private mode */
  }
  return 1;
}

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
  /** A crossfade to the next track is resolving or ramping. */
  private fading = false;
  private fadeTimer: number | null = null;

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
    volume: 1,
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
    const storedVolume = readStoredVolume();
    this.state.volume = storedVolume;
    this.audioA.volume = storedVolume;
    this.audioB.volume = storedVolume;
    this.audioA.addEventListener('ended', () => this.onEnded());
    this.audioB.addEventListener('ended', () => this.onEnded());
    // Only the audible element drives the app state: during a crossfade the
    // incoming element is buffering/preparing behind a still-playing track.
    this.audioA.addEventListener('loadedmetadata', () => {
      if (this.active === this.audioA) this.syncDuration();
    });
    this.audioB.addEventListener('loadedmetadata', () => {
      if (this.active === this.audioB) this.syncDuration();
    });
    this.audioA.addEventListener('waiting', () => {
      if (this.active === this.audioA) this.setLoading(true);
    });
    this.audioB.addEventListener('waiting', () => {
      if (this.active === this.audioB) this.setLoading(true);
    });
    this.audioA.addEventListener('playing', () => {
      if (this.active === this.audioA) {
        this.setLoading(false);
        this.setPlaying(true);
      }
      void this.requestWakeLock();
    });
    this.audioB.addEventListener('playing', () => {
      if (this.active === this.audioB) {
        this.setLoading(false);
        this.setPlaying(true);
      }
      void this.requestWakeLock();
    });
    // The wake lock exists for audible playback only: dropped once nothing
    // is playing (the fade-out element pauses after the fade-in element
    // fires 'playing', so a plain per-element drop would release too early).
    this.audioA.addEventListener('pause', () => this.onElementPause(this.audioA));
    this.audioB.addEventListener('pause', () => this.onElementPause(this.audioB));
    this.bindMediaSession();
  }

  private onElementPause(el: HTMLAudioElement): void {
    // The outgoing element of a fade pauses under the incoming one — the
    // transport must not flip to "paused" while the new track ramps up.
    if (this.active === el && !this.fading) this.setPlaying(false);
    if (this.audioA.paused && this.audioB.paused) this.releaseWakeLock();
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

  /**
   * Playback state rides the element's own events (play/pause), so a manual
   * pause, a slept timer and a fade all keep the transport honest.
   */
  private setPlaying(playing: boolean): void {
    if (this.state.playing === playing) return;
    this.state.playing = playing;
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
    this.cancelCrossfade();
    this.state.queue = [...songs];
    this.state.index = startIndex;
    this.state.error = null;
    this.emit();
    await this.openCurrent();
  }

  async playAt(index: number): Promise<void> {
    if (index < 0 || index >= this.state.queue.length) return;
    this.cancelCrossfade();
    this.state.index = index;
    this.state.error = null;
    this.emit();
    await this.openCurrent();
  }

  togglePlayPause(): void {
    const audio = this.active;
    if (audio.paused) {
      // A failed open leaves the previous track's URL on the element —
      // replaying that would sound like the queue lied. Reopen instead.
      if (this.state.error) {
        void this.openCurrent();
      } else if (audio.src) {
        void audio.play();
      } else if (this.currentSong()) {
        void this.openCurrent();
      }
    } else {
      audio.pause();
    }
  }

  pause(): void {
    this.cancelCrossfade();
    this.active.pause();
  }

  seek(positionMs: number): void {
    this.cancelCrossfade();
    const audio = this.active;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      const clampedMs = Math.max(0, Math.min(positionMs, audio.duration * 1000 - 250));
      audio.currentTime = clampedMs / 1000;
      this.state.positionMs = clampedMs;
      this.updateMediaSessionPosition();
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
      // Tapping next on the last song halts playback instead of leaving the
      // audio audible behind a "paused" transport.
      this.pause();
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
    // The insert changes what "next" means; a fade already aimed at the old
    // successor would swap onto the wrong track.
    this.cancelCrossfade();
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
    this.cancelCrossfade();
    const wasCurrent = index === this.state.index;
    queue.splice(index, 1);
    this.state.queue = queue;
    if (index < this.state.index) {
      this.state.index -= 1;
    } else if (wasCurrent) {
      // The playing row went away: the song now at this slot takes over, and
      // an emptied queue stops the player instead of leaving a ghost track.
      if (queue.length === 0) {
        this.stop();
      } else {
        void this.playAt(Math.min(this.state.index, queue.length - 1));
      }
    }
    this.emit();
  }

  /** Halt playback and forget the queue (nothing is left to play). */
  private stop(): void {
    this.cancelCrossfade();
    this.active.pause();
    this.active.removeAttribute('src');
    this.active.load();
    this.state.index = -1;
    this.state.playing = false;
    this.state.loading = false;
    this.state.positionMs = 0;
    this.state.durationMs = 0;
    this.state.stream = null;
    this.token++;
    this.releaseWakeLock();
    this.emit();
  }

  toggleShuffle(): void {
    // Both change which track "next" means; an in-flight fade must re-aim.
    this.cancelCrossfade();
    this.state.shuffle = !this.state.shuffle;
    this.emit();
  }

  cycleRepeat(): void {
    this.cancelCrossfade();
    this.state.repeat =
      this.state.repeat === 'off' ? 'all' : this.state.repeat === 'all' ? 'one' : 'off';
    this.emit();
  }

  setSpeed(speed: number): void {
    this.cancelCrossfade();
    this.state.speed = speed;
    this.audioA.playbackRate = speed;
    this.audioB.playbackRate = speed;
    this.emit();
  }

  setVolume(volume: number): void {
    // A fade is a volume ramp of its own; cancelling hands the slider back
    // full control of the audible element.
    this.cancelCrossfade();
    const clamped = Math.max(0, Math.min(1, volume));
    this.state.volume = clamped;
    this.audioA.volume = clamped;
    this.audioB.volume = clamped;
    try {
      localStorage.setItem(K_VOLUME, String(clamped));
    } catch {
      /* private mode */
    }
    this.emit();
  }

  /** Drop everything after the playing track — "clear queue". */
  clearUpcoming(): void {
    const { index, queue } = this.state;
    if (index < 0 || index + 1 >= queue.length) return;
    this.cancelCrossfade();
    this.state.queue = queue.slice(0, index + 1);
    this.emit();
  }

  /** Re-open the current track after a failed resolution. */
  retryCurrent(): void {
    void this.openCurrent();
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

  // ---- crossfade -----------------------------------------------------------------

  /** Start fading into the next track once the current one is that close. */
  private maybeStartCrossfade(): void {
    if (this.fading) return;
    const seconds = this.crossfadeSettingsSeconds();
    if (seconds <= 0) return;
    const audio = this.active;
    if (audio.paused || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const remaining = audio.duration - audio.currentTime;
    if (remaining > seconds) return;
    // Too late to resolve a stream before the track runs out; the normal
    // 'ended' path takes it from here.
    if (remaining < 0.25) return;
    const nextIndex = this.nextIndexForCrossfade();
    if (nextIndex < 0) return;
    const current = this.currentSong();
    if (this.state.queue[nextIndex]?.videoId === current?.videoId) return;
    void this.startCrossfade(nextIndex);
  }

  /**
   * Which track a natural advance would go to, mirroring next() but without
   * the side effects. -1 when there is nothing to fade into (end of queue
   * without repeat, repeat-one, a single-track queue, or AutoPlay territory,
   * where the radio resolves only after 'ended').
   */
  private nextIndexForCrossfade(): number {
    const { queue, index, shuffle, repeat } = this.state;
    if (repeat === 'one' || queue.length < 2) return -1;
    if (shuffle) {
      let candidate = index;
      while (candidate === index) candidate = Math.floor(Math.random() * queue.length);
      return candidate;
    }
    if (index + 1 < queue.length) return index + 1;
    return repeat === 'all' ? 0 : -1;
  }

  private async startCrossfade(nextIndex: number): Promise<void> {
    const from = this.active;
    const to = from === this.audioA ? this.audioB : this.audioA;
    const song = this.state.queue[nextIndex];
    if (!song) return;
    const myToken = ++this.token;
    this.fading = true;

    let handle: StreamHandle;
    try {
      handle = await resolveStream(song.videoId);
    } catch {
      // No fade partner: the track plays out and 'ended' advances normally.
      if (myToken === this.token) this.fading = false;
      return;
    }
    if (myToken !== this.token || !this.fading) return;

    to.pause();
    to.volume = 0;
    to.playbackRate = this.state.speed;
    to.src = handle.url;
    try {
      await to.play();
    } catch {
      to.removeAttribute('src');
      to.load();
      if (myToken === this.token) this.fading = false;
      return;
    }
    if (myToken !== this.token || !this.fading) {
      to.pause();
      to.removeAttribute('src');
      to.load();
      return;
    }

    // Ramp across whatever is left of the outgoing track, capped at the
    // configured seconds and floored so a late start still fades briefly.
    const duration = Number.isFinite(from.duration) ? from.duration : 0;
    const remainingMs = Math.max(0, duration * 1000 - from.currentTime * 1000);
    const fadeMs = Math.max(250, Math.min(this.crossfadeSettingsSeconds() * 1000, remainingMs - 100));
    const target = this.state.volume;
    const startedAt = performance.now();
    const step = () => {
      if (myToken !== this.token || !this.fading) return;
      const t = Math.min(1, (performance.now() - startedAt) / fadeMs);
      from.volume = target * (1 - t);
      to.volume = target * t;
      if (t >= 1) this.completeCrossfade(from, to, handle, nextIndex, song);
    };
    this.fadeTimer = window.setInterval(step, 50);
    step();
  }

  /** The ramp finished: the incoming element becomes the player's audio. */
  private completeCrossfade(
    from: HTMLAudioElement,
    to: HTMLAudioElement,
    handle: StreamHandle,
    nextIndex: number,
    song: Song,
  ): void {
    this.clearFadeTimer();
    this.fading = false;

    from.pause();
    from.removeAttribute('src');
    from.load();
    from.volume = this.state.volume;

    this.active = to;
    this.state.index = nextIndex;
    this.state.stream = handle;
    this.state.error = null;
    this.state.playing = true;
    this.state.loading = false;
    this.state.positionMs = to.currentTime * 1000;
    const duration = to.duration;
    this.state.durationMs =
      Number.isFinite(duration) && duration > 0 ? duration * 1000 : songDurationMs(song);
    this.updateMediaSession(song);
    this.updateMediaSessionPosition();
    this.emit();
  }

  /**
   * Abort a fade in progress and put the player back on the audible track.
   * Any user action that re-aims playback goes through here first, then acts
   * on the restored `active` element as usual.
   */
  private cancelCrossfade(): void {
    if (!this.fading) return;
    this.fading = false;
    this.clearFadeTimer();
    // Invalidate the in-flight stream resolution, if any.
    this.token++;
    const from = this.active;
    const to = from === this.audioA ? this.audioB : this.audioA;
    to.pause();
    to.removeAttribute('src');
    to.load();
    to.volume = 0;
    from.volume = this.state.volume;
  }

  private clearFadeTimer(): void {
    if (this.fadeTimer !== null) {
      window.clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  /** The Crossfade setting lives in localStorage settings; read it straight. */
  private crossfadeSettingsSeconds(): number {
    try {
      const raw = localStorage.getItem('bitchord.settings');
      if (raw) {
        const value = (JSON.parse(raw) as { crossfadeSeconds?: number }).crossfadeSeconds;
        if (typeof value === 'number' && Number.isFinite(value)) {
          return Math.max(0, Math.min(15, value));
        }
      }
    } catch {
      /* ignore */
    }
    return 0;
  }

  // ---- internals -----------------------------------------------------------------

  private async openCurrent(): Promise<void> {
    const song = this.currentSong();
    if (!song) return;
    const myToken = ++this.token;
    this.state.loading = true;
    this.state.error = null;
    this.state.stream = null;
    this.state.positionMs = 0;
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
    // A fade that ran late leaves the outgoing element to finish under the
    // incoming one; the fade step, not this handler, owns the advance.
    if (this.fading) return;
    if (this.state.repeat === 'one') {
      this.seek(0);
      void this.active.play();
      return;
    }
    void this.onQueueExhaustedOrNext();
  }

  /**
   * The song ended with nothing lined up. With AutoPlay on (the app's
   * automix), resolve the seed's radio behind it and keep going; otherwise
   * hand the transport over to `next`, which stops cleanly at the end.
   */
  private async onQueueExhaustedOrNext(): Promise<void> {
    const { queue, index } = this.state;
    const atEnd = index + 1 >= queue.length;
    if (
      atEnd &&
      this.state.repeat !== 'all' &&
      !this.extendingRadio &&
      this.autoplayEnabled() &&
      queue[index] != null
    ) {
      const extended = await this.extendWithRadio(index);
      if (extended) {
        void this.playAt(index + 1);
        return;
      }
      // The user moved on while the radio resolved; their action already
      // decided what plays.
      if (this.state.index !== index) return;
    }
    this.next();
  }

  private extendingRadio = false;

  private async extendWithRadio(seedIndex: number): Promise<boolean> {
    this.extendingRadio = true;
    const seed = this.state.queue[seedIndex];
    const myToken = this.token;
    try {
      this.state.loading = true;
      this.emit();
      const radio = await fetchRadio(seed.videoId);
      if (this.state.index !== seedIndex) return false;
      const known = new Set(this.state.queue.map((s) => s.videoId));
      const fresh = radio.filter((s) => !known.has(s.videoId));
      if (fresh.length === 0) return false;
      this.state.queue = [...this.state.queue, ...fresh];
      this.emit();
      return true;
    } catch {
      return false;
    } finally {
      this.extendingRadio = false;
      // Don't swallow a loading flag an in-flight open raised meanwhile.
      if (this.state.loading && this.token === myToken) {
        this.state.loading = false;
        this.emit();
      }
    }
  }

  /** The AutoPlay switch lives in localStorage settings; read it straight. */
  private autoplayEnabled(): boolean {
    try {
      const raw = localStorage.getItem('bitchord.settings');
      if (raw) return (JSON.parse(raw) as { autoplay?: boolean }).autoplay !== false;
    } catch {
      /* ignore */
    }
    return true;
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
    let lastPosition = -1;
    this.ticking = window.setInterval(() => {
      const audio = this.active;
      // Sleep timer: pauses playing audio; an already-paused player just
      // drops the expired timer (otherwise resuming would pause instantly).
      if (this.sleepUntil && Date.now() >= this.sleepUntil) {
        const wasPlaying = !audio.paused;
        this.sleepUntil = null;
        if (wasPlaying) this.pause();
        else this.emit();
      }
      // A paused clock does not move: emitting only on change keeps four
      // ticks a second from re-rendering the whole app for nothing.
      if (audio.paused && this.state.positionMs === lastPosition) {
        return;
      }
      lastPosition = this.state.positionMs;
      if (!audio.paused) {
        this.state.positionMs = audio.currentTime * 1000;
        // A stream that only reports its duration late (or after a crossfade
        // swap) still gets a truthful seek bar.
        if (
          Number.isFinite(audio.duration) &&
          audio.duration > 0 &&
          Math.abs(audio.duration * 1000 - this.state.durationMs) > 1000
        ) {
          this.state.durationMs = audio.duration * 1000;
        }
        this.updateMediaSessionPosition();
        this.maybeStartCrossfade();
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
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      this.seek(this.state.positionMs + (details.seekOffset ?? 10) * 1000);
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      this.seek(this.state.positionMs - (details.seekOffset ?? 10) * 1000);
    });
  }

  /**
   * Lock-screen / OS media UIs read the play position from here instead of
   * guessing; without it their scrubber sits still at zero.
   */
  private updateMediaSessionPosition(): void {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const duration = this.active.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.active.playbackRate,
        position: Math.min(this.active.currentTime, duration),
      });
    } catch {
      /* transient states (e.g. Infinity metadata) are fine to ignore */
    }
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

  private releaseWakeLock(): void {
    if (this.wakeLock) {
      void this.wakeLock.release().catch(() => {
        /* already released */
      });
      this.wakeLock = null;
    }
  }
}

export const player = new BitChordPlayer();
export type { BitChordPlayer };

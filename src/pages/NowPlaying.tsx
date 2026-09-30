/**
 * BitChord web — Now Playing.
 *
 * Ported from NowPlayingScreen + PlayerControls: full-screen take-over with
 * the artwork over a palette-driven gradient, seek bar, full transport,
 * shuffle/repeat, speed and sleep timer, and pages for the queue and synced
 * lyrics (PlayerLyrics / PlayerQueue). Artwork rides SmartArt, so a dead
 * proxy thumbnail falls back to YouTube's own stills instead of a blank tile.
 */

import { useEffect, useState } from 'react';
import { player } from '../player/player';
import { actions, useApp, usePlayer } from '../state/store';
import { formatDuration } from '../api/models';
import { extractPalette, fallbackPalette } from '../lib/palette';
import type { ArtworkPalette } from '../lib/palette';
import { fetchLyrics } from '../lyrics/providers';
import type { Lyrics } from '../lyrics/lyrics';
import { LyricsPage } from './LyricsPage';
import { SmartArt } from '../components/SmartArt';
import { SongRow } from '../components/SongRow';
import {
  LikeFilledIcon,
  LikeIcon,
  LyricsIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  SleepIcon,
  SpeedIcon,
} from '../components/icons';

type Page = 'player' | 'queue' | 'lyrics';

export function NowPlaying() {
  const app = useApp();
  const playerState = usePlayer();
  const song = playerState.queue[playerState.index] ?? null;
  const [page, setPage] = useState<Page>('player');
  const [palette, setPalette] = useState<ArtworkPalette>(fallbackPalette);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [lyricsState, setLyricsState] = useState<'loading' | 'ready' | 'none'>('loading');
  const [showSleep, setShowSleep] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);

  const art = song?.thumbnailUrl ?? null;

  useEffect(() => {
    setLyrics(null);
    setLyricsState('loading');
    if (!song) return;
    let cancelled = false;
    extractPalette(art ?? '').then((p) => {
      if (cancelled) return;
      setPalette(p ?? fallbackPalette);
    });
    if (app.settings.syncedLyrics) {
      fetchLyrics(song, playerState.durationMs)
        .then((l) => {
          if (cancelled) return;
          setLyrics(l);
          setLyricsState(l ? 'ready' : 'none');
        })
        .catch(() => !cancelled && setLyricsState('none'));
    } else {
      setLyricsState('none');
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.videoId]);

  if (!song) return null;

  const playing = playerState.playing;
  const busy = playerState.loading;
  const liked = app.liked.some((s) => s.videoId === song.videoId);

  const gradient = `linear-gradient(160deg, rgb(${palette.r} ${palette.g} ${palette.b}) 0%, rgb(${Math.round(palette.r * 0.4)} ${Math.round(palette.g * 0.4)} ${Math.round(palette.b * 0.4)}) 55%, #000 100%)`;

  return (
    <div className="now-playing" style={{ background: gradient }}>
      <div className="now-playing-top safe-top">
        <button className="icon-button" onClick={() => actions.setShowNowPlaying(false)} aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7l-4.9 4.9l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275Z" />
          </svg>
        </button>
        <div className="now-playing-source label-medium" style={{ color: 'rgba(255,255,255,0.8)' }}>
          {song.albumName ?? 'BitChord'}
        </div>
        <button
          className="icon-button"
          onClick={() => setShowSleep(true)}
          aria-label="Sleep timer"
          style={{ color: player.sleepRemainingMs() !== null ? 'var(--accent)' : undefined }}
        >
          <SleepIcon size={22} />
        </button>
      </div>

      {page === 'player' && (
        <div className="now-playing-player">
          <div className={`now-playing-art${playing ? ' art-playing' : ''}`}>
            <SmartArt src={art} videoId={song.videoId} size={480} radius={16} eager keepOriginalSize />
          </div>
          <div className="now-playing-meta">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="now-playing-title headline-medium">{song.title}</div>
              <div className="now-playing-artist body-large" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {song.artist}
              </div>
            </div>
            <button className="icon-button" onClick={() => actions.toggleLiked(song)} aria-label="Like" style={{ color: liked ? 'var(--accent)' : '#fff' }}>
              {liked ? <LikeFilledIcon size={26} /> : <LikeIcon size={26} />}
            </button>
          </div>

          <SeekBar />

          <div className="now-playing-transport">
            <button
              className="icon-button"
              onClick={() => player.toggleShuffle()}
              aria-label="Shuffle"
              style={{ color: playerState.shuffle ? 'var(--accent)' : 'rgba(255,255,255,0.8)' }}
            >
              <ShuffleIcon size={22} />
            </button>
            <button className="icon-button" onClick={() => player.previous()} aria-label="Previous">
              <SkipPreviousIcon size={34} />
            </button>
            <button className="play-pause-fab" onClick={() => player.togglePlayPause()} aria-label={playing ? 'Pause' : 'Play'}>
              {busy ? (
                <span className="spinner" style={{ width: 26, height: 26, borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} />
              ) : playing ? (
                <PauseGlyph />
              ) : (
                <PlayGlyph />
              )}
            </button>
            <button className="icon-button" onClick={() => player.next()} aria-label="Next">
              <SkipNextIcon size={34} />
            </button>
            <button
              className="icon-button"
              onClick={() => player.cycleRepeat()}
              aria-label="Repeat"
              style={{ color: playerState.repeat !== 'off' ? 'var(--accent)' : 'rgba(255,255,255,0.8)' }}
            >
              {playerState.repeat === 'one' ? <RepeatOneIcon size={22} /> : <RepeatIcon size={22} />}
            </button>
          </div>

          <div className="now-playing-footer">
            <button className="icon-button" onClick={() => setShowSpeed(true)} aria-label="Playback speed" style={{ color: 'rgba(255,255,255,0.8)' }}>
              <SpeedIcon size={20} />
            </button>
            <span className="label-small" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {playerState.stream?.source ? `via ${playerState.stream.source}` : ''}
            </span>
            <button
              className="icon-button"
              onClick={() => setPage('queue')}
              aria-label="Queue"
              style={{ color: 'rgba(255,255,255,0.8)' }}
            >
              <QueueIcon size={20} />
            </button>
            <button
              className="icon-button now-playing-lyrics-button"
              onClick={() => setPage('lyrics')}
              aria-label="Lyrics"
              style={{ color: lyricsState === 'ready' ? '#fff' : 'rgba(255,255,255,0.5)' }}
            >
              <LyricsIcon size={20} />
              {lyricsState === 'ready' && lyrics?.wordSynced && <span className="lyrics-ready-dot" />}
            </button>
          </div>
        </div>
      )}

      {page === 'queue' && <QueuePage onBack={() => setPage('player')} />}
      {page === 'lyrics' && <LyricsPage lyrics={lyrics} onBack={() => setPage('player')} />}

      {showSleep && <SleepSheet onClose={() => setShowSleep(false)} />}
      {showSpeed && <SpeedSheet onClose={() => setShowSpeed(false)} />}
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.14v14.72q0 .575.5.8t.9-.06l10.6-7.36q.4-.275.4-.74t-.4-.74L9.4 4.4q-.4-.285-.9-.06T8 5.14Z" transform="translate(1 0)" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 19q-.825 0-1.412-.587T6 17V7q0-.825.588-1.412T8 5t1.413.588T10 7v10q0 .825-.587 1.413T8 19Zm8 0q-.825 0-1.412-.587T14 17V7q0-.825.588-1.412T16 5t1.413.588T18 7v10q0 .825-.587 1.413T16 19Z" />
    </svg>
  );
}

function SeekBar() {
  const playerState = usePlayer();
  const [dragging, setDragging] = useState<number | null>(null);
  const duration = playerState.durationMs || 1;
  const position = dragging ?? playerState.positionMs;

  const onScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setDragging(fraction * duration);
  };

  return (
    <div className="seek-wrap">
      <div
        className="seek-track"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onScrub(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0) onScrub(e);
        }}
        onPointerUp={(e) => {
          if (dragging !== null) player.seek(dragging);
          setDragging(null);
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <div className="seek-fill" style={{ width: `${(position / duration) * 100}%` }} />
        <div className="seek-knob" style={{ left: `${(position / duration) * 100}%` }} />
      </div>
      <div className="seek-times label-small" style={{ color: 'rgba(255,255,255,0.6)' }}>
        <span>{formatDuration(position)}</span>
        <span>-{formatDuration(Math.max(0, duration - position))}</span>
      </div>
    </div>
  );
}

function QueuePage({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const playerState = usePlayer();
  const current = playerState.queue[playerState.index] ?? null;
  return (
    <div className="queue-page">
      <div className="queue-top safe-top">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.8 16.8q.3-.3.288-.7t-.288-.7L7.8 12.5h9.4q.375 0 .638-.263t.262-.637t-.262-.638t-.638-.262H7.8l3-3q.3-.3.3-.7t-.3-.7t-.7-.3t-.7.3L5.4 11.3q-.15.15-.213.325T5.125 12t.063.375t.212.325l4.6 4.6q.275.275.688.288t.712-.288Z" />
          </svg>
        </button>
        <span className="title-medium">Queue</span>
        <span style={{ width: 40 }} />
      </div>
      <div className="queue-list">
        {playerState.queue.map((song, i) => (
          <SongRow
            key={`${song.videoId}-${i}`}
            song={song}
            current={current}
            playing={playerState.playing}
            onPlay={() => void player.playAt(i)}
            onRemove={() => player.removeFromQueue(i)}
            onToggleLiked={() => actions.toggleLiked(song)}
            liked={app.liked.some((s) => s.videoId === song.videoId)}
          />
        ))}
      </div>
    </div>
  );
}

function SleepSheet({ onClose }: { onClose: () => void }) {
  const presets = [5, 10, 15, 30, 45, 60];
  const remaining = player.sleepRemainingMs();
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet frosted" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title title-medium">Sleep timer</div>
        {remaining !== null && (
          <div className="body-medium" style={{ color: 'var(--on-surface-variant)', marginBottom: 8 }}>
            Stopping in {Math.ceil(remaining / 60000)} min
          </div>
        )}
        <div className="sleep-grid">
          {presets.map((minutes) => (
            <button
              key={minutes}
              className="sleep-chip label-medium"
              onClick={() => {
                player.startSleepTimer(minutes);
                onClose();
              }}
            >
              {minutes} min
            </button>
          ))}
        </div>
        {remaining !== null && (
          <button
            className="text-button label-medium"
            onClick={() => {
              player.cancelSleepTimer();
              onClose();
            }}
          >
            Cancel timer
          </button>
        )}
      </div>
    </div>
  );
}

function SpeedSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet frosted" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title title-medium">Playback speed</div>
        <div className="sleep-grid">
          {speeds.map((speed) => (
            <button
              key={speed}
              className={`sleep-chip label-medium${app.settings.playbackSpeed === speed ? ' sleep-chip-active' : ''}`}
              onClick={() => {
                actions.updateSettings({ playbackSpeed: speed });
                onClose();
              }}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

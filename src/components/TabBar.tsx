/**
 * BitChord web — floating bottom bar.
 *
 * Ported from FloatingTabBar / GlassNavBar: a frosted pill with the four tabs
 * and the now-playing controls docked into it, collapsing inline on scroll
 * down and expanding on scroll up. Below glass support (or with nothing
 * playing) it degrades to the stacked MiniPlayer + tab pill of the app's
 * non-glass layout.
 */

import { useEffect, useRef, useState } from 'react';
import { player } from '../player/player';
import type { Song } from '../api/models';
import { useApp, usePlayer, actions } from '../state/store';
import { SmartArt } from './SmartArt';
import {
  ExploreIcon,
  HomeIcon,
  LibraryIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from './icons';
import type { TabId } from '../state/store';

const TABS: { id: TabId; label: string; icon: (props: { size?: number }) => JSX.Element }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'explore', label: 'Explore', icon: ExploreIcon },
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'search', label: 'Search', icon: SearchIcon },
];

export function BottomBars() {
  const app = useApp();
  const playerState = usePlayer();
  const song = playerState.queue[playerState.index] ?? null;
  const [inline, setInline] = useState(false);
  const lastScroll = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastScroll.current;
      lastScroll.current = y;
      if (y < 24) {
        setInline(false);
        return;
      }
      if (delta > 12) setInline(true);
      else if (delta < -12) setInline(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const busy = playerState.loading;
  const playing = playerState.playing;

  const playPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    player.togglePlayPause();
  };
  const nextTrack = (e: React.MouseEvent) => {
    e.stopPropagation();
    player.next();
  };
  const prevTrack = (e: React.MouseEvent) => {
    e.stopPropagation();
    player.previous();
  };
  const expand = () => {
    if (song) actions.setShowNowPlaying(true);
  };

  // Nothing playing: the bar is the tab pill alone (inline state has no
  // accessory to shrink, so collapse is a no-op).
  if (!song) {
    return (
      <nav className="bottom-bars safe-bottom">
        <TabPill app={app} compact={false} />
      </nav>
    );
  }

  return (
    <nav className="bottom-bars safe-bottom">
      {inline ? (
        <div className="frosted bar-inline">
          <InlineNowPlaying
            song={song}
            playing={playing}
            busy={busy}
            onPlayPause={playPause}
            onNext={nextTrack}
            onPrev={prevTrack}
            onExpand={expand}
          />
          <TabPill app={app} compact />
        </div>
      ) : (
        <>
          <div className="frosted bar-nowplaying" onClick={expand} role="button" tabIndex={0}>
            <ExpandedNowPlaying
              song={song}
              playing={playing}
              busy={busy}
              onPlayPause={playPause}
              onNext={nextTrack}
              onPrev={prevTrack}
            />
            <MiniProgress positionMs={playerState.positionMs} durationMs={playerState.durationMs} />
          </div>
          <TabPill app={app} compact={false} />
        </>
      )}
    </nav>
  );
}

/** A hairline of progress along the top of the mini player, like the app's. */
function MiniProgress({ positionMs, durationMs }: { positionMs: number; durationMs: number }) {
  const fraction = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  return (
    <div className="mini-progress" aria-hidden="true">
      <div className="mini-progress-fill" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

function TabPill({ app, compact }: { app: ReturnType<typeof useApp>; compact: boolean }) {
  return (
    <div className={`frosted tab-pill${compact ? ' tab-pill-compact' : ''}`}>
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const selected = app.tab === tab.id;
        return (
          <button
            key={tab.id}
            className={`tab-item${selected ? ' tab-item-selected' : ''}`}
            onClick={() => actions.setTab(tab.id)}
            aria-label={tab.label}
          >
            <Icon size={22} />
            {!compact && <span className="tab-label label-small">{tab.label}</span>}
            {selected && <span className="tab-dot" />}
          </button>
        );
      })}
    </div>
  );
}

interface TransportProps {
  song: Song;
  playing: boolean;
  busy: boolean;
  onPlayPause: (e: React.MouseEvent) => void;
  onNext: (e: React.MouseEvent) => void;
  onPrev: (e: React.MouseEvent) => void;
  onExpand?: () => void;
}

function ExpandedNowPlaying({ song, playing, busy, onPlayPause, onNext, onPrev }: TransportProps) {
  return (
    <div className="mini-player-row">
      <SmartArt src={song.thumbnailUrl} videoId={song.videoId} size={40} radius={8} eager />
      <div className="mini-player-text">
        <span className="mini-player-title body-medium">{song.title}</span>
        <span className="mini-player-artist label-small" style={{ color: 'var(--on-surface-variant)' }}>
          {song.artist}
        </span>
      </div>
      <div className="mini-player-transport">
        <button className="icon-button" onClick={onPrev} aria-label="Previous">
          <SkipPreviousIcon size={22} />
        </button>
        <button className="icon-button" onClick={onPlayPause} aria-label={playing ? 'Pause' : 'Play'}>
          {busy ? <span className="spinner" style={{ width: 20, height: 20 }} /> : playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </button>
        <button className="icon-button" onClick={onNext} aria-label="Next">
          <SkipNextIcon size={22} />
        </button>
      </div>
    </div>
  );
}

function InlineNowPlaying({ song, playing, busy, onPlayPause, onNext, onExpand }: TransportProps) {
  return (
    <div className="inline-player" onClick={onExpand} role="button" tabIndex={0}>
      <SmartArt src={song.thumbnailUrl} videoId={song.videoId} size={36} radius={7} eager />
      <button className="icon-button" onClick={onPlayPause} aria-label={playing ? 'Pause' : 'Play'}>
        {busy ? <span className="spinner" style={{ width: 18, height: 18 }} /> : playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
      </button>
      <button className="icon-button" onClick={onNext} aria-label="Next">
        <SkipNextIcon size={20} />
      </button>
    </div>
  );
}

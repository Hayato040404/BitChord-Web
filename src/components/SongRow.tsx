/**
 * BitChord web — song row.
 *
 * Mirrors the app's SongRow: 52dp-ish artwork, title over credit, the
 * now-playing highlight matched on title+artist, a long-press action sheet on
 * mobile / right-click on desktop, and optional trailing buttons. Artwork
 * rides SmartArt so proxy failures fall back to YouTube's own stills.
 */

import { useRef, useState } from 'react';
import type { Song } from '../api/models';
import { SmartArt } from './SmartArt';
import { LikeFilledIcon, LikeIcon, MoreIcon, PauseIcon, PlayIcon } from './icons';
import { t } from '../i18n';

interface SongRowProps {
  song: Song;
  index?: number;
  /** The track the player is on, for the highlight. */
  current?: Song | null;
  playing?: boolean;
  onPlay: () => void;
  onMenu?: () => void;
  onToggleLiked?: () => void;
  liked?: boolean;
  /** Trailing node instead of the default like + menu buttons. */
  trailing?: React.ReactNode;
  onRemove?: () => void;
  /** Queue reorder controls (queue page rows). */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  moveDisabledUp?: boolean;
  moveDisabledDown?: boolean;
}

export function SongRow({
  song,
  index,
  current,
  playing = false,
  onPlay,
  onMenu,
  onToggleLiked,
  liked = false,
  trailing,
  onRemove,
  onMoveUp,
  onMoveDown,
  moveDisabledUp = false,
  moveDisabledDown = false,
}: SongRowProps) {
  const [pressed, setPressed] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const isCurrent = current != null && current.videoId === song.videoId;

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // A held thumb on a row opens its menu (the app's onSongLongPress); the
  // context menu covers desktop right-clicks.
  const startLongPress = () => {
    if (!onMenu) return;
    clearLongPress();
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      setPressed(false);
      onMenu();
    }, 550);
  };

  const handleClick = () => {
    // The tap that ends a long-press must not also start playback.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onPlay();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onMenu) {
      e.preventDefault();
      onMenu();
    }
  };

  return (
    <div
      className={`song-row${pressed ? ' song-row-pressed' : ''}`}
      onClick={handleClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onTouchStart={startLongPress}
      onTouchEnd={clearLongPress}
      onTouchMove={clearLongPress}
      onContextMenu={handleContextMenu}
      data-current={isCurrent || undefined}
    >
      {index !== undefined && <span className="song-row-index label-medium">{index + 1}</span>}
      <SmartArt src={song.thumbnailUrl} videoId={song.videoId} size={52} radius={8} className="row-art-wrap" />
      <div className="song-row-text">
        <span className="song-row-title body-large" style={isCurrent ? { color: 'var(--accent)' } : undefined}>
          {song.title}
        </span>
        <span className="song-row-artist body-medium" style={{ color: 'var(--on-surface-variant)' }}>
          {song.artist}
          {song.durationText ? ` · ${song.durationText}` : ''}
        </span>
      </div>
      <div className="song-row-actions" onClick={(e) => e.stopPropagation()}>
        {(onMoveUp || onMoveDown) && (
          <span className="song-row-move">
            <button
              className="icon-button"
              onClick={() => onMoveUp?.()}
              disabled={moveDisabledUp}
              aria-label={t('queue.moveUp')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 10.8 7.7 15.1q-.275.275-.7.275t-.7-.275q-.3-.3-.3-.713t.3-.687L11.3 9.3q.3-.3.7-.3t.7.3l5 5q.275.275.288.688T17.7 15.4q-.3.3-.7.3t-.7-.3L12 10.8Z" />
              </svg>
            </button>
            <button
              className="icon-button"
              onClick={() => onMoveDown?.()}
              disabled={moveDisabledDown}
              aria-label={t('queue.moveDown')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 13.2l-4.3 4.3q-.275.275-.7.275t-.7-.275q-.3-.3-.3-.712t.3-.688l5-5q.3-.3.7-.3t.7.3l5 5q.275.275.288.688T17.7 17.5q-.3.3-.7.3t-.7-.3L12 13.2Z" />
              </svg>
            </button>
          </span>
        )}
        {isCurrent && playing ? (
          <PauseIcon size={20} style={{ color: 'var(--accent)' }} />
        ) : isCurrent ? (
          <PlayIcon size={20} style={{ color: 'var(--accent)' }} />
        ) : null}
        {onRemove && (
          <button className="icon-button" onClick={onRemove} aria-label={t('aria.clear')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l4.9-4.9q.275-.275-.7-.275t.7-.275t.7.275t.275.7t-.275.7l-4.9 4.9l4.9-4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275Z" />
            </svg>
          </button>
        )}
        {onToggleLiked && (
          <button className="icon-button" onClick={onToggleLiked} aria-label={t('aria.like')}>
            {liked ? <LikeFilledIcon size={20} /> : <LikeIcon size={20} />}
          </button>
        )}
        {onMenu && !trailing && (
          <button className="icon-button" onClick={onMenu} aria-label={t('aria.more')}>
            <MoreIcon size={20} />
          </button>
        )}
        {trailing}
      </div>
    </div>
  );
}

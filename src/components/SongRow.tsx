/**
 * BitChord web — song row.
 *
 * Mirrors the app's SongRow: 52dp-ish artwork, title over credit, the
 * now-playing highlight matched on title+artist, a long-press action sheet on
 * mobile / right-click on desktop, and optional trailing buttons. Artwork
 * rides SmartArt so proxy failures fall back to YouTube's own stills.
 */

import { useState } from 'react';
import type { Song } from '../api/models';
import { SmartArt } from './SmartArt';
import { LikeFilledIcon, LikeIcon, MoreIcon, PauseIcon, PlayIcon } from './icons';

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
}: SongRowProps) {
  const [pressed, setPressed] = useState(false);
  const isCurrent =
    current != null && current.title === song.title && current.artist === song.artist;

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onMenu) {
      e.preventDefault();
      onMenu();
    }
  };

  return (
    <div
      className={`song-row${pressed ? ' song-row-pressed' : ''}`}
      onClick={onPlay}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
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
        {isCurrent && playing ? (
          <PauseIcon size={20} style={{ color: 'var(--accent)' }} />
        ) : isCurrent ? (
          <PlayIcon size={20} style={{ color: 'var(--accent)' }} />
        ) : null}
        {onRemove && (
          <button className="icon-button" onClick={onRemove} aria-label="Remove">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l4.9-4.9q.275-.275-.7-.275t.7-.275t.7.275t.275.7t-.275.7l-4.9 4.9l4.9-4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275Z" />
            </svg>
          </button>
        )}
        {onToggleLiked && (
          <button className="icon-button" onClick={onToggleLiked} aria-label="Like">
            {liked ? <LikeFilledIcon size={20} /> : <LikeIcon size={20} />}
          </button>
        )}
        {onMenu && !trailing && (
          <button className="icon-button" onClick={onMenu} aria-label="More">
            <MoreIcon size={20} />
          </button>
        )}
        {trailing}
      </div>
    </div>
  );
}

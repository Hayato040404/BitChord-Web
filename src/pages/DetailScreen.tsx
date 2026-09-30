/**
 * BitChord web — album / artist / playlist detail.
 *
 * Ported from DetailScreen: large header with the sleeve, play + shuffle,
 * and the track list. Artist pages list their shelves (albums, singles)
 * instead of one track list.
 */

import { useEffect } from 'react';
import type { ShelfItem, Song } from '../api/models';
import { actions, useApp, usePlayer } from '../state/store';
import { player } from '../player/player';
import { ShelfCarousel } from '../components/common';
import { SongRow } from '../components/SongRow';
import { SmartArt } from '../components/SmartArt';

export function DetailScreen({
  browseId,
  onOpenDetail,
}: {
  browseId: string;
  onOpenDetail: (item: ShelfItem) => void;
}) {
  const app = useApp();
  const playerState = usePlayer();
  const current = playerState.queue[playerState.index] ?? null;
  const page = app.detailPages[browseId];

  useEffect(() => {
    if (!page) void actions.loadDetail(browseId);
  }, [browseId, page]);

  if (!page) {
    return (
      <div className="feed">
        <div className="skeleton" style={{ height: 300, borderRadius: 0 }} />
      </div>
    );
  }

  const playAll = (shuffle: boolean) => {
    const songs = page.songs;
    if (songs.length === 0) return;
    const start = shuffle ? Math.floor(Math.random() * songs.length) : 0;
    if (shuffle && !playerState.shuffle) player.toggleShuffle();
    actions.playSongs(songs, start, page.title);
  };

  const playSong = (song: Song) => {
    const index = page.songs.findIndex((s) => s.videoId === song.videoId);
    actions.playSongs(page.songs, Math.max(0, index), page.title);
  };

  return (
    <div className="feed">
      <div className="detail-header">
        <SmartArt
          src={page.thumbnailUrl}
          videoId={page.songs[0]?.videoId ?? null}
          size={720}
          radius={0}
          eager
          keepOriginalSize
          className="detail-header-art-wrap"
        />
        <div className="detail-header-scrim" />
        <div className="detail-header-content page-gutter">
          <button className="icon-button detail-back" onClick={() => actions.popDetail()} aria-label="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.8 16.8q.3-.3.288-.7t-.288-.7L7.8 12.5h9.4q.375 0 .638-.263t.262-.637t-.262-.638t-.638-.262H7.8l3-3q.3-.3.3-.7t-.3-.7t-.7-.3t-.7.3L5.4 11.3q-.15.15-.213.325T5.125 12t.063.375t.212.325l4.6 4.6q.275.275.688.288t.712-.288Z" />
            </svg>
          </button>
          <div className="detail-title-wrap">
            <h1 className="headline-large detail-title">{page.title}</h1>
            <span className="body-medium detail-subtitle">{page.subtitle}</span>
          </div>
        </div>
      </div>

      {page.type === 'ARTIST' ? (
        <>
          {page.shelves?.map((shelf, i) => (
            <ShelfCarousel key={`${shelf.title}-${i}`} shelf={shelf} onItemClick={onOpenDetail} />
          ))}
          {(!page.shelves || page.shelves.length === 0) && (
            <div className="page-gutter body-medium" style={{ color: 'var(--on-surface-variant)', padding: '12px 20px' }}>
              No releases parsed from this artist page.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="detail-actions page-gutter">
            <button className="play-fab" onClick={() => playAll(false)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.14v14.72q0 .575.5.8t.9-.06l10.6-7.36q.4-.275.4-.74t-.4-.74L9.4 4.4q-.4-.285-.9-.06T8 5.14Z" transform="translate(1 0)" />
              </svg>
              Play
            </button>
            <button className="text-button label-medium" onClick={() => playAll(true)}>
              Shuffle
            </button>
          </div>
          <div className="detail-songs">
            {page.songs.map((song, i) => (
              <SongRow
                key={`${song.videoId}-${i}`}
                song={song}
                index={i}
                current={current}
                playing={playerState.playing}
                onPlay={() => playSong(song)}
                onToggleLiked={() => actions.toggleLiked(song)}
                liked={app.liked.some((s) => s.videoId === song.videoId)}
              />
            ))}
            {page.songs.length === 0 && (
              <div className="page-gutter body-medium" style={{ color: 'var(--on-surface-variant)', padding: '12px 20px' }}>
                No tracks parsed from this page.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

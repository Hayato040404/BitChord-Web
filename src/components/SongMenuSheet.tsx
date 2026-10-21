/**
 * BitChord web — the row action sheet.
 *
 * What a long-press / menu tap on a song offers: play next, add to queue,
 * like, and add to (or create) a playlist. Lives above everything as a
 * sheet, opened through the store's `menuSong`.
 */

import { useState } from 'react';
import { actions, useApp } from '../state/store';
import { player } from '../player/player';
import { SmartArt } from './SmartArt';
import { LikeFilledIcon, LikeIcon, PlusIcon } from './icons';
import { t } from '../i18n';

export function SongMenuSheet() {
  const app = useApp();
  const song = app.menuSong;
  const [addToOpen, setAddToOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  if (!song) return null;

  const close = () => {
    setAddToOpen(false);
    setNewTitle('');
    actions.closeSongMenu();
  };

  const liked = app.liked.some((s) => s.videoId === song.videoId);

  const createAndAdd = () => {
    const title = newTitle.trim();
    if (!title) return;
    actions.createPlaylist(title, [song]);
    actions.showToast(t('menu.addedToast', { title }));
    close();
  };

  return (
    <div className="sheet-scrim" onClick={close}>
      <div className="sheet frosted" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="song-menu-head">
          <SmartArt src={song.thumbnailUrl} videoId={song.videoId} size={48} radius={8} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="song-menu-title body-medium">{song.title}</div>
            <div className="song-menu-artist label-small" style={{ color: 'var(--on-surface-variant)' }}>
              {song.artist}
            </div>
          </div>
        </div>

        {!addToOpen ? (
          <div className="song-menu-options">
            <button
              className="song-menu-row body-large"
              onClick={() => {
                // "Play next" on an idle player just starts the song.
                if (player.getSnapshot().queue.length === 0) {
                  void player.playQueue([song], 0);
                } else {
                  player.playNext(song);
                }
                actions.showToast(t('toast.playingNext'));
                close();
              }}
            >
              Play next
            </button>
            <button
              className="song-menu-row body-large"
              onClick={() => {
                void player.addToQueue(song);
                actions.showToast(t('toast.addedToQueue'));
                close();
              }}
            >
              Add to queue
            </button>
            <button
              className="song-menu-row body-large"
              onClick={() => {
                actions.toggleLiked(song);
                close();
              }}
            >
              <span className="song-menu-with-icon">
                {liked ? <LikeFilledIcon size={18} /> : <LikeIcon size={18} />}
                {liked ? t('menu.likeRemove') : t('menu.likeAdd')}
              </span>
            </button>
            <button className="song-menu-row body-large" onClick={() => setAddToOpen(true)}>
              <span className="song-menu-with-icon">
                <PlusIcon size={18} />
                {t('menu.addToPlaylist')}
              </span>
            </button>
          </div>
        ) : (
          <div className="song-menu-options">
            <button className="song-menu-back label-medium" onClick={() => setAddToOpen(false)} aria-label={t('menu.back')}>
              {t('menu.back')}
            </button>
            {app.playlists.length === 0 && (
              <div className="body-medium" style={{ color: 'var(--on-surface-variant)', padding: '2px 0 8px' }}>
                {t('menu.noPlaylists')}
              </div>
            )}
            {app.playlists.map((pl) => (
              <button
                key={pl.id}
                className="song-menu-row body-large"
                onClick={() => {
                  actions.addToPlaylist(pl.id, song);
                  close();
                }}
              >
                {pl.title}
              </button>
            ))}
            <div className="song-menu-new">
              <input
                className="text-input body-medium"
                placeholder={t('menu.newPlaylistName')}
                aria-label={t('menu.newPlaylistName')}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createAndAdd()}
              />
              <button className="text-button label-medium" onClick={createAndAdd} disabled={!newTitle.trim()}>
                {t('menu.create')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

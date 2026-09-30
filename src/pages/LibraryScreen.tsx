/**
 * BitChord web — Library.
 *
 * The guest library: liked songs, playlists created here, listening history
 * and recents. Follows the app's LibraryScreen structure (shelves per
 * collection, then the track lists) with creation inline.
 */

import { useState } from 'react';
import type { Song } from '../api/models';
import { actions, useApp, usePlayer } from '../state/store';
import { SongRow } from '../components/SongRow';
import { SmartArt } from '../components/SmartArt';
import type { UserPlaylist } from '../data/library';

export function LibraryScreen() {
  const app = useApp();
  const playerState = usePlayer();
  const current = playerState.queue[playerState.index] ?? null;
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const liked = app.liked;
  const history = app.history.slice(0, 30).map((h) => h.song);

  const playAll = (songs: Song[], source: string) => {
    if (songs.length === 0) return;
    actions.playSongs(songs, 0, source);
  };

  const create = () => {
    const title = newTitle.trim();
    if (!title) return;
    actions.createPlaylist(title);
    setNewTitle('');
    setCreating(false);
  };

  return (
    <div className="feed">
      <h1 className="display-large page-gutter" style={{ margin: '8px 0 12px' }}>
        Library
      </h1>

      <div className="page-gutter shelf-header-row">
        <h2 className="title-large">Playlists</h2>
        <button className="text-button label-medium" onClick={() => setCreating(true)}>New playlist</button>
      </div>
      {creating && (
        <div className="page-gutter" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="text-input body-medium"
            placeholder="Playlist title"
            value={newTitle}
            autoFocus
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className="text-button label-medium" onClick={create}>
            Create
          </button>
        </div>
      )}
      <div className="playlist-grid page-gutter">
        {app.playlists.map((pl: UserPlaylist) => (
          <PlaylistCard
            key={pl.id}
            playlist={pl}
            onOpen={() => actions.showToast('Open the playlist from its rows below')}
            onDelete={() => actions.deletePlaylist(pl.id)}
          />
        ))}
        {app.playlists.length === 0 && !creating && (
          <div className="body-medium" style={{ color: 'var(--on-surface-variant)' }}>
            No playlists yet.
          </div>
        )}
      </div>

      <div className="page-gutter shelf-header-row">
        <h2 className="title-large">Liked songs</h2>
        {liked.length > 0 && (
          <button className="text-button label-medium" onClick={() => playAll(liked, 'Liked songs')}>
            Play all
          </button>
        )}
      </div>
      {liked.length === 0 ? (
        <div className="page-gutter empty-hint body-medium" style={{ color: 'var(--on-surface-variant)' }}>
          Tracks you like land here. They are saved on this device.
        </div>
      ) : (
        liked.slice(0, 20).map((song) => (
          <SongRow
            key={song.videoId}
            song={song}
            current={current}
            playing={playerState.playing}
            onPlay={() => playAll(liked.slice(liked.indexOf(song)), 'Liked songs')}
            onToggleLiked={() => actions.toggleLiked(song)}
            liked
          />
        ))
      )}

      <div className="page-gutter shelf-header-row">
        <h2 className="title-large">History</h2>
      </div>
      {history.length === 0 ? (
        <div className="page-gutter empty-hint body-medium" style={{ color: 'var(--on-surface-variant)' }}>
          Plays are recorded here as you listen.
        </div>
      ) : (
        history.map((song) => (
          <SongRow
            key={song.videoId}
            song={song}
            current={current}
            playing={playerState.playing}
            onPlay={() => playAll(history.slice(history.indexOf(song)), 'History')}
            onMenu={() => actions.addToQueue(song)}
          />
        ))
      )}
    </div>
  );
}

function PlaylistCard({
  playlist,
  onOpen,
  onDelete,
}: {
  playlist: UserPlaylist;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const cover = playlist.songs[0]?.thumbnailUrl ?? null;
  const coverVideo = playlist.songs[0]?.videoId ?? null;
  return (
    <div className="playlist-card" onClick={onOpen}>
      <SmartArt src={cover} videoId={coverVideo} size={56} radius={8} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="body-medium" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {playlist.title}
        </div>
        <div className="label-small" style={{ color: 'var(--on-surface-variant)' }}>
          {playlist.songs.length} songs
        </div>
      </div>
      <button
        className="icon-button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete playlist"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 22q-.825 0-1.412-.587T5 20V7q0-.825.588-1.412T7 5h10q.825 0 1.413.588T19 7v13q0 .825-.587 1.413T17 22Zm3-14q-.425 0-.712.288T9 9v9q0 .425.288.713T10 19t.713-.288T11 18V9q0-.425-.288-.712T10 8Zm4 0q-.425 0-.712.288T13 9v9q0 .425.288.713T14 19t.713-.288T15 18V9q0-.425-.288-.712T14 8ZM8 5V3.5q0-.625.438-1.062T9.5 2h5q.625 0 1.063.438T16 3.5V5h2.5q.425 0 .713.288T19.5 6t-.287.713T18.5 7h-13q-.425 0-.712-.288T4.5 6t.288-.712T5.5 5Z" />
        </svg>
      </button>
    </div>
  );
}

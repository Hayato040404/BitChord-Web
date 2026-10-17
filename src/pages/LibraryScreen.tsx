/**
 * BitChord web — Library.
 *
 * The guest library: liked songs, playlists created here (with a real
 * playlist view — rows play from the list, songs can be removed, playlists
 * deleted), listening history and recents. Follows the app's LibraryScreen
 * structure: shelf headers per collection, then the track lists.
 */

import { useState } from 'react';
import type { Song } from '../api/models';
import { actions, useApp, usePlayer } from '../state/store';
import { player } from '../player/player';
import { SongRow } from '../components/SongRow';
import { SmartArt } from '../components/SmartArt';
import type { UserPlaylist } from '../data/library';

const PREVIEW_COUNT = 10;

export function LibraryScreen() {
  const app = useApp();
  const playerState = usePlayer();
  const current = playerState.queue[playerState.index] ?? null;
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [showAllLiked, setShowAllLiked] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const liked = app.liked;
  const history = app.history.map((h) => h.song);

  const openPlaylist = app.playlists.find((pl) => pl.id === openPlaylistId) ?? null;

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

  if (openPlaylist) {
    return (
      <PlaylistView
        playlist={openPlaylist}
        current={current}
        playing={playerState.playing}
        onBack={() => setOpenPlaylistId(null)}
      />
    );
  }

  const likedPreview = showAllLiked ? liked : liked.slice(0, PREVIEW_COUNT);
  const historyPreview = showAllHistory ? history : history.slice(0, PREVIEW_COUNT);

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
            aria-label="Playlist title"
            value={newTitle}
            autoFocus
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            onKeyUp={(e) => e.key === 'Escape' && setCreating(false)}
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
            onOpen={() => setOpenPlaylistId(pl.id)}
            onDelete={() => {
              actions.deletePlaylist(pl.id);
              actions.showToast(`Deleted ${pl.title}`);
            }}
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
        <>
          {likedPreview.map((song) => (
            <SongRow
              key={song.videoId}
              song={song}
              current={current}
              playing={playerState.playing}
              onPlay={() => playAll(liked.slice(liked.findIndex((s) => s.videoId === song.videoId)), 'Liked songs')}
              onToggleLiked={() => actions.toggleLiked(song)}
              onMenu={() => actions.openSongMenu(song)}
              liked
            />
          ))}
          {liked.length > PREVIEW_COUNT && (
            <ShowAllToggle
              expanded={showAllLiked}
              label={`Show all ${liked.length} songs`}
              onToggle={() => setShowAllLiked((v) => !v)}
            />
          )}
        </>
      )}

      <div className="page-gutter shelf-header-row">
        <h2 className="title-large">History</h2>
      </div>
      {history.length === 0 ? (
        <div className="page-gutter empty-hint body-medium" style={{ color: 'var(--on-surface-variant)' }}>
          Plays are recorded here as you listen.
        </div>
      ) : (
        <>
          {historyPreview.map((song) => (
            <SongRow
              key={`${song.videoId}-${app.history[history.indexOf(song)]?.at ?? 0}`}
              song={song}
              current={current}
              playing={playerState.playing}
              onPlay={() => playAll(history.slice(history.findIndex((s) => s.videoId === song.videoId)), 'History')}
              onToggleLiked={() => actions.toggleLiked(song)}
              onMenu={() => actions.openSongMenu(song)}
              liked={app.liked.some((s) => s.videoId === song.videoId)}
            />
          ))}
          {history.length > PREVIEW_COUNT && (
            <ShowAllToggle
              expanded={showAllHistory}
              label={`Show all ${history.length} plays`}
              onToggle={() => setShowAllHistory((v) => !v)}
            />
          )}
        </>
      )}
    </div>
  );
}

function ShowAllToggle({ expanded, label, onToggle }: { expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <button className="show-all-toggle label-medium" onClick={onToggle}>
      {expanded ? 'Show less' : label}
    </button>
  );
}

/** A user playlist opened as a page: play / shuffle / delete / remove rows. */
function PlaylistView({
  playlist,
  current,
  playing,
  onBack,
}: {
  playlist: UserPlaylist;
  current: Song | null;
  playing: boolean;
  onBack: () => void;
}) {
  const app = useApp();
  const songs = playlist.songs;
  const cover = songs[0]?.thumbnailUrl ?? null;
  const coverVideo = songs[0]?.videoId ?? null;

  const playAll = (from: number) => {
    if (songs.length === 0) return;
    actions.playSongs(songs, Math.max(0, from), playlist.title);
  };
  const playShuffled = () => {
    if (songs.length === 0) return;
    if (!player.getSnapshot().shuffle) player.toggleShuffle();
    playAll(Math.floor(Math.random() * songs.length));
  };

  return (
    <div className="feed">
      <div className="playlist-view-header detail-header">
        <SmartArt src={cover} videoId={coverVideo} size={720} radius={0} eager keepOriginalSize className="detail-header-art-wrap" />
        <div className="detail-header-scrim" />
        <div className="detail-header-content page-gutter">
          <button className="icon-button detail-back" onClick={onBack} aria-label="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.8 16.8q.3-.3.288-.7t-.288-.7L7.8 12.5h9.4q.375 0 .638-.263t.262-.637t-.262-.638t-.638-.262H7.8l3-3q.3-.3.3-.7t-.3-.7t-.7-.3t-.7.3L5.4 11.3q-.15.15-.213.325T5.125 12t.063.375t.212.325l4.6 4.6q.275.275.688.288t.712-.288Z" />
            </svg>
          </button>
          <div className="detail-title-wrap">
            <h1 className="headline-large detail-title">{playlist.title}</h1>
            <span className="body-medium detail-subtitle">
              {songs.length === 1 ? '1 song' : `${songs.length} songs`}
            </span>
          </div>
        </div>
      </div>

      {songs.length > 0 && (
        <div className="detail-actions page-gutter">
          <button className="play-fab" onClick={() => playAll(0)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v14.72q0 .575.5.8t.9-.06l10.6-7.36q.4-.275.4-.74t-.4-.74L9.4 4.4q-.4-.285-.9-.06T8 5.14Z" transform="translate(1 0)" />
            </svg>
            Play
          </button>
          {songs.length > 1 && (
            <button className="text-button label-medium" onClick={playShuffled}>
              Shuffle
            </button>
          )}
        </div>
      )}

      <div className="detail-songs">
        {songs.map((song, i) => (
          <SongRow
            key={`${song.videoId}-${i}`}
            song={song}
            index={i}
            current={current}
            playing={playing}
            onPlay={() => playAll(i)}
            onToggleLiked={() => actions.toggleLiked(song)}
            onMenu={() => actions.openSongMenu(song)}
            liked={app.liked.some((s) => s.videoId === song.videoId)}
            onRemove={() => {
              actions.removeFromPlaylist(playlist.id, song.videoId);
              actions.showToast('Removed from playlist');
            }}
          />
        ))}
        {songs.length === 0 && (
          <div className="page-gutter body-medium" style={{ color: 'var(--on-surface-variant)', padding: '12px 20px' }}>
            Empty playlist — add songs from any row's menu.
          </div>
        )}
      </div>
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
    <div
      className="playlist-card"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {cover || coverVideo ? (
        <SmartArt src={cover} videoId={coverVideo} size={56} radius={8} />
      ) : (
        <span className="playlist-card-empty" aria-hidden="true" />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="body-medium" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {playlist.title}
        </div>
        <div className="label-small" style={{ color: 'var(--on-surface-variant)' }}>
          {playlist.songs.length === 1 ? '1 song' : `${playlist.songs.length} songs`}
        </div>
      </div>
      <button
        className="icon-button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${playlist.title}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 22q-.825 0-1.412-.587T5 20V7q0-.825.588-1.412T7 5h10q.825 0 1.413.588T19 7v13q0 .825-.587 1.413T17 22Zm3-14q-.425 0-.712.288T9 9v9q0 .425.288.713T10 19t.713-.288T11 18V9q0-.425-.288-.712T10 8Zm4 0q-.425 0-.712.288T13 9v9q0 .425.288.713T14 19t.713-.288T15 18V9q0-.425-.288-.712T14 8ZM8 5V3.5q0-.625.438-1.062T9.5 2h5q.625 0 1.063.438T16 3.5V5h2.5q.425 0 .713.288T19.5 6t-.287.713T18.5 7h-13q-.425 0-.712-.288T4.5 6t.288-.712T5.5 5Z" />
        </svg>
      </button>
    </div>
  );
}

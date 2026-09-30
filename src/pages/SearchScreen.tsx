/**
 * BitChord web — Search.
 *
 * Ported from SearchScreen: suggestions as you type (the cheap typeahead
 * endpoint), filter chips (All / Songs / Videos / Albums / Artists /
 * Playlists), heterogenous results, and paging via the continuation token.
 */

import { useEffect, useRef, useState } from 'react';
import { fetchSearch, fetchSuggestions, SEARCH_FILTERS } from '../api/repository';
import type { SearchFilterId, SearchPage } from '../api/repository';
import type { ShelfItem, Song } from '../api/models';
import { actions, useApp, usePlayer } from '../state/store';
import { player } from '../player/player';
import { SongRow } from '../components/SongRow';
import { FeedSkeleton } from '../components/common';
import { SmartArt } from '../components/SmartArt';

export function SearchScreen({ onOpenDetail }: { onOpenDetail: (item: ShelfItem) => void }) {
  const app = useApp();
  const playerState = usePlayer();
  const current = playerState.queue[playerState.index] ?? null;

  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<SearchFilterId>('all');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [page, setPage] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field on search tab tap — the same signal MainActivity sends.
  useEffect(() => {
    if (app.tab === 'search') inputRef.current?.focus();
  }, [app.tab]);

  // Debounced suggestions while typing.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const query = input.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      fetchSuggestions(query)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [input]);

  const runSearch = (query: string, filterId: SearchFilterId) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSuggestions([]);
    fetchSearch(trimmed, filterId)
      .then(setPage)
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Search failed');
        setPage(null);
      })
      .finally(() => setLoading(false));
  };

  // Re-run on filter change when there is a query.
  useEffect(() => {
    if (input.trim()) runSearch(input, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const playTrack = (song: Song, rows: (Song | ShelfItem)[]) => {
    // Queue the song rows around the tapped one, the way tapping a row plays
    // from its list.
    const songs = rows.filter((row): row is Song => 'videoId' in row && row.videoId !== null);
    const index = songs.findIndex((s) => s.videoId === song.videoId);
    actions.playSongs(songs, Math.max(0, index), 'Search');
  };

  const onItem = (item: ShelfItem) => {
    if (item.videoId) {
      playTrack(
        { videoId: item.videoId, title: item.title, artist: item.subtitle, thumbnailUrl: item.thumbnailUrl },
        page?.rows ?? [],
      );
    } else if (item.browseId) {
      onOpenDetail(item);
    }
  };

  return (
    <div className="feed">
      <div className="search-field-wrap page-gutter">
        <input
          ref={inputRef}
          className="search-field body-large"
          placeholder="Songs, artists, albums…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch(input, filter);
          }}
          enterKeyHint="search"
        />
        {input && (
          <button className="icon-button" onClick={() => { setInput(''); setPage(null); }} aria-label="Clear">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7l-4.9 4.9l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275Z" />
            </svg>
          </button>
        )}
      </div>

      {!page && suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              className="suggestion-row body-large"
              onClick={() => {
                setInput(suggestion);
                runSearch(suggestion, filter);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--on-surface-variant)' }}>
                <path d="M9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.15-.363 2.138t-.987 1.762l6.375 6.375q.3.3.288.7t-.313.7t-.7.3t-.7-.3l-6.375-6.375q-.775.625-1.763.988T9.5 16Zm0-2q1.875 0 3.188-1.313T14 9.5t-1.313-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14Z" />
              </svg>
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <div className="filter-chips page-gutter">
        {SEARCH_FILTERS.map((f) => (
          <button
            key={f.id}
            className={`filter-chip label-medium${filter === f.id ? ' filter-chip-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && !page ? (
        <FeedSkeleton firstIsHero={false} />
      ) : error ? (
        <div className="message-state">
          <div className="title-large">Search failed</div>
          <div className="body-medium" style={{ color: 'var(--on-surface-variant)' }}>
            {error}
          </div>
        </div>
      ) : page ? (
        <div className="results">
          {page.rows.map((row, i) => {
            if ('videoId' in row && row.videoId !== null) {
              const song = row as Song;
              return (
                <SongRow
                  key={`${song.videoId}-${i}`}
                  song={song}
                  current={current}
                  playing={playerState.playing}
                  onPlay={() => playTrack(song, page.rows)}
                  onToggleLiked={() => actions.toggleLiked(song)}
                  liked={app.liked.some((s) => s.videoId === song.videoId)}
                  onMenu={() => actions.playNext(song)}
                />
              );
            }
            const item = row as ShelfItem;
            return <BrowseRow key={`${item.browseId}-${i}`} item={item} onClick={() => onOpenDetail(item)} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

function BrowseRow({ item, onClick }: { item: ShelfItem; onClick: () => void }) {
  return (
    <button className="browse-row" onClick={onClick}>
      <SmartArt src={item.thumbnailUrl} videoId={item.videoId} size={52} radius={8} />
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div className="body-large" style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.title}
        </div>
        <div className="body-medium" style={{ color: 'var(--on-surface-variant)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.subtitle}
        </div>
      </div>
      <span className="label-small" style={{ color: 'var(--on-surface-variant)' }}>
        {item.type === 'ALBUM' ? 'Album' : item.type === 'ARTIST' ? 'Artist' : item.type === 'PLAYLIST' ? 'Playlist' : ''}
      </span>
    </button>
  );
}

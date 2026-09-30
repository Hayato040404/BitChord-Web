/**
 * BitChord web — Explore.
 *
 * Ported from ExploreScreen / MoodGenrePlaylistsScreen: the Moods & genres
 * grid, and the playlist shelves a mood or genre opens.
 */

import { useEffect, useState } from 'react';
import { fetchMoodAndGenres, fetchMoodGenreShelves } from '../api/repository';
import type { HomeShelf, MoodGenre, ShelfItem } from '../api/models';
import { actions, useApp } from '../state/store';
import { FeedSkeleton, MessageState, ShelfCarousel } from '../components/common';

export function ExploreScreen({ onOpenDetail }: { onOpenDetail: (item: ShelfItem) => void }) {
  const app = useApp();
  const [genres, setGenres] = useState<MoodGenre[] | null>(null);
  const [selected, setSelected] = useState<MoodGenre | null>(null);
  const [shelves, setShelves] = useState<HomeShelf[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMoodAndGenres()
      .then((list) => {
        if (!cancelled) setGenres(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load Explore');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setShelves(null);
    setError(null);
    fetchMoodGenreShelves(selected.browseId)
      .then((feed) => {
        if (!cancelled) setShelves(feed);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this mood');
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const onItem = (item: ShelfItem) => {
    if (item.videoId) {
      actions.playSongs(
        [
          {
            videoId: item.videoId,
            title: item.title,
            artist: item.subtitle,
            thumbnailUrl: item.thumbnailUrl,
          },
        ],
        0,
        'Explore',
      );
    } else if (item.browseId) {
      onOpenDetail(item);
    }
  };

  if (selected) {
    return (
      <div className="feed">
        <div className="page-gutter" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
          <button className="icon-button" onClick={() => setSelected(null)} aria-label="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.8 16.8q.3-.3.288-.7t-.288-.7L7.8 12.5h9.4q.375 0 .638-.263t.262-.637t-.262-.638t-.638-.262H7.8l3-3q.3-.3.3-.7t-.3-.7t-.7-.3t-.7.3L5.4 11.3q-.15.15-.213.325T5.125 12t.063.375t.212.325l4.6 4.6q.275.275.688.288t.712-.288Z" />
            </svg>
          </button>
          <h1 className="headline-medium" style={{ margin: 0 }}>
            {selected.title}
          </h1>
        </div>
        {error ? (
          <MessageState title="Something went wrong" message={error} onRetry={() => setSelected({ ...selected })} />
        ) : shelves === null ? (
          <FeedSkeleton firstIsHero={false} />
        ) : shelves.length === 0 ? (
          <MessageState title="Nothing here" message="This mood has no shelves right now." />
        ) : (
          shelves.map((shelf, i) => (
            <ShelfCarousel key={`${shelf.title}-${i}`} shelf={shelf} onItemClick={onItem} />
          ))
        )}
      </div>
    );
  }

  return (
    <div className="feed">
      <h1 className="display-large page-gutter" style={{ margin: '8px 0 12px' }}>
        Explore
      </h1>
      {error && genres === null ? (
        <MessageState title="Something went wrong" message={error} />
      ) : genres === null ? (
        <FeedSkeleton firstIsHero={false} />
      ) : (
        <div className="genre-grid page-gutter">
          {genres.map((genre) => (
            <button
              key={`${genre.browseId}-${genre.title}`}
              className="genre-chip label-medium"
              onClick={() => setSelected(genre)}
            >
              {genre.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

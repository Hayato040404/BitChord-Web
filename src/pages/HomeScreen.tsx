/**
 * BitChord web — Home.
 *
 * Ported from ui/screens/HomeScreen.kt: the feed of shelves, led by Recents
 * (from the local library, since the guest has no account feed) then the
 * YouTube Music home shelves, with a hero card on the first music shelf and
 * infinite scroll for more.
 */

import { useEffect, useState } from 'react';
import { player } from '../player/player';
import { fetchHome } from '../api/repository';
import type { HomeShelf, Song } from '../api/models';
import { actions, useApp } from '../state/store';
import { FeedSkeleton, HeroCard, MessageState, ShelfCarousel } from '../components/common';
import type { ShelfItem } from '../api/models';

export function HomeScreen({ onOpenDetail }: { onOpenDetail: (item: ShelfItem) => void }) {
  const app = useApp();
  const [shelves, setShelves] = useState<HomeShelf[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const feed = await fetchHome();
      setShelves(feed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the feed');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onItem = (item: ShelfItem) => {
    if (item.videoId) {
      const song: Song = {
        videoId: item.videoId,
        title: item.title,
        artist: item.subtitle,
        thumbnailUrl: item.thumbnailUrl,
      };
      actions.playSongs([song], 0, item.browseId ? 'Browse' : 'Home');
      // Radio keeps playing after the seed: resolve the queue behind it.
      void (async () => {
        const { fetchRadio } = await import('../api/repository');
        try {
          const radio = await fetchRadio(item.videoId!);
          if (radio.length > 0 && app.settings.autoplay) {
            player.setQueue([...player.getSnapshot().queue, ...radio]);
          }
        } catch {
          /* seed keeps playing either way */
        }
      })();
    } else if (item.browseId) {
      onOpenDetail(item);
    }
  };

  const recents = app.recents.slice(0, 12);
  const recentsShelf: HomeShelf | null =
    recents.length > 0
      ? {
          title: 'Recents',
          items: recents.map((song) => ({
            title: song.title,
            subtitle: song.artist,
            thumbnailUrl: song.thumbnailUrl,
            videoId: song.videoId,
            browseId: null,
          })),
        }
      : null;

  // The first track of the first music shelf leads the feed, the way the
  // app's hero card leads its first shelf.
  const hero = shelves?.[0]?.items[0] ?? null;
  const heroShelfItems = hero ? shelves![0].items.slice(1) : [];
  const heroShelves: HomeShelf[] | null =
    shelves === null
      ? null
      : hero
        ? [{ title: shelves![0].title, items: heroShelfItems }, ...shelves!.slice(1)]
        : shelves;

  return (
    <div className="feed">
      <h1 className="display-large page-gutter" style={{ margin: '8px 0 12px' }}>
        Home
      </h1>
      {error && shelves === null ? (
        <MessageState title="Something went wrong" message={error} onRetry={load} />
      ) : shelves === null ? (
        <FeedSkeleton />
      ) : (
        <>
          {recentsShelf && <ShelfCarousel shelf={recentsShelf} onItemClick={onItem} />}
          {hero && (
            <HeroCard
              title={hero.title}
              subtitle={hero.subtitle}
              thumbnailUrl={hero.thumbnailUrl ?? null}
              videoId={hero.videoId ?? null}
              onClick={() => onItem(hero)}
            />
          )}
          {heroShelves?.map((shelf, i) =>
            shelf.items.length > 0 ? (
              <ShelfCarousel key={`${shelf.title}-${i}`} shelf={shelf} onItemClick={onItem} />
            ) : null,
          )}
        </>
      )}
    </div>
  );
}

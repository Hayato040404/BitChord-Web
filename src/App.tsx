/**
 * BitChord web — app shell.
 *
 * Mirrors BitChordApp in MainActivity: tab pages under a floating bottom
 * bar, a detail stack over them, the full-screen player raised above
 * everything, settings as a sheet. On wide windows the player opens as a
 * side pane instead of a take-over (the app's two-column layout).
 */

import { useEffect, useState } from 'react';
import { actions, useApp, usePlayer } from './state/store';
import { notePlayForCurrentSong } from './state/store';
import { BottomBars } from './components/TabBar';
import { HomeScreen } from './pages/HomeScreen';
import { ExploreScreen } from './pages/ExploreScreen';
import { LibraryScreen } from './pages/LibraryScreen';
import { SearchScreen } from './pages/SearchScreen';
import { DetailScreen } from './pages/DetailScreen';
import { NowPlaying } from './pages/NowPlaying';
import { SettingsSheet } from './pages/SettingsSheet';
import type { ShelfItem } from './api/models';
import { SettingsIcon } from './components/icons';

export default function App() {
  const app = useApp();
  const playerState = usePlayer();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wide, setWide] = useState(() => window.innerWidth >= 900);

  // Theme class on <html>, following the app's ThemeMode.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        app.settings.themeMode === 'dark' ||
        (app.settings.themeMode === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [app.settings.themeMode]);

  // Track the wide breakpoint for the two-column player layout.
  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  // Record a play whenever the current track changes.
  useEffect(() => {
    notePlayForCurrentSong();
  }, [playerState.index]);

  const openDetail = (item: ShelfItem) => {
    if (!item.browseId) return;
    actions.openDetail({
      browseId: item.browseId,
      title: item.title,
      subtitle: item.subtitle,
      thumbnailUrl: item.thumbnailUrl,
      type: item.type ?? 'OTHER',
    });
  };

  const detail = app.detailStack[app.detailStack.length - 1];

  const page = (() => {
    switch (app.tab) {
      case 'home':
        return <HomeScreen onOpenDetail={openDetail} />;
      case 'explore':
        return <ExploreScreen onOpenDetail={openDetail} />;
      case 'library':
        return <LibraryScreen />;
      case 'search':
        return <SearchScreen onOpenDetail={openDetail} />;
    }
  })();

  const hasTrack = playerState.queue.length > 0;
  const showPlayerOverlay = app.showNowPlaying && hasTrack;

  return (
    <div className="app">
      <div className="app-topbar safe-top">
        <img src="./Logo.png" alt="" className="topbar-logo" onClick={() => actions.setTab('home')} />
        <span className="topbar-title label-medium">BitChord</span>
        <span style={{ flex: 1 }} />
        <button
          className="icon-button"
          onClick={() => hasTrack && actions.setShowNowPlaying(!app.showNowPlaying)}
          aria-label="Now playing"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22Zm0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20Zm0-2q2.5 0 4.25-1.75T18 12t-1.75-4.25T12 6T7.75 7.75T6 12t1.75 4.25T12 18Zm0-2q-1.65 0-2.825-1.175T8 12t1.175-2.825T12 8t2.825 1.175T16 12t-1.175 2.825T12 16Z" />
          </svg>
        </button>
        <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <SettingsIcon size={22} />
        </button>
      </div>

      <div className={`app-body${wide && showPlayerOverlay ? ' app-body-split' : ''}`}>
        <main className="app-page">
          {detail ? <DetailScreen browseId={detail.browseId} onOpenDetail={openDetail} /> : page}
        </main>
        {wide && showPlayerOverlay && (
          <aside className="app-player-pane">
            <NowPlaying />
          </aside>
        )}
      </div>

      <BottomBars />

      {!wide && showPlayerOverlay && <NowPlaying />}

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}

      <Toast />
    </div>
  );
}

function Toast() {
  const app = useApp();
  if (!app.toast) return null;
  return (
    <div className="toast frosted body-medium" key={app.toast.id}>
      {app.toast.message}
    </div>
  );
}

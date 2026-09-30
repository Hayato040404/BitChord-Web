# BitChord for Web (PWA)

The BitChord Android app, ported to the web — same UI language (Apple-Music-style
dark theme, floating glass tab bar, full-screen now-playing), running as an
installable PWA. Works on GitHub Pages and Vercel.

## What is ported

| Android | Web |
| --- | --- |
| Home / Explore / Library / Search tabs | Same four tabs, floating glass bar (collapses on scroll) |
| Mini player + glass now-playing dock | Mini player pill + expandable player (side pane ≥ 900px) |
| Now Playing (mesh gradient, artwork) | Palette extracted from artwork → gradient background |
| Queue with shuffle / repeat / "play next" | Same, with drag-free remove rows |
| Word/syllable lyrics (multiple sources) | LRCLIB synced lyrics with active-line highlight |
| Sleep timer, playback speed, data saver | Same, in Settings / player footer |
| Pluggable module sources | Piped / Invidious instance pool + custom sources (Settings → Sources) |
| YouTube account sign-in | Not portable — guest library in localStorage (likes, playlists, history, recents) |
| Downloads / local files / Discord / scrobbling / Jam | Not portable (no browser API surface for these) |

## Architecture (and why)

- **No youtubei.** Google does not send CORS headers on the Innertube
  endpoints, so a web page cannot call them (verified). This is why the only
  comparable web client, [ytify](https://github.com/n-ce/ytify), also rides
  instance APIs. Search, playlists, artists and radio run over the
  **Piped / Invidious pool** (`src/api/sources.ts`), tried in order with a
  10-minute health memory; instances that YouTube has IP-blocked fall away
  automatically and recover just as automatically.
- **Streams** are progressive audio URLs from Invidious adaptive formats
  (Opus itag 251 ≈ 145 kbps top) with Piped `audioStreams` as fallback. The
  `<audio>` element is left **without** `crossOrigin`: googlevideo serves no
  ACAO header, and no-cors media playback works — adding crossOrigin would
  enable Web Audio (crossfade) but mute playback entirely.
- **Guest library** (`src/data/library.ts`): likes, playlists, history and
  recents live in localStorage — the same surfaces the app draws on an
  account, backed by the device instead.
- **PWA**: hand-written manifest + service worker (`public/`). App shell is
  cache-first; media and artwork are never intercepted.

## Run

```bash
cd web
npm install
npm run dev       # dev server
npm run build     # typecheck + production build → dist/
npm run preview   # serve the production build
```

## Deploy

### GitHub Pages
`.github/workflows/web-deploy.yml` builds `web/` and publishes `web/dist`
on every push to `main` (paths-filtered to `web/**`). Enable
**Settings → Pages → Source: GitHub Actions** once. The build uses a
relative base (`./`), so the app works from a project subpath
(`user.github.io/bitchord/`) untouched.

### Vercel
Zero-config: import the repo, framework **Vite**, root directory `web`
(or use the top-level `vercel.json`, which builds `web/` into `dist/`).

## Quality ceiling

The Android app reaches lossless through its module sources; the web port
tops out at the best progressive audio an instance can hand a browser
(≈ 128–160 kbps Opus). The source pool, data-saver switch and the settings
UI for adding private instances are the same "pluggable sources" design —
a self-hosted Piped/Invidious gives the most reliable playback.

## License

GPL v3, like BitChord itself. Not affiliated with YouTube or Google.

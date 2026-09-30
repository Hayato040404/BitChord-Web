/**
 * BitChord web — stream & metadata source resolution.
 *
 * The Android app talks to youtubei directly with a full browser identity.
 * A web page cannot: Google does not send CORS headers on youtubei, so every
 * request a page makes is refused before it leaves the browser (verified —
 * this is why ytify, the only comparable web client, also rides Piped /
 * Invidious end to end).
 *
 * So this port works the way ytify does:
 *  - Search / playlists / channels / trending: Piped, Invidious as fallback.
 *  - Streams: Invidious `/api/v1/videos/:id` progressive audio URLs
 *    (Opus itag 251 ≈ 130–160 kbps, AAC 140 ≈ 128 kbps), with Piped
 *    `audioStreams` as fallback. googlevideo serves the returned URLs with
 *    permissive CORS, so <audio> plays them from any origin.
 *
 * Instances are a pool, tried in order. Health results are remembered for
 * ten minutes; the user's own sources (Settings → Sources) go first — the
 * same "pluggable sources" idea as the app's Sources screen. Public
 * instances get IP-blocked by YouTube regularly and recover just as
 * regularly, which is why the pool exists and why adding a private one is
 * supported first-class.
 */

// ---- Types ------------------------------------------------------------------

export interface StreamHandle {
  url: string;
  codec?: string;
  bitrate?: number;
  source: string;
}

export interface StreamSource {
  name: string;
  baseUrl: string;
  kind: 'piped' | 'invidious';
  custom?: boolean;
}

export type PipedFilter = 'all' | 'music_songs' | 'videos' | 'playlists' | 'channels';

export interface PipedSearchItem {
  url: string; // /watch?v=…, /playlist?list=…, /channel/UC…
  type: 'stream' | 'playlist' | 'channel';
  title: string;
  thumbnail: string;
  uploaderName?: string;
  uploaderUrl?: string;
  duration?: number;
  durationSeconds?: number;
  views?: number;
}

export interface PipedStream {
  title?: string;
  error?: string;
  audioStreams?: { url: string; bitrate?: number; mimeType?: string; quality?: string }[];
  relatedStreams?: PipedSearchItem[];
}

export interface InvidiousVideo {
  videoId: string;
  title: string;
  author: string;
  authorId?: string;
  lengthSeconds?: number;
  viewCount?: number;
  videoThumbnails?: { url: string; quality: string }[];
}

export interface InvidiousVideoDetail {
  videoId: string;
  title: string;
  author: string;
  authorId?: string;
  lengthSeconds?: number;
  adaptiveFormats: { url: string; bitrate?: number; type?: string; itag?: string }[];
  recommendedVideos?: InvidiousVideo[];
}

// ---- Instance pool ------------------------------------------------------------

export const BUILTIN_SOURCES: StreamSource[] = [
  { name: 'Invidious (f5.si)', baseUrl: 'https://invidious.f5.si', kind: 'invidious' },
  { name: 'Piped (private.coffee)', baseUrl: 'https://api.piped.private.coffee', kind: 'piped' },
  { name: 'Invidious (private.coffee)', baseUrl: 'https://invidious.private.coffee', kind: 'invidious' },
  { name: 'Invidious (yewtu.be)', baseUrl: 'https://yewtu.be', kind: 'invidious' },
];

const SOURCES_KEY = 'bitchord.sources';
const HEALTH_KEY = 'bitchord.sourceHealth';
const HEALTH_TTL_MS = 10 * 60 * 1000;

/**
 * Some instances bot-check unusual user agents. Browsers always send their
 * own User-Agent (fetch cannot override it — it is a forbidden header name),
 * which is the UA real users present, so requests from the app look exactly
 * like requests from a browser tab, which is what the instances want.
 */

export function loadSources(): StreamSource[] {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StreamSource[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* defaults below */
  }
  return [...BUILTIN_SOURCES];
}

export function saveSources(sources: StreamSource[]): void {
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
  } catch {
    /* private mode: session-only */
  }
}

type HealthMap = Record<string, { ok: boolean; at: number }>;

function loadHealth(): HealthMap {
  try {
    const raw = localStorage.getItem(HEALTH_KEY);
    if (raw) return JSON.parse(raw) as HealthMap;
  } catch {
    /* ignore */
  }
  return {};
}

function saveHealth(map: HealthMap): void {
  try {
    localStorage.setItem(HEALTH_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function recordHealth(baseUrl: string, ok: boolean): void {
  const map = loadHealth();
  map[baseUrl] = { ok, at: Date.now() };
  saveHealth(map);
}

function sourceIsHealthy(source: StreamSource): boolean {
  const entry = loadHealth()[source.baseUrl];
  if (!entry) return true; // unknown: worth a try
  if (Date.now() - entry.at > HEALTH_TTL_MS) return true; // stale: retry
  return entry.ok;
}

function orderedSources(): StreamSource[] {
  const sources = loadSources();
  const rank = (list: StreamSource[]): StreamSource[] => [
    ...list.filter(sourceIsHealthy),
    ...list.filter((src) => !sourceIsHealthy(src)),
  ];
  return [...rank(sources.filter((src) => src.custom)), ...rank(sources.filter((src) => !src.custom))];
}

// ---- Health check -------------------------------------------------------------

export async function checkSource(source: StreamSource): Promise<boolean> {
  const url =
    source.kind === 'piped'
      ? `${source.baseUrl}/search?q=test&filter=music_songs`
      : `${source.baseUrl}/api/v1/search?q=test&type=video`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(9000),
    });
    const ok = response.ok;
    recordHealth(source.baseUrl, ok);
    return ok;
  } catch {
    recordHealth(source.baseUrl, false);
    return false;
  }
}

// ---- Fetch plumbing -------------------------------------------------------------

interface Fetched<T> {
  data: T;
  source: string;
}

async function fetchFromPool<T>(
  build: (source: StreamSource) => { url: string; parse: (body: unknown) => T } | null,
): Promise<Fetched<T>> {
  const sources = orderedSources();
  let lastError: Error | null = null;
  for (const source of sources) {
    const spec = build(source);
    if (!spec) continue;
    try {
      const response = await fetch(spec.url, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = spec.parse(await response.json());
      recordHealth(source.baseUrl, true);
      return { data, source: source.name };
    } catch (e) {
      recordHealth(source.baseUrl, false);
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error('Every configured source failed');
}

export { fetchFromPool };

// ---- Stream resolution ----------------------------------------------------------

const prefersLowerBitrate = (): boolean => {
  try {
    const raw = localStorage.getItem('bitchord.settings');
    if (raw) return (JSON.parse(raw) as { dataSaver?: boolean }).dataSaver === true;
  } catch {
    /* ignore */
  }
  return false;
};

function pickInvidiousAudio(detail: InvidiousVideoDetail, source: StreamSource): StreamHandle | null {
  const audio = detail.adaptiveFormats
    .filter((f) => typeof f.type === 'string' && f.type.startsWith('audio'))
    .sort((x, y) => (y.bitrate ?? 0) - (x.bitrate ?? 0));
  if (audio.length === 0) return null;
  const handle = prefersLowerBitrate() ? audio[audio.length - 1] : audio[0];
  return { url: handle.url, codec: handle.type, bitrate: handle.bitrate, source: source.name };
}

function pickPipedAudio(detail: PipedStream, source: StreamSource): StreamHandle | null {
  const audio = [...(detail.audioStreams ?? [])].sort((x, y) => (y.bitrate ?? 0) - (x.bitrate ?? 0));
  if (audio.length === 0) return null;
  const handle = prefersLowerBitrate() ? audio[audio.length - 1] : audio[0];
  return { url: handle.url, codec: handle.mimeType, bitrate: handle.bitrate, source: source.name };
}

/**
 * Resolve an audio stream for [videoId], walking the source pool.
 * Throws when every configured source is down — the player surfaces that as
 * an error state rather than a silent skip.
 */
export async function resolveStream(videoId: string): Promise<StreamHandle> {
  const result = await fetchFromPool<StreamHandle>((source) => {
    if (source.kind === 'invidious') {
      return {
        url: `${source.baseUrl}/api/v1/videos/${videoId}`,
        parse: (body) => {
          const detail = body as InvidiousVideoDetail;
          const handle = pickInvidiousAudio(detail, source);
          if (!handle) throw new Error(`${source.name}: no audio streams`);
          return handle;
        },
      };
    }
    return {
      url: `${source.baseUrl}/streams/${videoId}`,
      parse: (body) => {
        const detail = body as PipedStream;
        if (detail.error) throw new Error(detail.error.slice(0, 120));
        const handle = pickPipedAudio(detail, source);
        if (!handle) throw new Error(`${source.name}: no audio streams`);
        return handle;
      },
    };
  });
  return result.data;
}

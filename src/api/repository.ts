/**
 * BitChord web — music repository.
 *
 * A full rewrite of the Android YtMusicRepository on top of the Piped /
 * Invidious pool (see sources.ts for why youtubei is out). Guest mode only:
 * likes, playlists and history live in localStorage (data/library.ts), the
 * way ytify keeps its library.
 */

import { fetchFromPool } from './sources';
// (fetch cannot set User-Agent — it is a forbidden header name; see sources.ts)
import type { InvidiousVideo, InvidiousVideoDetail, PipedSearchItem, PipedStream } from './sources';
import type { DetailPage, HomeShelf, ShelfItem, Song } from './models';

export type SearchFilterId = 'all' | 'songs' | 'videos' | 'albums' | 'artists' | 'playlists';

export const SEARCH_FILTERS: { id: SearchFilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
];

const PIPED_FILTER: Record<SearchFilterId, string> = {
  all: 'all',
  songs: 'music_songs',
  videos: 'videos',
  albums: 'music_albums',
  artists: 'music_artists',
  playlists: 'music_playlists',
};

const idFromUrl = (url: string): string | null => {
  const watch = url.match(/[?&]v=([^&]+)/);
  if (watch) return watch[1];
  const list = url.match(/[?&]list=([^&]+)/);
  if (list) return list[1];
  const channel = url.match(/channel\/(UC[^/?&]+)/);
  if (channel) return channel[1];
  return null;
};

function songFromPiped(item: PipedSearchItem): Song | null {
  const videoId = idFromUrl(item.url ?? '');
  if (!videoId || item.type !== 'stream') return null;
  const seconds = item.duration ?? item.durationSeconds ?? 0;
  const durationText =
    seconds > 0
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : null;
  return {
    videoId,
    title: item.title,
    artist: item.uploaderName ?? 'Unknown artist',
    thumbnailUrl: item.thumbnail,
    durationText,
    artistId: item.uploaderUrl ? idFromUrl(item.uploaderUrl) : null,
    isVideo: false,
    playlistId: null,
  };
}

// ---- Search -------------------------------------------------------------------

export interface SearchPage {
  rows: (Song | ShelfItem)[];
}

export async function fetchSearch(query: string, filter: SearchFilterId): Promise<SearchPage> {
  const pipedFilter = PIPED_FILTER[filter];
  const result = await fetchFromPool<SearchPage>((source) => {
    if (source.kind === 'piped') {
      return {
        url: `${source.baseUrl}/search?q=${encodeURIComponent(query)}&filter=${pipedFilter}`,
        parse: (body) => {
          const items = (body as { items?: PipedSearchItem[] }).items ?? [];
          const rows: (Song | ShelfItem)[] = [];
          for (const item of items) {
            if (item.type === 'stream') {
              const song = songFromPiped(item);
              if (song) rows.push(song);
            } else if (item.type === 'playlist' || item.type === 'channel') {
              const id = idFromUrl(item.url);
              if (!id) continue;
              rows.push({
                title: item.title,
                subtitle: item.uploaderName ?? '',
                thumbnailUrl: item.thumbnail,
                browseId: id,
                videoId: null,
                type: item.type === 'channel' ? 'ARTIST' : 'PLAYLIST',
              });
            }
          }
          return { rows };
        },
      };
    }
    // Invidious has no music filters; type=video is the closest for songs.
    return {
      url: `${source.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
      parse: (body) => {
        const videos = body as InvidiousVideo[];
        return {
          rows: videos
            .map((video): Song | null => ({
              videoId: video.videoId,
              title: video.title,
              artist: video.author,
              thumbnailUrl: video.videoThumbnails?.[video.videoThumbnails.length - 1]?.url ?? null,
              durationText: video.lengthSeconds
                ? `${Math.floor(video.lengthSeconds / 60)}:${String(video.lengthSeconds % 60).padStart(2, '0')}`
                : null,
              artistId: video.authorId,
              isVideo: false,
              playlistId: null,
            }))
            .filter((s): s is Song => s !== null),
        };
      },
    };
  });
  return result.data;
}

export async function fetchSuggestions(input: string): Promise<string[]> {
  try {
    const result = await fetchFromPool<string[]>((source) =>
      source.kind === 'piped'
        ? {
            url: `${source.baseUrl}/suggestions?query=${encodeURIComponent(input)}`,
            parse: (body) => (Array.isArray(body) ? (body as string[]) : []),
          }
        : null,
    );
    return result.data;
  } catch {
    return [];
  }
}

// ---- Home ----------------------------------------------------------------------

/**
 * The Home feed. Piped's trending endpoint answers even for music=true with
 * the general feed (verified: boat racing and esports), so the feed is built
 * from chart searches instead — the same idea as the app's chart shelves,
 * via real music-filtered results.
 */
const HOME_SEEDS: { shelf: string; query: string }[] = [
  { shelf: 'Trending songs', query: 'top songs this week' },
  { shelf: 'J-Pop hits', query: 'j-pop hits' },
  { shelf: 'Pop hits', query: 'pop hits' },
  { shelf: 'Chill & lo-fi', query: 'lofi chill beats' },
];

export async function fetchHome(): Promise<HomeShelf[]> {
  const shelves = await Promise.all(
    HOME_SEEDS.map(async (seed): Promise<HomeShelf | null> => {
      try {
        const page = await fetchSearch(seed.query, 'songs');
        const songs = page.rows.filter(
          (row): row is Song => 'videoId' in row && row.videoId !== null,
        );
        if (songs.length < 4) return null;
        return { title: seed.shelf, items: songs.map(songToShelf) };
      } catch {
        return null;
      }
    }),
  );
  return shelves.filter((shelf): shelf is HomeShelf => shelf !== null);
}

function songToShelf(song: Song): ShelfItem {
  return {
    title: song.title,
    subtitle: song.artist,
    thumbnailUrl: song.thumbnailUrl,
    videoId: song.videoId,
    browseId: null,
  };
}

/** Explore offers genre entry points that resolve to chart searches. */
export interface MoodGenre {
  title: string;
  browseId: string;
  params: string | null;
}

export async function fetchMoodAndGenres(): Promise<MoodGenre[]> {
  const GENRES = [
    'Pop', 'Hip-hop', 'Rock', 'J-Pop', 'K-Pop', 'Dance',
    'Ambient', 'Jazz', 'Lo-fi', 'Classical', 'R&B', 'Metal',
  ];
  return GENRES.map((title) => ({ title, browseId: `search:${title}`, params: null }));
}

export async function fetchMoodGenreShelves(browseId: string): Promise<HomeShelf[]> {
  const query = browseId.startsWith('search:') ? browseId.slice(7) : browseId;
  const page = await fetchSearch(query, 'songs');
  return [
    {
      title: query,
      items: page.rows
        .filter((row): row is Song => 'videoId' in row && row.videoId !== null)
        .map(songToShelf),
    },
  ];
}

// ---- Detail pages -------------------------------------------------------------------

export async function fetchDetail(browseId: string): Promise<DetailPage> {
  // Playlist / album ids (VL…, PL…, OLAK5uy…, RD… mixes).
  if (/^(VL|PL|OLAK5uy|RD|RDMM|RDAMVM)/.test(browseId)) {
    const playlistId = browseId.replace(/^VL/, '');
    const result = await fetchFromPool<{ title: string; songs: Song[]; thumb: string | null }>((source) => {
      if (source.kind === 'piped') {
        return {
          url: `${source.baseUrl}/playlists/${playlistId}`,
          parse: (body) => {
            const data = body as {
              name?: string;
              thumbnailUrl?: string;
              relatedStreams?: PipedSearchItem[];
            };
            return {
              title: data.name ?? 'Playlist',
              thumb: data.thumbnailUrl ?? null,
              songs: (data.relatedStreams ?? [])
                .map(songFromPiped)
                .filter((s): s is Song => s !== null),
            };
          },
        };
      }
      return {
        url: `${source.baseUrl}/api/v1/playlists/${playlistId}`,
        parse: (body) => {
          const data = body as {
            title?: string;
            videos?: { videoId: string; title: string; author: string; lengthSeconds: number; videoThumbnails?: { url: string }[] }[];
          };
          return {
            title: data.title ?? 'Playlist',
            thumb: data.videos?.[0]?.videoThumbnails?.[0]?.url ?? null,
            songs: (data.videos ?? []).map((video) => ({
              videoId: video.videoId,
              title: video.title,
              artist: video.author,
              thumbnailUrl: video.videoThumbnails?.[0]?.url ?? null,
              durationText: video.lengthSeconds
                ? `${Math.floor(video.lengthSeconds / 60)}:${String(video.lengthSeconds % 60).padStart(2, '0')}`
                : null,
              isVideo: false,
              playlistId,
            })),
          };
        },
      };
    });
    return {
      browseId,
      title: result.data.title,
      subtitle: 'Playlist',
      thumbnailUrl: result.data.thumb,
      type: 'PLAYLIST',
      songs: result.data.songs,
      playlistId,
    };
  }

  // Artist channels.
  if (browseId.startsWith('UC')) {
    const result = await fetchFromPool<{ title: string; thumb: string | null; songs: Song[] }>((source) => {
      if (source.kind === 'invidious') {
        return {
          url: `${source.baseUrl}/api/v1/channels/${browseId}/videos`,
          parse: (body) => {
            const videos = (body as { videos?: InvidiousVideo[] }).videos ?? [];
            return {
              title: videos[0]?.author ?? 'Artist',
              thumb: videos[0]?.videoThumbnails?.[0]?.url ?? null,
              songs: videos.map((video) => ({
                videoId: video.videoId,
                title: video.title,
                artist: video.author,
                thumbnailUrl: video.videoThumbnails?.[0]?.url ?? null,
                durationText: video.lengthSeconds
                  ? `${Math.floor(video.lengthSeconds / 60)}:${String(video.lengthSeconds % 60).padStart(2, '0')}`
                  : null,
                isVideo: false,
                playlistId: null,
              })),
            };
          },
        };
      }
      return null;
    });
    return {
      browseId,
      title: result.data.title,
      subtitle: 'Artist',
      thumbnailUrl: result.data.thumb,
      type: 'ARTIST',
      songs: result.data.songs,
      channelId: browseId,
    };
  }

  throw new Error(`Unsupported page: ${browseId}`);
}

// ---- Radio / related -----------------------------------------------------------------

/** The mix / related tracks a seed would queue into, for AutoPlay. */
export async function fetchRadio(videoId: string): Promise<Song[]> {
  try {
    const result = await fetchFromPool<Song[]>((source) => {
      if (source.kind === 'piped') {
        return {
          url: `${source.baseUrl}/streams/${videoId}`,
          parse: (body) => {
            const data = body as PipedStream;
            if (data.error) return [];
            return (data.relatedStreams ?? [])
              .map(songFromPiped)
              .filter((s): s is Song => s !== null);
          },
        };
      }
      return {
        url: `${source.baseUrl}/api/v1/videos/${videoId}`,
        parse: (body) => {
          const data = body as InvidiousVideoDetail;
          return (data.recommendedVideos ?? []).map(
            (video): Song => ({
              videoId: video.videoId,
              title: video.title,
              artist: video.author,
              thumbnailUrl: null,
              isVideo: false,
              playlistId: null,
            }),
          );
        },
      };
    });
    return result.data;
  } catch {
    return [];
  }
}

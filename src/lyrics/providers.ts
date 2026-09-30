/**
 * BitChord web — lyric providers.
 *
 * A port of the Android app's provider chain, trimmed to what a browser page
 * can actually reach. Every host here answered `Access-Control-Allow-Origin: *`
 * in testing (2026-09); the ones that did not are not here.
 *
 * The chain mirrors LyricsSource.kt's order where it can:
 *
 *  1. BiniLyrics — Apple TTML matched on the recording (ISRC-aware).
 *  2. BetterLyrics — Apple TTML by title/artist, no lookups.
 *  3. PaxSenix — the app's keyless Apple route through its public proxy,
 *     searched via the iTunes API because the proxy has no search endpoint.
 *  4. LRCLIB — `/api/search` fuzzy, then `/api/get` exact, synced then plain.
 *
 * The title is cleaned the way LyricsQuery.kt does before any of them are
 * asked: credits like "(feat. …)" come off, "(Remix)"/"(Live)" stay on —
 * stripping those turns a search for one recording into a search for another.
 */

import type { Song } from '../api/models';
import { durationMillis } from '../api/models';
import { makeLine, parseLrc, withInstrumentalGaps } from './lyrics';
import type { Lyrics, LyricLine, LyricWord } from './lyrics';

// ---- query cleaning (LyricsQuery.kt) ---------------------------------------

const CREDITS: RegExp[] = [
  /\s*[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/gi,
  /\s+(feat|ft|featuring)\.?\s+.*$/gi,
  /\s*[([]\s*(official\s*)?(music\s*)?(video|audio|visuali[sz]er|lyrics?\s*video|lyrics?|m\/?v|hd|hq|4k|full\s*song)\s*[)\]]/gi,
  /\s*[([]\s*official\s*[)\]]/gi,
];

/** A YouTube title, as a lyrics database would have indexed it. */
export function forLyricsSearch(title: string): string {
  let name = title;
  for (const pattern of CREDITS) name = name.replace(pattern, ' ');
  return name
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,–—-]+$/, '')
    .trim()
    .trim();
}

/** Trims " - Topic" off YouTube's auto-generated artist channels. */
export function artistForLyricsSearch(artist: string): string {
  return artist.replace(/ - Topic$/, '').trim() || artist.trim();
}

// ---- plumbing ----------------------------------------------------------------

const TIMEOUT_MS = 9_000;

async function getText(url: string, timeoutMs = TIMEOUT_MS): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown | null> {
  const text = await getText(url, timeoutMs);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface Candidate {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
}

const MIN_MATCH_SCORE = 10;

/** Title/artist/duration scoring, ported from PaxSenix.kt. */
function scoreCandidate(candidate: Candidate, title: string, artist: string, durationMs: number): number {
  let score = textScore(candidate.title, title, 20, 10) + textScore(candidate.artist, artist, 15, 5);
  if (durationMs > 0 && candidate.durationMs > 0) {
    const distance = Math.abs(candidate.durationMs - durationMs);
    if (distance < 3_000) score += 10;
    else if (distance < 10_000) score += 5;
  }
  return score;
}

function textScore(candidate: string, wanted: string, exact: number, partial: number): number {
  if (!candidate || !wanted) return 0;
  const a = candidate.toLowerCase();
  const b = wanted.toLowerCase();
  if (a === b) return exact;
  if (a.includes(b) || b.includes(a)) return partial;
  return 0;
}

function bestCandidate(
  candidates: Candidate[],
  title: string,
  artist: string,
  durationMs: number,
): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, title, artist, durationMs);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= MIN_MATCH_SCORE ? best : null;
}

// ---- TTML parsing (TtmlLyrics.kt) -----------------------------------------------

const SKIPPED_ROLES = new Set(['x-translation', 'x-roman']);
const BACKGROUND_ROLE = 'x-bg';

interface Piece {
  text: string;
  start: number | null;
  end: number | null;
}

/** TTML clock values: `27.395`, `1:05.20`, `1:02:03.4`, `1200ms`. */
export function ttmlTime(value: string | null | undefined): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.endsWith('ms')) {
    const n = parseFloat(raw.slice(0, -2));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  const stripped = raw.endsWith('s') ? raw.slice(0, -1) : raw;
  const parts = stripped.split(':');
  const numbers = parts.map((p) => parseFloat(p));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  let seconds = 0;
  if (numbers.length === 1) seconds = numbers[0];
  else if (numbers.length === 2) seconds = numbers[0] * 60 + numbers[1];
  else if (numbers.length === 3) seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  else return null;
  return Math.round(seconds * 1000);
}

interface ParsedLine {
  line: LyricLine;
  agent: string | null;
}

/** Parses Apple Music TTML into word-timed lines, duet alignment included. */
export function parseTtml(ttml: string): LyricLine[] {
  try {
    // `globalThis` keeps node-based verification working (a shim installed
    // there) while browsers use the native parser.
    const parser = (globalThis as { DOMParser?: new () => { parseFromString(s: string, type: string): XMLDocument } }).DOMParser;
    if (!parser) return [];
    const doc = new parser().parseFromString(ttml, 'text/xml');
    const errors = doc.getElementsByTagName('parsererror');
    if (errors && errors.length > 0) return [];
    const paragraphs = Array.from(doc.getElementsByTagName('p')) as Element[];
    const agentTypes = readAgentTypes(doc);

    const sung: ParsedLine[] = [];
    for (const p of paragraphs) {
      const parsed = lineFrom(p);
      if (!parsed) continue;
      const agent = attr(p, 'ttm:agent') || null;
      sung.push({ line: parsed, agent });
    }
    sung.sort((a, b) => a.line.at - b.line.at);

    const sides = lineAlignments(
      sung.map((entry) => entry.agent),
      agentTypes,
    );
    return withInstrumentalGaps(sung.map((entry, i) => ({ ...entry.line, alignment: sides[i] })));
  } catch {
    return [];
  }
}

function readAgentTypes(doc: XMLDocument): Map<string, string> {
  const types = new Map<string, string>();
  let agents: Element[] = [];
  try {
    agents = Array.from(doc.getElementsByTagName('ttm:agent'));
    if (agents.length === 0) agents = Array.from(doc.getElementsByTagName('agent'));
  } catch {
    /* shim: no agent metadata */
  }
  for (const agent of agents) {
    const id = attr(agent, 'xml:id');
    const type = agent.getAttribute('type');
    if (id && type) types.set(id, type);
  }
  return types;
}

/**
 * Reads a prefixed attribute (`ttm:agent`, `xml:id`, `ttm:role`) across XML
 * spellings — namespaced, bare-local-name, or lowercased, depending on how the
 * document declared things.
 */
function attr(el: Element, name: string): string {
  const direct = el.getAttribute(name);
  if (direct) return direct;
  const local = name.slice(name.indexOf(':') + 1);
  for (const candidate of [name, local, local.toLowerCase()]) {
    const value = el.getAttribute(candidate);
    if (value) return value;
  }
  for (const attribute of Array.from(el.attributes)) {
    if (
      attribute.name === name ||
      attribute.name === local ||
      attribute.name.toLowerCase() === local.toLowerCase()
    ) {
      return attribute.value;
    }
  }
  return '';
}

function hasTimedChild(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (child.getAttribute('begin') !== '' || hasTimedChild(child)) return true;
  }
  return false;
}

interface Collected {
  out: Piece[];
  backing: Piece[];
}

function collect(node: Element, sink: Collected, inBacking: boolean): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1) {
      const el = child as Element;
      const role = attr(el, 'ttm:role');
      if (SKIPPED_ROLES.has(role)) continue;
      const toBacking = inBacking || role === BACKGROUND_ROLE;
      const begin = ttmlTime(el.getAttribute('begin'));
      const end = ttmlTime(el.getAttribute('end'));
      if (begin !== null && end !== null && !hasTimedChild(el)) {
        const piece: Piece = { text: el.textContent ?? '', start: begin, end };
        (toBacking ? sink.backing : sink.out).push(piece);
      } else {
        collect(el, sink, toBacking);
      }
    } else if (child.nodeType === 3) {
      const text = child.textContent ?? '';
      if (text) sink.out.push({ text, start: null, end: null });
    }
  }
}

/** Glues syllables back into words: a word ends at the first whitespace after it. */
function mergeIntoWords(pieces: Piece[]): LyricWord[] {
  const words: LyricWord[] = [];
  let current = '';
  let start = 0;
  let end = 0;
  let timed = false;

  const flush = () => {
    const text = current.trim();
    current = '';
    if (text && timed) words.push({ startMs: start, endMs: Math.max(end, start), text });
    timed = false;
  };

  for (const piece of pieces) {
    if (piece.start === null) {
      if (!piece.text.trim()) flush();
      else if (timed) current += piece.text;
      continue;
    }
    if (!piece.text.trim()) continue;
    if (/\s/.test(piece.text[0])) flush();
    if (!current) start = piece.start;
    current += piece.text.trim();
    end = piece.end ?? piece.start;
    timed = true;
    if (/\s/.test(piece.text[piece.text.length - 1])) flush();
  }
  flush();
  return words;
}

function lineFrom(p: Element): LyricLine | null {
  const sink: Collected = { out: [], backing: [] };
  collect(p, sink, false);
  const words = mergeIntoWords(sink.out);
  const backingWords = mergeIntoWords(sink.backing);
  const background =
    backingWords.length > 0
      ? makeLine(backingWords[0].startMs, backingWords.map((w) => w.text).join(' '), {
          words: backingWords,
        })
      : null;

  if (words.length === 0) {
    // Line-synced TTML: a <p> with a stamp and bare text, no spans.
    const text = (p.textContent ?? '').trim();
    const begin = ttmlTime(p.getAttribute('begin'));
    if (begin === null || !text) return null;
    const end = ttmlTime(p.getAttribute('end'));
    return makeLine(begin, text, { until: end !== null && end > begin ? end : null });
  }

  const begin = ttmlTime(p.getAttribute('begin')) ?? words[0].startMs;
  return makeLine(Math.min(begin, words[0].startMs), words.map((w) => w.text).join(' '), {
    words,
    background,
  });
}

/**
 * Duet sides, ported from TtmlLyrics.lineAlignments: with two distinct voices
 * the minority one reads as the answering vocal and sits on the right.
 */
function lineAlignments(agents: (string | null)[], types: Map<string, string>): Array<'start' | 'end'> {
  const distinct = new Set(
    agents.filter((a): a is string => a !== null).map((a) => `${a}:${types.get(a) ?? '?'}`),
  );
  if (agents.every((a) => a === null) || distinct.size < 2) {
    return agents.map(() => 'start' as const);
  }
  const counts = new Map<string | null, number>();
  for (const agent of agents) counts.set(agent, (counts.get(agent) ?? 0) + 1);
  const [first, second] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const minority = second ? second[0] : null;
  return agents.map((agent) => (agent !== null && agent === minority ? 'end' : 'start'));
}

/**
 * Turns whatever a provider returned into lyrics: TTML (raw or JSON-wrapped),
 * structured karaoke JSON, LRC, or finally plain text.
 */
export function parseProviderResponse(raw: string): LyricLine[] | null {
  const trimmed = raw.replace(/\uFEFF/g, '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('<')) {
    if (/<(tt(\s|>)|tt:tt)/i.test(trimmed) || trimmed.includes('http://www.w3.org/ns/ttml')) {
      const lines = parseTtml(trimmed);
      return lines.length > 0 ? lines : null;
    }
    return null;
  }
  // Structured karaoke JSON (PaxSenix's Apple payload and friends), read off
  // the raw string — unwrapping first would flatten {timestamp,text[]} rows
  // into a plain-text join and lose every timing.
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const structured = parseStructured(trimmed);
    if (structured && structured.length > 0) return withInstrumentalGaps(structured);
  }
  const content = unwrapProvider(raw);
  if (!content) return null;
  const unwrapped = content.trim();
  if (unwrapped.startsWith('<')) {
    if (/<(tt(\s|>)|tt:tt)/i.test(unwrapped) || unwrapped.includes('http://www.w3.org/ns/ttml')) {
      const lines = parseTtml(unwrapped);
      return lines.length > 0 ? lines : null;
    }
    return null;
  }
  if (/\[\d{1,2}:\d{2}/.test(unwrapped)) {
    const lines = parseLrc(unwrapped);
    if (lines.length > 0) return withInstrumentalGaps(lines);
  }
  return plainLines(unwrapped);
}

/** The structured `{timestamp, text[]}[]` karaoke payload PaxSenix can return. */
function parseStructured(raw: string): LyricLine[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const rows = findTimedRows(data);
  if (!rows) return null;
  const lines: LyricLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { timestamp?: unknown; text?: unknown };
    const start = typeof row.timestamp === 'number' ? row.timestamp : null;
    if (start === null || !Array.isArray(row.text)) continue;
    const texts = row.text
      .map((word) => (typeof (word as { text?: unknown })?.text === 'string' ? ((word as { text: string }).text).trim() : null))
      .filter((t): t is string => t !== null && t.length > 0);
    if (texts.length === 0) continue;
    const nextRow = rows[i + 1] as { timestamp?: unknown } | undefined;
    const nextAt = typeof nextRow?.timestamp === 'number' ? nextRow.timestamp : null;
    const words: LyricWord[] = [];
    for (let w = 0; w < row.text.length; w++) {
      const entry = row.text[w] as { timestamp?: unknown; text?: unknown };
      const text = typeof entry?.text === 'string' ? entry.text.trim() : null;
      const wordStart = typeof entry?.timestamp === 'number' ? entry.timestamp : null;
      if (!text || wordStart === null) continue;
      const nextEntry = row.text[w + 1] as { timestamp?: unknown } | undefined;
      const nextWord = typeof nextEntry?.timestamp === 'number' ? nextEntry.timestamp : nextAt;
      const end = nextWord ?? wordStart + 800;
      words.push({ startMs: wordStart, endMs: Math.max(end, wordStart), text });
    }
    lines.push(
      makeLine(Math.min(start, words[0]?.startMs ?? start), texts.join(' '), {
        words,
        until: nextAt,
      }),
    );
  }
  return lines.some((line) => line.text.trim().length > 0) ? lines : null;
}

function findTimedRows(data: unknown): unknown[] | null {
  if (Array.isArray(data)) {
    if (data.some((row) => row && typeof row === 'object' && 'timestamp' in (row as object))) return data;
    for (const entry of data) {
      const found = findTimedRows(entry);
      if (found) return found;
    }
    return null;
  }
  if (data && typeof data === 'object') {
    for (const value of Object.values(data as Record<string, unknown>)) {
      const found = findTimedRows(value);
      if (found) return found;
    }
  }
  return null;
}

/** Unwraps the JSON envelopes and code fences small providers add. */
function unwrapProvider(raw: string): string | null {
  let value = raw.replace(/\uFEFF/g, '').trim();
  if (value.startsWith('```')) {
    const rows = value.split(/\r?\n/).slice(1);
    if (rows[rows.length - 1]?.trim() === '```') rows.pop();
    value = rows.join('\n').trim();
  }
  if (!value) return null;
  if (!value.startsWith('{') && !value.startsWith('[')) return value;
  return extractText(JSON.parse(value));
}

function extractText(element: unknown): string | null {
  if (element === null || element === undefined) return null;
  if (typeof element === 'string') {
    const text = element.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return extractText(JSON.parse(text));
      } catch {
        return text;
      }
    }
    return text;
  }
  if (typeof element === 'number') return null;
  if (Array.isArray(element)) {
    return element.map(extractText).filter((t): t is string => t !== null).join('\n') || null;
  }
  if (typeof element === 'object') {
    const obj = element as Record<string, unknown>;
    if (obj.isError === true || obj.error === true) return null;
    for (const key of ['ttml', 'ttmlContent', 'lyrics', 'lrc', 'content', 'text', 'plainLyrics', 'syncedLyrics', 'line', 'lines', 'lyric', 'data', 'result', 'response']) {
      if (key in obj) {
        const found = extractText(obj[key]);
        if (found) return found;
      }
    }
    if (obj.metadata) return extractText(obj.metadata);
    if (obj.words) return extractText(obj.words);
  }
  return null;
}

function plainLines(content: string): LyricLine[] | null {
  if (/lyrics? (not found|unavailable)|\berror\b/i.test(content)) return null;
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^\[[a-z]+:.*]$/.test(line))
    .map((text) => makeLine(0, text));
  return lines.length > 0 ? lines : null;
}

// ---- BiniLyrics -----------------------------------------------------------

interface BiniHit {
  track_name?: string;
  artist_name?: string;
  album_name?: string;
  duration?: number;
  isrc?: string;
  timing_type?: string;
  lyricsUrl?: string;
}

async function fromBiniLyrics(song: Song, durationMs: number): Promise<Lyrics | null> {
  const title = forLyricsSearch(song.title);
  const artist = artistForLyricsSearch(song.artist);
  const params = new URLSearchParams({ track: title, artist });
  if (song.albumName) params.set('album', song.albumName);
  const seconds = Math.floor(durationMs / 1000);
  if (seconds > 0) params.set('duration', String(seconds));
  const data = (await getJson(`https://lyrics-api.binimum.org/?${params.toString()}`)) as
    | { results?: BiniHit[] }
    | null;
  const hit = data?.results?.[0];
  const url = hit?.lyricsUrl;
  if (!url) return null;
  const ttml = await getText(url);
  if (!ttml) return null;
  const lines = parseTtml(ttml);
  if (lines.length === 0) return null;
  return { synced: true, lines, provider: 'BiniLyrics', wordSynced: true };
}

// ---- BetterLyrics ---------------------------------------------------------

async function fromBetterLyrics(song: Song, durationMs: number): Promise<Lyrics | null> {
  const title = forLyricsSearch(song.title);
  const artist = artistForLyricsSearch(song.artist);
  const params = new URLSearchParams({ s: title, a: artist });
  const seconds = Math.floor(durationMs / 1000);
  if (seconds > 0) params.set('d', String(seconds));
  if (song.albumName) params.set('al', song.albumName);
  const raw = await getText(`https://lyrics-api.boidu.dev/getLyrics?${params.toString()}`);
  if (!raw) return null;
  const lines = parseProviderResponse(raw);
  if (!lines) return null;
  const wordSynced = lines.some((line) => line.words.length > 0);
  return { synced: true, lines, provider: 'BetterLyrics', wordSynced };
}

// ---- PaxSenix -----------------------------------------------------------------

const PAXSENIX_PROXY = 'https://lyrics.paxsenix.org';
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

interface ItunesResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  trackTimeMillis?: number;
}

interface ItunesHit {
  candidates: Candidate[];
}

async function itunesSearch(params: URLSearchParams): Promise<Candidate[]> {
  const data = (await getJson(`${ITUNES_SEARCH}?${params.toString()}`)) as
    | { results?: ItunesResult[] }
    | null;
  return (data?.results ?? [])
    .filter((r) => typeof r.trackId === 'number' && typeof r.trackName === 'string')
    .map((r) => ({
      id: String(r.trackId),
      title: r.trackName ?? '',
      artist: r.artistName ?? '',
      durationMs: typeof r.trackTimeMillis === 'number' ? r.trackTimeMillis : 0,
    }));
}

/** The app's keyless PaxSenix route: Apple catalogue id, then its TTML. */
async function fromPaxSenix(song: Song, durationMs: number): Promise<Lyrics | null> {
  const title = forLyricsSearch(song.title);
  const artist = artistForLyricsSearch(song.artist);

  // The proxy exposes no search, so the track id comes from the iTunes API —
  // the same Apple catalogue, reachable from a page (ACAO:* verified). Three
  // passes, cheapest checks first: title+artist, the JP storefront (much of
  // the Japanese catalogue only answers there), then title alone — the
  // duration in the scoring keeps a title-only match honest.
  let candidates: Candidate[] = await itunesSearch(
    new URLSearchParams({ term: `${title} ${artist}`.trim(), entity: 'song', limit: '10' }),
  );
  let candidate = bestCandidate(candidates, title, artist, durationMs);
  if (!candidate) {
    candidates = await itunesSearch(
      new URLSearchParams({ term: `${title} ${artist}`.trim(), entity: 'song', limit: '10', country: 'JP' }),
    );
    candidate = bestCandidate(candidates, title, artist, durationMs);
  }
  if (!candidate) {
    candidates = await itunesSearch(
      new URLSearchParams({ term: title, entity: 'song', limit: '10' }),
    );
    candidate = bestCandidate(candidates, title, artist, durationMs);
  }
  if (!candidate) return null;

  const raw = await getText(
    `${PAXSENIX_PROXY}/apple-music/lyrics?id=${encodeURIComponent(candidate.id)}&ttml=true`,
    15_000,
  );
  if (!raw) return null;
  const lines = parseProviderResponse(raw);
  if (!lines) return null;
  const wordSynced = lines.some((line) => line.words.length > 0);
  return { synced: true, lines, provider: 'PaxSenix', wordSynced };
}

// ---- LRCLIB -----------------------------------------------------------------

async function lrclibLines(
  params: URLSearchParams,
  provider: string,
): Promise<Lyrics | null> {
  const data = (await getJson(`https://lrclib.net/api/get?${params.toString()}`)) as
    | { syncedLyrics?: unknown; plainLyrics?: unknown }
    | null;
  if (!data) return null;
  const synced = typeof data.syncedLyrics === 'string' ? data.syncedLyrics : null;
  if (synced) {
    const lines = parseLrc(synced);
    if (lines.length > 0) return { synced: true, lines: withInstrumentalGaps(lines), provider };
  }
  const plain = typeof data.plainLyrics === 'string' ? data.plainLyrics : null;
  if (plain) {
    const lines = plain
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text) => makeLine(0, text));
    if (lines.length > 0) return { synced: false, lines, provider };
  }
  return null;
}

async function fromLrclib(song: Song, durationMs: number): Promise<Lyrics | null> {
  const title = forLyricsSearch(song.title);
  const artist = artistForLyricsSearch(song.artist);
  const seconds = Math.max(0, Math.round(durationMs / 1000));

  // Fuzzy search first: YouTube titles rarely match the catalogued name.
  const searchWith = (term: string) =>
    getJson(`https://lrclib.net/api/search?${new URLSearchParams({ q: term }).toString()}`) as Promise<
      Array<{
        trackName?: string;
        artistName?: string;
        duration?: number;
        instrumental?: boolean;
        plainLyrics?: string | null;
        syncedLyrics?: string | null;
      }> | null
    >;
  let results = await searchWith(`${title} ${artist}`.trim());
  if (!Array.isArray(results) || results.length === 0) {
    // YouTube's artist string sometimes disagrees with the catalogue's;
    // the title alone still finds the song, and duration scoring arbitrates.
    results = await searchWith(title);
  }
  if (Array.isArray(results)) {
    const scored = results
      .filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
      .map((r) => ({
        hit: r,
        score: scoreCandidate(
          {
            id: '',
            title: r.trackName ?? '',
            artist: r.artistName ?? '',
            durationMs: typeof r.duration === 'number' ? r.duration * 1000 : 0,
          },
          title,
          artist,
          durationMs,
        ),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score >= MIN_MATCH_SCORE) {
      const synced = best.hit.syncedLyrics ?? null;
      if (synced) {
        const lines = parseLrc(synced);
        if (lines.length > 0) {
          return { synced: true, lines: withInstrumentalGaps(lines), provider: 'LRCLIB' };
        }
      }
      const plain = best.hit.plainLyrics ?? null;
      if (plain) {
        const lines = plain
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((text) => makeLine(0, text));
        if (lines.length > 0) return { synced: false, lines, provider: 'LRCLIB' };
      }
    }
  }

  // Exact /api/get as the fallback.
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (song.albumName) params.set('album_name', song.albumName);
  if (seconds > 0) params.set('duration', String(seconds));
  return lrclibLines(params, 'LRCLIB');
}

// ---- entry point ---------------------------------------------------------------

export async function fetchLyrics(song: Song, durationMs: number): Promise<Lyrics | null> {
  const total = durationMs || durationMillis(song.durationText);
  const chain = [fromBiniLyrics, fromBetterLyrics, fromPaxSenix, fromLrclib];
  for (const provider of chain) {
    try {
      const lyrics = await provider(song, total);
      if (lyrics && lyrics.lines.some((line) => line.text.trim().length > 0)) return lyrics;
    } catch {
      /* next provider */
    }
  }
  return null;
}

/**
 * BitChord web — the lyric data model and its reader.
 *
 * Ported from the app's LyricLine.kt: word timing, the sung end of a line,
 * instrumental-gap markers, and the three moves of Apple's karaoke — the sweep
 * that reveals text as it is sung, the lift that makes sung words rise, and
 * the fade that dims sung words back to ink.
 */

// ---- model -----------------------------------------------------------------

export interface LyricWord {
  startMs: number;
  endMs: number;
  text: string;
}

/** Which side of the panel a line is sung from — a duet reads as two people. */
export type LyricAlignment = 'start' | 'end';

export interface LyricLine {
  /** When the line starts, in milliseconds. */
  at: number;
  text: string;
  /** Per-word timing; empty on line-synced providers. */
  words: LyricWord[];
  /** The line's own end where a provider states one. */
  until: number | null;
  /** The answering vocal, drawn under the lead on its own clock. */
  background: LyricLine | null;
  alignment: LyricAlignment;
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
  provider: string;
  /** True when the timings are word-level (Apple TTML and friends). */
  wordSynced?: boolean;
}

export function makeLine(at: number, text: string, extra: Partial<LyricLine> = {}): LyricLine {
  return {
    at,
    text,
    words: [],
    until: null,
    background: null,
    alignment: 'start',
    ...extra,
  };
}

// ---- reader ----------------------------------------------------------------

const RISE_MS = 700;

function smooth(f: number): number {
  return f * f * (3 - 2 * f);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function isGap(line: LyricLine): boolean {
  return line.text.length === 0;
}

/** True when the line carries word-level timing. */
export function isWordSynced(line: LyricLine): boolean {
  return line.words.length > 0;
}

export function hasKnownEnd(line: LyricLine): boolean {
  return line.words.length > 0 || line.until !== null;
}

export function lineEnd(line: LyricLine): number {
  const lead = line.words.length > 0 ? line.words[line.words.length - 1].endMs : line.until ?? line.at;
  const bg = line.background ? lineEnd(line.background) : lead;
  return Math.max(lead, bg);
}

/**
 * Where each of the line's words sits in `text`, as [start, end) pairs.
 * Walked forward from the last match, so a word repeated in the line lines up
 * with its own occurrence.
 */
export function wordSpans(line: LyricLine): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let offset = 0;
  for (const word of line.words) {
    const found = line.text.indexOf(word.text, offset);
    const start = found >= 0 ? found : offset;
    spans.push([start, start + word.text.length]);
    offset = start + word.text.length;
  }
  return spans;
}

/** Whether anything on this line is off the floor at [positionMs]. */
export function isLifted(line: LyricLine, positionMs: number): boolean {
  const first = line.words[0];
  if (!first) return false;
  if (positionMs <= first.startMs) return false;
  return positionMs < lineEnd(line) + RISE_MS;
}

/**
 * How far the word covering [positionMs] has lifted, 0..1. Up from the word's
 * own start and down after its own end, so a held note rises further than
 * patter.
 */
export function wordLift(line: LyricLine, index: number, positionMs: number): number {
  const word = line.words[index];
  if (!word) return 0;
  const rising = clamp01((positionMs - word.startMs) / RISE_MS);
  const falling = clamp01(1 - (positionMs - word.endMs) / RISE_MS);
  return smooth(Math.min(rising, falling));
}

/**
 * How far through the line the singing has got, 0..1, as a fraction of
 * `text.length`. Within a word it interpolates across that word's own span
 * (held note = slow draw), and the whitespace between two words fills over the
 * pause between them, so the highlight creeps instead of resting.
 */
export function revealedFraction(line: LyricLine, positionMs: number): number {
  if (line.text.length === 0) return 0;
  if (line.words.length === 0) return positionMs >= line.at ? 1 : 0;
  const spans = wordSpans(line);
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i];
    const [start, end] = spans[i];
    if (positionMs < word.startMs) return start / line.text.length;
    if (positionMs < word.endMs) {
      const span = Math.max(1, word.endMs - word.startMs);
      const through = (positionMs - word.startMs) / span;
      return (start + through * word.text.length) / line.text.length;
    }
    const next = line.words[i + 1];
    if (next && positionMs < next.startMs) {
      const gapStart = spans[i + 1] ? spans[i + 1][0] : end;
      const pause = Math.max(1, next.startMs - word.endMs);
      const through = clamp01((positionMs - word.endMs) / pause);
      return (end + through * (gapStart - end)) / line.text.length;
    }
  }
  return 1;
}

/** Line index active at [positionMs], or -1 before the first line. */
export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].at <= positionMs) index = i;
    else break;
  }
  return index;
}

const MIN_GAP_MS = 2_000;

/**
 * Inserts blank lines where the singing stops for a while, so the reader can
 * show "· · ·" and the sweep never stalls mid-line during an interlude.
 * Ported from LyricGaps.kt.
 */
export function withInstrumentalGaps(lines: LyricLine[]): LyricLine[] {
  if (lines.length === 0) return lines;
  const out: LyricLine[] = [];
  if (lines[0].at >= MIN_GAP_MS) out.push(makeLine(0, ''));
  lines.forEach((line, index) => {
    out.push(line);
    const next = lines[index + 1];
    if (!next || !hasKnownEnd(line)) return;
    const silence = next.at - lineEnd(line);
    if (silence >= MIN_GAP_MS && lineEnd(line) > line.at) out.push(makeLine(lineEnd(line), ''));
  });
  return out;
}

// ---- LRC parsing -----------------------------------------------------------

/** `[mm:ss.xx]` / `[mm:ss.xxx]` timestamps, several per line allowed. */
const LRC_TIME = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?]/g;
/** Enhanced LRC word stamp `<mm:ss.xx>` inside a line. */
const LRC_WORD = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;

export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(LRC_TIME)];
    if (stamps.length === 0) continue;
    const rest = raw.replace(LRC_TIME, '').trim();
    if (!rest) continue;

    // Enhanced LRC: per-word stamps along the line.
    const wordStamps = [...rest.matchAll(LRC_WORD)];
    let words: LyricWord[] = [];
    let plain = rest;
    if (wordStamps.length > 0) {
      words = [];
      const chunks = rest.split(LRC_WORD);
      // split with capture groups alternates [text, m, s, f, text, m, s, f, …]
      let cursor = -1;
      for (let i = 0; i < chunks.length; i += 4) {
        const chunk = (chunks[i] ?? '').trim();
        const nextAt = chunks[i + 1] !== undefined ? stampMs(chunks[i + 1], chunks[i + 2], chunks[i + 3] ?? '') : null;
        if (chunk) {
          if (cursor >= 0) words.push({ startMs: cursor, endMs: Math.max(cursor + 200, nextAt ?? cursor + 200), text: chunk });
        }
        if (nextAt !== null) cursor = nextAt;
      }
      plain = rest.replace(LRC_WORD, '').replace(/\s+/g, ' ').trim();
    }

    const until = words.length > 0 ? words[words.length - 1].endMs : null;
    for (const stamp of stamps) {
      const at = stampMs(stamp[1], stamp[2], stamp[3] ?? '');
      lines.push(makeLine(at, plain, words.length > 0 ? { words, until } : {}));
    }
  }
  return lines.sort((x, y) => x.at - y.at);
}

function stampMs(minutes: string, seconds: string, fraction: string): number {
  // Two fraction digits mean centiseconds, three mean milliseconds.
  const fractionMs = fraction.length === 3 ? parseInt(fraction, 10) : fraction ? parseInt(fraction, 10) * 10 : 0;
  return parseInt(minutes, 10) * 60_000 + parseInt(seconds, 10) * 1_000 + fractionMs;
}

export { LRC_TIME };

/**
 * BitChord web — the word-synced sweep, lifted from YTM_Immersion.
 *
 * This is a TypeScript port of YTM_Immersion's `web/js/lyrics-engine.js`, the
 * part that draws the sung line. The reading experience it produces:
 *
 *  - One wavefront runs across the whole line, in **pixels** rather than in
 *    characters, so a line that wraps keeps reading as a single sweep. The
 *    front passes through every word boundary (and every glyph inside a word)
 *    on the beat, and the gap between two boundaries is filled with a cubic
 *    Hermite spline whose tangents are monotone (Fritsch–Carlson), so the
 *    front never overshoots backwards and never stalls.
 *  - A held note lifts, swells and glows. Words are split with Intl.Segmenter
 *    so Japanese — which has no spaces — still gets real words to animate.
 *  - The lift and the swell are handed to the Web Animations API as
 *    keyframes rather than written as `transform` from script, so the
 *    compositor owns them and they stay smooth between our own frames.
 *
 * Everything here works in **seconds**, like the original. The page converts.
 *
 * What is deliberately not ported: the reference's critically-damped scroll and
 * its past-line fade. BitChord keeps its own falloff ladder and scrolling, so
 * this module only ever touches the inside of the active line.
 */

import { lineEnd } from './lyrics';
import type { LyricLine, LyricWord } from './lyrics';

// ---- constants (the same values as lyrics-engine.js) ------------------------

const WORD_FEATHER_EM = 0.3;
const WORD_LIFT_EM = 0.05;
const WORD_LIFT_MIN_SEC = 1.0;
const WORD_EMPHASIS_PREROLL_SEC = 0.4;
const WORD_EMPHASIS_STRETCH = 1.4;
const WORD_DEFAULT_SEC = 0.4;
const WORD_STEP = 512;
const SWEEP_STEP = 32;

const MOTION_FRAME_MS = 40;
const MOTION_MIN_FRAMES = 8;
const MOTION_MAX_FRAMES = 40;
// The lift is a composited transform, so between our own frames the browser
// runs it on its own clock. Keep the two within a frame of each other — the
// reference allowed 80ms here, which is five frames and reads as the word
// rising late.
const MOTION_RESYNC_SEC = 0.016;

const bellCurve = (x: number): number =>
  x <= 0 || x >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * x);

const emphasisCurve = (durSec: number, scale: number): number => {
  const x = durSec / scale;
  return x > 1 ? Math.sqrt(x) : Math.pow(x, 1.8);
};

const emphasisScaleAmount = (durSec: number): number =>
  Math.min(1.2, emphasisCurve(durSec, 1.8) * 0.7);

const emphasisGlowAmount = (durSec: number): number =>
  Math.min(0.7, emphasisCurve(durSec, 2.4) * 0.45);

const isSpaceGlyph = (c: string): boolean =>
  c === ' ' || c === ' ' || c === '\t' || c === '　';

// ---- segmentation ----------------------------------------------------------

// Japanese and friends do not separate words with spaces, so Intl.Segmenter
// does the splitting. Falls back to the simple rules below when unavailable.
const lyricUnitSegmenter = ((): Intl.Segmenter | null => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return new Intl.Segmenter('ja', { granularity: 'word' });
    }
  } catch {
    /* fall through to the simple rules */
  }
  return null;
})();

const CJK_GLYPH_RE =
  /[⺀-〾ぁ-㏿㐀-䶿一-鿿豈-﫿＀-ﾟ￠-￦가-힯]/;
const CJK_TAIL_RE =
  /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーｰ゛゜々〆、。，．！？!?)）」』】〕》〉”’]/;

/** One glyph, with the second it is sung. `null` = no timing of its own. */
interface Glyph {
  c: string;
  t: number | null;
}

/**
 * The line's words, spread out into glyphs. A provider gives one stamp per
 * word; inside a word the glyphs are spaced evenly across its duration, so a
 * long note draws slowly. The gaps between words become untimed spaces — the
 * segmentation below decides whether they are real word breaks or just the
 * formatting noise that CJK joining leaves behind.
 */
const flattenLineGlyphs = (words: LyricWord[]): Glyph[] => {
  const flat: Glyph[] = [];
  words.forEach((word, i) => {
    if (i > 0) flat.push({ c: ' ', t: null });
    const start = word.startMs / 1000;
    const end = word.endMs / 1000;
    const glyphs = Array.from(word.text ?? '');
    if (glyphs.length === 0) return;
    const step = Number.isFinite(end) && end > start ? (end - start) / glyphs.length : 0;
    glyphs.forEach((c, k) => {
      flat.push({ c, t: step > 0 ? start + step * k : start });
    });
  });
  return flat;
};

export interface LyricWordUnit {
  type: 'word';
  text: string;
  /** Per-glyph start seconds, parallel to `offsets`. */
  times: Array<number | null>;
  /** Per-glyph offsets into `text`, for the within-word sweep. */
  offsets: number[];
  start: number | null;
  end: number | null;
}

export interface LyricSpaceUnit {
  type: 'space';
  text: string;
}

export type LyricUnit = LyricWordUnit | LyricSpaceUnit;

/** The line's glyphs, grouped into the words that will be animated. */
export const buildLyricWordUnits = (words: LyricWord[], lineEndSec: number): LyricUnit[] => {
  const flat = flattenLineGlyphs(words);

  // A space with CJK on both sides is not a word break, it is an artefact of
  // how the line was joined. If that is most of the spaces, drop them — and
  // with them the stop the sweep would otherwise take at every join.
  const isFormattingSpace = new Array<boolean>(flat.length).fill(false);
  {
    let spaces = 0;
    let betweenCjk = 0;
    for (let i = 0; i < flat.length; i++) {
      if (!isSpaceGlyph(flat[i].c)) continue;
      spaces += 1;
      const prev = flat[i - 1];
      const next = flat[i + 1];
      if (prev && next && CJK_GLYPH_RE.test(prev.c) && CJK_GLYPH_RE.test(next.c)) {
        isFormattingSpace[i] = true;
        betweenCjk += 1;
      }
    }
    if (!spaces || betweenCjk / spaces <= 0.5) isFormattingSpace.fill(false);
  }

  const boundaries = new Set<number>();
  if (flat.length && lyricUnitSegmenter) {
    try {
      let text = '';
      const flatIndexAt = new Map<number, number>();
      for (let i = 0; i < flat.length; i++) {
        if (isFormattingSpace[i]) continue;
        flatIndexAt.set(text.length, i);
        text += flat[i].c;
      }
      for (const seg of lyricUnitSegmenter.segment(text)) {
        const index = flatIndexAt.get(seg.index);
        if (index !== undefined) boundaries.add(index);
      }
    } catch {
      /* fall through to the simple rules */
    }
  }
  const useSegmenter = boundaries.size > 0;

  const units: LyricUnit[] = [];
  let current: LyricWordUnit | null = null;
  let currentIsCjk = false;

  flat.forEach((glyph, index) => {
    if (isSpaceGlyph(glyph.c)) {
      if (isFormattingSpace[index]) return;
      const last = units[units.length - 1];
      if (last && last.type === 'space') last.text += glyph.c;
      else units.push({ type: 'space', text: glyph.c });
      current = null;
      return;
    }

    const isTail = CJK_TAIL_RE.test(glyph.c);
    let needsNewUnit: boolean;
    if (useSegmenter) {
      needsNewUnit = !current || (!isTail && boundaries.has(index));
    } else {
      const isCjk = CJK_GLYPH_RE.test(glyph.c);
      needsNewUnit = !current || (!isTail && (isCjk || currentIsCjk));
      if (needsNewUnit) currentIsCjk = isCjk;
    }

    if (needsNewUnit || !current) {
      current = { type: 'word', text: '', times: [], offsets: [], start: null, end: null };
      units.push(current);
    }
    current.offsets.push(current.text.length);
    current.text += glyph.c;
    current.times.push(glyph.t);
  });

  // `end` is filled in by buildLyricRowModel, which still has the neighbouring
  // units in hand: a word ends where the next timed word begins. The dropped
  // formatting spaces are what let the sweep run straight through a CJK join.
  for (const unit of units) {
    if (unit.type !== 'word') continue;
    unit.start = unit.times.find((t) => t !== null) ?? null;
  }

  return units;
};

// ---- phrase grouping -------------------------------------------------------

const LYRIC_PHRASE_RULES = {
  suffixes: new Set([
    'て', 'に', 'を', 'は', 'が', 'の', 'へ', 'と', 'も', 'で', 'や', 'し', 'から', 'より', 'だけ', 'まで', 'こそ', 'さえ', 'でも', 'など', 'なら', 'くらい', 'ぐらい', 'ばかり',
    'ね', 'よ', 'な', 'さ', 'わ', 'ぞ', 'ぜ', 'かしら', 'かな', 'かも', 'だし', 'もん', 'もの',
    'って', 'けど', 'けれど', 'のに', 'ので', 'ため', 'よう', 'こと', 'わけ', 'ほう', 'ところ', 'とおり',
    'た', 'だ', 'ない', 'たい', 'ます', 'ません', 'う', 'れる', 'られる', 'せる', 'させる', 'ん', 'ず',
    'てた', 'てる', 'ちゃう', 'じゃん', 'なきゃ', 'なくちゃ', 'く', 'き', 'けれ', 'れば',
    'った', 'たら', 'たり',
    'か', 'かい', 'だい', 'いる', 'ある', 'くる', 'いく', 'みる', 'おく', 'しまう', 'ほしい', 'あげる', 'くれる', 'もらう',
    '、', '。', '，', '．', '…', '・', '！', '？', '!', '?', '~', '～', '“', '”', '‘', '’', ')', ']', '}', '」', '』', '】', '）',
  ]),
  isEnglish: (w: string) => /^[a-zA-Z0-9'\-.,!?:;]+$/.test(w),
  isSpace: (w: string) => /^\s+$/.test(w),
  isOpenParen: (w: string) => /^[\(\[「『（【]$/.test(w),
  hasKanji: (w: string) => /[一-鿿]/.test(w),
  isHiragana: (w: string) => /^[぀-ゟー]+$/.test(w),
  isKatakana: (w: string) => /^[゠-ヿー]+$/.test(w),
  startsWithSmallKana: (w: string) => /^[ぁぃぅぇぉっゃゅょゎゕゖ]/.test(w),
};

const shouldMergeLyricSegments = (word: string, nextWord: string): boolean => {
  if (!nextWord) return false;
  const r = LYRIC_PHRASE_RULES;
  if (r.isOpenParen(word)) return true;
  if (r.startsWithSmallKana(nextWord)) return true;
  if (r.suffixes.has(nextWord)) return !r.isOpenParen(nextWord);
  if (r.hasKanji(word) && r.isHiragana(nextWord)) return true;
  if (r.isKatakana(word) && r.isKatakana(nextWord)) return true;
  if (
    (r.isEnglish(word) || r.isSpace(word)) &&
    (r.isEnglish(nextWord) || r.isSpace(nextWord))
  ) {
    return true;
  }
  return false;
};

/**
 * Words are grouped into phrases so the browser can break the line between
 * them and not through the middle of a word. The grouping is a purely visual
 * concern — it changes where a line may wrap, nothing about the timing.
 */
export const groupLyricUnitsIntoPhrases = (units: LyricUnit[]): LyricUnit[][] => {
  const phrases: LyricUnit[][] = [];
  let current: LyricUnit[] | null = null;
  for (let i = 0; i < units.length; i++) {
    if (!current) {
      current = [];
      phrases.push(current);
    }
    current.push(units[i]);
    const next = units[i + 1];
    if (!next) break;
    if (shouldMergeLyricSegments(units[i].text, next.text)) continue;
    current = null;
  }
  return phrases;
};

// ---- the row model ---------------------------------------------------------

/**
 * Everything the DOM needs to know about one line, computed once per line so
 * the render path stays a pure function of the lyrics.
 */
export interface LyricRowModel {
  /** The phrases to render, in order. */
  phrases: LyricUnit[][];
  /** The word units in DOM order; index matches the `.lyric-word` elements. */
  words: LyricWordUnit[];
}

export function buildLyricRowModel(line: LyricLine): LyricRowModel | null {
  if (line.words.length === 0) return null;
  const units = buildLyricWordUnits(line.words, lineEnd(line) / 1000);
  if (units.length === 0) return null;

  // A word's end is the start of the next timed glyph after it. Resolving it
  // here keeps the per-frame code free of guesswork.
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.type !== 'word') continue;
    const start = unit.times.find((t) => t !== null) ?? null;
    unit.start = start;
    const glyphTimes = unit.times.filter((t): t is number => t !== null);
    const last = glyphTimes.length ? glyphTimes[glyphTimes.length - 1] : null;
    let end: number | null = null;
    for (let j = i + 1; j < units.length; j++) {
      const next = units[j];
      if (next.type !== 'word') continue;
      const nextStart = next.times.find((t) => t !== null) ?? null;
      if (nextStart !== null) {
        end = nextStart;
        break;
      }
    }
    if (end === null) end = Number.isFinite(lineEnd(line)) ? lineEnd(line) / 1000 : null;
    // A zero-length word would never draw; give it a floor.
    unit.end = end !== null && start !== null && end > start ? end : start !== null ? start + WORD_DEFAULT_SEC : last !== null ? last + WORD_DEFAULT_SEC : null;
  }

  const words: LyricWordUnit[] = units.filter((u): u is LyricWordUnit => u.type === 'word');
  if (words.length === 0) return null;
  return { phrases: groupLyricUnitsIntoPhrases(units), words };
}

// ---- measurement -----------------------------------------------------------

interface WordMeta {
  times: Array<number | null>;
  offsets: number[];
  start: number | null;
  end: number | null;
  /** Worth animating at all — only a held note is. */
  emp: boolean;
  empStart: number;
  empDur: number;
  amp: number;
  glow: boolean;
}

interface RowState {
  words: HTMLElement[];
  meta: WordMeta[];
  sweepT: number[] | null;
  sweepX: number[] | null;
  sweepM: number[] | null;
  sweepEnd: number;
  sweepIndex: number;
  sweepReady: boolean;
  motionReady: boolean;
  motions: Animation[] | null;
  motionOrigin: number;
  motionSyncedAt: number | undefined;
  motionSyncedLocal: number | undefined;
}

const rowStates = new WeakMap<HTMLElement, RowState>();

function stateFor(row: HTMLElement): RowState | null {
  return rowStates.get(row) ?? null;
}

/**
 * Monotone tangents (weighted harmonic mean, Fritsch–Carlson). Keeps the
 * wavefront from wobbling backwards through a word it has already passed.
 */
export const buildMonotoneTangents = (ts: number[], xs: number[]): number[] => {
  const n = ts.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;

  const h = new Array<number>(n - 1);
  const d = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = ts[i + 1] - ts[i];
    d[i] = h[i] > 0 ? (xs[i + 1] - xs[i]) / h[i] : 0;
  }

  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] < 0) !== (d[i] < 0)) {
      m[i] = 0;
      continue;
    }
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return m;
};

/** Where the wavefront is at [t], in px from the start of the line. */
export const lyricSweepAt = (row: HTMLElement, t: number): number => {
  const state = stateFor(row);
  if (!state) return 0;
  const st = state.sweepT;
  const sx = state.sweepX;
  if (!st || !sx || st.length === 0) return 0;
  if (t <= st[0]) return 0;
  if (t >= st[st.length - 1]) return state.sweepEnd || sx[sx.length - 1];

  let i = state.sweepIndex || 0;
  if (i >= st.length - 1) i = st.length - 2;
  if (t < st[i]) i = 0;
  while (i + 1 < st.length - 1 && t >= st[i + 1]) i++;
  state.sweepIndex = i;

  const t0 = st[i];
  const t1 = st[i + 1];
  const x0 = sx[i];
  const x1 = sx[i + 1];
  if (!(t1 > t0)) return x1;

  const h = t1 - t0;
  const u = (t - t0) / h;
  const sm = state.sweepM;
  if (!sm) return x0 + (x1 - x0) * u;

  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * x0 +
    (u3 - 2 * u2 + u) * h * sm[i] +
    (-2 * u3 + 3 * u2) * x1 +
    (u3 - u2) * h * sm[i + 1]
  );
};

/**
 * Reads the laid-out geometry of every word in the line and turns it into the
 * "when → how many px" table the sweep interpolates through. Words on the same
 * visual row share an origin, and the origins stack, so a wrapped line still
 * reads as one continuous sweep left to right.
 */
const measureRow = (row: HTMLElement): void => {
  const state = stateFor(row);
  if (!state || state.words.length === 0) return;
  if (!row.offsetWidth && !row.offsetHeight) return; // not laid out yet
  state.sweepReady = true;

  const doc = row.ownerDocument;
  const view = doc.defaultView;

  try {
    // 1. group words by the visual row they landed on, and measure each row
    const rowsByTop = new Map<number, { right: number; origin: number }>();
    for (const span of state.words) {
      const top = span.offsetTop;
      let bucket = rowsByTop.get(top);
      if (!bucket) rowsByTop.set(top, (bucket = { right: 0, origin: 0 }));
      bucket.right = Math.max(bucket.right, span.offsetLeft + span.offsetWidth);
    }
    const tops = Array.from(rowsByTop.keys()).sort((a, b) => a - b);
    let carry = 0;
    for (const top of tops) {
      const bucket = rowsByTop.get(top)!;
      bucket.origin = carry;
      carry += bucket.right;
    }

    // 2. each word's start offset, plus a position per glyph inside it
    const times: number[] = [];
    const xs: number[] = [];
    const range = doc.createRange();

    state.words.forEach((span, index) => {
      const meta = state.meta[index];
      const origin = rowsByTop.get(span.offsetTop)?.origin ?? 0;
      const wordX = origin + span.offsetLeft;
      const width = span.offsetWidth;
      span.style.setProperty('--wx', String(wordX));

      const node = span.firstChild;
      const offsets = meta?.offsets;
      let fractions: number[] | null = null;
      if (node && node.nodeType === 3 && Array.isArray(offsets) && offsets.length > 1) {
        const text = node as Text;
        const len = text.data.length;
        const raw: number[] = [];
        for (const offset of offsets) {
          range.setStart(node, 0);
          range.setEnd(node, Math.min(offset, len));
          raw.push(range.getBoundingClientRect().width);
        }
        range.setStart(node, 0);
        range.setEnd(node, len);
        const last = range.getBoundingClientRect().width;
        if (last > 0) fractions = raw.map((w) => w / last);
      }

      meta?.times.forEach((t, i) => {
        if (t === null) return;
        const frac = fractions
          ? (fractions[i] ?? i / meta.times.length)
          : i / meta.times.length;
        times.push(t);
        xs.push(wordX + width * frac);
      });

      // the word's own end is a node on the curve too
      if (meta && Number.isFinite(meta.end)) {
        times.push(meta.end as number);
        xs.push(wordX + width);
      }
    });

    // 3. sort by time and force it monotone in x
    const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b] || xs[a] - xs[b]);
    const st: number[] = [];
    const sx: number[] = [];
    for (const i of order) {
      if (st.length && times[i] <= st[st.length - 1]) {
        sx[sx.length - 1] = Math.max(sx[sx.length - 1], xs[i]);
        continue;
      }
      st.push(times[i]);
      sx.push(Math.max(xs[i], sx.length ? sx[sx.length - 1] : 0));
    }
    state.sweepT = st;
    state.sweepX = sx;
    state.sweepM = buildMonotoneTangents(st, sx);
    state.sweepEnd = carry;
    state.sweepIndex = 0;

    // 4. the feather is a font-relative px value, so it scales with the line
    const fontPx = (view ? parseFloat(view.getComputedStyle(row).fontSize) : NaN) || 32;
    row.style.setProperty('--feather', (WORD_FEATHER_EM * fontPx).toFixed(1));

    // 5. per-word emphasis, scaled by how long the note is held
    state.words.forEach((span, index) => {
      const meta = state.meta[index];
      if (!meta || meta.start === null || meta.end === null || !Number.isFinite(meta.end)) return;
      const dur = meta.end - meta.start > 0 ? meta.end - meta.start : WORD_DEFAULT_SEC;
      const scaleAmount = emphasisScaleAmount(dur);
      const glowAmount = emphasisGlowAmount(dur);
      meta.emp = scaleAmount > 0.05 || glowAmount > 0.05;
      meta.empStart = meta.start - WORD_EMPHASIS_PREROLL_SEC;
      meta.empDur = Math.max(WORD_LIFT_MIN_SEC, dur) * WORD_EMPHASIS_STRETCH;
      meta.amp = scaleAmount;
      meta.glow = meta.emp;
      if (meta.glow) {
        span.style.setProperty('--wglowa', glowAmount.toFixed(3));
        span.style.setProperty('--wglowr', Math.min(0.3, glowAmount * 0.3).toFixed(3));
      }
    });
  } catch {
    state.sweepT = null;
    state.sweepX = null;
  }
};

// ---- motion ----------------------------------------------------------------

/**
 * The lift and swell, as keyframes. Handing these to the Web Animations API
 * rather than writing `transform` from script keeps the movement on the
 * compositor, and lets the browser interpolate in floating point between our
 * own frames.
 */
const buildWordKeyframes = (meta: WordMeta, origin: number) => {
  if (!Number.isFinite(meta.empStart) || !(meta.empDur > 0)) return null;

  const amp = meta.amp || 0;
  const count = Math.max(
    MOTION_MIN_FRAMES,
    Math.min(MOTION_MAX_FRAMES, Math.round((meta.empDur * 1000) / MOTION_FRAME_MS)),
  );

  const frames: Keyframe[] = [];
  for (let i = 0; i <= count; i++) {
    const env = bellCurve(i / count);
    frames.push({
      offset: i / count,
      transform:
        `translateY(${(-WORD_LIFT_EM * env).toFixed(4)}em)` +
        ` scale(${(1 + env * amp * 0.085).toFixed(4)})`,
    });
  }

  return { frames, delay: (meta.empStart - origin) * 1000, duration: meta.empDur * 1000 };
};

const createRowMotion = (row: HTMLElement, state: RowState): void => {
  state.motionReady = true;
  if (state.words.length === 0) return;
  if (typeof state.words[0].animate !== 'function') return;

  const origin = state.meta
    .map((m) => m.start)
    .find((v) => Number.isFinite(v)) as number | undefined;
  if (origin === undefined || !Number.isFinite(origin)) return;
  state.motionOrigin = origin;

  const animations: Animation[] = [];

  state.words.forEach((span, index) => {
    const meta = state.meta[index];
    if (!meta || !meta.emp || meta.start === null || !Number.isFinite(meta.start)) return;
    const built = buildWordKeyframes(meta, origin);
    if (!built) return;
    try {
      const animation = span.animate(built.frames, {
        duration: built.duration,
        delay: built.delay,
        fill: 'both',
        easing: 'linear',
      });
      animation.pause();
      animations.push(animation);
    } catch {
      /* the sweep still runs without it */
    }
  });
  state.motions = animations;
};

const syncRowMotion = (row: HTMLElement, state: RowState, t: number, rate: number): void => {
  const motions = state.motions;
  if (!motions || !motions.length) return;
  const local = (t - state.motionOrigin) * 1000;
  const now = performance.now();

  // Between our own frames the animations run on their own clock; only step
  // them back into line when the drift is worth the seek.
  if (state.motionSyncedAt !== undefined && state.motionSyncedLocal !== undefined) {
    const predicted = state.motionSyncedLocal + (now - state.motionSyncedAt) * rate;
    if (Math.abs(predicted - local) <= MOTION_RESYNC_SEC * 1000) return;
  }

  for (const animation of motions) {
    try {
      animation.currentTime = local;
      if (animation.playbackRate !== rate) animation.playbackRate = rate;
      animation.play();
    } catch {
      /* animation was cancelled */
    }
  }
  state.motionSyncedLocal = local;
  state.motionSyncedAt = now;
};

const stopRowMotion = (state: RowState): void => {
  state.motionSyncedAt = undefined;
  if (!state.motions) return;
  for (const animation of state.motions) {
    try {
      animation.pause();
      animation.currentTime = 0;
    } catch {
      /* animation was cancelled */
    }
  }
};

/** Writes a CSS custom property, but only when the quantised value moved. */
const writeVar = (
  el: HTMLElement,
  key: string,
  cacheKey: string,
  value: number,
  step: number,
): void => {
  const cache = el as unknown as Record<string, number | undefined>;
  const q = Math.round(value * step) / step;
  if (cache[cacheKey] === q) return;
  cache[cacheKey] = q;
  el.style.setProperty(key, String(q));
};

// ---- public surface --------------------------------------------------------

/**
 * Ties a rendered row to its model: collects the `.lyric-word` elements, pairs
 * them with the units they came from, and marks the line as needing
 * measurement. Safe to call on every render — it does no work unless the
 * geometry or the lyrics actually changed.
 */
export function bindRow(row: HTMLElement, model: LyricRowModel): void {
  const elements = Array.from(row.querySelectorAll<HTMLElement>('.lyric-word'));
  let state = rowStates.get(row);

  if (elements.length !== model.words.length) {
    // React has not caught up with the model yet, or the line is not a
    // word-synced one. Leave any existing state alone.
    return;
  }

  const fresh = !state;
  if (!state) {
    state = {
      words: elements,
      meta: model.words.map((w) => ({
        times: w.times,
        offsets: w.offsets,
        start: w.start,
        end: w.end,
        emp: false,
        empStart: 0,
        empDur: 0,
        amp: 0,
        glow: false,
      })),
      sweepT: null,
      sweepX: null,
      sweepM: null,
      sweepEnd: 0,
      sweepIndex: 0,
      sweepReady: false,
      motionReady: false,
      motions: null,
      motionOrigin: 0,
      motionSyncedAt: undefined,
      motionSyncedLocal: undefined,
    };
    rowStates.set(row, state);
  } else {
    const existing = state;
    const changed =
      existing.words.length !== elements.length ||
      existing.words.some((el, i) => el !== elements[i]) ||
      existing.meta.some((m, i) => m.start !== model.words[i].start || m.end !== model.words[i].end);
    existing.words = elements;
    if (changed) {
      existing.meta = model.words.map((w) => ({
        times: w.times,
        offsets: w.offsets,
        start: w.start,
        end: w.end,
        emp: false,
        empStart: 0,
        empDur: 0,
        amp: 0,
        glow: false,
      }));
      invalidateRow(row);
    }
  }
}

/**
 * Paints the active line at [t] seconds.
 *
 * Call this once per frame with a time read straight off the audio clock. The
 * wavefront is written here rather than handed to a Web Animations keyframe
 * animation (as the reference does) because such an animation advances on its
 * own clock and only gets corrected once it has drifted past its tolerance —
 * which is what made the lyrics sit behind the song. `--sweep` feeds a paint
 * property, so the compositor never got us anything by handing it over.
 */
export function paintRow(row: HTMLElement, t: number): void {
  const state = stateFor(row);
  if (!state) return;
  if (!state.sweepReady) measureRow(row);
  if (!state.motionReady) createRowMotion(row, state);
  syncRowMotion(row, state, t, 1);

  writeVar(row, '--sweep', '__sweep', lyricSweepAt(row, t), SWEEP_STEP);

  // The glow is a paint-level effect too, so it is written every frame as
  // well, quantised so we are not thrashing the style engine.
  state.words.forEach((span, index) => {
    const meta = state.meta[index];
    if (!meta || !meta.glow || meta.start === null) return;
    const env = bellCurve((t - meta.empStart) / meta.empDur);
    writeVar(span, '--wg', '__wg', env, WORD_STEP);
  });
}

/** Stops a line that is no longer the sung one and clears its wavefront. */
export function releaseRow(row: HTMLElement): void {
  const state = stateFor(row);
  if (!state) return;
  stopRowMotion(state);
  writeVar(row, '--sweep', '__sweep', 0, SWEEP_STEP);
  state.sweepIndex = 0;
  for (const span of state.words) {
    writeVar(span, '--wg', '__wg', 0, WORD_STEP);
  }
}

/**
 * Throws away the measured geometry and the animations built from it. Call
 * when the font loads, the viewport resizes, or the line is re-laid out — the
 * pixel positions are only true for the layout they were read from.
 */
export function invalidateRow(row: HTMLElement): void {
  const state = stateFor(row);
  if (!state) return;
  state.sweepReady = false;
  state.motionReady = false;
  if (state.motions) {
    for (const animation of state.motions) {
      try {
        animation.cancel();
      } catch {
        /* already gone */
      }
    }
    state.motions = null;
  }
  state.sweepT = null;
  state.sweepX = null;
  state.sweepM = null;
  state.sweepIndex = 0;
}

export function hasRowState(row: HTMLElement): boolean {
  return rowStates.has(row);
}

/**
 * Drops the measured geometry for every word-synced line inside [container].
 * The pixel positions are only true for the layout they were read from, so a
 * font swap or a viewport change invalidates all of them at once.
 */
export function invalidateRows(container: HTMLElement | null): void {
  if (!container) return;
  for (const row of container.querySelectorAll<HTMLElement>('.ytm-word-sync')) {
    invalidateRow(row);
  }
}

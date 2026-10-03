/**
 * BitChord web — the lyrics page.
 *
 * The full PlayerLyrics port. The reading experience:
 *
 *  - The sung line carries a single wavefront, measured in pixels and
 *    interpolated through every word boundary on the beat. Held notes lift,
 *    swell and glow; see `src/lyrics/sweep.ts`, which is ported from
 *    YTM_Immersion's `lyrics-engine.js`.
 *  - The panel follows the lead on a critically damped spring, so it can be
 *    handed a new destination mid-flight without restarting or overshooting;
 *    see `src/lyrics/scroll.ts`, also ported from the reference. A hand on the
 *    panel wins for three seconds, then it takes over again.
 *  - Both of those run off one rAF loop reading the audio element directly —
 *    `useLyricsClock` — so the sweep is never a frame behind the song. Rows
 *    only re-render when the sung line changes.
 *  - Words off the lead sit in the app's falloff ladder — alpha [1, .8, .7,
 *    .58, .46] and blur [0, 1, 1, 1.7, 2.4]px indexed by distance — so the
 *    two lines around the playing one stay readable and only past that does
 *    the panel let go. Past lines dim rather than vanish; the reference hides
 *    them, which is not what this app wants.
 *  - Tapping any line seeks to it (the app's onSeekToLine), a row under a
 *    finger dips, and the active row scales up from 0.98.
 *  - Instrumental breaks are three dots that fill left to right across the
 *    break, and the row only opens while the break is playing.
 *  - Plain-text providers get [Section] headers as chips.
 *  - A lyrics offset (± ms) and the provider / manual search live in the
 *    toolbar; everything re-fetches live.
 */

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject } from 'react';
import { player } from '../player/player';
import { activeLineIndex, isGap } from '../lyrics/lyrics';
import type { Lyrics, LyricLine } from '../lyrics/lyrics';
import { buildLyricRowModel, bindRow, invalidateRow, invalidateRows, paintRow, releaseRow } from '../lyrics/sweep';
import { createLyricScroll } from '../lyrics/scroll';
import { fetchLyrics } from '../lyrics/providers';
import type { Song } from '../api/models';

/** The app's LINE_FALLOFF_ALPHA / LINE_FALLOFF_BLUR, indexed by distance. */
const FALLOFF_ALPHA = [1, 0.8, 0.7, 0.58, 0.46];
const FALLOFF_BLUR = [0, 1, 1, 1.7, 2.4];
const PRESSED_SCALE = 0.96;
const INACTIVE_SCALE = 0.98;

/** Genius.isSectionHeader: [Chorus], [Verse 2], and friends. */
function isSectionHeader(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length >= 3 && trimmed.length <= 60;
}

/**
 * Drives the karaoke off one rAF loop that reads the audio element directly.
 *
 * Deliberately not routed through React state. Two reasons:
 *
 *  - Accuracy. `player.positionMs` is only reported four times a second, and a
 *    state update per frame puts a render between the clock and the paint. The
 *    lyrics ended up sitting behind the song. Reading `audio.currentTime`
 *    inside the frame that draws removes both gaps.
 *  - Cost. Fifty-odd rows re-rendering sixty times a second to move a gradient
 *    is a lot of work for nothing. The rows only re-render when the sung line
 *    changes; everything per-frame is written straight to the DOM.
 */
interface LyricsClockOptions {
  enabled: boolean;
  lines: LyricLine[];
  offsetMs: number;
  rows: MutableRefObject<Map<number, HTMLDivElement>>;
  container: MutableRefObject<HTMLDivElement | null>;
  onIndex: (index: number) => void;
  /** Re-arms the instant first scroll whenever this changes. */
  resetKey: unknown;
}

function useLyricsClock({
  enabled,
  lines,
  offsetMs,
  rows,
  container,
  onIndex,
  resetKey,
}: LyricsClockOptions): void {
  // Read through refs so the loop never has to be torn down and rebuilt.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const offsetRef = useRef(offsetMs);
  offsetRef.current = offsetMs;
  const onIndexRef = useRef(onIndex);
  onIndexRef.current = onIndex;
  const instantRef = useRef(true);

  useEffect(() => {
    const el = container.current;
    if (!enabled || !el) return;

    const scroller = createLyricScroll(el);
    instantRef.current = true;
    let raf = 0;
    let last = 0;
    let current = -2;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;

      const raw = player.currentAudioTimeMs() ?? player.getSnapshot().positionMs;
      const t = Math.max(0, raw - offsetRef.current);
      const list = linesRef.current;
      const index = activeLineIndex(list, t);

      if (index !== current) {
        if (current >= 0) {
          const previous = rows.current.get(current);
          if (previous) releaseRow(previous);
        }
        current = index;
        onIndexRef.current(index);

        const next = index >= 0 ? rows.current.get(index) : null;
        // A hand on the panel wins for a few seconds; then it takes over again.
        if (next && !scroller.isUserScrolling()) {
          scroller.scrollToRow(next, instantRef.current);
          instantRef.current = false;
        }
      }

      if (index >= 0) {
        const row = rows.current.get(index);
        const line = list[index];
        if (row && line) {
          if (isGap(line)) {
            // Instrumental break: the dots fill across the silence.
            const nextAt = list[index + 1]?.at ?? line.at;
            const span = Math.max(1, nextAt - line.at);
            const through = Math.max(0, Math.min(1, (t - line.at) / span));
            row.style.setProperty('--gap-through', through.toFixed(3));
          } else {
            paintRow(row, t / 1000);
          }
        }
      }

      scroller.step(dt);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      scroller.reset();
      onIndexRef.current(-1);
    };
  }, [enabled, resetKey, container, rows]);
}

interface LyricsPageProps {
  lyrics: Lyrics | null;
  loading: boolean;
  song: Song;
  durationMs: number;
  onBack: () => void;
}

export function LyricsPage({ lyrics, loading, song, durationMs, onBack }: LyricsPageProps) {
  const [offsetMs, setOffsetMs] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef(new Map<number, HTMLDivElement>());
  const [sheet, setSheet] = useState<'none' | 'offset' | 'provider'>('none');

  const registerRow = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) rowsRef.current.set(index, el);
    else rowsRef.current.delete(index);
  }, []);

  useLyricsClock({
    enabled: lyrics?.synced === true,
    lines: lyrics?.lines ?? [],
    offsetMs,
    rows: rowsRef,
    container: bodyRef,
    onIndex: setActiveIndex,
    resetKey: lyrics,
  });

  // The word-sync sweep works in pixels read off the laid-out line, so those
  // measurements only hold for the layout they were taken from. A late font
  // load or a resize invalidates them all; the clock re-measures the sung line
  // on its next frame, so nothing else has to happen here.
  useEffect(() => {
    const refresh = () => invalidateRows(bodyRef.current);
    window.addEventListener('resize', refresh);
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(() => {
      if (!cancelled) refresh();
    });
    return () => {
      cancelled = true;
      window.removeEventListener('resize', refresh);
    };
  }, [lyrics]);

  const seekToLine = (line: LyricLine) => {
    if (!lyrics?.synced) return;
    player.seek(Math.max(0, line.at + offsetMs));
  };

  const wordmark = lyrics
    ? lyrics.wordSynced
      ? 'WORD SYNC'
      : lyrics.synced
        ? 'SYNCED'
        : ''
    : '';

  return (
    <div className="lyrics-page">
      <div className="queue-top safe-top">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.8 16.8q.3-.3.288-.7t-.288-.7L7.8 12.5h9.4q.375 0 .638-.263t.262-.637t-.262-.638t-.638-.262H7.8l3-3q.3-.3.3-.7t-.3-.7t-.7-.3t-.7.3L5.4 11.3q-.15.15-.213.325T5.125 12t.063.375t.212.325l4.6 4.6q.275.275.688.288t.712-.288Z" />
          </svg>
        </button>
        <button
          className="lyrics-provider-link title-medium"
          onClick={() => setSheet('provider')}
          title="Change lyrics provider"
        >
          {loading ? 'Searching…' : (lyrics?.provider ?? 'Lyrics')}
        </button>
        <div className="lyrics-top-actions">
          <span className="lyrics-wordmark label-small">{wordmark}</span>
          <button className="icon-button" onClick={() => setSheet('offset')} aria-label="Lyrics offset" title="Adjust timing">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 17h2v-6h-2Zm1-8q.425 0 .713-.288T13 8t-.287-.712T12 7t-.712.288T11 8t.288.713T12 9Zm0 13q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22Z" />
            </svg>
          </button>
        </div>
      </div>

      {offsetMs !== 0 && (
        <div className="lyrics-offset-note label-small">
          offset {offsetMs > 0 ? '+' : ''}
          {offsetMs}ms
        </div>
      )}

      {loading && !lyrics ? (
        <LyricsSkeleton />
      ) : lyrics === null ? (
        <ProviderSheet
          song={song}
          embedded
          onClose={() => setSheet('none')}
          onFound={() => setSheet('none')}
        />
      ) : (
        <div
          className={`lyrics-body${lyrics.synced ? ' lyrics-body-synced' : ''}`}
          ref={bodyRef}
        >
          {lyrics.synced
            ? lyrics.lines.map((line, i) => (
                <LyricRow
                  key={i}
                  line={line}
                  index={i}
                  activeIndex={activeIndex}
                  register={registerRow}
                  onTap={() => seekToLine(line)}
                />
              ))
            : lyrics.lines.map((line, i) =>
                isGap(line) ? null : isSectionHeader(line.text) ? (
                  <span key={i} className="lyric-section-chip label-medium">
                    {line.text.replace(/^\[/, '').replace(/\]$/, '').trim().toUpperCase()}
                  </span>
                ) : (
                  <div key={i} className="lyric-line lyrics-plain-line">
                    {line.text}
                  </div>
                ),
              )}
        </div>
      )}

      {sheet === 'offset' && (
        <OffsetSheet
          offsetMs={offsetMs}
          onChange={(ms) => setOffsetMs(ms)}
          onClose={() => setSheet('none')}
        />
      )}
      {sheet === 'provider' && (
        <ProviderSheet song={song} onClose={() => setSheet('none')} />
      )}
    </div>
  );
}

/** The app's LyricsSkeleton: text-shaped blocks with ragged bottoms. */
function LyricsSkeleton() {
  const BLOCKS = [
    [0.97, 0.54],
    [0.92, 0.99, 0.41],
    [0.68],
    [0.95, 0.73],
    [0.89, 0.96, 0.37],
  ];
  return (
    <div className="lyrics-body" aria-hidden="true">
      {BLOCKS.map((block, i) => (
        <div key={i} className="lyrics-skel-block">
          {block.map((width, j) => (
            <div
              key={j}
              className="skeleton lyrics-skel-bar"
              style={{ width: `${width * 100}%`, animationDelay: `${(i * 3 + j) * 0.12}s` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Lyrics offset: shifts every stamp, the way the app's LyricsOffsetSheet does. */
function OffsetSheet({
  offsetMs,
  onChange,
  onClose,
}: {
  offsetMs: number;
  onChange: (ms: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(offsetMs);
  const step = (delta: number) => {
    const next = Math.max(-10_000, Math.min(10_000, value + delta));
    setValue(next);
    onChange(next);
  };
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet frosted" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title title-medium">Lyrics timing</div>
        <div className="body-medium" style={{ color: 'var(--on-surface-variant)', marginBottom: 10 }}>
          Lyrics ahead of the song? Nudge them back. Behind? Nudge them forward.
        </div>
        <div className="offset-row">
          <button className="sleep-chip label-medium" onClick={() => step(-200)}>
            −200ms
          </button>
          <button className="sleep-chip label-medium" onClick={() => step(-50)}>
            −50ms
          </button>
          <span className="offset-value title-medium">
            {value > 0 ? '+' : ''}
            {value}ms
          </span>
          <button className="sleep-chip label-medium" onClick={() => step(50)}>
            +50ms
          </button>
          <button className="sleep-chip label-medium" onClick={() => step(200)}>
            +200ms
          </button>
        </div>
        <div className="offset-actions">
          <button
            className="text-button label-medium"
            onClick={() => {
              setValue(0);
              onChange(0);
            }}
          >
            Reset
          </button>
          <button className="lyrics-manual-button label-medium" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The provider sheet: who answered, a manual search for the recording's real
 * name, and re-fetch. Also the whole page when nothing was found.
 */
function ProviderSheet({
  song,
  embedded = false,
  onClose,
  onFound,
}: {
  song: Song;
  embedded?: boolean;
  onClose: () => void;
  onFound?: () => void;
}) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Lyrics | null | null>(null);

  const search = async () => {
    setBusy(true);
    try {
      const result = await fetchLyrics(song, 0, {
        title: title.trim() || song.title,
        artist: artist.trim() || song.artist,
      });
      setFound(result);
      if (result) onFound?.();
    } finally {
      setBusy(false);
    }
  };

  // Applying a found result means re-fetching through the page state; the
  // simplest correct route is a synthetic update through the same channel the
  // page already listens on — a custom event carrying the new lyrics.
  const apply = () => {
    if (!found) return;
    window.dispatchEvent(new CustomEvent('bitchord:lyrics', { detail: found }));
    onClose();
  };

  if (embedded && found === null && !busy) {
    return (
      <div className="lyrics-empty">
        <div className="lyrics-empty-title headline-medium">No lyrics found</div>
        <div className="body-medium" style={{ color: 'rgba(255,255,255,0.6)', maxWidth: 330, textAlign: 'center' }}>
          The title on YouTube is sometimes not the title on the record. Correct it
          below — the search covers BiniLyrics, PaxSenix, BetterLyrics and LRCLIB.
        </div>
        <form
          className="lyrics-manual"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            className="lyrics-manual-input body-medium"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            aria-label="Song title"
            autoFocus
          />
          <input
            className="lyrics-manual-input body-medium"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist"
            aria-label="Artist"
          />
          <button className="lyrics-manual-button label-medium" type="submit" disabled={busy}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet frosted" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title title-medium">Lyrics</div>
        {found !== null && (
          <div className="lyrics-found-note body-medium">
            {found
              ? `Found: ${found.provider}${found.wordSynced ? ' (word sync)' : ''}`
              : 'Nothing found for that search.'}
            {found && (
              <button className="lyrics-manual-button label-medium" onClick={apply}>
                Use these lyrics
              </button>
            )}
          </div>
        )}
        <div className="body-medium" style={{ color: 'var(--on-surface-variant)', marginBottom: 10 }}>
          Search all providers with the recording's real name:
        </div>
        <form
          className="lyrics-manual"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            className="lyrics-manual-input body-medium"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            aria-label="Song title"
          />
          <input
            className="lyrics-manual-input body-medium"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist"
            aria-label="Artist"
          />
          <button className="lyrics-manual-button label-medium" type="submit" disabled={busy}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
      </div>
    </div>
  );
}

const LyricRow = memo(function LyricRow({
  line,
  index,
  activeIndex,
  register,
  onTap,
}: {
  line: LyricLine;
  index: number;
  activeIndex: number;
  register: (index: number, el: HTMLDivElement | null) => void;
  onTap: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const active = index === activeIndex;
  const past = index < activeIndex;
  const distance = Math.min(4, Math.abs(index - activeIndex));
  const background = line.background;

  // The word-sync model: words re-split with Intl.Segmenter, grouped into
  // phrases the line is allowed to wrap between. Null on line-synced providers.
  const model = useMemo(() => buildLyricRowModel(line), [line]);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const boundRef = useRef<HTMLDivElement | null>(null);
  const setRow = useCallback(
    (el: HTMLDivElement | null) => {
      rowRef.current = el;
    },
    [],
  );

  // Pair the rendered words with the units they came from, and hand the
  // element to the clock that paints it. Cheap on every commit — the engine
  // only redoes work when the words or their timing move.
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    register(index, el);
    if (model) {
      bindRow(el, model);
      boundRef.current = el;
    }
  });

  // Let the compositor drop the animations when the line unmounts.
  useEffect(
    () => () => {
      register(index, null);
      if (boundRef.current) invalidateRow(boundRef.current);
    },
    [index, register],
  );

  if (isGap(line)) {
    // The break: three dots that fill left to right across the interlude, and
    // a row that only opens while the break is playing (the app's swell).
    // `--gap-through` is written by the clock, not by React, so the dots stay
    // on the audio without re-rendering this row every frame.
    return (
      <div
        className={`lyric-gap${active ? ' lyric-gap-active' : ''}`}
        ref={setRow}
        onClick={onTap}
        role="button"
        tabIndex={-1}
        aria-label="Instrumental"
      >
        {[0, 1, 2].map((dot) => (
          <span key={dot} style={{ '--dot': dot } as CSSProperties} />
        ))}
      </div>
    );
  }

  // The falloff ladder: alpha and blur both indexed by distance from the
  // sung line, easing on the shared settle curve.
  const opacity = active ? 1 : past ? FALLOFF_ALPHA[distance] * 0.85 : FALLOFF_ALPHA[distance];
  const blur = active ? 0 : FALLOFF_BLUR[distance];
  const scale = pressed ? PRESSED_SCALE : active ? 1 : INACTIVE_SCALE;

  const lineClass = [
    'lyric-line',
    'lyrics-big',
    active ? 'lyric-active' : past ? 'lyric-past' : 'lyric-future',
    line.alignment === 'end' ? 'lyric-end' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const style: React.CSSProperties = {
    opacity,
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
    transform: `scale(${scale})`,
    transformOrigin: line.alignment === 'end' ? 'right center' : 'left center',
  };

  const seek = () => {
    setPressed(false);
    onTap();
  };

  if (!model) {
    return (
      <div
        ref={setRow}
        className={lineClass}
        style={style}
        onClick={seek}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        role="button"
        tabIndex={-1}
      >
        {line.text}
        {background && <span className="lyric-background">({background.text})</span>}
      </div>
    );
  }

  // A word-synced line. The structure is built for every line, not just the
  // sung one, so a line does not reflow at the moment it takes the lead — the
  // wavefront's pixel positions would all be wrong. The words carry no inline
  // colour: the sweep is one gradient across the whole line, and the engine
  // feeds it `--sweep`, `--wx` and the per-word glow.
  return (
    <div
      ref={setRow}
      className={`${lineClass} lyric-swept ytm-word-sync`}
      style={style}
      onClick={seek}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      role="button"
      tabIndex={-1}
    >
      <span className="lyric-main">
        {model.phrases.map((phrase, phraseIndex) => (
          <span key={phraseIndex} className="lyric-phrase lyric-phrase-sync">
            {phrase.map((unit, unitIndex) =>
              unit.type === 'space' ? (
                <Fragment key={unitIndex}>{unit.text}</Fragment>
              ) : (
                <span key={unitIndex} className="lyric-word">
                  {unit.text}
                </span>
              ),
            )}
          </span>
        ))}
      </span>
      {background && <span className="lyric-background">({background.text})</span>}
    </div>
  );
});

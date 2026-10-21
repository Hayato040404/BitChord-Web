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
 *  - Words off the lead step down the am-lyrics ladder: the next line stays
 *    open, then opacity [1, .8, .7, .58, .46] and a soft em-based blur push
 *    everything else back. Past lines dim rather than vanish.
 *  - Tapping any line seeks to it (the app's onSeekToLine), a row under a
 *    finger dips, and the active row scales up from 0.98.
 *  - Instrumental breaks are three dots that fill left to right across the
 *    break, and the row only opens while the break is playing.
 *  - Plain-text providers get [Section] headers as chips.
 *  - A floating header holds the back / timing / provider actions; the source
 *    attribution sits at the end of the scroll, as it does in am-lyrics.
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
import { saveLyricsBySongEntry, clearLyricsBySongEntry } from '../data/library';
import { t } from '../i18n';
import { BackIcon, MoreIcon } from '../components/icons';

export function getSavedLyricsMeta(videoId: string): { offsetMs: number; manualTitle: string; manualArtist: string } | null {
  try {
    const raw = window.localStorage?.getItem('bitchord.lyricsBySong');
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, { offsetMs: number; manualTitle: string; manualArtist: string }> | null;
    if (!map || !Object.prototype.hasOwnProperty.call(map, videoId)) return null;
    const entry = map[videoId];
    if (!entry) return null;
    return {
      offsetMs: Number.isFinite(entry.offsetMs) ? entry.offsetMs : 0,
      manualTitle: typeof entry.manualTitle === 'string' ? entry.manualTitle : '',
      manualArtist: typeof entry.manualArtist === 'string' ? entry.manualArtist : '',
    };
  } catch {
    return null;
  }
}

/** その曲の保存済み歌詞メタにオフsetsを書き込む。 */
function saveOffsetForSong(videoId: string, offsetMs: number): void {
  saveLyricsBySongEntry(videoId, { offsetMs });
}

/** その曲の保存済み歌詞メタに手動検索名を書き込む(検索成功時のみ永久化する)。 */
function saveManualQueryForSong(videoId: string, title: string, artist: string): void {
  saveLyricsBySongEntry(videoId, {
    manualTitle: title.trim(),
    manualArtist: artist.trim(),
  });
}

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
    /** Keep re-aiming briefly after a line change: an interlude in front of
     *  the new line is collapsing, which shifts it under the anchor. */
    let followUntil = 0;

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
        followUntil = now + 650;

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
          if (now < followUntil && !scroller.isUserScrolling()) {
            scroller.trackRow(row);
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
  const [offsetMs, setOffsetMs] = useState(() => {
    // 同じ曲で前回確定した歌詞オフsetsがあればそれを復元する。
    const saved = getSavedLyricsMeta(song.videoId);
    return saved?.offsetMs ?? 0;
  });
  // 曲が切り替わったらオフセットをその曲の保存値に戻す(ページは
  // マウントされ続けるため、初期化だけでは次の曲に引き継いでしまう)。
  useEffect(() => {
    setOffsetMs(getSavedLyricsMeta(song.videoId)?.offsetMs ?? 0);
  }, [song.videoId]);
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
      ? t('lyrics.wordSync')
      : lyrics.synced
        ? t('lyrics.synced')
        : ''
    : '';
  const hasDuet = lyrics?.synced === true && lyrics.lines.some((line) => line.alignment === 'end');

  return (
    <div className="lyrics-page">
      <header className="lyrics-top">
        <div className="lyrics-top-inner">
          <button className="lyrics-icon-button" type="button" onClick={onBack} aria-label={t('aria.back')}>
            <BackIcon size={22} />
          </button>
          <div className="lyrics-meta">
            <div className="lyrics-meta-title">{song.title}</div>
            <div className="lyrics-meta-artist">{song.artist}</div>
          </div>
          <div className="lyrics-top-actions">
            <button
              className={`lyrics-icon-button${offsetMs !== 0 ? ' is-on' : ''}`}
              type="button"
              onClick={() => setSheet('offset')}
              aria-label={t('lyrics.adjustTiming')}
              title={t('lyrics.adjustTiming')}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="8" />
                <path d="M12 7.6V12l3 1.8" />
              </svg>
            </button>
            <button
              className="lyrics-icon-button"
              type="button"
              onClick={() => setSheet('provider')}
              aria-label={t('lyrics.changeProvider')}
              title={t('lyrics.changeProvider')}
            >
              <MoreIcon size={20} />
            </button>
          </div>
        </div>
      </header>

      {offsetMs !== 0 && (
        <button
          className="lyrics-offset-note label-small"
          type="button"
          onClick={() => setSheet('offset')}
          title={t('lyrics.adjustTiming')}
        >
          {t('lyrics.offsetApplied', { value: `${offsetMs > 0 ? '+' : ''}${offsetMs}ms` })}
        </button>
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
          className={`lyrics-body${lyrics.synced ? ' lyrics-body-synced' : ' lyrics-body-plain'}${
            hasDuet ? ' lyrics-body-duet' : ''
          }`}
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
          <LyricsCredit lyrics={lyrics} badge={wordmark} onOpen={() => setSheet('provider')} />
        </div>
      )}

      {sheet === 'offset' && (
        <OffsetSheet
          offsetMs={offsetMs}
          onChange={(ms) => setOffsetMs(ms)}
          onClose={() => setSheet('none')}
          videoId={song.videoId}
        />
      )}
      {sheet === 'provider' && (
        <ProviderSheet song={song} onClose={() => setSheet('none')} />
      )}
    </div>
  );
}

/** am-lyrics' seven-bar skeleton, sized to the lyric type. */
function LyricsSkeleton() {
  const WIDTHS = [64, 84, 58, 76, 50, 68, 60];
  return (
    <div className="lyrics-body lyrics-body-synced lyrics-skeleton" aria-hidden="true">
      {WIDTHS.map((width, i) => (
        <div
          key={i}
          className="lyrics-skeleton-line"
          style={{ width: `${width}%`, animationDelay: `${i * 0.08}s` }}
        />
      ))}
    </div>
  );
}

/**
 * The source line at the bottom of the scroll, as in am-lyrics: attribution
 * lives with the lyrics rather than in a toolbar, and doubles as the way back
 * into the provider search.
 */
function LyricsCredit({
  lyrics,
  badge,
  onOpen,
}: {
  lyrics: Lyrics;
  badge: string;
  onOpen: () => void;
}) {
  const provider = lyrics.provider || t('lyrics.providerFallback');
  return (
    <div className="lyrics-credit">
      <button
        className="lyrics-credit-source"
        type="button"
        onClick={onOpen}
        title={t('lyrics.changeProvider')}
      >
        {t('lyrics.source', { provider })}
      </button>
      {badge && <span className="lyrics-credit-badge">{badge}</span>}
    </div>
  );
}

/** Lyrics offset: shifts every stamp, the way the app's LyricsOffsetSheet does. */
function OffsetSheet({
  offsetMs,
  onChange,
  onClose,
  videoId,
}: {
  offsetMs: number;
  onChange: (ms: number) => void;
  onClose: () => void;
  videoId: string;
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
        <div className="sheet-title title-medium">{t('lyrics.offsetTitle')}</div>
        <div className="body-medium" style={{ color: 'var(--on-surface-variant)', marginBottom: 10 }}>
          {t('lyrics.offsetHint')}
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
            {t('lyrics.reset')}
          </button>
          <button
            className="text-button label-medium"
            onClick={() => {
              clearLyricsBySongEntry(videoId);
              setValue(0);
              onChange(0);
              onClose();
            }}
          >
            {t('lyrics.clearSaved')}
          </button>
          <button
            className="lyrics-manual-button label-medium"
            onClick={() => {
              saveOffsetForSong(videoId, offsetMs);
              onClose();
            }}
          >
            {t('lyrics.done')}
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
  const saved = getSavedLyricsMeta(song.videoId);
  const [title, setTitle] = useState(saved?.manualTitle || song.title);
  const [artist, setArtist] = useState(saved?.manualArtist || song.artist);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Lyrics | null>(null);

  const search = async () => {
    setBusy(true);
    try {
      const result = await fetchLyrics(song, 0, {
        title: title.trim() || song.title,
        artist: artist.trim() || song.artist,
      });
      setFound(result);
      if (result) {
        onFound?.();
        // その曲の歌詞探しで成功した名前を次回に自動で使うように記憶する。
        saveManualQueryForSong(song.videoId, title, artist);
      }
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
    const saved = getSavedLyricsMeta(song.videoId);
    return (
      <div className="lyrics-empty">
        <div className="lyrics-empty-title headline-medium">{t('lyrics.noLyrics')}</div>
        <div className="body-medium" style={{ color: 'rgba(255,255,255,0.6)', maxWidth: 330, textAlign: 'center' }}>
          {t('lyrics.titleFixBody')}
        </div>
        {saved && (
          <button
            className="text-button label-medium"
            style={{ marginBottom: 8 }}
            onClick={() => {
              clearLyricsBySongEntry(song.videoId);
              setTitle(song.title);
              setArtist(song.artist);
            }}
          >
            {t('lyrics.clearSavedName')}
          </button>
        )}
        <form
          className="lyrics-manual"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            className="lyrics-manual-input body-medium"
            value={saved?.manualTitle || title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('aria.songTitle')}
            aria-label={t('aria.songTitle')}
            autoFocus
          />
          <input
            className="lyrics-manual-input body-medium"
            value={saved?.manualArtist || artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t('aria.artist')}
            aria-label={t('aria.artist')}
          />
          <button className="lyrics-manual-button label-medium" type="submit" disabled={busy}>
            {busy ? t('lyrics.searching') : t('lyrics.search')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet frosted" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title title-medium">{t('player.lyricsTitle')}</div>
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
        {saved && (
          <button
            className="text-button label-medium"
            style={{ marginBottom: 8 }}
            onClick={() => {
              clearLyricsBySongEntry(song.videoId);
              setTitle(song.title);
              setArtist(song.artist);
            }}
          >
            {t('lyrics.clearSavedName')}
          </button>
        )}
        <div className="body-medium" style={{ color: 'var(--on-surface-variant)', marginBottom: 10 }}>
          {t('lyrics.searchHint')}
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
            placeholder={t('aria.songTitle')}
            aria-label={t('aria.songTitle')}
          />
          <input
            className="lyrics-manual-input body-medium"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t('aria.artist')}
            aria-label={t('aria.artist')}
          />
          <button className="lyrics-manual-button label-medium" type="submit" disabled={busy}>
            {busy ? t('lyrics.searching') : t('lyrics.search')}
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
  const next = activeIndex >= 0 && index === activeIndex + 1;
  const distance =
    activeIndex < 0 ? Math.min(4, index + 1) : Math.min(4, Math.abs(index - activeIndex));
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
        aria-label={t('aria.instrumental')}
      >
        {[0, 1, 2].map((dot) => (
          <span key={dot} style={{ '--dot': dot } as CSSProperties} />
        ))}
      </div>
    );
  }

  // The falloff ladder lives in CSS: distance decides opacity/blur, the row
  // under the lead turns white, and only the immediate next line is warmed up.
  const lineClass = [
    'lyric-line',
    'lyrics-big',
    active ? 'lyric-active' : past ? 'lyric-past' : 'lyric-future',
    `lyric-d${distance}`,
    next ? 'lyric-next' : '',
    pressed ? 'lyric-pressed' : '',
    line.alignment === 'end' ? 'lyric-end' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const seek = () => {
    setPressed(false);
    onTap();
  };

  if (!model) {
    return (
      <div
        ref={setRow}
        className={lineClass}
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

/**
 * BitChord web — the lyrics page.
 *
 * The full PlayerLyrics port. The reading experience:
 *
 *  - The sung line sweeps in per-word gradients (see the previous pass), the
 *    edge feathered so it reads as a wavefront rather than a bar.
 *  - Words off the lead sit in the app's falloff ladder — alpha [1, .8, .7,
 *    .58, .46] and blur [0, 1, 1, 1.7, 2.4]px indexed by distance — so the
 *    two lines around the playing one stay readable and only past that does
 *    the panel let go.
 *  - Tapping any line seeks to it (the app's onSeekToLine), a row under a
 *    finger dips, and the active row scales up from 0.98.
 *  - Instrumental breaks are three dots that fill left to right across the
 *    break, and the row only opens while the break is playing.
 *  - Plain-text providers get [Section] headers as chips.
 *  - A lyrics offset (± ms) and the provider / manual search live in the
 *    toolbar; everything re-fetches live.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { player } from '../player/player';
import { usePlayer } from '../state/store';
import {
  activeLineIndex,
  isGap,
  lineEnd,
  wordLift,
  wordSpans,
} from '../lyrics/lyrics';
import type { Lyrics, LyricLine } from '../lyrics/lyrics';
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
 * Drives the karaoke off rAF, carried forward from the player's coarser
 * reports (the app's rememberLyricClock idea: advance on the frame clock
 * between reports, resync whenever a report lands).
 */
function useSmoothPosition(synced: boolean): number {
  const playerState = usePlayer();
  const [smooth, setSmooth] = useState(playerState.positionMs);
  const playing = playerState.playing;
  const reported = playerState.positionMs;

  useEffect(() => {
    if (!synced || !playing) {
      setSmooth(reported);
      return;
    }
    let raf = 0;
    const tick = () => {
      const audioMs = player.currentAudioTimeMs();
      setSmooth(audioMs ?? reported);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [synced, playing, reported]);

  return synced && playing ? smooth : reported;
}

interface LyricsPageProps {
  lyrics: Lyrics | null;
  loading: boolean;
  song: Song;
  durationMs: number;
  onBack: () => void;
}

export function LyricsPage({ lyrics, loading, song, durationMs, onBack }: LyricsPageProps) {
  const positionMs = useSmoothPosition(lyrics?.synced === true);
  const [offsetMs, setOffsetMs] = useState(0);
  const adjusted = Math.max(0, positionMs - offsetMs);
  const activeIndex = useMemo(
    () => (lyrics?.synced ? activeLineIndex(lyrics.lines, adjusted) : -1),
    [lyrics, adjusted],
  );
  const activeRef = useRef<HTMLDivElement | null>(null);
  const [sheet, setSheet] = useState<'none' | 'offset' | 'provider'>('none');

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

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
        <div className={`lyrics-body${lyrics.synced ? ' lyrics-body-synced' : ''}`}>
          {lyrics.synced
            ? lyrics.lines.map((line, i) => (
                <LyricRow
                  key={i}
                  line={line}
                  lines={lyrics.lines}
                  index={i}
                  activeIndex={activeIndex}
                  positionMs={adjusted}
                  activeRef={i === activeIndex ? (el) => { activeRef.current = el; } : undefined}
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

function LyricRow({
  line,
  lines,
  index,
  activeIndex,
  positionMs,
  activeRef,
  onTap,
}: {
  line: LyricLine;
  lines: LyricLine[];
  index: number;
  activeIndex: number;
  positionMs: number;
  activeRef?: (el: HTMLDivElement | null) => void;
  onTap: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const active = index === activeIndex;
  const past = index < activeIndex;
  const distance = Math.min(4, Math.abs(index - activeIndex));
  const background = line.background;

  if (isGap(line)) {
    // The break: three dots that fill left to right across the interlude, and
    // a row that only opens while the break is playing (the app's swell).
    const nextAt = lines[index + 1]?.at ?? line.at;
    const span = Math.max(1, nextAt - line.at);
    const through = Math.max(0, Math.min(1, (positionMs - line.at) / span));
    return (
      <div
        className={`lyric-gap${active ? ' lyric-gap-active' : ''}`}
        ref={activeRef}
        onClick={onTap}
        role="button"
        tabIndex={-1}
        aria-label="Instrumental"
      >
        {[0, 1, 2].map((dot) => {
          const lit = Math.max(0, Math.min(1, through * 3 - dot));
          return (
            <span
              key={dot}
              style={{
                opacity: 0.25 + 0.75 * lit,
                transform: `scale(${0.76 + 0.24 * lit})`,
              }}
            />
          );
        })}
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

  if (line.words.length === 0 || !active) {
    return (
      <div
        ref={activeRef}
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

  // The sung line: every word carries a gradient whose lit edge travels
  // through it. The edge is feathered by easing the colour stop in — a hard
  // boundary reads as a bar, the feather reads as a wavefront.
  const spans = wordSpans(line);
  const words = line.words;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const [start, end] = spans[i];
    if (start > cursor) {
      parts.push(
        <span key={`s${i}`} className="lyric-plain">
          {line.text.slice(cursor, start)}
        </span>,
      );
    }
    const lift = wordLift(line, i, positionMs);
    const wordStart = words[i].startMs;
    const wordEnd = words[i].endMs;
    let through: number;
    if (positionMs <= wordStart) through = 0;
    else if (positionMs >= wordEnd) through = 1;
    else through = (positionMs - wordStart) / Math.max(1, wordEnd - wordStart);
    const transform = lift > 0 ? `translateY(${(-lift * 0.1).toFixed(4)}em)` : undefined;
    // Feather: the stop pair straddles the reveal point by ~18% of the word,
    // so the cut between lit and unlit ink is a ramp.
    const feather = Math.max(4, (end - start) * 0.18);
    const pct = (v: number) => (v * 100).toFixed(1);
    const wordStyle: React.CSSProperties =
      through >= 1
        ? { color: '#fff', transform }
        : through <= 0
          ? { color: 'rgba(255,255,255,0.28)', transform }
          : {
              color: 'transparent',
              transform,
              backgroundImage: `linear-gradient(90deg, #fff 0%, #fff ${pct(Math.max(0, through - feather / (end - start)))}%, rgba(255,255,255,0.28) ${pct(Math.min(1, through + feather / (end - start)))}%, rgba(255,255,255,0.28) 100%)`,
            };
    parts.push(
      <span key={`w${i}`} className="lyric-word" style={wordStyle}>
        {line.text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < line.text.length) {
    parts.push(
      <span key="tail" className="lyric-plain" style={{ color: 'rgba(255,255,255,0.28)' }}>
        {line.text.slice(cursor)}
      </span>,
    );
  }

  return (
    <div
      ref={activeRef}
      className={`${lineClass} lyric-swept`}
      style={style}
      onClick={seek}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      role="button"
      tabIndex={-1}
    >
      {parts}
      {background && <span className="lyric-background">({background.text})</span>}
    </div>
  );
}

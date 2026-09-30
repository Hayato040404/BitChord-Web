/**
 * BitChord web — the lyrics page.
 *
 * The reading experience ported from the app's PlayerLyrics: Apple Music's
 * karaoke — a sweep that reveals each line as it is sung, words that rise as
 * they land and settle after, a fade back to ink once past — with duet lines
 * laid out on opposite sides, instrumental gaps shown as a breathing "···",
 * and the active line scrolled to centre.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { player } from '../player/player';
import { usePlayer } from '../state/store';
import {
  activeLineIndex,
  isGap,
  isLifted,
  revealedFraction,
  wordLift,
  wordSpans,
} from '../lyrics/lyrics';
import type { Lyrics, LyricLine } from '../lyrics/lyrics';

/**
 * Drives the karaoke off rAF for a sweep that moves with the song rather than
 * in four steps a second (positionMs ticks at 250 ms). Reads the active
 * element's clock directly; falls back to the ticked position when paused.
 */
function useSmoothPosition(synced: boolean): number {
  const playerState = usePlayer();
  const [smooth, setSmooth] = useState(playerState.positionMs);
  const playing = playerState.playing;

  useEffect(() => {
    if (!synced || !playing) {
      setSmooth(playerState.positionMs);
      return;
    }
    let raf = 0;
    const tick = () => {
      const audioMs = player.currentAudioTimeMs();
      setSmooth(audioMs ?? playerState.positionMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // positionMs intentionally not a dependency: the rAF loop reads live time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synced, playing]);

  return synced && playing ? smooth : playerState.positionMs;
}

export function LyricsPage({
  lyrics,
  onBack,
}: {
  lyrics: Lyrics | null;
  onBack: () => void;
}) {
  const positionMs = useSmoothPosition(lyrics?.synced === true);
  const activeIndex = useMemo(
    () => (lyrics?.synced ? activeLineIndex(lyrics.lines, positionMs) : -1),
    [lyrics, positionMs],
  );
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  return (
    <div className="lyrics-page">
      <div className="queue-top safe-top">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.8 16.8q.3-.3.288-.7t-.288-.7L7.8 12.5h9.4q.375 0 .638-.263t.262-.637t-.262-.638t-.638-.262H7.8l3-3q.3-.3.3-.7t-.3-.7t-.7-.3t-.7.3L5.4 11.3q-.15.15-.213.325T5.125 12t.063.375t.212.325l4.6 4.6q.275.275.688.288t.712-.288Z" />
          </svg>
        </button>
        <span className="title-medium">{lyrics?.provider ?? 'Lyrics'}</span>
        <span className="lyrics-wordmark label-small">
          {lyrics?.wordSynced ? 'WORD SYNC' : lyrics?.synced ? 'SYNCED' : ''}
        </span>
      </div>
      {!lyrics ? (
        <div className="lyrics-body">
          <div className="body-large" style={{ color: 'rgba(255,255,255,0.6)' }}>
            No lyrics found for this track.
          </div>
        </div>
      ) : (
        <div className={`lyrics-body${lyrics.synced ? ' lyrics-body-synced' : ''}`}>
          {lyrics.synced
            ? lyrics.lines.map((line, i) => (
                <LyricRow
                  key={i}
                  line={line}
                  state={lineState(i, activeIndex, lyrics.lines)}
                  positionMs={positionMs}
                  activeRef={i === activeIndex ? (el) => { activeRef.current = el; } : undefined}
                />
              ))
            : lyrics.lines.map((line, i) => (
                <div key={i} className="lyric-line body-large">
                  {line.text}
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

/** The emphasis window Apple uses: sung, then the line about to be sung. */
function lineState(
  index: number,
  activeIndex: number,
  lines: LyricLine[],
): 'past' | 'active' | 'next' | 'future' {
  if (index < activeIndex) return 'past';
  if (index === activeIndex) return 'active';
  if (index === activeIndex + 1 && !isGap(lines[activeIndex + 1])) return 'next';
  return 'future';
}

function LyricRow({
  line,
  state,
  positionMs,
  activeRef,
}: {
  line: LyricLine;
  state: 'past' | 'active' | 'next' | 'future';
  positionMs: number;
  activeRef?: (el: HTMLDivElement | null) => void;
}) {
  if (isGap(line)) {
    return (
      <div className="lyric-gap" ref={activeRef} aria-hidden="true">
        <span /><span /><span />
      </div>
    );
  }

  const background = line.background;

  if (line.words.length === 0 || state !== 'active') {
    return (
      <div
        ref={activeRef}
        className={`lyric-line lyrics-big lyric-${state}${line.alignment === 'end' ? ' lyric-end' : ''}`}
      >
        {line.text}
        {background && <span className="lyric-background">({background.text})</span>}
      </div>
    );
  }

  // The sung line: a sweep over a dim copy, words that lift as they land.
  const spans = wordSpans(line);
  const revealed = revealedFraction(line, positionMs);
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
    parts.push(
      <span
        key={`w${i}`}
        className="lyric-word"
        style={{
          transform: `translateY(${(-lift * 0.12).toFixed(4)}em)`,
          opacity: (0.6 + lift * 0.4).toFixed(3),
        }}
      >
        {line.text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < line.text.length) {
    parts.push(
      <span key="tail" className="lyric-plain">
        {line.text.slice(cursor)}
      </span>,
    );
  }

  return (
    <div
      ref={activeRef}
      className={`lyric-line lyrics-big lyric-active lyric-swept${line.alignment === 'end' ? ' lyric-end' : ''}`}
    >
      <span className="lyric-reveal" style={{ clipPath: `inset(0 ${(1 - revealed) * 100}% 0 0)` }}>
        {parts}
      </span>
      {background && <span className="lyric-background">({background.text})</span>}
    </div>
  );
}

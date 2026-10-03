/**
 * BitChord web — the lyrics panel's scroll, lifted from YTM_Immersion.
 *
 * A critically damped spring rather than a `scroll-behavior: smooth` tween,
 * because the target keeps moving: every time the sung line changes, the panel
 * is handed a new destination while it is still travelling toward the last
 * one. A critically damped spring can change goal mid-flight and keep its
 * velocity, so the motion never restarts or snaps. Being critically damped it
 * also cannot overshoot, so the line never bounces past where it belongs.
 *
 * Ported from the `requestLyricScroll` / `stepLyricScroll` pair in
 * YTM_Immersion's `web/js/lyrics-engine.js`.
 */

// ---- constants (the same values as lyrics-engine.js) ------------------------

const STIFFNESS = 120;
const DAMPING = 2 * Math.sqrt(STIFFNESS);
const SETTLE_PX = 0.5;
const SETTLE_VEL = 8;
/** How far the panel may drift from what we last wrote and still count as ours. */
const HANDOVER_PX = 4;
/** How long we stay out of the way after the reader scrolls by hand. */
const USER_RESUME_SEC = 3;
/** The sung line sits a little above centre — closer to where the eye rests. */
const ANCHOR_FRACTION = 0.38;
/** Ignore scroll events we know we caused, for this long after writing one. */
const SUPPRESS_MS = 220;
const SUPPRESS_MS_INSTANT = 300;

export interface LyricScrollController {
  /** Move to [target]. The spring keeps its velocity; [instant] snaps. */
  request(target: number, instant?: boolean): void;
  /** Advance the spring. Call once per frame with the frame time in seconds. */
  step(dt: number): void;
  /** Scroll so [row] sits at the anchor line. */
  scrollToRow(row: HTMLElement, instant?: boolean): void;
  /** True while the reader is driving the panel themselves. */
  isUserScrolling(): boolean;
  /** Drop all spring state, e.g. after the lyrics are re-laid out. */
  reset(): void;
}

export function createLyricScroll(container: HTMLElement): LyricScrollController {
  /** Where the spring currently thinks the panel is. */
  let pos: number | undefined;
  /** Its velocity, px per second. */
  let vel = 0;
  /** Where it is heading. `undefined` means "arrived". */
  let target: number | undefined;
  /** The last scrollTop we wrote, used to tell our own scrolling from the user's. */
  let lastWritten: number | undefined;
  let userScrollUntil = 0;
  let suppressUntil = 0;

  /**
   * True once we have written a scroll position AND the panel has since moved
   * further than the handover margin — i.e. something other than us moved it.
   * Before the first write there is nothing to compare against, so this is
   * false; `request` handles that case separately.
   */
  const movedAway = (): boolean =>
    lastWritten !== undefined && Math.abs(container.scrollTop - lastWritten) > HANDOVER_PX;

  const snap = () => {
    if (target === undefined) return;
    container.scrollTop = target;
    pos = container.scrollTop;
    lastWritten = container.scrollTop;
    vel = 0;
    target = undefined;
  };

  const request = (next: number, instant = false) => {
    if (instant) {
      target = next;
      snap();
      return;
    }
    // Start from where the panel actually is if we have not written a position
    // yet, or if something moved it behind our back.
    if (lastWritten === undefined || movedAway()) {
      pos = container.scrollTop;
      vel = 0;
    }
    target = next;
  };

  // A scroll event fires for our own writes too. Only an excursion further
  // than the handover margin means a finger did it.
  const onScroll = () => {
    if (performance.now() < suppressUntil) return;
    if (!movedAway()) return;
    userScrollUntil = performance.now() + USER_RESUME_SEC * 1000;
  };
  container.addEventListener('scroll', onScroll, { passive: true });

  return {
    request,

    step(dt: number) {
      if (target === undefined || !(dt > 0)) return;

      // A hand on the panel wins: let go of the target and stay put.
      if (movedAway()) {
        target = undefined;
        vel = 0;
        return;
      }

      let p = pos ?? container.scrollTop;
      let v = vel;
      const diff = p - target;

      if (Math.abs(diff) < SETTLE_PX && Math.abs(v) < SETTLE_VEL) {
        snap();
        return;
      }

      v += (-STIFFNESS * diff - DAMPING * v) * dt;
      p += v * dt;

      pos = p;
      vel = v;
      container.scrollTop = p;
      lastWritten = container.scrollTop;
    },

    scrollToRow(row: HTMLElement, instant = false) {
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const anchor = container.clientHeight * ANCHOR_FRACTION - rowRect.height / 2;
      const next = container.scrollTop + rowRect.top - containerRect.top - anchor;
      suppressUntil = performance.now() + (instant ? SUPPRESS_MS_INSTANT : SUPPRESS_MS);
      request(next, instant);
    },

    isUserScrolling() {
      return performance.now() < userScrollUntil;
    },

    reset() {
      pos = undefined;
      vel = 0;
      target = undefined;
      lastWritten = undefined;
      userScrollUntil = 0;
      suppressUntil = 0;
    },
  };
}
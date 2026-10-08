import { useEffect, useState } from "react";

/**
 * Playback pace for the animated maps.
 *
 * The two players hold longer on beats that carry the reasoning — a hop that
 * impairs a downstream plant, an exposure that cannot be rerouted, the closing
 * summary. That relative weighting is what makes the sequence readable, so the
 * user control sets a BASE seconds-per-step and the weighting is applied on top,
 * rather than replacing it with one flat interval.
 *
 * The choice is persisted because it is a presentation preference, not scenario
 * state: someone who slows the player down to talk over it wants it to stay slow
 * when they move between the ripple and the optimisation view.
 */

const KEY = "sc.playback.baseSeconds";

export const PACE_OPTIONS = [1.5, 3, 5, 8, 12, 20] as const;

/** How much longer a beat holds when it carries explanation. */
export const HEAVY_BEAT_FACTOR = 1.45;

function read(): number {
  if (typeof window === "undefined") return 3;
  const raw = window.localStorage.getItem(KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** Base seconds per step, persisted across pages and reloads. */
export function usePace(): [number, (n: number) => void] {
  const [sec, setSec] = useState<number>(read);

  useEffect(() => {
    try { window.localStorage.setItem(KEY, String(sec)); } catch { /* private mode */ }
  }, [sec]);

  return [sec, setSec];
}

/**
 * Dwell for one beat, in milliseconds.
 *
 * `heavy` marks the beats worth lingering on. Everything scales from the user's
 * base, so picking 20s genuinely gives ~20s per ordinary beat and ~29s on the
 * ones that explain something.
 */
export function dwellMs(baseSeconds: number, heavy: boolean): number {
  return Math.round(baseSeconds * 1000 * (heavy ? HEAVY_BEAT_FACTOR : 1));
}

/** Label for a pace value. */
export function paceLabel(sec: number): string {
  if (sec < 2) return `${sec}s · brisk`;
  if (sec <= 3) return `${sec}s · normal`;
  if (sec <= 5) return `${sec}s · slow`;
  if (sec <= 8) return `${sec}s · study`;
  return `${sec}s · very slow`;
}

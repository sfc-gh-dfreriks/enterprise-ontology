/**
 * One severity scale, used by every scenario view.
 *
 * The map and the graph sit side by side and must agree: if a node reads amber
 * on one and red on the other the reader trusts neither. Both import from here.
 *
 * The scale is calibrated to the data range rather than to fixed thresholds —
 * a caveat the Creately guidance is explicit about, because a fixed 0/50/100
 * banding makes every scenario look either trivial or catastrophic depending on
 * where the real values happen to fall.
 */

/** Snowflake blue through amber to red. Interpolated in HSL for even steps. */
const STOPS: [number, string][] = [
  [0.00, "#94a3b8"],   // slate — untouched
  [0.15, "#38bdf8"],   // light blue — barely affected
  [0.35, "#facc15"],   // yellow
  [0.60, "#f97316"],   // orange
  [1.00, "#dc2626"],   // red — total loss
];

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour for an impairment or impact fraction in 0..1. */
export function severityColor(t: number): string {
  const x = Math.max(0, Math.min(1, t || 0));
  let lo = STOPS[0], hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (x >= STOPS[i][0] && x <= STOPS[i + 1][0]) { lo = STOPS[i]; hi = STOPS[i + 1]; break; }
  }
  const span = hi[0] - lo[0] || 1;
  const k = (x - lo[0]) / span;
  const a = hexToRgb(lo[1]), b = hexToRgb(hi[1]);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Ring colour by hop distance, darkest at the origin. */
export const HOP_COLOR = ["#7f1d1d", "#dc2626", "#f97316", "#facc15", "#fde68a"];

export function hopColor(hop: number): string {
  return HOP_COLOR[Math.min(hop, HOP_COLOR.length - 1)];
}

/** Node glyph colours by role, for the undisrupted baseline. */
export const TYPE_COLOR: Record<string, string> = {
  Plant: "#1B3A57",
  Supplier: "#7D44CF",
  Customer: "#0e7490",
};

/**
 * Edge thickness from monthly volume.
 *
 * Square-root scaled: volume spans 2 to 30 units, and a linear map makes the
 * thin lanes invisible while the fat ones dominate. Thickness carries structural
 * importance; colour carries disruption state. Keeping the two encodings separate
 * is what lets a reader see "big lane, unaffected" at a glance.
 */
export function edgeWidth(volume: number, max: number, min = 1, maxPx = 7): number {
  if (!max) return min;
  return min + (maxPx - min) * Math.sqrt(Math.max(0, volume) / max);
}

export const money = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
};

export const pct = (n: number | null | undefined, dp = 0): string =>
  `${(Number(n ?? 0)).toFixed(dp)}%`;

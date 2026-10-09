/**
 * One severity scale for every enterprise scenario view, the same as the Supply
 * Chain ripple pages: the map and the graph sit side by side and must agree on
 * what amber and red mean.
 */
const STOPS: [number, string][] = [
  [0.00, "#94a3b8"], [0.15, "#38bdf8"], [0.35, "#facc15"], [0.60, "#f97316"], [1.00, "#dc2626"],
];
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** Colour for an impact fraction in 0..1. */
export function severityColor(t: number): string {
  const x = Math.max(0, Math.min(1, t || 0));
  let lo = STOPS[0], hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) if (x >= STOPS[i][0] && x <= STOPS[i + 1][0]) { lo = STOPS[i]; hi = STOPS[i + 1]; break; }
  const k = (x - lo[0]) / (hi[0] - lo[0] || 1);
  const a = rgb(lo[1]), b = rgb(hi[1]);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
}

/** Ring colour by hop distance, darkest at the origin. */
const HOP = ["#7f1d1d", "#dc2626", "#f97316", "#facc15", "#fde68a", "#fef3c7"];
export const hopColor = (hop: number) => HOP[Math.min(Math.max(hop, 0), HOP.length - 1)];

/** Baseline glyph colours by node type, before a scenario touches them. */
export const TYPE_COLOR: Record<string, string> = {
  Supplier: "#7D44CF", Plant: "#1B3A57", Customer: "#0e7490", LegalEntity: "#0f172a", Currency: "#475569", App: "#334155",
};

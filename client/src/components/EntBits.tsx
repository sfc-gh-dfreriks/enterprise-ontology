/** Shared bits for the enterprise pages: module chips, money, and ranked bars. */
export const MODULE_COLOR: Record<string, string> = {
  CORE: "#0f172a", FIN: "#0ea5e9", SAL: "#22c55e", PPL: "#a855f7", SPD: "#f59e0b", WCP: "#14b8a6", SCM: "#ef4444",
};
export const MODULE_NAME: Record<string, string> = {
  CORE: "Enterprise core", FIN: "Finance", SAL: "Sales", PPL: "People", SPD: "Spend", WCP: "Working Capital", SCM: "Supply Chain",
};

export function usd(v: any, digits = 1): string {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
export const num = (v: any, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

export function ModuleChips({ list }: { list?: string | null }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {(list ?? "").split(",").filter(Boolean).map((m) => (
        <span key={m} title={MODULE_NAME[m]} className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ background: MODULE_COLOR[m] ?? "#64748b" }}>{m}</span>
      ))}
    </span>
  );
}

/** Horizontal bars ranked largest first (chart policy: no pies, descending order). */
export function RankBars({ rows, value, label, format = usd, color = "#6366f1", max = 12, onClick }: {
  rows: any[]; value: (r: any) => number; label: (r: any) => string; format?: (v: number) => string;
  color?: string | ((r: any) => string); max?: number; onClick?: (r: any) => void;
}) {
  const ranked = [...rows].filter((r) => Number(value(r)) > 0).sort((a, b) => value(b) - value(a)).slice(0, max);
  const top = ranked.length ? value(ranked[0]) : 1;
  return (
    <div className="space-y-1.5">
      {ranked.map((r, i) => (
        <button key={i} onClick={() => onClick?.(r)} disabled={!onClick}
          className="grid w-full grid-cols-[10rem_1fr_5rem] items-center gap-2 text-left text-xs enabled:hover:bg-slate-50">
          <span className="truncate text-slate-700" title={label(r)}>{label(r)}</span>
          <span className="h-3 rounded bg-slate-100">
            <span className="block h-3 rounded" style={{ width: `${(100 * value(r)) / top}%`,
              background: typeof color === "function" ? color(r) : color }} />
          </span>
          <span className="text-right font-semibold tabular-nums text-slate-800">{format(value(r))}</span>
        </button>
      ))}
      {!ranked.length && <p className="text-xs text-slate-400">No values.</p>}
    </div>
  );
}

export function Panel({ title, children, right }: { title: string; children: any; right?: any }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>{right}
      </div>
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-extrabold text-slate-800">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function Caveat({ children }: { children: any }) {
  return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{children}</p>;
}

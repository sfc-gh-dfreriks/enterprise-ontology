import type { StackLayer } from "../lib/api";

/**
 * The deployed ontology stack, L1 to L5.
 *
 * Every figure here is read from Snowflake by tools/export_ontology_schema.py,
 * not written by hand — a diagram that claims objects exist when they do not is
 * worse than no diagram. Widths are proportional to a log of the object count so
 * L1 (2,662 nodes) does not flatten L5 (one agent) into nothing.
 */

const TONE: Record<string, { bar: string; chip: string; text: string }> = {
  L1: { bar: "bg-slate-700",  chip: "bg-slate-100 text-slate-700",  text: "text-slate-700" },
  L2: { bar: "bg-[#1B3A57]",  chip: "bg-slate-100 text-[#1B3A57]",  text: "text-[#1B3A57]" },
  L3: { bar: "bg-[#0ea5e9]",  chip: "bg-sky-50 text-sky-700",       text: "text-sky-700" },
  L4: { bar: "bg-[#29B5E8]",  chip: "bg-cyan-50 text-cyan-700",     text: "text-cyan-700" },
  L5: { bar: "bg-purple-500", chip: "bg-purple-50 text-purple-700", text: "text-purple-700" },
};

export function LayerStack({ stack, compact = false }: {
  stack: StackLayer[];
  compact?: boolean;
}) {
  // log scale: object counts span 1 to 2,662, and a linear bar would render the
  // agent row as a hairline.
  const widths = stack.map((s) => Math.log10(Math.max(s.objects, 1) + 1));
  const maxW = Math.max(...widths, 1);

  return (
    <div className="space-y-1.5">
      {stack.map((s, i) => {
        const tone = TONE[s.layer] ?? TONE.L1;
        const pct = Math.max(14, Math.round((widths[i] / maxW) * 100));
        return (
          <div key={s.layer} className="group flex items-center gap-2.5">
            <span className={`w-7 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold ${tone.chip}`}>
              {s.layer}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`shrink-0 text-[12px] font-semibold ${tone.text}`}>{s.name}</span>
                <span className="truncate font-mono text-[10px] text-slate-500">{s.detail}</span>
              </div>
              {!compact && (
                <div className="mt-0.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${tone.bar} transition-all`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[10px] text-slate-400">
                    {s.objects}
                  </span>
                </div>
              )}
              {!compact && (
                <div className="text-[10px] leading-snug text-slate-400">{s.note}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Abstract-class rollup as proportional bars. Showing Customer 8 / Supplier 6 as
 * a split bar makes the point faster than two numbers do: one query, several
 * concrete types.
 */
export function RollupBars({ breakdown, total, palette }: {
  breakdown: { type: string; count: number }[];
  total: number;
  palette?: string[];
}) {
  const colors = palette ?? ["#29B5E8", "#1B3A57", "#0ea5e9", "#14b8a6", "#94a3b8", "#a855f7"];
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 overflow-hidden rounded-full ring-1 ring-slate-200">
        {breakdown.map((b, i) => (
          <div key={b.type}
            title={`${b.type}: ${b.count.toLocaleString()}`}
            style={{ width: `${(b.count / Math.max(total, 1)) * 100}%`,
                     backgroundColor: colors[i % colors.length] }} />
        ))}
      </div>
      <div className="space-y-0.5">
        {breakdown.map((b, i) => (
          <div key={b.type} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 text-slate-700">
              <span className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: colors[i % colors.length] }} />
              {b.type}
            </span>
            <span className="font-medium text-slate-900">{b.count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Kpi } from "../lib/substeps";
import { HEAVY_BEAT_FACTOR, PACE_OPTIONS, paceLabel } from "../lib/pace";

/**
 * Shared step-narration furniture for the two animated maps.
 *
 * Both the ripple (what breaks) and the optimisation (what we do about it) play as
 * a sequence of beats over a map, so they share the same three pieces:
 *
 *   SubtitleBand  one burned-in line across the bottom of the map
 *   KpiCards      popout cards that animate in when the beat changes
 *   ExplainStep   the arithmetic behind the beat, on demand
 *
 * The cards deliberately re-mount on every beat (via a `key` on the row) so the
 * entrance animation replays. Without that they would silently update in place and
 * the eye would miss the change, which is the whole point of showing them.
 */

const TONE: Record<Kpi["tone"], { card: string; label: string; value: string }> = {
  neutral: { card: "border-slate-200 bg-white",     label: "text-slate-500", value: "text-slate-800" },
  bad:     { card: "border-rose-200 bg-rose-50",    label: "text-rose-600",  value: "text-rose-700" },
  warn:    { card: "border-amber-200 bg-amber-50",  label: "text-amber-700", value: "text-amber-800" },
  good:    { card: "border-emerald-200 bg-emerald-50", label: "text-emerald-700", value: "text-emerald-800" },
};

/** Cinematic subtitle strip. Sits over the bottom of the map, not below it. */
export function SubtitleBand({
  text, badge, tone = "dark",
}: { text: string; badge?: string; tone?: "dark" | "green" }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4">
      <div
        className={`flex max-w-4xl items-start gap-2.5 rounded-lg px-4 py-2.5 shadow-lg backdrop-blur-sm
          ${tone === "green"
            ? "bg-emerald-950/85 ring-1 ring-emerald-400/30"
            : "bg-slate-950/85 ring-1 ring-white/10"}`}
      >
        {badge && (
          <span
            className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider
              ${tone === "green" ? "bg-emerald-400 text-emerald-950" : "bg-sky-400 text-slate-950"}`}
          >
            {badge}
          </span>
        )}
        <span className="text-sm font-medium leading-snug text-white/95">{text}</span>
      </div>
    </div>
  );
}

/** A row of popout KPI cards. `beatKey` forces the entrance animation to replay. */
export function KpiCards({ kpis, beatKey }: { kpis: Kpi[]; beatKey: string }) {
  if (!kpis.length) return null;
  return (
    <div key={beatKey} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {kpis.map((k, i) => {
        const t = TONE[k.tone];
        const isDelta = k.before !== undefined && k.after !== undefined;
        return (
          <div
            key={`${k.label}-${i}`}
            title={k.hint}
            className={`animate-kpi-in rounded-lg border px-3 py-2 shadow-sm ${t.card}`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${t.label}`}>
              {k.label}
            </div>

            {isDelta ? (
              <>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xs text-slate-400 line-through">{k.before}</span>
                  <span className="text-slate-400">&rarr;</span>
                  <span className={`text-base font-bold tabular-nums ${t.value}`}>{k.after}</span>
                </div>
                {k.delta && (
                  <div className={`text-[11px] font-semibold tabular-nums ${t.label}`}>{k.delta}</div>
                )}
              </>
            ) : (
              <div className={`mt-1 text-lg font-bold tabular-nums leading-tight ${t.value}`}>
                {k.value}
              </div>
            )}

            {k.hint && (
              <div className="mt-0.5 truncate text-[10px] leading-snug text-slate-400">{k.hint}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * "Explain this step" — the mechanism and the arithmetic.
 *
 * Closes on outside click and on Escape, because a popover that can only be closed
 * by hitting the same small button again is annoying to use during a live demo.
 */
export function ExplainStep({
  why, detail, label = "Explain this step",
}: { why?: string; detail: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number;
                                   maxHeight: number; above: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  /**
   * Position the panel in viewport coordinates.
   *
   * The button sits on the right-hand side of the beat header, so anchoring the
   * panel to the button's left edge pushed a 30rem panel off the screen. Measuring
   * and clamping is used rather than a static `right-0` because the button is not
   * always on the right — the two players place it differently — and a fixed
   * position also escapes any clipping ancestor.
   */
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const M = 12;                                     // keep off the window edge
    const width = Math.min(480, window.innerWidth - M * 2);
    const left = Math.max(M, Math.min(r.left, window.innerWidth - width - M));

    const below = window.innerHeight - r.bottom - M;
    const above = r.top - M;
    // Open upward only when there is materially more room up there.
    const flip = below < 240 && above > below;
    return setPos({
      left,
      top: flip ? Math.max(M, r.top - 8) : r.bottom + 8,
      width,
      maxHeight: Math.max(160, (flip ? above : below) - 8),
      above: flip,
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // Reposition rather than close: the page scrolls while the panel is open.
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  if (!why && !detail.length) return null;

  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition
          ${open
            ? "border-sky-400 bg-sky-50 text-sky-700"
            : "border-slate-300 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700"}`}
      >
        {label}
      </button>

      {open && pos && (
        <div
          ref={box}
          style={{
            position: "fixed",
            left: pos.left,
            ...(pos.above
              ? { bottom: window.innerHeight - pos.top }
              : { top: pos.top }),
            width: pos.width,
            maxHeight: pos.maxHeight,
          }}
          className="z-50 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
        >
          {why && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wider text-sky-600">
                Why this happens
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{why}</p>
            </>
          )}

          {detail.length > 0 && (
            <>
              <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                The numbers
              </div>
              <ul className="mt-1 space-y-1">
                {detail.map((d, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                    <span className="select-none text-slate-300">&bull;</span>
                    <span className="break-words font-mono">{d}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button
            onClick={() => setOpen(false)}
            className="mt-3 text-[11px] text-slate-400 underline hover:text-slate-600"
          >
            close
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Seconds-per-step control for the playback bar.
 *
 * Explicit seconds rather than a "0.5x / 2x" multiplier: the useful question when
 * you are talking an audience through a cascade is "how long do I get on each
 * step", and a multiplier makes you do arithmetic to answer it.
 */
export function PaceControl({
  seconds, onChange, heavyNote = "steps that explain something hold longer",
}: { seconds: number; onChange: (n: number) => void; heavyNote?: string }) {
  const heavy = (seconds * HEAVY_BEAT_FACTOR).toFixed(1).replace(/\.0$/, "");
  return (
    <label
      className="flex items-center gap-1.5 text-xs text-slate-600"
      title={`Each step holds for ${seconds}s. Beats that carry the reasoning hold `
           + `about ${heavy}s — ${heavyNote}.`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        time per step
      </span>
      <select
        value={seconds}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-slate-700
                   focus:border-sky-400 focus:outline-none"
      >
        {PACE_OPTIONS.map((o) => (
          <option key={o} value={o}>{paceLabel(o)}</option>
        ))}
      </select>
      <span className="hidden text-[10px] text-slate-400 sm:inline">
        key beats ~{heavy}s
      </span>
    </label>
  );
}

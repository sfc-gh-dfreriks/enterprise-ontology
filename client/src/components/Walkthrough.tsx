import type { ReactNode } from "react";

/**
 * Presentation frames for the guided walkthrough.
 *
 * The walkthrough embeds the REAL components rather than screenshots. Screenshots
 * would show the surrounding chrome, but they go stale the moment a label or a
 * figure changes, and this application's figures change whenever the SAP catalog
 * is re-sliced. Live components with annotation overlays give the same "here is
 * what you will see" quality and cannot drift from the actual UI.
 *
 * The chrome is faked instead: a titled panel that looks like the page being
 * described, so a reader recognises where they are.
 */

/** A panel styled to look like the page it is standing in for. */
export function ScreenFrame({
  page, caption, children, tone = "light",
}: {
  page: string;
  caption?: string;
  children: ReactNode;
  tone?: "light" | "dark";
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-300 shadow-sm">
      {/* window bar — signals "this is a screen", without pretending to be a screenshot */}
      <div className="flex items-center gap-2 border-b border-gray-300 bg-slate-100 px-3 py-1.5">
        <span className="flex gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-300" />
          <span className="inline-block h-2 w-2 rounded-full bg-amber-300" />
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-300" />
        </span>
        <span className="text-[11px] font-semibold text-slate-600">{page}</span>
        {caption && <span className="ml-auto text-[10px] text-slate-400">{caption}</span>}
      </div>
      <div className={tone === "dark" ? "bg-slate-900 p-2" : "bg-white p-2"}>
        {children}
      </div>
    </div>
  );
}

export interface Pin {
  /** Percentage position within the frame. */
  x: number;
  y: number;
  label: string;
  /** Which side the label sits on, so pins near an edge stay readable. */
  side?: "right" | "left" | "top" | "bottom";
  n?: number;
}

/**
 * Overlay numbered pins on top of arbitrary content.
 *
 * Percentage coordinates rather than pixels: the embedded components are
 * responsive, and a pixel offset would drift off its target the moment the
 * panel width changed.
 */
export function Annotated({ pins, children }: { pins: Pin[]; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      {pins.map((p, i) => {
        const n = p.n ?? i + 1;
        const side = p.side ?? "right";
        const pos: React.CSSProperties = { left: `${p.x}%`, top: `${p.y}%` };
        const labelPos =
          side === "right" ? "left-6 top-1/2 -translate-y-1/2"
          : side === "left" ? "right-6 top-1/2 -translate-y-1/2"
          : side === "top" ? "bottom-6 left-1/2 -translate-x-1/2"
          : "top-6 left-1/2 -translate-x-1/2";
        return (
          <div key={i} className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
               style={pos}>
            <div className="relative">
              {/* pulsing ring draws the eye to the click target */}
              <span className="absolute -inset-2 animate-ping rounded-full bg-sky-400/30" />
              <span className="relative flex h-6 w-6 items-center justify-center rounded-full
                               bg-sky-500 text-[11px] font-bold text-white shadow ring-2 ring-white">
                {n}
              </span>
              <span className={`absolute ${labelPos} whitespace-nowrap rounded
                                bg-slate-900/92 px-2 py-0.5 text-[10.5px] font-medium
                                text-white shadow`}>
                {p.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A mocked control strip, for steps where the real control is a button row. */
export function MockControls({ items, active }: {
  items: { label: string; sub?: string }[];
  active?: number;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
      {items.map((it, i) => (
        <div key={it.label}
             className={`rounded-lg border p-2.5 transition
               ${i === active ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200"
                              : "border-gray-200 bg-white"}`}>
          <div className="text-[11px] font-semibold text-slate-800">{it.label}</div>
          {it.sub && <div className="mt-0.5 text-[10px] leading-tight text-slate-500">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Numbered do-this list that sits beside each screen. */
export function Steps({ items }: { items: { n: number; text: string; note?: string }[] }) {
  return (
    <ol className="space-y-2">
      {items.map((s) => (
        <li key={s.n} className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full
                           bg-sky-500 text-[11px] font-bold text-white">
            {s.n}
          </span>
          <span className="text-xs leading-relaxed text-slate-700">
            {s.text}
            {s.note && (
              <span className="mt-0.5 block text-[11px] italic text-slate-500">{s.note}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

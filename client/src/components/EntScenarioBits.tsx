import { useEffect, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { PRESETS } from "../lib/entScenario";
import { pickScenario, type ActiveScenario } from "../hooks/useActiveScenario";
import { hopColor } from "../lib/entSeverity";

/** Preset chips plus a way back to the Studio for a custom shock. One row on every scenario page. */
export function ScenarioBar({ active, title, onNavigate }: { active: ActiveScenario; title: string; onNavigate?: (p: string) => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Scenario</span>
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => pickScenario(p.id, p.scenario)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${active.presetId === p.id ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {p.label}</button>
        ))}
        {!active.presetId && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">custom</span>}
        {onNavigate && <button onClick={() => onNavigate("ent-scenario")} className="ml-auto text-xs text-indigo-600 hover:underline">Build your own in Scenario Studio →</button>}
      </div>
      <p className="mt-2 text-sm font-bold text-slate-800">{title}</p>
    </div>
  );
}

/** Jump between the four scenario views of the same shock. */
export function ScenarioTabs({ page, onNavigate }: { page: string; onNavigate: (p: string) => void }) {
  const tabs = [["ent-scenario", "Studio"], ["ent-impact", "Impact Map"], ["ent-risk", "Risk Outcome"], ["ent-mitigation", "Mitigation & Recovery"]];
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
      {tabs.map(([id, l]) => (
        <button key={id} onClick={() => onNavigate(id)}
          className={`rounded-md px-3 py-1 ${page === id ? "bg-white font-semibold text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
      ))}
    </div>
  );
}

export interface PlayStep { id: string; label: string; group: number; groupLabel: string }

/** Step chips with play / pause / back / next, the same controls as the Supply Chain ripple. */
export function Playback({ steps, index, onIndex, ms = 3500, groupColor = hopColor }: {
  steps: PlayStep[]; index: number; onIndex: (i: number) => void; ms?: number; groupColor?: (g: number) => string;
}) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => onIndex(index + 1), ms);
    return () => clearTimeout(t);
  }, [playing, index, steps.length, ms, onIndex]);
  const groups = [...new Map(steps.map((s) => [s.group, s.groupLabel])).entries()];
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Playback</span>
        <button onClick={() => { if (index >= steps.length - 1) onIndex(0); setPlaying(!playing); }}
          className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-700">
          {playing ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> {index > 0 ? "Resume" : "Play from the start"}</>}
        </button>
        <button disabled={index <= 0} onClick={() => { setPlaying(false); onIndex(index - 1); }}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-40"><SkipBack className="h-3.5 w-3.5" /> Back</button>
        <button disabled={index >= steps.length - 1} onClick={() => { setPlaying(false); onIndex(index + 1); }}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-40">Next <SkipForward className="h-3.5 w-3.5" /></button>
        <span className="ml-auto text-xs text-slate-400">step {index + 1} of {steps.length}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {groups.map(([g, gl]) => (
          <span key={g} className="flex items-center gap-1">
            <span className="flex items-center gap-1 pl-1 text-[11px] font-semibold text-slate-500">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: groupColor(g) }} />{gl}</span>
            {steps.map((s, i) => s.group === g && (
              <button key={s.id} onClick={() => { setPlaying(false); onIndex(i); }}
                className={`rounded px-2 py-0.5 text-[11px] ${i === index ? "bg-slate-800 font-semibold text-white" : i < index ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                {s.label}</button>
            ))}
          </span>
        ))}
      </div>
      <div className="mt-2 h-1 rounded bg-slate-100"><div className="h-1 rounded bg-sky-500 transition-all" style={{ width: `${(100 * (index + 1)) / steps.length}%` }} /></div>
    </div>
  );
}

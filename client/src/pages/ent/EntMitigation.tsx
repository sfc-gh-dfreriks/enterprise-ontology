import { useEffect, useMemo, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { analyse, defaultLevers, APP_NAME, type Action } from "../../lib/entImpact";
import { fmt } from "../../lib/entScenario";
import { useActiveScenario } from "../../hooks/useActiveScenario";
import { AskCortex } from "../../components/AskCortex";
import { EntWorldMap, type Overlay } from "../../components/EntWorldMap";
import { Playback, ScenarioBar, ScenarioTabs } from "../../components/EntScenarioBits";
import { Caveat, ModuleChips, Panel } from "../../components/EntBits";
import { kpiVal } from "./EntImpact";

const STEP_COLOR = (g: number) => (g === 0 ? "#dc2626" : g === 1 ? "#16a34a" : "#0ea5e9");

/** Mitigation & Recovery — what can be done, what it protects, and what stays exposed. */
export default function EntMitigation({ onNavigate }: { onNavigate: (p: string) => void }) {
  const data = useQuery(() => entApi.scenarioData(), []);
  const [active, setActive] = useActiveScenario();
  const a = useMemo(() => (data.data ? analyse(data.data, active.spec, active.levers) : null), [data.data, active]);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [active]);
  if (data.loading) return <p className="text-sm text-slate-500">Loading scenario inputs…</p>;
  if (data.error || !a) return <p className="text-sm text-rose-600">{data.error}</p>;

  const m = a.mitigation, imp = a.impact;
  const setLever = (id: string, v: number) => setActive({ ...active, levers: { ...active.levers, [id]: v } });
  // Recovery playback: before → each action that protects value, largest first → result.
  const moves = m.actions.filter((x) => x.protectedUsd > 0);
  const steps = [{ id: "before", label: "before", group: 0, groupLabel: "Exposure" },
    ...moves.map((x, k) => ({ id: x.id, label: `fix ${k + 1}`, group: 1, groupLabel: "Actions" })),
    { id: "result", label: "result", group: 2, groupLabel: "Outcome" }];
  const upto = i === 0 ? 0 : i >= steps.length - 1 ? moves.length : i;
  const applied = moves.slice(0, upto);
  const protectedSoFar = applied.reduce((s, x) => s + x.protectedUsd, 0);
  const cur: Action | undefined = i > 0 && i < steps.length - 1 ? moves[i - 1] : undefined;
  const overlays: Overlay[] = applied.filter((x) => x.from && x.to && x.from !== x.to)
    .map((x) => ({ id: x.id, from: x.from!, to: x.to!, label: `${x.title} · protects ${fmt(x.protectedUsd)}` }));
  const touched = new Set(applied.flatMap((x) => [x.to, x.from]).filter(Boolean) as string[]);
  // a node turns green once every action touching it is applied and its residual is small
  const protectedNodes = new Set([...touched].filter((id) => !moves.some((x) => (x.to === id || x.from === id) && !applied.includes(x))));
  const focus = cur ? [cur.from, cur.to].filter(Boolean) as string[] : undefined;
  // levers are sent only when changed, so the public build's baked default analysis is found
  const custom = JSON.stringify(active.levers) !== JSON.stringify(defaultLevers(active.spec));
  const askArgs = { ...(active.presetId ? { preset: active.presetId } : { scenario: JSON.stringify(active.spec) }), ...(custom ? { levers: JSON.stringify(active.levers) } : {}) };
  const pctProtected = m.atRiskUsd ? (100 * m.protectedUsd) / m.atRiskUsd : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ScenarioTabs page="ent-mitigation" onNavigate={onNavigate} />
        <AskCortex key={JSON.stringify(askArgs)} topic="ent-mitigation" args={askArgs} label="Ask Cortex: should we approve this plan?"
          suggestions={["What should we do first?", "What is still exposed and why?", "Which assumption matters most?"]} />
      </div>
      <ScenarioBar active={active} title={`${a.result.title} — recovery`} onNavigate={onNavigate} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["At risk", fmt(m.atRiskUsd), m.exposureLabel, "text-slate-800"],
          ["Protected", fmt(m.protectedUsd), `${pctProtected.toFixed(1)}% of the exposure`, "text-emerald-700"],
          ["Still exposed", fmt(m.residualUsd), `${m.unmitigable.length} items cannot be mitigated`, "text-rose-600"],
          ["Cash effect", fmt(m.cashUsd), "payables held, POs paused, collections, new margin", m.cashUsd >= 0 ? "text-sky-700" : "text-amber-700"]].map(([l, v, s, c]) => (
          <div key={l} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className={`text-2xl font-extrabold ${c}`}>{v}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l}</p>
            <p className="text-xs text-slate-500">{s}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
        <Panel title="Mitigation levers">
          <div className="space-y-4">
            {m.levers.map((l) => (
              <div key={l.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">{l.label}</span>
                  <span className={`rounded px-1.5 text-[10px] font-semibold ${l.derived ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                    {l.derived ? "from data" : "your assumption"}</span>
                </div>
                {l.kind === "toggle"
                  ? <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" checked={!!l.value} onChange={(e) => setLever(l.id, e.target.checked ? 1 : 0)} /> {l.value ? "on" : "off"}</label>
                  : <label className="mt-1 block text-xs text-slate-600"><b>{l.value}%</b>
                      <input type="range" min={0} max={100} step={5} value={l.value} onChange={(e) => setLever(l.id, Number(e.target.value))} className="w-full" /></label>}
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{l.help}</p>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Recovery on the network" right={<span className="text-xs text-slate-500">dashed green = mitigation · green node = protected</span>}>
            <EntWorldMap nodes={imp.nodes} links={imp.links} nodeHits={imp.nodeHits} linkHits={imp.linkHits}
              overlays={overlays} protectedNodes={protectedNodes} focus={focus} height={360} />
            <div className="mt-3">
              <div className="flex justify-between text-[11px] text-slate-500"><span>protected so far</span><span>{fmt(protectedSoFar)} of {fmt(m.atRiskUsd)}</span></div>
              <div className="mt-1 flex h-3 overflow-hidden rounded bg-rose-200">
                <div className="h-3 bg-emerald-500 transition-all duration-500" style={{ width: `${m.atRiskUsd ? (100 * protectedSoFar) / m.atRiskUsd : 0}%` }} />
              </div>
            </div>
          </Panel>
          <Playback steps={steps} index={i} onIndex={setI} groupColor={STEP_COLOR} />
          <section className="rounded-xl border-2 bg-white p-4 shadow-sm" style={{ borderColor: STEP_COLOR(steps[i].group) }}>
            {i === 0 && <><h2 className="text-base font-bold text-slate-800">Before mitigation</h2>
              <p className="mt-1 text-sm text-slate-700">{fmt(m.atRiskUsd)} of {m.exposureLabel} is exposed. The plan works through it largest first: {moves.length} actions protect value, {m.actions.length - moves.length} more move cash.</p></>}
            {cur && <><div className="flex items-center gap-2"><span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">FIX {i}</span>
              <h2 className="text-base font-bold text-slate-800">{cur.title}</h2><ModuleChips list={cur.module} />
              {!cur.derived && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">your assumption</span>}</div>
              <p className="mt-1 text-sm text-slate-700">{cur.detail}. Protects <b>{fmt(cur.protectedUsd)}</b>; {fmt(m.atRiskUsd - protectedSoFar)} still exposed after this step.</p></>}
            {i === steps.length - 1 && <><h2 className="text-base font-bold text-slate-800">Result</h2>
              <p className="mt-1 text-sm text-slate-700">{fmt(m.protectedUsd)} protected ({pctProtected.toFixed(1)}%), {fmt(m.residualUsd)} still exposed. Risk moves from <b>{a.riskBefore.overall}</b> to <b>{a.riskAfter.overall}</b>.
                {m.unmitigable.length > 0 && ` What remains is structural: ${m.unmitigable.slice(0, 2).map((u) => u.title).join(" and ")}.`}</p></>}
          </section>
        </div>
      </div>

      <Panel title="Actions, in priority order">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500"><tr><th className="py-1">#</th><th>Action</th><th>App</th><th>Basis</th><th className="text-right">Protects</th><th className="text-right">Cash</th></tr></thead>
          <tbody>{m.actions.map((x, k) => (
            <tr key={x.id} className="border-t border-slate-100 align-top">
              <td className="py-1.5 text-slate-400">{k + 1}</td>
              <td><b className="text-slate-800">{x.title}</b><div className="text-slate-500">{x.detail}</div></td>
              <td><ModuleChips list={x.module} /></td>
              <td><span className={`rounded px-1.5 text-[10px] font-semibold ${x.derived ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{x.derived ? "from data" : "assumption"}</span></td>
              <td className="text-right font-semibold tabular-nums text-emerald-700">{x.protectedUsd ? fmt(x.protectedUsd) : "—"}</td>
              <td className={`text-right tabular-nums ${x.cashUsd < 0 ? "text-amber-700" : "text-sky-700"}`}>{x.cashUsd ? fmt(x.cashUsd) : "—"}</td>
            </tr>))}
            {!m.actions.length && <tr><td colSpan={6} className="py-3 text-slate-400">No levers are switched on.</td></tr>}
          </tbody>
        </table>
      </Panel>

      {m.unmitigable.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-rose-700">Cannot be mitigated — {fmt(m.unmitigable.reduce((s, u) => s + u.valueUsd, 0))} exposed</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-2">{m.unmitigable.map((u) => (
            <div key={u.title} className="flex justify-between gap-2 rounded-lg border border-rose-200 bg-white p-3 text-xs">
              <span><b className="text-slate-800">{u.title}</b><div className="text-slate-500">{u.reason}</div></span>
              <b className="text-rose-600">{fmt(u.valueUsd)}</b></div>))}</div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="What each app sees — before and after the plan">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500"><tr><th className="py-1">App</th><th>Metric</th><th className="text-right">Before</th><th className="text-right">After</th><th className="text-right">Saved</th></tr></thead>
            <tbody>{m.before.map((e, k) => {
              // saved is the size of the improvement, whichever direction the metric runs
              const f = m.after[k], saved = Math.abs(f.delta - e.delta);
              return (
                <tr key={k} className="border-t border-slate-100">
                  <td className="py-1.5" title={APP_NAME[e.module]}><ModuleChips list={e.module} /></td>
                  <td className="font-semibold text-slate-800">{e.metric}</td>
                  <td className={`text-right tabular-nums ${e.delta < 0 ? "text-rose-600" : ""}`}>{kpiVal(e.delta, e.unit)}</td>
                  <td className={`text-right tabular-nums ${f.delta < 0 ? "text-rose-600" : ""}`}>{kpiVal(f.delta, f.unit)}</td>
                  <td className="text-right font-semibold tabular-nums text-emerald-700">{Math.abs(saved) > 0.5 ? kpiVal(saved, e.unit) : "—"}</td>
                </tr>);
            })}</tbody>
          </table>
        </Panel>
        {m.capacityAfter.length > 0 && (
          <Panel title="Load on the receiving plants">
            <div className="space-y-2.5">{m.capacityAfter.map((c) => (
              <div key={c.plant} className="text-xs">
                <div className="flex justify-between"><span className="font-semibold text-slate-700">{c.name}</span>
                  <span className={c.headroomAfter < 2 ? "font-bold text-rose-600" : "text-slate-500"}>headroom {c.headroomBefore}% → {c.headroomAfter}%</span></div>
                <div className="mt-1 flex h-2.5 overflow-hidden rounded bg-slate-100">
                  <div className="h-2.5 bg-slate-400" style={{ width: `${100 - c.headroomBefore}%` }} />
                  <div className="h-2.5 bg-rose-500" style={{ width: `${Math.max(0, c.headroomBefore - c.headroomAfter)}%` }} /></div>
                {c.headroomAfter < 2 && c.headroomBefore > c.headroomAfter && <p className="mt-0.5 text-[11px] text-rose-600">no recovery room left if anything else slips</p>}
              </div>))}</div>
            <p className="mt-3 text-[11px] text-slate-400">Grey = load today, red = added by reroutes. Hours per unit are blended per plant — planning grade.</p>
          </Panel>
        )}
      </div>
      <Caveat>{m.caveats.join(" ")} Levers marked "your assumption" are inputs, not findings — change them to test the plan.</Caveat>
    </div>
  );
}

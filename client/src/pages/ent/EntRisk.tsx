import { useMemo, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { analyse, defaultLevers, APP_NAME, BAND_COLOR, type Band, type Risk } from "../../lib/entImpact";
import { fmt } from "../../lib/entScenario";
import { useActiveScenario } from "../../hooks/useActiveScenario";
import { AskCortex } from "../../components/AskCortex";
import { ScenarioBar, ScenarioTabs } from "../../components/EntScenarioBits";
import { Caveat, ModuleChips, Panel } from "../../components/EntBits";

const BANDS: Band[] = ["Low", "Moderate", "High", "Critical"];
const BandChip = ({ b }: { b: Band }) => (
  <span className="rounded px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: BAND_COLOR[b] }}>{b}</span>
);

/** Risk Outcome — how bad the scenario is for each app, when it lands, and what is left after mitigation. */
export default function EntRisk({ onNavigate }: { onNavigate: (p: string) => void }) {
  const data = useQuery(() => entApi.scenarioData(), []);
  const [active] = useActiveScenario();
  const a = useMemo(() => (data.data ? analyse(data.data, active.spec, active.levers) : null), [data.data, active]);
  const [view, setView] = useState<"before" | "after">("before");
  if (data.loading) return <p className="text-sm text-slate-500">Loading scenario inputs…</p>;
  if (data.error || !a) return <p className="text-sm text-rose-600">{data.error}</p>;

  const risk: Risk = view === "before" ? a.riskBefore : a.riskAfter;
  const m = a.mitigation;
  // levers are sent only when changed, so the public build's baked default analysis is found
  const custom = JSON.stringify(active.levers) !== JSON.stringify(defaultLevers(active.spec));
  const askArgs = { ...(active.presetId ? { preset: active.presetId } : { scenario: JSON.stringify(active.spec) }), ...(custom ? { levers: JSON.stringify(active.levers) } : {}) };
  const horizon = Math.max(1, ...risk.timeline.map((t) => t.day), "weeks" in active.spec ? active.spec.weeks * 7 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ScenarioTabs page="ent-risk" onNavigate={onNavigate} />
        <AskCortex key={JSON.stringify(askArgs)} topic="ent-risk" args={askArgs} label="Ask Cortex: how worried should we be?"
          suggestions={["Which risk needs a decision this week?", "What is the single biggest point of failure?", "How much risk is left after the plan?"]} />
      </div>
      <ScenarioBar active={active} title={a.result.title} onNavigate={onNavigate} />

      <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderTop: `4px solid ${BAND_COLOR[risk.overall]}` }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{view === "before" ? "Inherent risk" : "Residual risk"}</p>
            <div className="flex rounded-md bg-slate-100 p-0.5 text-[11px]">
              {(["before", "after"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`rounded px-2 py-0.5 ${view === v ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}>
                  {v === "before" ? "before mitigation" : "after the plan"}</button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-3xl font-extrabold" style={{ color: BAND_COLOR[risk.overall] }}>{risk.overall}</p>
          <p className="text-xs text-slate-500">risk index {risk.score} / 100 · inherent {a.riskBefore.overall} → residual {a.riskAfter.overall}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Exposure ({m.exposureLabel})</p>
          <p className="mt-1 text-2xl font-extrabold text-rose-600">{fmt(view === "before" ? m.atRiskUsd : m.residualUsd)}</p>
          <p className="text-xs text-slate-500">{view === "before" ? "before any action" : `${fmt(m.protectedUsd)} protected by the plan`}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">First felt</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-800">{risk.timeline.length > 1 ? `day ${risk.timeline.find((t) => t.day > 0)?.day ?? 0}` : "immediately"}</p>
          <p className="text-xs text-slate-500">{risk.timeline.find((t) => t.day > 0)?.label ?? "translation and policy effects land at once"}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Single points of failure</p>
          <p className="mt-1 text-2xl font-extrabold text-amber-600">{risk.spofs.length}</p>
          <p className="text-xs text-slate-500">{risk.spofs.slice(0, 2).map((s) => s.name).join(", ") || "none on this path"}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Risk by app — exposure as a share of what the app manages">
          <div className="space-y-3">
            {risk.apps.sort((x, y) => y.materiality - x.materiality).map((r) => {
              const before = a.riskBefore.apps.find((x) => x.module === r.module)!;
              return (
                <div key={r.module}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2"><ModuleChips list={r.module} /><b className="text-slate-800">{APP_NAME[r.module]}</b>
                      <span className="text-slate-500">{r.driver}</span></span>
                    <span className="flex items-center gap-2">
                      {view === "after" && before.band !== r.band && <span className="text-[11px] text-slate-400 line-through">{before.band}</span>}
                      <BandChip b={r.band} /></span>
                  </div>
                  <div className="mt-1 h-3 rounded bg-slate-100">
                    <div className="h-3 rounded" style={{ width: `${Math.min(100, (100 * r.materiality) / 0.3)}%`, background: BAND_COLOR[r.band] }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {r.exposureUsd ? `${fmt(r.exposureUsd)} = ${(100 * r.materiality).toFixed(1)}% of ${r.baseLabel} (${fmt(r.base)})` : `${(100 * r.materiality).toFixed(1)}% change`}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Bands: Low &lt; 1% · Moderate 1–5% · High 5–15% · Critical ≥ 15% of the app's own base. Scale on the bar runs to 30%.</p>
        </Panel>

        <Panel title="When it lands — time to impact">
          {risk.timeline.length ? (
            <div className="relative pb-2 pt-3">
              <div className="space-y-2">
                {risk.timeline.map((t) => (
                  <div key={t.id} className="relative flex items-start gap-2 text-xs">
                    <span className="w-14 shrink-0 text-right font-bold tabular-nums text-slate-700">day {t.day}</span>
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.day === 0 ? "#7f1d1d" : t.day <= horizon / 3 ? "#dc2626" : "#f97316" }} />
                    <span className="text-slate-600">{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-xs text-slate-400">No timed effects for this scenario.</p>}
          {risk.spofs.length > 0 && (
            <div className="mt-3 rounded-lg border border-yellow-300 bg-yellow-50 p-3">
              <p className="text-xs font-bold text-yellow-900">Single points of failure on this path</p>
              <ul className="mt-1 space-y-0.5 text-xs text-yellow-900">{risk.spofs.map((s) => <li key={s.id}><b>{s.name}</b> — {s.why}</li>)}</ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Risk register">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500"><tr><th className="py-1">Object</th><th>App</th><th>Rating</th><th className="text-right">Exposure</th><th className="text-right">Felt from</th><th className="pl-3">Driver</th></tr></thead>
          <tbody>{risk.register.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="py-1.5 font-semibold text-slate-800">{r.name} <span className="font-normal text-slate-400">· {r.type === "LegalEntity" ? "legal entity" : r.type.toLowerCase()}</span>
                {r.spof && <span className="ml-1 rounded bg-yellow-100 px-1 text-[10px] text-yellow-800">SPOF</span>}</td>
              <td>{r.module !== "CORE" ? <ModuleChips list={r.module} /> : <span className="text-slate-400">core</span>}</td>
              <td><BandChip b={r.band} /></td>
              <td className="text-right tabular-nums">{r.exposureUsd ? fmt(r.exposureUsd) : "—"}</td>
              <td className="text-right tabular-nums">{r.daysToImpact == null ? "—" : `day ${r.daysToImpact}`}</td>
              <td className="pl-3 text-slate-500">{r.driver}</td>
            </tr>))}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">{BANDS.map((b) => <span key={b} className="flex items-center gap-1"><BandChip b={b} /></span>)}
          <span>object ratings combine share hit, exposure and single-point-of-failure status</span></div>
      </Panel>
      <div className="flex justify-end"><button onClick={() => onNavigate("ent-mitigation")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">See the mitigation plan →</button></div>
      <Caveat>Residual risk uses the levers set on Mitigation &amp; Recovery. {a.result.assumptions.join(" ")}</Caveat>
    </div>
  );
}

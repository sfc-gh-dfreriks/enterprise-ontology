import { useEffect, useMemo, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { analyse } from "../../lib/entImpact";
import { fmt } from "../../lib/entScenario";
import { useActiveScenario } from "../../hooks/useActiveScenario";
import { AskCortex } from "../../components/AskCortex";
import { EntWorldMap } from "../../components/EntWorldMap";
import { EntRippleGraph } from "../../components/EntRippleGraph";
import { Playback, ScenarioBar, ScenarioTabs } from "../../components/EntScenarioBits";
import { Caveat, ModuleChips, MODULE_COLOR, Panel, num } from "../../components/EntBits";
import { hopColor } from "../../lib/entSeverity";

export const kpiVal = (v: number, unit: string) =>
  unit === "usd" ? fmt(v) : unit === "pct" ? `${v.toFixed(1)}%` : unit === "days" ? `${v.toFixed(1)} d` : num(v, 1);

/** Impact Map — the scenario's ripple through the master ontology, played hop by hop on a map and a topology. */
export default function EntImpact({ onNavigate }: { onNavigate: (p: string) => void }) {
  const data = useQuery(() => entApi.scenarioData(), []);
  const [active] = useActiveScenario();
  const a = useMemo(() => (data.data ? analyse(data.data, active.spec, active.levers) : null), [data.data, active]);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [active.spec]);
  if (data.loading) return <p className="text-sm text-slate-500">Loading scenario inputs…</p>;
  if (data.error || !a) return <p className="text-sm text-rose-600">{data.error}</p>;

  const imp = a.impact, step = imp.steps[Math.min(i, imp.steps.length - 1)];
  // Everything up to the current step stays lit; the camera frames what this step adds plus what caused it.
  const highlight = new Set(step.links);
  const focus = [...step.nodes, ...imp.steps.filter((s) => s.hop === step.hop - 1).flatMap((s) => s.nodes)];
  const spof = new Set(a.riskBefore.spofs.map((s) => s.id));
  const askArgs = active.presetId ? { preset: active.presetId } : { scenario: JSON.stringify(active.spec) };
  const total = a.result.headline[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ScenarioTabs page="ent-impact" onNavigate={onNavigate} />
        <AskCortex key={JSON.stringify(askArgs)} topic="ent-impact" args={askArgs} label="Ask Cortex: explain this ripple"
          suggestions={["Which hop does the most damage?", "Where should we intervene first?", "Which app sees it first?"]} />
      </div>
      <ScenarioBar active={active} title={`${a.result.title} — ${total.label.toLowerCase()} ${kpiVal(total.value, total.unit)} · ${imp.steps.length} steps across ${imp.hops.length} hops`} onNavigate={onNavigate} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Geography — where it happens" right={<span className="text-xs text-sky-600">following step {i + 1}</span>}>
          <EntWorldMap nodes={imp.nodes} links={imp.links} nodeHits={imp.nodeHits} linkHits={imp.linkHits}
            revealHop={step.hop} highlight={highlight} focus={focus} height={400} />
        </Panel>
        <Panel title="Topology — how far from the event">
          <EntRippleGraph nodes={imp.nodes} links={imp.links} nodeHits={imp.nodeHits} linkHits={imp.linkHits}
            revealHop={step.hop} highlight={highlight} spof={spof} height={400} />
        </Panel>
      </div>

      <Playback index={i} onIndex={setI}
        steps={imp.steps.map((s, k) => ({ id: s.id, label: k === 0 ? "start" : s.title.split(" ").slice(0, 3).join(" "), group: s.hop,
          groupLabel: imp.hops.find((h) => h.hop === s.hop)?.label ?? `Hop ${s.hop}` }))} />

      <section className="rounded-xl border-2 p-4 shadow-sm" style={{ borderColor: hopColor(step.hop), background: "#fff" }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded px-2 py-0.5 text-xs font-bold text-white" style={{ background: hopColor(step.hop) }}>
            {step.hop === 0 ? "EVENT" : `HOP ${step.hop}`}</span>
          <h2 className="text-base font-bold text-slate-800">{step.title}</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{step.narrative}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {step.kpis.map((k) => (
            <div key={k.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3" style={{ borderTop: `3px solid ${MODULE_COLOR[k.module]}` }}>
              <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-500"><ModuleChips list={k.module} /> {k.label}</div>
              <div className="text-xl font-extrabold text-slate-800">{kpiVal(k.value, k.unit)}</div>
            </div>
          ))}
        </div>
      </section>

      <Panel title="Every object the ripple reaches">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500"><tr><th className="py-1">Hop</th><th>Object</th><th>Type</th><th className="text-right">Value at risk</th><th className="text-right">Felt from</th><th className="pl-3">How</th></tr></thead>
          <tbody>
            {Object.entries(imp.nodeHits).sort(([, x], [, y]) => x.hop - y.hop || y.valueUsd - x.valueUsd).map(([id, h]) => {
              const n = imp.nodes.find((x) => x.id === id)!;
              return (
                <tr key={id} className={`border-t border-slate-100 ${h.hop === step.hop ? "bg-sky-50" : ""}`}>
                  <td className="py-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: hopColor(h.hop) }} /> {h.hop}</td>
                  <td className="font-semibold text-slate-800">{n.name}{spof.has(id) && <span className="ml-1 rounded bg-yellow-100 px-1 text-[10px] text-yellow-800">single point of failure</span>}</td>
                  <td className="text-slate-500">{n.type === "LegalEntity" ? "legal entity" : n.type === "App" ? "360 app" : n.type.toLowerCase()}</td>
                  <td className="text-right tabular-nums">{h.valueUsd ? fmt(h.valueUsd) : "—"}</td>
                  <td className="text-right tabular-nums">{h.daysToImpact == null ? "—" : `day ${h.daysToImpact}`}</td>
                  <td className="pl-3 text-slate-500">{h.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <Caveat>{imp.geoNote} Timing uses each plant's minimum days of inventory (Supply Chain 360). {a.result.assumptions.join(" ")}</Caveat>
    </div>
  );
}

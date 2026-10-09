import { useEffect, useMemo, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { entApi, STATIC } from "../../lib/api";
import { runScenario, PRESETS, fmt, type Scenario } from "../../lib/entScenario";
import { AskCortex } from "../../components/AskCortex";
import { Panel, RankBars, ModuleChips, MODULE_COLOR, MODULE_NAME, Caveat, num } from "../../components/EntBits";

const KINDS: { kind: Scenario["kind"]; label: string; hint: string }[] = [
  { kind: "supplier", label: "Supplier failure", hint: "Spend → Supply Chain → customers → Finance, Sales, Working Capital" },
  { kind: "plant", label: "Plant outage", hint: "Supply Chain → customers → Finance, Sales, Working Capital" },
  { kind: "customer", label: "Customer default", hint: "Working Capital + Finance AR → Sales pipeline → Supply Chain order book" },
  { kind: "fx", label: "FX shock", hint: "Finance P&L, Spend and People payroll in USD" },
  { kind: "terms", label: "Payment terms", hint: "Working Capital cash ↔ Spend risk ↔ Supply Chain critical suppliers" },
  { kind: "workforce", label: "Workforce change", hint: "People → Finance productivity, flagged against Supply Chain OTIF" },
];

function val(v: number | null, unit: string) {
  if (v == null) return "—";
  if (unit === "usd") return fmt(v);
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "days") return `${v.toFixed(1)} d`;
  return num(v, 1);
}

/** Enterprise Scenario Studio: one shock, propagated through golden-record edges into all six apps. */
export default function EntScenario() {
  const data = useQuery(() => entApi.scenarioData(), []);
  // A use case can hand the studio a preset to open on. Read in the initialiser, cleared
  // in an effect: StrictMode runs initialisers twice, so clearing there would lose it.
  const [handoff] = useState(() => PRESETS.find((x) => x.id === sessionStorage.getItem("ent.preset")) ?? PRESETS[0]);
  useEffect(() => { sessionStorage.removeItem("ent.preset"); }, []);
  const [presetId, setPresetId] = useState<string | null>(handoff.id);
  const [spec, setSpec] = useState<Scenario>(handoff.scenario);
  const result = useMemo(() => (data.data ? runScenario(data.data, spec) : null), [data.data, spec]);
  if (data.loading) return <p className="text-sm text-slate-500">Loading scenario inputs…</p>;
  if (data.error) return <p className="text-sm text-rose-600">{data.error}</p>;
  const d = data.data!;
  const pick = (p: (typeof PRESETS)[number]) => { setPresetId(p.id); setSpec(p.scenario); };
  const edit = (s: Scenario) => { setPresetId(null); setSpec(s); };
  const defaults: Record<Scenario["kind"], Scenario> = {
    supplier: { kind: "supplier", supplierId: d.suppliers[0].supplier_id, weeks: 8, mitigationPct: 0 },
    plant: { kind: "plant", plant: d.scenario.plants[0].plant, weeks: 4 },
    customer: { kind: "customer", customerId: d.customers[0].customer_id, recoveryPct: 40 },
    fx: { kind: "fx", currency: "EUR", pct: -10 },
    terms: { kind: "terms", dpoDays: 10, dsoDays: 5 },
    workforce: { kind: "workforce", companyCode: "1000", pct: -5 },
  };
  const scmSuppliers = new Set(d.scenario.supplier_plant.map((x: any) => x.supplier_id));
  const r = result!;
  // Ask Cortex: presets are keyed by id (baked for the public build); custom specs are sent whole.
  const askArgs = presetId ? { preset: presetId } : { scenario: JSON.stringify(spec) };
  const slider = (label: string, value: number, min: number, max: number, step: number, on: (v: number) => void, suffix = "") => (
    <label className="block text-xs text-slate-600">{label}: <b>{value}{suffix}</b>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(Number(e.target.value))} className="w-full" />
    </label>);

  return (
    <div className="space-y-4">
      <p className="max-w-4xl text-sm text-slate-600">
        Pick a shock. The engine walks the master ontology — <i>supplies</i>, <i>shipsTo</i>, <i>ownedBy</i>, <i>buysFrom</i>,
        <i> owesTo</i>, <i>sellsToCustomer</i>, <i>employs</i> — and shows what each of the six apps would see. Apps run at
        different scales, so the shock travels as a <b>share</b> of activity and each app applies it to its own baseline.
      </p>
      <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-7">
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => pick(p)}
            className={`rounded-lg border p-2 text-left text-xs ${presetId === p.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
            <div className="font-semibold text-slate-800">{p.label}</div><div className="mt-0.5 text-slate-500">{p.question}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Panel title="Build a scenario">
          <div className="mb-3 grid grid-cols-2 gap-1">
            {KINDS.map((k) => (
              <button key={k.kind} onClick={() => edit(defaults[k.kind])} title={k.hint}
                className={`rounded px-2 py-1 text-xs ${spec.kind === k.kind ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>{k.label}</button>
            ))}
          </div>
          <p className="mb-3 text-[11px] text-slate-500">{KINDS.find((k) => k.kind === spec.kind)?.hint}</p>
          <div className="space-y-3">
            {spec.kind === "supplier" && (<>
              <select value={spec.supplierId} onChange={(e) => edit({ ...spec, supplierId: e.target.value })} className="w-full rounded border px-2 py-1 text-xs">
                {d.suppliers.filter((s: any) => scmSuppliers.has(s.supplier_id)).map((s: any) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier}</option>)}
              </select>
              {slider("Weeks out", spec.weeks, 1, 26, 1, (v) => edit({ ...spec, weeks: v }))}
              {slider("Covered by alternate source", spec.mitigationPct, 0, 100, 10, (v) => edit({ ...spec, mitigationPct: v }), "%")}
            </>)}
            {spec.kind === "plant" && (<>
              <select value={spec.plant} onChange={(e) => edit({ ...spec, plant: e.target.value })} className="w-full rounded border px-2 py-1 text-xs">
                {d.scenario.plants.map((p: any) => <option key={p.plant} value={p.plant}>{p.name}</option>)}
              </select>
              {slider("Weeks down", spec.weeks, 1, 26, 1, (v) => edit({ ...spec, weeks: v }))}
            </>)}
            {spec.kind === "customer" && (<>
              <select value={spec.customerId} onChange={(e) => edit({ ...spec, customerId: e.target.value })} className="w-full rounded border px-2 py-1 text-xs">
                {d.customers.map((c: any) => <option key={c.customer_id} value={c.customer_id}>{c.customer}</option>)}
              </select>
              {slider("Recovery", spec.recoveryPct, 0, 100, 10, (v) => edit({ ...spec, recoveryPct: v }), "%")}
            </>)}
            {spec.kind === "fx" && (<>
              <select value={spec.currency} onChange={(e) => edit({ ...spec, currency: e.target.value })} className="w-full rounded border px-2 py-1 text-xs">
                {["EUR", "JPY"].map((c) => <option key={c}>{c}</option>)}
              </select>
              {slider("Move vs USD", spec.pct, -25, 25, 1, (v) => edit({ ...spec, pct: v }), "%")}
            </>)}
            {spec.kind === "terms" && (<>
              {slider("Pay suppliers later by", spec.dpoDays, -15, 30, 1, (v) => edit({ ...spec, dpoDays: v }), " days")}
              {slider("Collect sooner by", spec.dsoDays, -15, 20, 1, (v) => edit({ ...spec, dsoDays: v }), " days")}
            </>)}
            {spec.kind === "workforce" && (<>
              <select value={spec.companyCode} onChange={(e) => edit({ ...spec, companyCode: e.target.value })} className="w-full rounded border px-2 py-1 text-xs">
                {d.companies.map((c: any) => <option key={c.company_code} value={c.company_code}>{c.company}</option>)}
              </select>
              {slider("Headcount change", spec.pct, -20, 20, 1, (v) => edit({ ...spec, pct: v }), "%")}
            </>)}
          </div>
          {STATIC && !presetId && <p className="mt-3 text-[11px] text-amber-700">Custom scenarios run in your browser; Ask Cortex for them needs the live app.</p>}
        </Panel>

        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 className="text-lg font-bold text-slate-800">{r.title}</h2><p className="text-sm text-slate-600">{r.summary}</p></div>
            <AskCortex key={JSON.stringify(askArgs)} topic="ent-scenario" args={askArgs} label="Ask Cortex about this scenario"
              suggestions={["What should we decide this week?", "Which app shows the problem first?", "What would reduce the impact most?"]} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {r.headline.map((h) => (
              <div key={h.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" style={{ borderTop: `3px solid ${MODULE_COLOR[h.module]}` }}>
                <div className="flex items-center gap-1 text-xs text-slate-500"><ModuleChips list={h.module} /> {h.label}</div>
                <div className="text-xl font-extrabold text-slate-800">{val(h.value, h.unit)}</div>
              </div>
            ))}
          </div>

          <Panel title="Propagation through the ontology">
            <ol className="space-y-1.5 text-xs">
              {r.path.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-5 text-right font-bold text-slate-400">{i + 1}</span>
                  <span className="font-semibold text-slate-800">{p.from}</span>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[10px] text-white" style={{ background: MODULE_COLOR[p.module] ?? "#0f172a" }}>{p.rel}</span>
                  <span className="font-semibold text-slate-800">{p.to}</span>
                  <span className="text-slate-500">— {p.detail}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="What each app would see">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500"><tr><th className="py-1">App</th><th>Metric</th><th className="text-right">Baseline</th><th className="text-right">Scenario</th><th className="text-right">Change</th><th className="pl-3">Basis</th></tr></thead>
              <tbody>{r.effects.map((e, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1.5" title={MODULE_NAME[e.module]}><ModuleChips list={e.module} /></td>
                  <td className="font-semibold text-slate-800">{e.metric}</td>
                  <td className="text-right tabular-nums">{val(e.baseline, e.unit)}</td>
                  <td className="text-right tabular-nums">{val(e.scenario, e.unit)}</td>
                  <td className={`text-right font-bold tabular-nums ${e.delta < 0 ? "text-rose-600" : "text-emerald-700"}`}>{val(e.delta, e.unit)}</td>
                  <td className="pl-3 text-slate-500">{e.note}</td>
                </tr>))}
              </tbody>
            </table>
          </Panel>

          <div className="grid gap-4 md:grid-cols-3">
            <Panel title="Legal entities">
              <RankBars rows={r.companies} value={(c) => Math.abs(c.revenueAtRiskUsd || c.marginAtRiskUsd || c.cashUsd)} label={(c) => c.company} color="#0f172a" />
            </Panel>
            <Panel title="Customers">
              <RankBars rows={r.customers} value={(c) => c.valueAtRiskUsd} label={(c) => c.customer} color="#16a34a" />
            </Panel>
            <Panel title="Suppliers">
              {r.suppliers.length ? <ul className="space-y-1 text-xs">{[...r.suppliers].sort((a, b) => b.valueUsd - a.valueUsd).map((s) => (
                <li key={s.supplier_id}><b>{s.supplier}</b> <span className="text-slate-500">— {s.note}</span></li>))}</ul>
                : <p className="text-xs text-slate-400">No supplier links for this scenario.</p>}
            </Panel>
          </div>
          <Caveat>Assumptions: {r.assumptions.join(" ")} Identity across apps comes from the demo crosswalk.</Caveat>
        </div>
      </div>
    </div>
  );
}

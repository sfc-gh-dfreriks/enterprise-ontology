import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { AskCortex } from "../../components/AskCortex";
import { Panel, Kpi, RankBars, ModuleChips, MODULE_COLOR, usd, num, Caveat } from "../../components/EntBits";

/** One page that only the master ontology can draw: the three legal entities across all six apps. */
export default function EntOverview({ onNavigate }: { onNavigate: (p: string) => void }) {
  const q = useQuery(() => entApi.summary(), []);
  if (q.loading) return <p className="text-sm text-slate-500">Loading the enterprise ontology…</p>;
  if (q.error) return <p className="text-sm text-rose-600">{q.error}</p>;
  const d = q.data!;
  const cos = d.companies as any[];
  const rev = cos.reduce((s, c) => s + (c.revenue_usd ?? 0), 0);
  const hc = cos.reduce((s, c) => s + (c.headcount ?? 0), 0);
  const spend = cos.reduce((s, c) => s + (c.spend_usd ?? 0), 0);
  const late = cos.reduce((s, c) => s + (c.late_cost_usd ?? 0), 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          One ontology over <b>six SAP BDC 360 apps</b>. Shared upper classes (Party, OrgUnit, Facility, Transaction,
          Item, Asset, Product) live in the enterprise core; golden legal entities, customers and suppliers
          conform each app's local records so a question can cross Finance, Sales, People, Spend, Working Capital
          and Supply Chain in one traversal.
        </p>
        <AskCortex topic="ent-overview" label="Ask Cortex about the enterprise"
          suggestions={["Which company is the weakest overall and why?", "Where do finance and operations disagree?",
                        "What are the three biggest cross-app risks?"]} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Revenue (Finance)" value={usd(rev)} sub="3 legal entities, USD" />
        <Kpi label="Headcount (People)" value={num(hc)} sub={`${usd(rev / Math.max(hc, 1), 0)} revenue / employee`} />
        <Kpi label="Spend (Spend)" value={usd(spend)} sub="purchase orders, USD" />
        <Kpi label="Late-delivery cost (Supply Chain)" value={usd(late)} sub="OTIF misses" />
        <Kpi label="Knowledge graph" value={`${num(d.stats.nodes)} nodes`} sub={`${num(d.stats.edges)} edges · ${d.stats.classes} classes`} />
      </div>

      <Panel title="Modules — the six 360 apps the ontology conforms">
        <div className="grid gap-2 md:grid-cols-4">
          {d.modules.map((m: any) => (
            <div key={m.module} className="rounded-lg border border-slate-200 p-3" style={{ borderLeft: `4px solid ${MODULE_COLOR[m.module]}` }}>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><ModuleChips list={m.module} /> {m.name}</div>
              <div className="mt-1 text-[11px] text-slate-500">{m.description}</div>
              <div className="mt-1 font-mono text-[10px] text-slate-400">{m.source_database}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Legal entities across every app" right={<AskCortex compact topic="ent-companies" label="Ask Cortex"
             suggestions={["Rank the companies on cash conversion and OTIF together", "Is US Operations' late cost a people or a supplier problem?"]} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Company</th><th>Revenue <ModuleChips list="FIN" /></th><th>Net margin</th>
                <th>DSO / DPO / CCC <ModuleChips list="WCP" /></th><th>Headcount <ModuleChips list="PPL" /></th>
                <th>Spend <ModuleChips list="SPD" /></th><th>On contract</th>
                <th>OTIF <ModuleChips list="SCM" /></th><th>Operating rate</th><th>Late cost</th>
              </tr>
            </thead>
            <tbody>
              {cos.map((c) => (
                <tr key={c.company_code} className="border-t border-slate-100">
                  <td className="py-1.5 font-semibold text-slate-800">{c.company}</td>
                  <td>{usd(c.revenue_usd)}</td><td>{c.net_margin_pct}%</td>
                  <td>{num(c.dso, 1)} / {num(c.dpo, 1)} / {num(c.ccc, 1)}</td>
                  <td>{num(c.headcount)}</td><td>{usd(c.spend_usd)}</td><td>{c.on_contract_pct}%</td>
                  <td className={Number(c.otif_pct) < 75 ? "font-bold text-rose-600" : ""}>{c.otif_pct}%</td>
                  <td>{c.operating_rate_pct}%</td><td>{usd(c.late_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Golden customers by order value" right={<button onClick={() => onNavigate("ent-customers")} className="text-xs text-indigo-600">Customer 360 →</button>}>
          <RankBars rows={d.top_customers} value={(r) => r.order_value_usd} label={(r) => r.customer} color="#22c55e" />
        </Panel>
        <Panel title="Golden suppliers by spend" right={<button onClick={() => onNavigate("ent-suppliers")} className="text-xs text-indigo-600">Supplier 360 →</button>}>
          <RankBars rows={d.top_suppliers} value={(r) => r.spend_usd} label={(r) => r.supplier} color="#f59e0b" />
        </Panel>
      </div>
      <Caveat>{d.notes.identity} {d.notes.currency}</Caveat>
    </div>
  );
}

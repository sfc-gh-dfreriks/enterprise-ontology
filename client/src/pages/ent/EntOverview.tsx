import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { AskCortex } from "../../components/AskCortex";
import { Panel, Kpi, RankBars, ModuleChips, MODULE_COLOR, usd, num, Caveat } from "../../components/EntBits";
import { BuiltOn } from "../../components/SourceBadge";

// Each governed domain, the 360 app it covers, and its module colour.
const DOMAINS: { domain: string; module: string; app: string }[] = [
  { domain: "Enterprise", module: "CORE", app: "Legal entities, golden customers and suppliers, departments" },
  { domain: "Enterprise.Finance", module: "FIN", app: "SAP Finance 360" },
  { domain: "Enterprise.Sales", module: "SAL", app: "SAP Sales 360" },
  { domain: "Enterprise.People", module: "PPL", app: "SAP People 360" },
  { domain: "Enterprise.Spend", module: "SPD", app: "SAP Spend 360" },
  { domain: "Enterprise.Working Capital", module: "WCP", app: "SAP Working Capital 360" },
  { domain: "Supply Chain", module: "SCM", app: "Reused: Supplier, Customer, Plant, Sales Order and more" },
];

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
          One governed ontology over <b>six SAP BDC 360 apps</b>, in Snowflake Business Ontology. The Enterprise
          domain owns legal entities, departments and the local-to-golden records; each app has its own subdomain; and
          Supplier, Customer and Plant are reused from the governed Supply Chain domain, so a question can cross
          Finance, Sales, People, Spend, Working Capital and Supply Chain in one walk.
        </p>
        <AskCortex topic="ent-overview" label="Ask Cortex about the enterprise"
          suggestions={["Which company is the weakest overall and why?", "Where do finance and operations disagree?",
                        "What are the three biggest cross-app risks?"]} />
      </div>

      <BuiltOn walks="Figures come from Legal Entity's representations (DT_COMPANY_360, DT_WC_MONTHLY_KPI) and the golden Customer and Supplier records, found by walking the Enterprise domain." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Revenue (Finance)" value={usd(rev)} sub="3 legal entities, USD" />
        <Kpi label="Headcount (People)" value={num(hc)} sub={`${usd(rev / Math.max(hc, 1), 0)} revenue / employee`} />
        <Kpi label="Spend (Spend)" value={usd(spend)} sub="purchase orders, USD" />
        <Kpi label="Late-delivery cost (Supply Chain)" value={usd(late)} sub="OTIF misses" />
        <Kpi label="Governed concepts" value={String(d.ontology?.counts?.nodes ?? "–")}
          sub={`${d.ontology?.counts?.relationships ?? 0} relationships · ${num(d.stats.nodes)} instances`} />
      </div>

      <Panel title="Governed domains — one per 360 app" right={<button onClick={() => onNavigate("ent-ontology")} className="text-xs text-indigo-600">Ontology →</button>}>
        <div className="grid gap-2 md:grid-cols-4">
          {DOMAINS.map((m) => (
            <div key={m.domain} className="rounded-lg border border-slate-200 p-3" style={{ borderLeft: `4px solid ${MODULE_COLOR[m.module]}` }}>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><ModuleChips list={m.module} /> {m.domain.replace("Enterprise.", "")}</div>
              <div className="mt-1 text-[11px] text-slate-500">{m.app}</div>
              <div className="mt-1 text-[10px] text-slate-400">{d.ontology?.byDomain?.[m.domain] ?? 0} governed concepts in scope</div>
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

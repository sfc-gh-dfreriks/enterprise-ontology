import { useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { AskCortex } from "../../components/AskCortex";
import { Panel, RankBars, ModuleChips, usd, num, Caveat } from "../../components/EntBits";

/** Customer 360 and Supplier 360: ranked golden records, then one record across every app it appears in. */
export default function EntParty({ kind }: { kind: "customer" | "supplier" }) {
  const isC = kind === "customer";
  const list = useQuery(() => (isC ? entApi.customers() : entApi.suppliers()), [kind]);
  const [sel, setSel] = useState<string | null>(null);
  const idOf = (r: any) => (isC ? r.customer_id : r.supplier_id);
  const nameOf = (r: any) => (isC ? r.customer : r.supplier);
  const current = sel ?? (list.data?.[0] ? idOf(list.data[0]) : null);
  const det = useQuery(() => (current ? (isC ? entApi.customer(current) : entApi.supplier(current)) : Promise.resolve(null)), [current, kind]);

  if (list.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (list.error) return <p className="text-sm text-rose-600">{list.error}</p>;
  const rows = list.data!;
  const rec = det.data?.[kind];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          {isC ? "A golden customer joins Finance AR, Working Capital AR and disputes, Sales orders and CRM pipeline, and Supply Chain OTIF."
               : "A golden supplier joins Spend and risk, Working Capital and Finance payables, and Supply Chain component lots and cover."}
          {" "}Click a bar to open the record.
        </p>
        <AskCortex topic={isC ? "ent-customers" : "ent-suppliers"} label={`Ask Cortex about ${isC ? "customers" : "suppliers"}`}
          suggestions={isC ? ["Which customers combine overdue AR with late deliveries?", "Where is pipeline at risk from fulfilment?"]
                           : ["Which suppliers are high spend and high quality risk?", "Where are we losing early-pay discounts with risky suppliers?"]} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title={isC ? "Order value (Sales USD + Supply Chain)" : "Spend (Spend 360)"}>
          <RankBars rows={rows} max={20} value={(r) => (isC ? r.order_value_usd : r.spend_usd)} label={nameOf}
            color={isC ? "#22c55e" : "#f59e0b"} onClick={(r) => setSel(idOf(r))} />
        </Panel>
        <Panel title={isC ? "Overdue receivables (Finance + Working Capital)" : "Open payables (Working Capital + Finance)"}>
          <RankBars rows={rows} max={20} value={(r) => (isC ? r.ar_overdue_usd : r.ap_open_usd)} label={nameOf}
            color="#14b8a6" onClick={(r) => setSel(idOf(r))} />
        </Panel>
        <Panel title="Supply Chain late-delivery cost / deviating lots">
          <RankBars rows={rows} max={20} value={(r) => (isC ? r.late_cost_usd : r.deviating_lots)} label={nameOf}
            color="#ef4444" format={isC ? usd : (v) => `${v} lots`} onClick={(r) => setSel(idOf(r))} />
        </Panel>
      </div>

      {rec && (
        <Panel title={`${nameOf(rec)} — ${idOf(rec)}`} right={<div className="flex items-center gap-2"><ModuleChips list={rec.module_list} />
          <AskCortex compact topic={isC ? "ent-customer" : "ent-supplier"} args={{ id: idOf(rec) }} label="Ask Cortex"
            suggestions={isC ? ["Is this account healthy across finance, sales and delivery?", "What should the account team do this week?"]
                             : ["Should we pay this supplier early, hold, or dual-source?", "Which customers does this supplier's quality touch?"]} /></div>}>
          <div className="grid gap-2 text-xs md:grid-cols-4">
            {(isC ? [
              ["Order value", usd(rec.order_value_usd)], ["Sales orders (USD)", num(rec.sales_orders)],
              ["Open pipeline", usd(rec.open_pipeline_usd)], ["Win rate", rec.win_rate_pct == null ? "—" : `${rec.win_rate_pct}%`],
              ["AR", usd(rec.ar_usd)], ["AR overdue", usd(rec.ar_overdue_usd)], ["Disputes", num(rec.disputes)],
              ["Credit risk", rec.credit_risk ?? "—"], ["SC orders", num(rec.scm_orders)],
              ["OTIF", rec.otif_pct == null ? "—" : `${rec.otif_pct}%`], ["Late cost", usd(rec.late_cost_usd)], ["Days to pay", num(rec.days_to_pay, 1)],
            ] : [
              ["Spend", usd(rec.spend_usd)], ["On contract", rec.on_contract_pct == null ? "—" : `${rec.on_contract_pct}%`],
              ["Risk score", num(rec.max_risk_score)], ["Single source", rec.single_source ? "yes" : "no"],
              ["AP open", usd(rec.ap_open_usd)], ["Discount lost", usd(rec.discount_lost_usd)],
              ["Dynamic-discount opp.", usd(rec.dynamic_discount_opportunity_usd)], ["Days to pay", num(rec.days_to_pay, 1)],
              ["Component lots", num(rec.component_lots)], ["Deviating lots", num(rec.deviating_lots)],
              ["Critical components", num(rec.critical_components)], ["Worst shortfall (days)", num(rec.worst_shortfall_days)],
            ]).map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-slate-500">{k}</div>
                <div className="text-base font-bold text-slate-800">{v}</div></div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-bold text-slate-700">Crosswalk — local records resolving to this golden record</h3>
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500"><tr><th>App</th><th>Local id</th><th>Local name</th><th>Match</th></tr></thead>
                <tbody>{det.data.members.map((m: any) => (
                  <tr key={m.module + m.local_id} className="border-t border-slate-100">
                    <td className="py-1"><ModuleChips list={m.module} /></td><td className="font-mono">{m.local_id}</td>
                    <td className="truncate">{m.local_name}</td><td className="text-slate-500">{m.match_method}</td></tr>))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-bold text-slate-700">
                Quality exposure — {isC ? "suppliers whose deviating lots sit in this customer's orders" : "customer orders containing this supplier's deviating lots"}
              </h3>
              <RankBars rows={det.data.quality_exposure} value={(r) => r.order_value_usd}
                label={(r) => (isC ? r.supplier : r.customer)} color="#ef4444" />
            </div>
          </div>
        </Panel>
      )}
      <Caveat>Identity comes from a deterministic demo crosswalk (the six apps share no keys). Sales order values come
        from the SAP BDC demo tenant and are far larger than the Supply Chain demo orders — compare within an app.</Caveat>
    </div>
  );
}

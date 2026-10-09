/**
 * Enterprise scenario engine — what-if propagation through the master ontology.
 *
 * Pure and deterministic: the same inputs give the same result in the live app, the
 * public static build and the Ask Cortex facts (the client posts the result it shows).
 *
 * The six 360 apps run at different scales (Supply Chain ships ~$4M a week from a
 * plant; Working Capital books ~$0.5M of revenue a month per company), so dollars are
 * never added across apps. A shock is propagated as a SHARE through golden-record
 * edges — the share of a company's or customer's activity that is hit — and each app
 * applies that share to its own baseline. Every effect row says which app's baseline
 * it uses.
 */

export type Mod = "FIN" | "SAL" | "PPL" | "SPD" | "WCP" | "SCM";

export interface ScenarioInputs {
  weeks: number;                       // measured Supply Chain order period
  plants: { plant: string; name: string; company_code: string; value_per_week: number; margin_per_week: number; otif_pct: number }[];
  supplier_plant: { supplier_id: string; plant: string; share: number; deviating_lots: number }[];
  plant_customer: { plant: string; customer_id: string; value_usd: number }[];
  money_edges: { type: "buysFrom" | "owesTo" | "sellsToCustomer"; company_code: string; party_id: string; value_usd: number }[];
  working_capital: { company_code: string; revenue_usd: number; cogs_usd: number; purchases_usd: number; ar_usd: number;
    ap_usd: number; inventory_usd: number; dso: number; dpo: number; dio: number; ccc: number }[];
  fx: { company_code: string; currency: string; rate_to_usd: number }[];
}
export interface EntData {
  scenario: ScenarioInputs;
  companies: any[]; customers: any[]; suppliers: any[];
}

export type Scenario =
  | { kind: "supplier"; supplierId: string; weeks: number; mitigationPct: number }
  | { kind: "plant"; plant: string; weeks: number }
  | { kind: "customer"; customerId: string; recoveryPct: number }
  | { kind: "fx"; currency: string; pct: number }
  | { kind: "terms"; dpoDays: number; dsoDays: number }
  | { kind: "workforce"; companyCode: string; pct: number };

export interface Effect { module: Mod; metric: string; baseline: number | null; scenario: number | null; delta: number;
  unit: "usd" | "pct" | "days" | "count"; note: string }
export interface PathStep { from: string; rel: string; to: string; detail: string; module: Mod | "CORE" }
export interface CompanyImpact { company_code: string; company: string; hitShare: number; revenueAtRiskUsd: number;
  marginAtRiskUsd: number; cashUsd: number; ccc: number | null; cccNew: number | null }
export interface ScenarioResult {
  title: string; summary: string; headline: { label: string; value: number; unit: Effect["unit"]; module: Mod }[];
  effects: Effect[]; path: PathStep[]; companies: CompanyImpact[];
  customers: { customer_id: string; customer: string; valueAtRiskUsd: number; share: number; pipelineAtRiskUsd: number }[];
  suppliers: { supplier_id: string; supplier: string; note: string; valueUsd: number }[];
  assumptions: string[];
}

const WEEKS_PER_MONTH = 52 / 12;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const annualShare = (hitShare: number, weeks: number) => Math.min(0.9, hitShare * weeks / 52);
const nz = (x: any) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

function companyName(d: EntData, cc: string) { return d.companies.find((c) => c.company_code === cc)?.company ?? cc; }
function wc(d: EntData, cc: string) { return d.scenario.working_capital.find((w) => w.company_code === cc); }
function grossMargin(d: EntData, cc: string) {
  const w = wc(d, cc); return w && w.revenue_usd ? (w.revenue_usd - w.cogs_usd) / w.revenue_usd : 0.45;
}

/** Shared tail for the two operational shocks (supplier, plant): lost plant output
 * -> customers (shipsTo) -> companies (ownedBy) -> Finance, Working Capital, Sales. */
function propagateOutput(d: EntData, lostByPlant: Record<string, number>, weeks: number, path: PathStep[]): Omit<ScenarioResult, "title" | "summary" | "headline" | "assumptions" | "suppliers"> {
  const S = d.scenario;
  const effects: Effect[] = [];
  // Supply Chain: lost output value and margin over the shock window (measured weekly rates)
  let lostValue = 0, lostMargin = 0, baseValue = 0;
  for (const p of S.plants) {
    const f = lostByPlant[p.plant] ?? 0;
    lostValue += f * p.value_per_week * weeks; lostMargin += f * p.margin_per_week * weeks;
    baseValue += p.value_per_week * weeks;
  }
  effects.push({ module: "SCM", metric: "Output value lost", baseline: baseValue, scenario: baseValue - lostValue, delta: -lostValue,
    unit: "usd", note: `over ${weeks} weeks at measured weekly plant rates` });
  effects.push({ module: "SCM", metric: "Margin lost", baseline: null, scenario: null, delta: -lostMargin, unit: "usd",
    note: "order quantity × margin per unit" });

  // Customers: each plant's loss lands on its customers in proportion to what it ships them
  const custLost: Record<string, number> = {};
  for (const p of S.plants) {
    const f = lostByPlant[p.plant] ?? 0;
    if (!f) continue;
    const ships = S.plant_customer.filter((e) => e.plant === p.plant);
    const tot = sum(ships.map((e) => e.value_usd));
    for (const e of ships) custLost[e.customer_id] = (custLost[e.customer_id] ?? 0) + f * p.value_per_week * weeks * (e.value_usd / tot);
  }
  const customers = Object.entries(custLost).map(([id, v]) => {
    const c = d.customers.find((x) => x.customer_id === id);
    const scmPerWeek = nz(c?.scm_order_value_usd ?? 0) / S.weeks
      || sum(S.plant_customer.filter((e) => e.customer_id === id).map((e) => e.value_usd)) / S.weeks;
    const share = Math.min(1, v / Math.max(1, scmPerWeek * weeks));
    return { customer_id: id, customer: c?.customer ?? id, valueAtRiskUsd: v, share,
             pipelineAtRiskUsd: share * nz(c?.open_pipeline_usd) };
  }).sort((a, b) => b.valueAtRiskUsd - a.valueAtRiskUsd);
  const top = customers[0];
  if (top) path.push({ from: "Plant", rel: "shipsTo", to: `${customers.length} customers`, module: "SCM",
    detail: `largest: ${top.customer}, ${(100 * top.share).toFixed(0)}% of its deliveries in the window` });
  const pipe = sum(customers.map((c) => c.pipelineAtRiskUsd));
  effects.push({ module: "SAL", metric: "Open pipeline at risk", baseline: sum(customers.map((c) => nz(d.customers.find((x) => x.customer_id === c.customer_id)?.open_pipeline_usd))),
    scenario: null, delta: -pipe, unit: "usd", note: "each affected customer's CRM pipeline × share of its deliveries hit" });

  // Companies: the share of each company's plant output lost becomes its revenue-at-risk share
  const companies: CompanyImpact[] = d.companies.map((c) => {
    const ps = S.plants.filter((p) => p.company_code === c.company_code);
    const base = sum(ps.map((p) => p.value_per_week));
    const lost = sum(ps.map((p) => (lostByPlant[p.plant] ?? 0) * p.value_per_week));
    const hitShare = base ? lost / base : 0;
    const w = wc(d, c.company_code);
    const months = weeks / WEEKS_PER_MONTH;
    const revenueAtRiskUsd = hitShare * nz(w?.revenue_usd) * months;
    return { company_code: c.company_code, company: c.company, hitShare, revenueAtRiskUsd,
             marginAtRiskUsd: revenueAtRiskUsd * grossMargin(d, c.company_code),
             cashUsd: -revenueAtRiskUsd, ccc: w?.ccc ?? null,
             // Measured against a year of turnover: revenue falls by the lost share of the year while
             // receivables and inventory already held stay, so DSO and DIO stretch by x / (1 − x).
             cccNew: w ? w.ccc + (w.dso + w.dio) * annualShare(hitShare, weeks) / (1 - annualShare(hitShare, weeks)) : null };
  }).filter((c) => c.hitShare > 0).sort((a, b) => b.revenueAtRiskUsd - a.revenueAtRiskUsd);
  for (const c of companies) path.push({ from: "Plant", rel: "ownedBy", to: c.company, module: "SCM",
    detail: `${(100 * c.hitShare).toFixed(0)}% of its plant output in the window` });
  effects.push({ module: "FIN", metric: "Revenue at risk", baseline: null, scenario: null, delta: -sum(companies.map((c) => c.revenueAtRiskUsd)),
    unit: "usd", note: "company revenue (Finance/Working Capital monthly) × share of its output lost" });
  effects.push({ module: "FIN", metric: "Gross margin at risk", baseline: null, scenario: null, delta: -sum(companies.map((c) => c.marginAtRiskUsd)),
    unit: "usd", note: "revenue at risk × company gross margin (Working Capital revenue − COGS)" });
  const worst = companies[0];
  if (worst?.ccc != null && worst.cccNew != null)
    effects.push({ module: "WCP", metric: `Cash conversion cycle — ${worst.company}`, baseline: worst.ccc, scenario: worst.cccNew,
      delta: worst.cccNew - worst.ccc, unit: "days", note: "lower sales against the receivables and inventory already held" });
  return { effects, path, companies, customers };
}

export function runScenario(d: EntData, s: Scenario): ScenarioResult {
  const S = d.scenario;
  const path: PathStep[] = [];

  if (s.kind === "supplier" || s.kind === "plant") {
    const lostByPlant: Record<string, number> = {};
    let title: string, supplierRows: ScenarioResult["suppliers"] = [];
    const extra: Effect[] = [];
    const assumptions = [`Weekly plant value and margin measured over ${S.weeks.toFixed(0)} weeks of Supply Chain orders.`];
    if (s.kind === "supplier") {
      const sup = d.suppliers.find((x) => x.supplier_id === s.supplierId);
      title = `${sup?.supplier ?? s.supplierId} stops shipping for ${s.weeks} weeks`;
      const left = 1 - s.mitigationPct / 100;
      for (const sp of S.supplier_plant.filter((x) => x.supplier_id === s.supplierId)) {
        lostByPlant[sp.plant] = sp.share * left;
        const p = S.plants.find((x) => x.plant === sp.plant);
        path.push({ from: sup?.supplier ?? s.supplierId, rel: "supplies", to: p?.name ?? sp.plant, module: "SCM",
          detail: `${(100 * sp.share).toFixed(0)}% of systems built there contain its lots` });
      }
      // Spend + Working Capital: the money edges on the same golden supplier
      const buy = S.money_edges.filter((e) => e.type === "buysFrom" && e.party_id === s.supplierId);
      const owe = S.money_edges.filter((e) => e.type === "owesTo" && e.party_id === s.supplierId);
      const spend = sum(buy.map((e) => e.value_usd)), ap = sum(owe.map((e) => e.value_usd));
      extra.push({ module: "SPD", metric: "Spend to re-source", baseline: null, scenario: null, delta: spend, unit: "usd",
        note: `${buy.length} legal entities buy from this supplier (buysFrom)` });
      extra.push({ module: "WCP", metric: "Open payables to hold or renegotiate", baseline: null, scenario: null, delta: ap, unit: "usd",
        note: "owesTo edge — leverage while supply is disrupted" });
      if (buy.length) path.push({ from: "LegalEntity", rel: "buysFrom / owesTo", to: sup?.supplier ?? s.supplierId, module: "SPD",
        detail: `spend and open payables sit on the same golden supplier` });
      supplierRows = [{ supplier_id: s.supplierId, supplier: sup?.supplier ?? s.supplierId,
        note: `risk ${nz(sup?.max_risk_score)}, ${nz(sup?.on_contract_pct)}% on contract, single source: ${sup?.single_source ? "yes" : "no"}`, valueUsd: spend }];
      if (s.mitigationPct) assumptions.push(`${s.mitigationPct}% of the supplier's volume is covered by an alternate source.`);
      assumptions.push("A system that contains the supplier's lots cannot ship while the supplier is out.");
    } else {
      const p = S.plants.find((x) => x.plant === s.plant);
      title = `${p?.name ?? s.plant} goes down for ${s.weeks} weeks`;
      lostByPlant[s.plant] = 1;
      const feeders = S.supplier_plant.filter((x) => x.plant === s.plant).sort((a, b) => b.share - a.share);
      supplierRows = feeders.map((f) => {
        const sup = d.suppliers.find((x) => x.supplier_id === f.supplier_id);
        return { supplier_id: f.supplier_id, supplier: sup?.supplier ?? f.supplier_id,
                 note: `${(100 * f.share).toFixed(0)}% of the plant's systems use its lots — inbound to pause`, valueUsd: nz(sup?.spend_usd) };
      });
      path.push({ from: p?.name ?? s.plant, rel: "ownedBy", to: companyName(d, p?.company_code ?? ""), module: "SCM", detail: "100% of this plant's output" });
      assumptions.push("The plant ships nothing for the window; no transfer to sister plants.");
    }
    const base = propagateOutput(d, lostByPlant, s.weeks, path);
    const effects = [...base.effects, ...extra];
    const lost = -base.effects[0].delta;
    return { title, summary: `${title}: ${fmt(lost)} of output lost, reaching ${plural(base.customers.length, "customer")} and ${plural(base.companies.length, "legal entity", "legal entities")}.`,
      headline: [{ label: "Output value lost", value: lost, unit: "usd", module: "SCM" },
                 { label: "Revenue at risk", value: -effects.find((e) => e.metric === "Revenue at risk")!.delta, unit: "usd", module: "FIN" },
                 { label: "Pipeline at risk", value: -effects.find((e) => e.metric === "Open pipeline at risk")!.delta, unit: "usd", module: "SAL" },
                 { label: "Customers hit", value: base.customers.length, unit: "count", module: "SCM" }],
      effects, path, companies: base.companies, customers: base.customers, suppliers: supplierRows, assumptions };
  }

  if (s.kind === "customer") {
    const c = d.customers.find((x) => x.customer_id === s.customerId);
    const name = c?.customer ?? s.customerId;
    const keep = s.recoveryPct / 100;
    const writeOff = nz(c?.ar_usd) * (1 - keep);
    const sells = S.money_edges.filter((e) => e.type === "sellsToCustomer" && e.party_id === s.customerId);
    const tot = sum(sells.map((e) => e.value_usd));
    const companies: CompanyImpact[] = sells.map((e) => {
      const share = tot ? e.value_usd / tot : 0;
      const w = wc(d, e.company_code);
      return { company_code: e.company_code, company: companyName(d, e.company_code), hitShare: share,
        revenueAtRiskUsd: 0, marginAtRiskUsd: writeOff * share, cashUsd: -writeOff * share, ccc: w?.ccc ?? null, cccNew: w?.ccc ?? null };
    }).sort((a, b) => b.marginAtRiskUsd - a.marginAtRiskUsd);
    for (const co of companies) path.push({ from: co.company, rel: "sellsToCustomer", to: name, module: "WCP",
      detail: `${(100 * co.hitShare).toFixed(0)}% of the customer's invoicing` });
    const plants = S.plant_customer.filter((e) => e.customer_id === s.customerId);
    for (const p of plants) path.push({ from: S.plants.find((x) => x.plant === p.plant)?.name ?? p.plant, rel: "shipsTo", to: name,
      module: "SCM", detail: `${fmt(p.value_usd)} of orders` });
    const ni = sum(d.companies.map((x) => nz(x.net_income_usd)));
    const effects: Effect[] = [
      { module: "WCP", metric: "Receivables written off", baseline: nz(c?.ar_usd), scenario: nz(c?.ar_usd) * keep, delta: -writeOff, unit: "usd",
        note: `Finance open AR + Working Capital AR, ${s.recoveryPct}% recovered` },
      { module: "FIN", metric: "Net income hit (bad-debt expense)", baseline: ni, scenario: ni - writeOff, delta: -writeOff, unit: "usd",
        note: "against enterprise net income over the Finance period" },
      { module: "SAL", metric: "Open pipeline lost", baseline: nz(c?.open_pipeline_usd), scenario: 0, delta: -nz(c?.open_pipeline_usd), unit: "usd",
        note: "CRM opportunities on the golden customer" },
      { module: "SCM", metric: "Order book to re-allocate", baseline: null, scenario: null, delta: -sum(plants.map((p) => p.value_usd)), unit: "usd",
        note: `${plants.length} plants ship to this customer — capacity freed for others` },
    ];
    return { title: `${name} defaults`, summary: `${name} defaults with ${s.recoveryPct}% recovery: ${fmt(writeOff)} written off across ${plural(companies.length, "legal entity", "legal entities")}.`,
      headline: [{ label: "Write-off", value: writeOff, unit: "usd", module: "WCP" },
                 { label: "Pipeline lost", value: nz(c?.open_pipeline_usd), unit: "usd", module: "SAL" },
                 { label: "Order book freed", value: sum(plants.map((p) => p.value_usd)), unit: "usd", module: "SCM" },
                 { label: "Entities exposed", value: companies.length, unit: "count", module: "WCP" }],
      effects, path, companies,
      customers: [{ customer_id: s.customerId, customer: name, valueAtRiskUsd: writeOff, share: 1, pipelineAtRiskUsd: nz(c?.open_pipeline_usd) }],
      suppliers: [], assumptions: ["Write-off applies to receivables on the books today; future orders are cancelled.",
        "Customer identity across apps comes from the demo crosswalk."] };
  }

  if (s.kind === "fx") {
    const f = s.pct / 100;
    const hit = S.fx.filter((x) => x.currency === s.currency).map((x) => x.company_code);
    const cos = d.companies.filter((c) => hit.includes(c.company_code));
    const d_rev = f * sum(cos.map((c) => nz(c.revenue_usd))), d_ni = f * sum(cos.map((c) => nz(c.net_income_usd)));
    const d_spend = f * sum(cos.map((c) => nz(c.spend_usd))), d_sal = f * sum(cos.map((c) => nz(c.salary_cost_usd)));
    for (const c of cos) path.push({ from: c.company, rel: "reports in", to: s.currency, module: "FIN", detail: `${s.pct > 0 ? "+" : ""}${s.pct}% vs USD` });
    return { title: `${s.currency} moves ${s.pct > 0 ? "+" : ""}${s.pct}% against USD`,
      summary: `${s.currency} ${s.pct > 0 ? "+" : ""}${s.pct}%: reported revenue ${fmt(d_rev)}, net income ${fmt(d_ni)} for ${cos.map((c) => c.company).join(", ")}.`,
      headline: [{ label: "Reported revenue", value: d_rev, unit: "usd", module: "FIN" },
                 { label: "Reported net income", value: d_ni, unit: "usd", module: "FIN" },
                 { label: "Spend in USD", value: d_spend, unit: "usd", module: "SPD" },
                 { label: "Payroll in USD", value: d_sal, unit: "usd", module: "PPL" }],
      effects: [
        { module: "FIN", metric: "Reported revenue (USD)", baseline: sum(cos.map((c) => nz(c.revenue_usd))), scenario: (1 + f) * sum(cos.map((c) => nz(c.revenue_usd))), delta: d_rev, unit: "usd", note: "translation of the Finance P&L" },
        { module: "FIN", metric: "Reported net income (USD)", baseline: sum(cos.map((c) => nz(c.net_income_usd))), scenario: (1 + f) * sum(cos.map((c) => nz(c.net_income_usd))), delta: d_ni, unit: "usd", note: "translation; no transaction hedging modelled" },
        { module: "SPD", metric: "Spend (USD)", baseline: sum(cos.map((c) => nz(c.spend_usd))), scenario: (1 + f) * sum(cos.map((c) => nz(c.spend_usd))), delta: d_spend, unit: "usd", note: "purchase orders booked in the currency" },
        { module: "PPL", metric: "Payroll (USD)", baseline: sum(cos.map((c) => nz(c.salary_cost_usd))), scenario: (1 + f) * sum(cos.map((c) => nz(c.salary_cost_usd))), delta: d_sal, unit: "usd", note: "active salaries in local currency" },
      ],
      path, companies: cos.map((c) => ({ company_code: c.company_code, company: c.company, hitShare: 1, revenueAtRiskUsd: f * nz(c.revenue_usd),
        marginAtRiskUsd: f * nz(c.net_income_usd), cashUsd: 0, ccc: c.ccc ?? null, cccNew: c.ccc ?? null })),
      customers: [], suppliers: [],
      assumptions: ["Pure translation at the planning rate; local-currency volumes unchanged.", "Days metrics (DSO, DPO, CCC) do not move with FX."] };
  }

  if (s.kind === "terms") {
    const companies: CompanyImpact[] = S.working_capital.map((w) => {
      const cash = (w.purchases_usd / 30) * s.dpoDays + (w.revenue_usd / 30) * s.dsoDays;
      return { company_code: w.company_code, company: companyName(d, w.company_code), hitShare: 0, revenueAtRiskUsd: 0, marginAtRiskUsd: 0,
        cashUsd: cash, ccc: w.ccc, cccNew: w.ccc - s.dpoDays - s.dsoDays };
    }).sort((a, b) => b.cashUsd - a.cashUsd);
    // who gets squeezed: high-risk or critical suppliers we owe the most
    const squeezed = d.suppliers.filter((x) => nz(x.ap_open_usd) > 0)
      .map((x) => ({ x, score: nz(x.max_risk_score) + 20 * nz(x.critical_components) }))
      .sort((a, b) => b.score - a.score).slice(0, 6)
      .map(({ x }) => ({ supplier_id: x.supplier_id, supplier: x.supplier, valueUsd: nz(x.ap_open_usd),
        note: `risk ${nz(x.max_risk_score)}${nz(x.critical_components) ? `, ${x.critical_components} critical components in Supply Chain` : ""}` }));
    for (const q of squeezed.slice(0, 3)) path.push({ from: "LegalEntity", rel: "owesTo", to: q.supplier, module: "WCP",
      detail: `${q.note} — paying later strains a supplier we depend on` });
    const cash = sum(companies.map((c) => c.cashUsd));
    return { title: `Pay suppliers ${s.dpoDays} days later, collect ${s.dsoDays} days sooner`,
      summary: `Cash released ${fmt(cash)}; but the suppliers most squeezed include ${squeezed.slice(0, 2).map((q) => q.supplier).join(" and ")}.`,
      headline: [{ label: "Cash released", value: cash, unit: "usd", module: "WCP" },
                 { label: "CCC change (days)", value: -(s.dpoDays + s.dsoDays), unit: "days", module: "WCP" },
                 { label: "At-risk suppliers squeezed", value: squeezed.filter((q) => q.note.includes("critical")).length, unit: "count", module: "SCM" },
                 { label: "Payables affected", value: sum(squeezed.map((q) => q.valueUsd)), unit: "usd", module: "WCP" }],
      effects: [
        { module: "WCP", metric: "Cash released", baseline: null, scenario: null, delta: cash, unit: "usd", note: "monthly purchases/30 × DPO days + revenue/30 × DSO days" },
        ...companies.map((c) => ({ module: "WCP" as Mod, metric: `CCC — ${c.company}`, baseline: c.ccc, scenario: c.cccNew, delta: (c.cccNew ?? 0) - (c.ccc ?? 0), unit: "days" as const, note: "latest Working Capital month" })),
        { module: "SPD", metric: "Suppliers with risk ≥ 80 still owed", baseline: null, scenario: null,
          delta: d.suppliers.filter((x) => nz(x.max_risk_score) >= 80 && nz(x.ap_open_usd) > 0).length, unit: "count", note: "Spend 360 risk score" },
        { module: "SCM", metric: "Squeezed suppliers holding critical components", baseline: null, scenario: null,
          delta: squeezed.filter((q) => q.note.includes("critical")).length, unit: "count", note: "Supply Chain component cover" },
      ],
      path, companies, customers: [], suppliers: squeezed,
      assumptions: ["Balances from the latest Working Capital month.", "Suppliers accept the new terms; no early-pay discounts are forgone beyond those already lost."] };
  }

  // workforce
  const c = d.companies.find((x) => x.company_code === s.companyCode);
  const f = s.pct / 100;
  const hc = nz(c?.headcount), sal = nz(c?.salary_cost_usd), rev = nz(c?.revenue_usd);
  const newHc = hc * (1 + f);
  path.push({ from: c?.company ?? s.companyCode, rel: "employs", to: `${Math.round(hc)} employees`, module: "PPL", detail: `${s.pct > 0 ? "+" : ""}${s.pct}%` });
  if (nz(c?.otif_pct) < 75) path.push({ from: c?.company ?? "", rel: "ownedBy⁻¹", to: "its plants", module: "SCM",
    detail: `OTIF already ${c?.otif_pct}% — cutting capacity here compounds a delivery problem` });
  return { title: `${c?.company ?? s.companyCode} changes headcount ${s.pct > 0 ? "+" : ""}${s.pct}%`,
    summary: `${s.pct > 0 ? "+" : ""}${s.pct}% headcount at ${c?.company}: payroll ${fmt(f * sal)}, revenue per employee ${fmt(rev / Math.max(1, newHc))}.`,
    headline: [{ label: "Payroll change", value: f * sal, unit: "usd", module: "PPL" },
               { label: "Headcount change", value: newHc - hc, unit: "count", module: "PPL" },
               { label: "Revenue / employee", value: rev / Math.max(1, newHc), unit: "usd", module: "FIN" },
               { label: "Plant OTIF today", value: nz(c?.otif_pct), unit: "pct", module: "SCM" }],
    effects: [
      { module: "PPL", metric: "Headcount", baseline: hc, scenario: newHc, delta: newHc - hc, unit: "count", note: "People 360" },
      { module: "PPL", metric: "Payroll (annual)", baseline: sal, scenario: sal * (1 + f), delta: f * sal, unit: "usd", note: "active salaries" },
      { module: "FIN", metric: "Revenue per employee", baseline: rev / Math.max(1, hc), scenario: rev / Math.max(1, newHc), delta: rev / Math.max(1, newHc) - rev / Math.max(1, hc), unit: "usd", note: "Finance revenue held constant" },
      { module: "SCM", metric: "OTIF at the company's plants", baseline: nz(c?.otif_pct), scenario: null, delta: 0, unit: "pct", note: "not modelled — flagged when already below 75%" },
    ],
    path, companies: c ? [{ company_code: c.company_code, company: c.company, hitShare: Math.abs(f), revenueAtRiskUsd: 0, marginAtRiskUsd: -f * sal,
      cashUsd: -f * sal, ccc: c.ccc ?? null, cccNew: c.ccc ?? null }] : [],
    customers: [], suppliers: [],
    assumptions: ["Revenue held constant — no productivity or capacity model.", "Severance and hiring costs not included."] };
}

function plural(n: number, one: string, many = one + "s") { return `${n} ${n === 1 ? one : many}`; }

export function fmt(v: number): string {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}

/** Presets for the studio, the static build's baked Ask Cortex and the video. */
export const PRESETS: { id: string; label: string; question: string; scenario: Scenario }[] = [
  { id: "sup-teledyne", label: "Top-spend supplier fails (8 weeks)", question: "Our largest supplier by spend stops shipping — who feels it?",
    scenario: { kind: "supplier", supplierId: "GS-002", weeks: 8, mitigationPct: 0 } },
  { id: "sup-festo-dual", label: "Festo fails, 50% dual-sourced", question: "How much does a second source buy us?",
    scenario: { kind: "supplier", supplierId: "GS-005", weeks: 8, mitigationPct: 50 } },
  { id: "plant-sanjose", label: "San Jose HQ down 4 weeks", question: "What does a four-week outage at our biggest plant cost the enterprise?",
    scenario: { kind: "plant", plant: "1000", weeks: 4 } },
  { id: "cust-skhynix", label: "SK Hynix defaults (40% recovery)", question: "If our most overdue customer defaults, where does it land?",
    scenario: { kind: "customer", customerId: "GC-006", recoveryPct: 40 } },
  { id: "fx-eur", label: "EUR −10% vs USD", question: "What does a weaker euro do to reported results?",
    scenario: { kind: "fx", currency: "EUR", pct: -10 } },
  { id: "terms", label: "Pay 10 days later, collect 5 sooner", question: "How much cash do terms release, and who pays for it?",
    scenario: { kind: "terms", dpoDays: 10, dsoDays: 5 } },
  { id: "wf-us", label: "US Operations −5% headcount", question: "What does a 5% reduction at US Operations save — and risk?",
    scenario: { kind: "workforce", companyCode: "1000", pct: -5 } },
];

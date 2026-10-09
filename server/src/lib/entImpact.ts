/**
 * Impact, risk and mitigation for the enterprise scenario engine.
 *
 * Built on runScenario's result so every figure here reconciles to the Scenario
 * Studio: the ripple re-expresses the same propagation as nodes and hops, the risk
 * outcome grades the same effects, and mitigation acts on the same exposure.
 *
 * Pure and deterministic, shared by the pages, the server's Ask Cortex facts and
 * tools/verify_ent_mitigation.mjs.
 *
 * What is DERIVED from data:  reroutes (capability from observed shipments, hours
 *   from work-center capacity), buffer cover (minimum days of inventory), timing.
 * What is an ASSUMPTION the user sets:  alternate-source share, hedge ratio, credit
 *   insurance cover, re-sale of freed capacity, plant-facing share of a headcount cut.
 *   Each is a labelled lever, never a hidden constant.
 */
import { runScenario, fmt, type EntData, type Mod, type Scenario, type ScenarioResult, type Effect } from "./entScenario.js";

export type NodeType = "Supplier" | "Plant" | "Customer" | "LegalEntity" | "Currency" | "App";
export const APPS: Mod[] = ["FIN", "SAL", "PPL", "SPD", "WCP", "SCM"];
export const APP_NAME: Record<Mod, string> = {
  FIN: "Finance 360", SAL: "Sales 360", PPL: "People 360", SPD: "Spend 360", WCP: "Working Capital 360", SCM: "Supply Chain 360",
};

export interface ImpactNode { id: string; name: string; type: NodeType; lat?: number; lon?: number; city?: string; country?: string;
  module?: Mod; assumed?: boolean }
export interface ImpactLink { id: string; source: string; target: string; rel: string; module: Mod | "CORE" }
export interface NodeHit { hop: number; severity: number; valueUsd: number; daysToImpact: number | null; note: string }
export interface LinkHit { hop: number; severity: number; valueUsd: number }
export interface Kpi { label: string; value: number; unit: Effect["unit"]; module: Mod }
export interface ImpactStep { id: string; hop: number; title: string; narrative: string; nodes: string[]; links: string[]; kpis: Kpi[] }
export interface Impact {
  nodes: ImpactNode[]; links: ImpactLink[];
  nodeHits: Record<string, NodeHit>; linkHits: Record<string, LinkHit>;
  steps: ImpactStep[]; hops: { hop: number; label: string }[];
  geoNote: string;
}

const WEEKS_PER_MONTH = 52 / 12;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const nz = (x: any) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const PLT = (p: string) => `PLT:${p}`;
const CO = (c: string) => `CO:${c}`;
const APP = (m: Mod) => `APP:${m}`;

// ------------------------------------------------------------------ the base network
/** Every node and ontology edge the maps can draw, before any scenario touches them. */
export function baseNetwork(d: EntData): { nodes: ImpactNode[]; links: ImpactLink[] } {
  const S = d.scenario as any;
  const geo: any[] = S.geo ?? [];
  const byId = new Map(geo.map((g) => [g.id, g]));
  const nodes: ImpactNode[] = [];
  const add = (n: ImpactNode) => { if (!nodes.some((x) => x.id === n.id)) nodes.push(n); };
  const place = (id: string) => {
    const g = byId.get(id);
    return g ? { lat: Number(g.lat), lon: Number(g.lon), city: g.city, country: g.country, assumed: !!g.location_assumed } : {};
  };
  for (const sp of S.supplier_plant) {
    const sup = d.suppliers.find((x) => x.supplier_id === sp.supplier_id);
    add({ id: sp.supplier_id, name: sup?.supplier ?? sp.supplier_id, type: "Supplier", module: "SPD", ...place(sp.supplier_id) });
  }
  for (const p of S.plants) add({ id: PLT(p.plant), name: p.name, type: "Plant", module: "SCM", ...place(PLT(p.plant)) });
  for (const e of S.plant_customer) {
    const c = d.customers.find((x) => x.customer_id === e.customer_id);
    add({ id: e.customer_id, name: c?.customer ?? e.customer_id, type: "Customer", module: "SAL", ...place(e.customer_id) });
  }
  for (const c of d.companies) add({ id: CO(c.company_code), name: c.company, type: "LegalEntity", ...place(CO(c.company_code)) });
  for (const m of APPS) add({ id: APP(m), name: APP_NAME[m], type: "App", module: m });

  const links: ImpactLink[] = [];
  for (const sp of S.supplier_plant) links.push({ id: `sup:${sp.supplier_id}:${sp.plant}`, source: sp.supplier_id, target: PLT(sp.plant), rel: "supplies", module: "SCM" });
  for (const e of S.plant_customer) links.push({ id: `ship:${e.plant}:${e.customer_id}`, source: PLT(e.plant), target: e.customer_id, rel: "shipsTo", module: "SCM" });
  for (const p of S.plants) links.push({ id: `own:${p.plant}`, source: PLT(p.plant), target: CO(p.company_code), rel: "ownedBy", module: "SCM" });
  for (const c of d.companies) for (const m of APPS) links.push({ id: `app:${c.company_code}:${m}`, source: CO(c.company_code), target: APP(m), rel: "reportsIn", module: m });
  return { nodes, links };
}

const bufferDays = (d: EntData, plant: string) => {
  const b = ((d.scenario as any).buffer ?? []).find((x: any) => x.plant === plant);
  return b ? nz(b.min_days) : null;
};
const plantName = (d: EntData, plant: string) => d.scenario.plants.find((p) => p.plant === plant)?.name ?? plant;

// ------------------------------------------------------------------ 1. the ripple
/** The scenario as nodes and hops: who is hit, when, and through which ontology edge. */
export function buildImpact(d: EntData, s: Scenario, r: ScenarioResult = runScenario(d, s)): Impact {
  const S = d.scenario;
  const { nodes, links } = baseNetwork(d);
  const nodeHits: Record<string, NodeHit> = {};
  const linkHits: Record<string, LinkHit> = {};
  const steps: ImpactStep[] = [];
  const hit = (id: string, h: NodeHit) => { if (!nodeHits[id] || nodeHits[id].hop > h.hop) nodeHits[id] = h; };
  const lhit = (id: string, h: LinkHit) => { if (links.some((l) => l.id === id)) linkHits[id] = h; };
  const weeks = "weeks" in s ? s.weeks : 0;

  // Apps: one node per app the scenario moves, graded by its largest money effect.
  const appStep = (hop: number) => {
    const money = APPS.map((m) => ({ m, v: sum(r.effects.filter((e) => e.module === m && e.unit === "usd").map((e) => Math.abs(e.delta))) }));
    const top = Math.max(1, ...money.map((x) => x.v));
    const touched = APPS.filter((m) => r.effects.some((e) => e.module === m && e.delta !== 0));
    for (const m of touched) {
      const v = money.find((x) => x.m === m)!.v;
      const e = r.effects.filter((x) => x.module === m).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
      hit(APP(m), { hop, severity: v ? Math.max(0.15, v / top) : 0.25, valueUsd: v, daysToImpact: null,
        note: e ? `${e.metric}: ${e.unit === "usd" ? fmt(e.delta) : e.unit === "count" ? `${e.delta > 0 ? "+" : ""}${Math.round(e.delta)}`
          : `${e.delta > 0 ? "+" : ""}${e.delta.toFixed(1)} ${e.unit}`}` : "" });
      for (const c of d.companies) if (nodeHits[CO(c.company_code)]) lhit(`app:${c.company_code}:${m}`, { hop, severity: nodeHits[APP(m)].severity, valueUsd: 0 });
    }
    steps.push({ id: `h${hop}-apps`, hop, title: `${touched.length} apps record it`,
      narrative: touched.map((m) => `${APP_NAME[m]} — ${nodeHits[APP(m)].note}`).join(" · "),
      nodes: touched.map(APP), links: Object.keys(linkHits).filter((k) => k.startsWith("app:")),
      kpis: r.headline.slice(0, 4) });
  };

  const companyStep = (hop: number, via: string) => {
    for (const c of r.companies) {
      const v = Math.abs(c.revenueAtRiskUsd || c.marginAtRiskUsd || c.cashUsd);
      hit(CO(c.company_code), { hop, severity: clamp01(Math.max(c.hitShare, 0.15)), valueUsd: v, daysToImpact: null,
        note: c.revenueAtRiskUsd ? `${fmt(c.revenueAtRiskUsd)} revenue at risk` : c.marginAtRiskUsd ? `${fmt(c.marginAtRiskUsd)} hit` : `${fmt(c.cashUsd)} cash` });
    }
    for (const p of S.plants) if (nodeHits[PLT(p.plant)] && nodeHits[CO(p.company_code)])
      lhit(`own:${p.plant}`, { hop, severity: nodeHits[PLT(p.plant)].severity, valueUsd: 0 });
    steps.push({ id: `h${hop}-companies`, hop, title: `${r.companies.length} legal ${r.companies.length === 1 ? "entity" : "entities"} carry it`,
      narrative: `${via} ${r.companies.map((c) => `${c.company} (${nodeHits[CO(c.company_code)].note})`).join(", ")}.`,
      nodes: r.companies.map((c) => CO(c.company_code)),
      links: Object.keys(linkHits).filter((k) => k.startsWith("own:")),
      kpis: [{ label: "Revenue at risk", value: sum(r.companies.map((c) => c.revenueAtRiskUsd)), unit: "usd", module: "FIN" },
             { label: "Entities", value: r.companies.length, unit: "count", module: "FIN" }] });
  };

  if (s.kind === "supplier" || s.kind === "plant") {
    // Re-derive per-plant loss exactly as runScenario does, so links carry its numbers.
    const lostByPlant: Record<string, number> = {};
    if (s.kind === "supplier") for (const sp of S.supplier_plant.filter((x) => x.supplier_id === s.supplierId)) lostByPlant[sp.plant] = sp.share * (1 - s.mitigationPct / 100);
    else lostByPlant[s.plant] = 1;
    const plantLoss = (p: string) => (lostByPlant[p] ?? 0) * nz(S.plants.find((x) => x.plant === p)?.value_per_week) * weeks;

    if (s.kind === "supplier") {
      const sup = d.suppliers.find((x) => x.supplier_id === s.supplierId);
      hit(s.supplierId, { hop: 0, severity: 1 - s.mitigationPct / 100, valueUsd: nz(sup?.spend_usd), daysToImpact: 0, note: `stops shipping for ${weeks} weeks` });
      steps.push({ id: "h0", hop: 0, title: `${sup?.supplier ?? s.supplierId} stops shipping`,
        narrative: `For ${weeks} weeks${s.mitigationPct ? `, with ${s.mitigationPct}% of its volume already dual-sourced` : ""}. Spend 360 shows ${fmt(nz(sup?.spend_usd))} of annual spend on this golden supplier.`,
        nodes: [s.supplierId], links: [], kpis: [{ label: "Weeks out", value: weeks, unit: "count", module: "SCM" }, { label: "Annual spend", value: nz(sup?.spend_usd), unit: "usd", module: "SPD" }] });
      const ps = Object.keys(lostByPlant).sort((a, b) => plantLoss(b) - plantLoss(a));
      for (const p of ps) {
        const days = bufferDays(d, p);
        hit(PLT(p), { hop: 1, severity: clamp01(lostByPlant[p]), valueUsd: plantLoss(p), daysToImpact: days,
          note: `${Math.round(100 * lostByPlant[p])}% of systems use its lots · ${days ?? "?"}d of stock` });
        lhit(`sup:${s.supplierId}:${p}`, { hop: 1, severity: clamp01(lostByPlant[p]), valueUsd: plantLoss(p) });
      }
      const first = ps.map((p) => ({ p, days: bufferDays(d, p) ?? 0 })).sort((a, b) => a.days - b.days)[0];
      steps.push({ id: "h1", hop: 1, title: `${ps.length} plants lose ${s.mitigationPct ? "part of " : ""}their supply`,
        narrative: `${ps.map((p) => `${plantName(d, p)} ${Math.round(100 * lostByPlant[p])}%`).join(", ")}. ` +
          (first ? `${plantName(d, first.p)} runs out first, after ${first.days} days of stock.` : ""),
        nodes: ps.map(PLT), links: ps.map((p) => `sup:${s.supplierId}:${p}`),
        kpis: [{ label: "Output value lost", value: sum(ps.map(plantLoss)), unit: "usd", module: "SCM" },
               { label: "Days to first stock-out", value: first?.days ?? 0, unit: "count", module: "SCM" }] });
    } else {
      const p = S.plants.find((x) => x.plant === s.plant)!;
      hit(PLT(s.plant), { hop: 0, severity: 1, valueUsd: plantLoss(s.plant), daysToImpact: 0, note: `ships nothing for ${weeks} weeks` });
      const feeders = S.supplier_plant.filter((x) => x.plant === s.plant);
      for (const f of feeders) {
        hit(f.supplier_id, { hop: 1, severity: 0.3 * f.share, valueUsd: 0, daysToImpact: 0, note: "inbound to this plant pauses" });
        lhit(`sup:${f.supplier_id}:${s.plant}`, { hop: 1, severity: 0.3, valueUsd: 0 });
      }
      steps.push({ id: "h0", hop: 0, title: `${p.name} goes down`,
        narrative: `${weeks} weeks with no output. At measured rates the plant ships ${fmt(p.value_per_week)} a week, so ${fmt(plantLoss(s.plant))} of orders cannot leave.`,
        nodes: [PLT(s.plant)], links: [], kpis: [{ label: "Output value lost", value: plantLoss(s.plant), unit: "usd", module: "SCM" },
          { label: "Weeks down", value: weeks, unit: "count", module: "SCM" }] });
    }
    const custHop = s.kind === "supplier" ? 2 : 1;
    for (const c of r.customers) {
      const via = Object.keys(lostByPlant).filter((p) => S.plant_customer.some((e) => e.plant === p && e.customer_id === c.customer_id));
      const days = s.kind === "supplier" ? Math.min(...via.map((p) => bufferDays(d, p) ?? 0)) : 0;
      hit(c.customer_id, { hop: custHop, severity: clamp01(c.share), valueUsd: c.valueAtRiskUsd, daysToImpact: Number.isFinite(days) ? days : null,
        note: `${Math.round(100 * c.share)}% of its deliveries in the window` });
      for (const p of via) {
        const ships = S.plant_customer.filter((e) => e.plant === p);
        const tot = sum(ships.map((e) => e.value_usd));
        const e = ships.find((x) => x.customer_id === c.customer_id)!;
        lhit(`ship:${p}:${c.customer_id}`, { hop: custHop, severity: clamp01(lostByPlant[p]), valueUsd: plantLoss(p) * e.value_usd / tot });
      }
    }
    const top = r.customers[0];
    // in a plant outage the plant's own suppliers are hit at the same hop: their inbound pauses
    const upstream = s.kind === "plant" ? S.supplier_plant.filter((x) => x.plant === s.plant).map((x) => x.supplier_id) : [];
    steps.push({ id: `h${custHop}`, hop: custHop, title: `${r.customers.length} customers miss deliveries`,
      narrative: (top ? `Largest exposure: ${top.customer}, ${fmt(top.valueAtRiskUsd)} (${Math.round(100 * top.share)}% of its deliveries). ` +
        `Sales 360 holds ${fmt(sum(r.customers.map((c) => c.pipelineAtRiskUsd)))} of open pipeline on these accounts.` : "") +
        (upstream.length ? ` Upstream, ${upstream.length} suppliers see their inbound to the plant pause.` : ""),
      nodes: [...r.customers.map((c) => c.customer_id), ...upstream],
      links: Object.keys(linkHits).filter((k) => k.startsWith("ship:") || (upstream.length > 0 && k.startsWith("sup:"))),
      kpis: [{ label: "Customer value at risk", value: sum(r.customers.map((c) => c.valueAtRiskUsd)), unit: "usd", module: "SCM" },
             { label: "Pipeline at risk", value: sum(r.customers.map((c) => c.pipelineAtRiskUsd)), unit: "usd", module: "SAL" }] });
    companyStep(custHop + 1, "Plants roll up to");
    appStep(custHop + 2);
  } else if (s.kind === "customer") {
    const c = d.customers.find((x) => x.customer_id === s.customerId);
    hit(s.customerId, { hop: 0, severity: 1 - s.recoveryPct / 100, valueUsd: nz(c?.ar_usd), daysToImpact: 0, note: `defaults, ${s.recoveryPct}% recovered` });
    steps.push({ id: "h0", hop: 0, title: `${c?.customer ?? s.customerId} defaults`, nodes: [s.customerId], links: [],
      narrative: `${fmt(nz(c?.ar_usd))} of receivables on the golden customer, ${fmt(nz(c?.ar_overdue_usd))} already overdue. ${s.recoveryPct}% is recovered.`,
      kpis: [{ label: "Receivables", value: nz(c?.ar_usd), unit: "usd", module: "WCP" }, { label: "Overdue", value: nz(c?.ar_overdue_usd), unit: "usd", module: "WCP" }] });
    const plants = S.plant_customer.filter((e) => e.customer_id === s.customerId);
    for (const e of plants) {
      hit(PLT(e.plant), { hop: 1, severity: 0.3, valueUsd: e.value_usd, daysToImpact: 0, note: `${fmt(e.value_usd)} of its order book freed` });
      lhit(`ship:${e.plant}:${s.customerId}`, { hop: 1, severity: 0.5, valueUsd: e.value_usd });
    }
    companyStep(1, `The write-off lands on`);
    steps.push({ id: "h1-plants", hop: 1, title: `${plants.length} plants lose an order book`, nodes: plants.map((e) => PLT(e.plant)),
      links: plants.map((e) => `ship:${e.plant}:${s.customerId}`), narrative: plants.map((e) => `${plantName(d, e.plant)} ${fmt(e.value_usd)}`).join(", ") + " — capacity that can be re-sold.",
      kpis: [{ label: "Order book freed", value: sum(plants.map((e) => e.value_usd)), unit: "usd", module: "SCM" }] });
    appStep(2);
  } else if (s.kind === "fx") {
    nodes.push({ id: `CCY:${s.currency}`, name: `${s.currency} ${s.pct > 0 ? "+" : ""}${s.pct}%`, type: "Currency", module: "FIN" });
    hit(`CCY:${s.currency}`, { hop: 0, severity: clamp01(Math.abs(s.pct) / 25), valueUsd: 0, daysToImpact: 0, note: `${s.pct > 0 ? "+" : ""}${s.pct}% vs USD` });
    for (const c of r.companies) {
      links.push({ id: `ccy:${c.company_code}`, source: `CCY:${s.currency}`, target: CO(c.company_code), rel: "reportsIn", module: "FIN" });
    }
    steps.push({ id: "h0", hop: 0, title: `${s.currency} moves ${s.pct > 0 ? "+" : ""}${s.pct}% against USD`, nodes: [`CCY:${s.currency}`], links: [],
      narrative: "A translation shock: local-currency volumes do not change, the USD view of them does.", kpis: r.headline.slice(0, 2) });
    companyStep(1, "It reaches the entities that report in it:");
    for (const c of r.companies) lhit(`ccy:${c.company_code}`, { hop: 1, severity: nodeHits[CO(c.company_code)].severity, valueUsd: 0 });
    appStep(2);
  } else if (s.kind === "terms") {
    for (const c of r.companies) hit(CO(c.company_code), { hop: 0, severity: 0.25, valueUsd: c.cashUsd, daysToImpact: 0, note: `${fmt(c.cashUsd)} cash released` });
    steps.push({ id: "h0", hop: 0, title: `New terms: pay ${s.dpoDays} days later, collect ${s.dsoDays} sooner`, nodes: r.companies.map((c) => CO(c.company_code)), links: [],
      narrative: `Working Capital 360 releases ${fmt(sum(r.companies.map((c) => c.cashUsd)))} of cash across ${r.companies.length} entities.`, kpis: r.headline.slice(0, 2) });
    const plantsHit = new Set<string>();
    for (const q of r.suppliers) {
      const sup = d.suppliers.find((x) => x.supplier_id === q.supplier_id);
      // squeezed suppliers outside the Supply Chain network still belong on the topology
      if (!nodes.some((n) => n.id === q.supplier_id)) nodes.push({ id: q.supplier_id, name: q.supplier, type: "Supplier", module: "SPD" });
      const sev = clamp01(nz(sup?.max_risk_score) / 100);
      hit(q.supplier_id, { hop: 1, severity: sev, valueUsd: q.valueUsd, daysToImpact: s.dpoDays, note: q.note });
      for (const sp of S.supplier_plant.filter((x) => x.supplier_id === q.supplier_id)) {
        lhit(`sup:${q.supplier_id}:${sp.plant}`, { hop: 2, severity: sev * sp.share, valueUsd: 0 });
        if (nz(sup?.critical_components)) plantsHit.add(sp.plant);
      }
    }
    steps.push({ id: "h1", hop: 1, title: `${r.suppliers.length} suppliers carry the cost`, nodes: r.suppliers.map((x) => x.supplier_id), links: [],
      narrative: r.suppliers.slice(0, 3).map((x) => `${x.supplier} (${x.note})`).join("; ") + ".",
      kpis: [{ label: "Payables affected", value: sum(r.suppliers.map((x) => x.valueUsd)), unit: "usd", module: "WCP" }] });
    for (const p of plantsHit) hit(PLT(p), { hop: 2, severity: 0.35, valueUsd: 0, daysToImpact: s.dpoDays, note: "fed by a squeezed supplier holding critical components" });
    steps.push({ id: "h2", hop: 2, title: `${plantsHit.size} plants depend on them`, nodes: [...plantsHit].map(PLT),
      links: Object.keys(linkHits).filter((k) => k.startsWith("sup:")),
      narrative: "Supply Chain 360 component cover shows which squeezed suppliers hold critical components — paying them later puts that supply at risk.",
      kpis: [{ label: "Plants exposed", value: plantsHit.size, unit: "count", module: "SCM" }] });
    appStep(3);
  } else {
    const c = d.companies.find((x) => x.company_code === s.companyCode)!;
    hit(CO(s.companyCode), { hop: 0, severity: clamp01(Math.abs(s.pct) / 20), valueUsd: Math.abs(nz(c?.salary_cost_usd) * s.pct / 100), daysToImpact: 0,
      note: `${s.pct > 0 ? "+" : ""}${s.pct}% headcount` });
    steps.push({ id: "h0", hop: 0, title: `${c?.company} changes headcount ${s.pct > 0 ? "+" : ""}${s.pct}%`, nodes: [CO(s.companyCode)], links: [],
      narrative: `People 360: ${Math.round(nz(c?.headcount))} employees, ${fmt(nz(c?.salary_cost_usd))} payroll.`, kpis: r.headline.slice(0, 2) });
    const ps = S.plants.filter((p) => p.company_code === s.companyCode);
    for (const p of ps) {
      hit(PLT(p.plant), { hop: 1, severity: p.otif_pct < 75 ? 0.5 : 0.2, valueUsd: 0, daysToImpact: null, note: `OTIF ${p.otif_pct}%` });
      lhit(`own:${p.plant}`, { hop: 1, severity: 0.3, valueUsd: 0 });
    }
    steps.push({ id: "h1", hop: 1, title: `${ps.length} plants staffed from it`, nodes: ps.map((p) => PLT(p.plant)), links: ps.map((p) => `own:${p.plant}`),
      narrative: ps.map((p) => `${p.name} OTIF ${p.otif_pct}%`).join(", ") + (ps.some((p) => p.otif_pct < 75) ? " — already below 75%, so a cut compounds a delivery problem." : "."),
      kpis: [{ label: "Lowest plant OTIF", value: Math.min(...ps.map((p) => p.otif_pct)), unit: "pct", module: "SCM" }] });
    appStep(2);
  }

  const labels = ["Event", "First contact", "Second hop", "Third hop", "Fourth hop", "Fifth hop"];
  const hops = [...new Set(steps.map((x) => x.hop))].sort().map((h) => ({ hop: h, label: labels[h] ?? `Hop ${h}` }));
  return { nodes, links, nodeHits, linkHits, steps, hops,
    geoNote: "Plants, suppliers and customers are placed at their Supply Chain 360 addresses; legal entities at their first plant (an assumption)." };
}

// ------------------------------------------------------------------ 2. risk outcome
export type Band = "Low" | "Moderate" | "High" | "Critical";
export const BAND_COLOR: Record<Band, string> = { Low: "#22c55e", Moderate: "#eab308", High: "#f97316", Critical: "#dc2626" };
const band = (x: number): Band => (x >= 0.15 ? "Critical" : x >= 0.05 ? "High" : x >= 0.01 ? "Moderate" : "Low");

export interface AppRisk { module: Mod; band: Band; materiality: number; exposureUsd: number; base: number; baseLabel: string; driver: string }
export interface RiskRow { id: string; name: string; type: NodeType; module: Mod | "CORE"; exposureUsd: number; band: Band;
  daysToImpact: number | null; driver: string; spof: boolean }
export interface Risk {
  overall: Band; score: number; apps: AppRisk[]; register: RiskRow[];
  timeline: { day: number; label: string; id: string }[];
  spofs: { id: string; name: string; why: string }[];
  exposureUsd: number;
}

/** What one app's exposure is measured against, so bands mean the same thing in every app. */
function appBase(d: EntData, m: Mod, r: ScenarioResult): { base: number; label: string } {
  const S = d.scenario;
  switch (m) {
    case "FIN": return { base: sum(d.companies.map((c) => nz(c.revenue_usd))), label: "enterprise revenue (Finance period)" };
    case "SAL": return { base: sum(d.customers.map((c) => nz(c.open_pipeline_usd))), label: "open pipeline on golden customers" };
    case "SCM": { const b = r.effects.find((e) => e.module === "SCM" && e.baseline); return b ? { base: nz(b.baseline), label: "plant output over the window" }
      : { base: sum(S.plants.map((p) => p.value_per_week)) * S.weeks, label: "measured plant output" }; }
    case "WCP": return { base: sum(S.working_capital.map((w) => nz(w.ar_usd) + nz(w.ap_usd))), label: "receivables + payables" };
    case "SPD": return { base: sum(d.suppliers.map((s) => nz(s.spend_usd))), label: "annual spend on golden suppliers" };
    case "PPL": return { base: sum(d.companies.map((c) => nz(c.salary_cost_usd))), label: "annual payroll" };
  }
}

export function assessRisk(d: EntData, s: Scenario, r: ScenarioResult, imp: Impact, residualShare = 1): Risk {
  const apps: AppRisk[] = APPS.map((m) => {
    const es = r.effects.filter((e) => e.module === m);
    const usd = es.filter((e) => e.unit === "usd");
    const exposureUsd = sum(usd.map((e) => Math.abs(e.delta))) * residualShare;
    const days = es.find((e) => e.unit === "days");
    const { base, label } = appBase(d, m, r);
    // Days metrics are graded on their own scale: a 10-day CCC move on a ~60-day cycle is material.
    const mat = usd.length ? exposureUsd / Math.max(1, base) : days ? Math.abs(days.delta * residualShare) / Math.max(1, nz(days.baseline)) : 0;
    const top = [...es].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    return { module: m, band: band(mat), materiality: mat, exposureUsd, base, baseLabel: label,
      driver: top ? top.metric : "not affected" };
  }).filter((a) => r.effects.some((e) => e.module === a.module));

  const spofIds = new Set<string>();
  const spofs: Risk["spofs"] = [];
  const subs: any[] = (d.scenario as any).substitution ?? [];
  for (const [id, h] of Object.entries(imp.nodeHits)) {
    const n = imp.nodes.find((x) => x.id === id);
    if (!n) continue;
    if (n.type === "Supplier" && d.suppliers.find((x) => x.supplier_id === id)?.single_source) {
      spofIds.add(id); spofs.push({ id, name: n.name, why: "single-source supplier in Spend 360" });
    }
    if (n.type === "Plant" && h.severity > 0) {
      const sole = subs.filter((x) => `PLT:${x.plant}` === id && nz(x.capable_plants) === 1).map((x) => x.category);
      if (sole.length) { spofIds.add(id); spofs.push({ id, name: n.name, why: `only plant that makes ${sole.join(", ")}` }); }
    }
  }
  const register: RiskRow[] = Object.entries(imp.nodeHits)
    .map(([id, h]) => {
      const n = imp.nodes.find((x) => x.id === id)!;
      const ex = h.valueUsd * (n.type === "App" || n.type === "Currency" ? 1 : residualShare);
      return { id, name: n.name, type: n.type, module: (n.module ?? "CORE") as Mod | "CORE", exposureUsd: ex,
        band: band(h.severity * (n.type === "App" ? 0.3 : 0.25) * (ex > 0 || n.type !== "App" ? 1 : 0.5) * residualShare + (spofIds.has(id) ? 0.05 : 0)),
        daysToImpact: h.daysToImpact, driver: h.note, spof: spofIds.has(id) };
    })
    .filter((x) => x.type !== "App")
    .sort((a, b) => b.exposureUsd - a.exposureUsd || (a.daysToImpact ?? 99) - (b.daysToImpact ?? 99));

  const timeline = Object.entries(imp.nodeHits)
    .filter(([, h]) => h.daysToImpact != null)
    .map(([id, h]) => ({ day: h.daysToImpact!, id, label: `${imp.nodes.find((n) => n.id === id)?.name}: ${h.note}` }))
    .sort((a, b) => a.day - b.day);

  const order: Band[] = ["Low", "Moderate", "High", "Critical"];
  const overall = apps.reduce<Band>((b, a) => (order.indexOf(a.band) > order.indexOf(b) ? a.band : b), "Low");
  const score = Math.round(100 * Math.min(1, sum(apps.map((a) => Math.min(1, a.materiality / 0.15))) / Math.max(1, apps.length) + spofs.length * 0.05));
  return { overall, score: Math.min(100, score), apps, register, timeline, spofs,
    exposureUsd: sum(apps.map((a) => a.exposureUsd)) };
}

// ------------------------------------------------------------------ 3. mitigation
export interface LeverDef { id: string; label: string; kind: "toggle" | "pct"; value: number; derived: boolean; help: string }
export interface Action { id: string; lever: string; title: string; detail: string; protectedUsd: number; cashUsd: number;
  module: Mod; from?: string; to?: string; derived: boolean }
export interface Unmitigable { title: string; reason: string; valueUsd: number }
export interface Mitigation {
  levers: LeverDef[]; actions: Action[]; unmitigable: Unmitigable[];
  atRiskUsd: number; protectedUsd: number; residualUsd: number; cashUsd: number; exposureLabel: string;
  before: Effect[]; after: Effect[]; residualShare: number;
  capacityAfter: { plant: string; name: string; headroomBefore: number; headroomAfter: number }[];
  caveats: string[];
}

export type Levers = Record<string, number>;
export function defaultLevers(s: Scenario): Levers {
  switch (s.kind) {
    case "supplier": return { buffer: 1, reroute: 1, altSource: 0, holdAp: 1 };
    case "plant": return { reroute: 1, pauseInbound: 1, collections: 1 };
    case "customer": return { insurance: 0, resell: 20, stopShip: 1 };
    case "fx": return { hedge: 50 };
    case "terms": return { exemptCritical: 1 };
    case "workforce": return { exemptPlant: 30 };
  }
}

/** Reroute lost plant output to sister plants that have made the same category, within their free hours. */
function reroutes(d: EntData, lostFrac: Record<string, number>, lossUsd: Record<string, number>, excluded: Set<string> = new Set()) {
  const S = d.scenario as any;
  const subs: any[] = S.substitution ?? [];
  // a partly-hit plant can only offer the share of its free hours it is still running
  const cap = new Map<string, any>((S.capacity ?? []).map((c: any) => [c.plant, { ...c, free: nz(c.free_hrs) * (1 - (lostFrac[c.plant] ?? 0)), added: 0 }]));
  const flows: any[] = (S.flows ?? []).filter((f: any) => f.type === "Outbound");
  const actions: Action[] = [], blocked: Unmitigable[] = [];
  // largest exposure first: the optimiser spends scarce hours where they protect most
  const work: { plant: string; cat: string; units: number; usd: number }[] = [];
  for (const p of Object.keys(lostFrac)) {
    const out = flows.filter((f) => f.source_plant === p);
    const tot = sum(out.map((f) => nz(f.value_usd)));
    const byCat = new Map<string, { units: number; value: number }>();
    for (const f of out) { const x = byCat.get(f.category) ?? { units: 0, value: 0 }; x.units += nz(f.volume); x.value += nz(f.value_usd); byCat.set(f.category, x); }
    for (const [cat, x] of byCat) work.push({ plant: p, cat, units: x.units * lostFrac[p], usd: tot ? lossUsd[p] * x.value / tot : 0 });
  }
  work.sort((a, b) => b.usd - a.usd);
  for (const w of work) {
    if (w.usd <= 0) continue;
    const alts = subs.filter((x) => x.category === w.cat && x.plant !== w.plant && (lostFrac[x.plant] ?? 0) < 1 && !excluded.has(x.plant))
      .map((x) => cap.get(x.plant)).filter(Boolean).sort((a: any, b: any) => b.free / b.hrs_per_unit - a.free / a.hrs_per_unit);
    if (!alts.length) {
      const any = subs.some((x) => x.category === w.cat && x.plant !== w.plant);
      blocked.push({ title: `${w.cat} from ${plantName(d, w.plant)}`, valueUsd: w.usd,
        reason: any ? "the other plants that make it depend on the same failed supplier" : "no other plant makes this category" });
      continue;
    }
    let left = w.units, saved = 0;
    for (const t of alts as any[]) {
      if (left <= 0) break;
      const can = Math.min(left, t.free / nz(t.hrs_per_unit));
      if (can <= 0.01) continue;
      const hrs = can * nz(t.hrs_per_unit);
      t.free -= hrs; t.added += hrs; left -= can;
      const usd = w.usd * can / w.units; saved += usd;
      actions.push({ id: `rr:${w.plant}:${w.cat}:${t.plant}`, lever: "reroute", module: "SCM", derived: true, from: `PLT:${w.plant}`, to: `PLT:${t.plant}`,
        title: `Move ${w.cat} from ${plantName(d, w.plant)} to ${plantName(d, t.plant)}`,
        detail: `${can.toFixed(1)} units/mo · ${hrs.toFixed(0)} of its free hours · it has made ${w.cat} before` +
          (t.free < 0.02 * nz(t.available_hrs) ? " · leaves it no recovery room" : ""), protectedUsd: usd, cashUsd: 0 });
    }
    if (left > 0.01) blocked.push({ title: `${w.cat} from ${plantName(d, w.plant)}`, reason: "capable plants are out of free hours", valueUsd: w.usd - saved });
  }
  // load shown is only what the reroutes add, on the plants that receive them
  const capacityAfter = [...cap.values()].filter((c: any) => c.added > 0).map((c: any) => ({ plant: c.plant, name: plantName(d, c.plant),
    headroomBefore: nz(c.headroom_pct), headroomAfter: Math.round(1000 * (nz(c.free_hrs) - c.added) / Math.max(1, nz(c.available_hrs))) / 10 }));
  return { actions, blocked, capacityAfter };
}

export function mitigate(d: EntData, s: Scenario, levers: Levers = defaultLevers(s), r: ScenarioResult = runScenario(d, s)): Mitigation {
  const S = d.scenario;
  const L = { ...defaultLevers(s), ...levers };
  const actions: Action[] = []; let unmitigable: Unmitigable[] = [];
  let capacityAfter: Mitigation["capacityAfter"] = [];
  const caveats: string[] = [];
  let atRiskUsd = 0, exposureLabel = "";
  const lv: LeverDef[] = [];

  if (s.kind === "supplier" || s.kind === "plant") {
    const weeks = s.weeks;
    const lostFrac: Record<string, number> = {};
    if (s.kind === "supplier") for (const sp of S.supplier_plant.filter((x) => x.supplier_id === s.supplierId)) lostFrac[sp.plant] = sp.share * (1 - s.mitigationPct / 100);
    else lostFrac[s.plant] = 1;
    const loss: Record<string, number> = {};
    for (const p of Object.keys(lostFrac)) loss[p] = lostFrac[p] * nz(S.plants.find((x) => x.plant === p)?.value_per_week) * weeks;
    atRiskUsd = sum(Object.values(loss)); exposureLabel = "customer-facing output value";

    if (s.kind === "supplier") {
      lv.push({ id: "altSource", label: "Additional alternate source", kind: "pct", value: L.altSource, derived: false,
        help: "Share of the remaining volume a second supplier can cover — your assumption." });
      lv.push({ id: "buffer", label: "Run on stock already held", kind: "toggle", value: L.buffer, derived: true,
        help: "Each plant keeps building for its minimum days of inventory (Supply Chain 360)." });
      if (L.altSource) for (const p of Object.keys(loss)) {
        const v = loss[p] * L.altSource / 100; loss[p] -= v;
        actions.push({ id: `alt:${p}`, lever: "altSource", module: "SPD", derived: false, title: `Qualify a second source for ${plantName(d, p)}`,
          detail: `${L.altSource}% of the remaining volume — assumption`, protectedUsd: v, cashUsd: 0, to: `PLT:${p}` });
      }
      if (L.buffer) for (const p of Object.keys(loss)) {
        const days = bufferDays(d, p) ?? 0;
        const v = loss[p] * Math.min(1, days / (weeks * 7)); loss[p] -= v;
        if (v > 0) actions.push({ id: `buf:${p}`, lever: "buffer", module: "SCM", derived: true, title: `Build from stock at ${plantName(d, p)}`,
          detail: `${days} days of inventory against a ${weeks * 7}-day outage`, protectedUsd: v, cashUsd: 0, to: `PLT:${p}` });
      }
    }
    lv.push({ id: "reroute", label: "Reroute to capable sister plants", kind: "toggle", value: L.reroute, derived: true,
      help: "Categories move only to plants that have shipped them, within their free work-center hours." });
    if (L.reroute) {
      const frac: Record<string, number> = {};
      // share of each plant's output still lost after the levers above
      for (const p of Object.keys(lostFrac)) frac[p] = loss[p] / Math.max(1, nz(S.plants.find((x) => x.plant === p)?.value_per_week) * weeks);
      // in a supplier failure, a plant fed by the same supplier cannot absorb more of the same work
      const excluded = new Set(s.kind === "supplier" ? S.supplier_plant.filter((x) => x.supplier_id === s.supplierId).map((x) => x.plant) : []);
      const rr = reroutes(d, frac, loss, excluded);
      actions.push(...rr.actions); unmitigable = rr.blocked; capacityAfter = rr.capacityAfter;
      for (const a of rr.actions) loss[a.from!.slice(4)] -= a.protectedUsd;
    } else unmitigable = Object.keys(loss).filter((p) => loss[p] > 0).map((p) => ({ title: plantName(d, p), reason: "rerouting switched off", valueUsd: loss[p] }));

    if (s.kind === "supplier") {
      const ap = sum(S.money_edges.filter((e) => e.type === "owesTo" && e.party_id === s.supplierId).map((e) => e.value_usd));
      lv.push({ id: "holdAp", label: "Hold open payables while supply is out", kind: "toggle", value: L.holdAp, derived: true,
        help: "Working Capital 360 owesTo edge on the same golden supplier." });
      if (L.holdAp && ap) actions.push({ id: "holdAp", lever: "holdAp", module: "WCP", derived: true, title: "Hold payables to the failed supplier",
        detail: "cash cushion, and leverage in the recovery conversation", protectedUsd: 0, cashUsd: ap });
    } else {
      const feeders = S.supplier_plant.filter((x) => x.plant === s.plant);
      const pause = sum(feeders.map((f) => nz(d.suppliers.find((x) => x.supplier_id === f.supplier_id)?.spend_usd) * f.share)) * weeks / 52;
      lv.push({ id: "pauseInbound", label: "Pause inbound purchase orders", kind: "toggle", value: L.pauseInbound, derived: true,
        help: "Spend 360 spend × the plant's share of each feeder, for the outage window." });
      if (L.pauseInbound && pause) actions.push({ id: "pause", lever: "pauseInbound", module: "SPD", derived: true, title: `Pause POs into ${plantName(d, s.plant)}`,
        detail: `${feeders.length} suppliers`, protectedUsd: 0, cashUsd: pause });
      const cust = r.customers.map((c) => nz(d.customers.find((x) => x.customer_id === c.customer_id)?.ar_overdue_usd)).reduce((a, b) => a + b, 0);
      lv.push({ id: "collections", label: "Collect overdue AR from affected customers", kind: "toggle", value: L.collections, derived: true,
        help: "Working Capital overdue receivables on the customers who will miss deliveries — collect before the relationship strains." });
      if (L.collections && cust) actions.push({ id: "collect", lever: "collections", module: "WCP", derived: true, title: "Collect overdue receivables now",
        detail: `${r.customers.length} affected customers`, protectedUsd: 0, cashUsd: cust });
    }
    caveats.push("Hours per unit are blended across a plant's work centers — planning grade, not a routing check.",
      "A reroute protects output value; it does not model freight or qualification cost.");
  } else if (s.kind === "customer") {
    const c = d.customers.find((x) => x.customer_id === s.customerId);
    const writeOff = nz(c?.ar_usd) * (1 - s.recoveryPct / 100);
    const book = sum(S.plant_customer.filter((e) => e.customer_id === s.customerId).map((e) => e.value_usd));
    atRiskUsd = writeOff; exposureLabel = "receivables written off";
    lv.push({ id: "insurance", label: "Trade-credit insurance cover", kind: "pct", value: L.insurance, derived: false, help: "Share of the write-off an insurer pays — your assumption." });
    lv.push({ id: "resell", label: "Re-sell the freed capacity", kind: "pct", value: L.resell, derived: false, help: "Share of the freed order book placed with other customers — your assumption." });
    lv.push({ id: "stopShip", label: "Stop shipping on credit", kind: "toggle", value: L.stopShip, derived: true, help: "No new receivables on a defaulting account." });
    if (L.insurance) actions.push({ id: "ins", lever: "insurance", module: "WCP", derived: false, title: "Claim on trade-credit insurance", detail: `${L.insurance}% of the write-off`, protectedUsd: writeOff * L.insurance / 100, cashUsd: 0, to: s.customerId });
    if (L.resell) {
      const gm = d.companies.length ? sum(S.working_capital.map((w) => (w.revenue_usd - w.cogs_usd))) / Math.max(1, sum(S.working_capital.map((w) => w.revenue_usd))) : 0.45;
      // Re-selling capacity earns new margin; it does not un-write the bad debt, so it is
      // reported as a benefit beside the exposure rather than netted against it.
      const margin = book * L.resell / 100 * gm;
      actions.push({ id: "resell", lever: "resell", module: "SAL", derived: false, title: "Place the freed order book with other customers",
        detail: `${L.resell}% of ${fmt(book)} at ${(100 * gm).toFixed(0)}% gross margin — new margin, does not reduce the write-off`,
        protectedUsd: 0, cashUsd: margin });
    }
    if (L.stopShip) actions.push({ id: "stop", lever: "stopShip", module: "WCP", derived: true, title: "Put the account on credit hold", detail: "prevents further exposure", protectedUsd: 0, cashUsd: 0 });
    caveats.push("Only insurance reduces the write-off; re-sold capacity is shown as new margin beside it.");
  } else if (s.kind === "fx") {
    const ni = Math.abs(r.effects.find((e) => e.metric.startsWith("Reported net income"))?.delta ?? 0);
    atRiskUsd = ni; exposureLabel = "reported net income";
    lv.push({ id: "hedge", label: "Hedge ratio", kind: "pct", value: L.hedge, derived: false, help: "Share of the exposure covered by forwards — your assumption." });
    if (L.hedge) actions.push({ id: "hedge", lever: "hedge", module: "FIN", derived: false, title: `Hedge ${L.hedge}% of ${(s as any).currency} net income`, detail: "forward cover at today's rate", protectedUsd: ni * L.hedge / 100, cashUsd: 0 });
    caveats.push("Translation only; hedge cost not modelled.");
  } else if (s.kind === "terms") {
    const cash = sum(r.companies.map((c) => c.cashUsd));
    // only the suppliers the new terms actually squeeze (runScenario's list), not every critical one
    const isCrit = (id: string) => { const x = d.suppliers.find((y) => y.supplier_id === id); return nz(x?.critical_components) > 0 || nz(x?.max_risk_score) >= 80; };
    const critical = r.suppliers.filter((x) => isCrit(x.supplier_id));
    const apAll = sum(d.suppliers.map((x) => nz(x.ap_open_usd)));
    const apCrit = sum(critical.map((x) => x.valueUsd));
    atRiskUsd = apCrit; exposureLabel = "payables to squeezed critical or high-risk suppliers";
    lv.push({ id: "exemptCritical", label: "Exempt critical and high-risk suppliers", kind: "toggle", value: L.exemptCritical, derived: true,
      help: "Keep today's terms for suppliers with critical components or risk ≥ 80." });
    if (L.exemptCritical && apAll) {
      const givenUp = cash * (s.dpoDays > 0 ? Math.max(0, s.dpoDays) / (s.dpoDays + Math.max(0, s.dsoDays) || 1) : 0) * apCrit / apAll;
      actions.push({ id: "exempt", lever: "exemptCritical", module: "SCM", derived: true, title: `Keep current terms for ${critical.length} critical suppliers`,
        detail: `${fmt(givenUp)} of the cash release given up to protect them`, protectedUsd: apCrit, cashUsd: -givenUp });
    }
  } else {
    const c = d.companies.find((x) => x.company_code === s.companyCode);
    const save = Math.abs(nz(c?.salary_cost_usd) * s.pct / 100);
    const low = S.plants.filter((p) => p.company_code === s.companyCode && p.otif_pct < 75);
    atRiskUsd = low.length ? save : 0; exposureLabel = "payroll change touching low-OTIF plants";
    lv.push({ id: "exemptPlant", label: "Plant-facing share exempted", kind: "pct", value: L.exemptPlant, derived: false, help: "Share of the change kept away from plant roles — your assumption." });
    if (L.exemptPlant && low.length) actions.push({ id: "exemptPlant", lever: "exemptPlant", module: "PPL", derived: false, title: `Exempt plant roles at ${low.map((p) => p.name).join(", ")}`,
      detail: `OTIF below 75% today`, protectedUsd: save * L.exemptPlant / 100, cashUsd: -(save * L.exemptPlant / 100) });
  }

  const protectedUsd = Math.min(atRiskUsd, sum(actions.map((a) => a.protectedUsd)));
  const residualUsd = Math.max(0, atRiskUsd - protectedUsd);
  const residualShare = atRiskUsd ? residualUsd / atRiskUsd : 1;
  // Effects that propagate from the exposure shrink with it; one-off positions (spend to
  // re-source, payables, counts) do not.
  const scales = (e: Effect) => ["Output value lost", "Margin lost", "Open pipeline at risk", "Revenue at risk", "Gross margin at risk",
    "Receivables written off", "Net income hit (bad-debt expense)", "Reported net income (USD)"].includes(e.metric) || e.metric.startsWith("Cash conversion cycle —");
  const after = r.effects.map((e) => scales(e) ? { ...e, delta: e.delta * residualShare,
    scenario: e.baseline != null && e.scenario != null ? e.baseline + (e.scenario - e.baseline) * residualShare : e.scenario } : e);
  return { levers: lv, actions: actions.sort((a, b) => b.protectedUsd - a.protectedUsd || b.cashUsd - a.cashUsd), unmitigable,
    atRiskUsd, protectedUsd, residualUsd, cashUsd: sum(actions.map((a) => a.cashUsd)), exposureLabel,
    before: r.effects, after, residualShare, capacityAfter, caveats };
}

/** Everything the three pages and Ask Cortex need, from one call. */
export function analyse(d: EntData, s: Scenario, levers?: Levers) {
  const result = runScenario(d, s);
  const impact = buildImpact(d, s, result);
  const mitigation = mitigate(d, s, levers, result);
  return { result, impact, mitigation,
    riskBefore: assessRisk(d, s, result, impact, 1),
    riskAfter: assessRisk(d, s, result, impact, mitigation.residualShare) };
}

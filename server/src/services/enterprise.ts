/**
 * Enterprise master ontology across the six SAP BDC 360 apps.
 *
 * Served from data/enterprise_ontology.json (tools/export_enterprise.py), which
 * reads only SAP_ENTERPRISE_ONTOLOGY. Ask Cortex passes the relevant slice to
 * AI_COMPLETE as facts, the same grounding pattern as thread.ts / reason.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { runSql } from "./analyst.js";
import { runScenario, PRESETS, type Scenario } from "../lib/entScenario.js";
import { analyse } from "../lib/entImpact.js";

const MODEL = process.env.SCENARIO_LLM_MODEL ?? "claude-4-sonnet";
let _e: any = null;

export function loadEnterprise(): any {
  if (_e) return _e;
  const f = path.resolve(import.meta.dirname, "../../../data/enterprise_ontology.json");
  if (!fs.existsSync(f)) throw new Error(`Enterprise ontology not found at ${f}. Run tools/export_enterprise.py.`);
  _e = JSON.parse(fs.readFileSync(f, "utf-8"));
  return _e;
}

let _l: any = null;

/** SAP BDC lineage, from data/enterprise_lineage.json (tools/export_lineage.py). */
export function loadLineage(): any {
  if (_l) return _l;
  const f = path.resolve(import.meta.dirname, "../../../data/enterprise_lineage.json");
  if (!fs.existsSync(f)) throw new Error(`Enterprise lineage not found at ${f}. Run tools/export_lineage.py.`);
  _l = JSON.parse(fs.readFileSync(f, "utf-8"));
  return _l;
}

export function summary() {
  const e = loadEnterprise();
  return { stats: e.stats, modules: e.modules, companies: e.companies, notes: e.notes,
           relations: e.relations, departments: e.departments,
           top_customers: e.customers.slice(0, 8), top_suppliers: e.suppliers.slice(0, 8) };
}

export function customer(id: string) {
  const e = loadEnterprise();
  const c = e.customers.find((x: any) => x.customer_id === id);
  if (!c) return null;
  return { customer: c, members: e.crosswalk.filter((x: any) => x.entity === "Customer" && x.golden_id === id),
           quality_exposure: e.exposure.filter((x: any) => x.customer_id === id) };
}

export function supplier(id: string) {
  const e = loadEnterprise();
  const s = e.suppliers.find((x: any) => x.supplier_id === id);
  if (!s) return null;
  return { supplier: s, members: e.crosswalk.filter((x: any) => x.entity === "Supplier" && x.golden_id === id),
           quality_exposure: e.exposure.filter((x: any) => x.supplier_id === id) };
}

// ------------------------------------------------------------- Ask Cortex
const SYSTEM = `You are Snowflake Cortex, an enterprise analyst. The facts below come from a master ontology that
conforms six SAP BDC 360 applications — Finance (FIN), Sales (SAL), People (PPL), Spend (SPD), Working
Capital (WCP) and Supply Chain (SCM) — through golden legal entities, customers and suppliers. Treat the
facts as authoritative; never invent numbers. Lead with the direct answer, then evidence (a small markdown
table when comparing), then 2-4 concrete actions. Say which apps each figure comes from. Customer and
supplier identity comes from a demo crosswalk; mention it when an answer depends on cross-app identity.
Money is USD. Under 300 words. For a scenario, explain the propagation path, the biggest effect per app,
and the decision it implies; state the scenario's assumptions where they change the answer.`;

function factsFor(topic: string, a: Record<string, any>): unknown {
  const e = loadEnterprise();
  switch (topic) {
    case "ent-overview": return { stats: e.stats, modules: e.modules, companies: e.companies, notes: e.notes };
    case "ent-lineage": {
      const l = loadLineage();
      return { counts: l.counts, notes: l.notes, layers: l.layers,
               modules: l.modules.map((m: any) => ({ code: m.code, name: m.name, bdcProducts: m.bdcProducts,
                 sources: m.products.map((r: any) => ({ source: r.source, provenance: r.provenanceLabel,
                   dataProduct: r.dataProduct, rows: r.rows, appObject: r.appObject, readBy: r.enterpriseObjects })) })) };
    }
    case "ent-companies": return { companies: e.companies, notes: e.notes };
    case "ent-customer": return customer(String(a.id)) ?? { error: "customer not found" };
    case "ent-supplier": return supplier(String(a.id)) ?? { error: "supplier not found" };
    case "ent-customers": return { customers: e.customers, notes: e.notes };
    case "ent-suppliers": return { suppliers: e.suppliers, exposure: e.exposure, notes: e.notes };
    case "ent-model": return { classes: e.classes, relations: e.relations, modules: e.modules };
    case "ent-crosswalk": return { summary: e.crosswalk_summary, notes: e.notes };
    case "ent-people": return { departments: e.departments, companies: e.companies.map((c: any) => ({
      company: c.company, headcount: c.headcount, terminations: c.terminations, salary_cost_usd: c.salary_cost_usd,
      revenue_per_employee_usd: c.revenue_per_employee_usd })) };
    case "ent-scenario": {
      // Recomputed here from the spec the page sent, with the same engine the page ran,
      // so Cortex reads exactly the result on screen.
      const raw = typeof a.scenario === "string" ? JSON.parse(a.scenario) : a.scenario;
      const spec = (a.preset ? PRESETS.find((p) => p.id === a.preset)?.scenario : raw) as Scenario | undefined;
      if (!spec) return { error: "unknown scenario" };
      return { scenario: spec, result: runScenario(e, spec), notes: e.notes };
    }
    case "ent-impact": case "ent-risk": case "ent-mitigation": {
      // Same engine, same spec and levers as the page — Cortex reads what is on screen.
      const raw = typeof a.scenario === "string" ? JSON.parse(a.scenario) : a.scenario;
      const spec = (a.preset ? PRESETS.find((p) => p.id === a.preset)?.scenario : raw) as Scenario | undefined;
      if (!spec) return { error: "unknown scenario" };
      const levers = typeof a.levers === "string" ? JSON.parse(a.levers) : a.levers;
      const x = analyse(e, spec, levers);
      const base = { scenario: spec, title: x.result.title, headline: x.result.headline, assumptions: x.result.assumptions, notes: e.notes };
      if (topic === "ent-impact") return { ...base, steps: x.impact.steps.map(({ hop, title, narrative }) => ({ hop, title, narrative })),
        reached: Object.entries(x.impact.nodeHits).map(([id, h]) => ({ id, name: x.impact.nodes.find((n) => n.id === id)?.name, ...h })) };
      if (topic === "ent-risk") return { ...base, inherent: x.riskBefore, residual: { overall: x.riskAfter.overall, score: x.riskAfter.score, apps: x.riskAfter.apps },
        mitigation: { atRiskUsd: x.mitigation.atRiskUsd, protectedUsd: x.mitigation.protectedUsd, residualUsd: x.mitigation.residualUsd } };
      return { ...base, mitigation: { ...x.mitigation, before: undefined, after: undefined },
        effects_before_after: x.mitigation.before.map((b, i) => ({ module: b.module, metric: b.metric, before: b.delta, after: x.mitigation.after[i].delta })),
        risk: { inherent: x.riskBefore.overall, residual: x.riskAfter.overall } };
    }
    case "ent-usecase": return { usecase: a.id, question: a.question, companies: e.companies, top_customers: e.customers.slice(0, 8),
      top_suppliers: e.suppliers.slice(0, 8), exposure: e.exposure.slice(0, 12), notes: e.notes };
    default: throw new Error(`unknown topic ${topic}`);
  }
}

export const ENTERPRISE_TOPICS = ["ent-overview", "ent-lineage", "ent-impact", "ent-risk", "ent-mitigation", "ent-companies", "ent-customer", "ent-supplier", "ent-customers",
  "ent-suppliers", "ent-model", "ent-crosswalk", "ent-people", "ent-scenario", "ent-usecase"];

export async function askEnterprise(topic: string, a: Record<string, any>, question: string): Promise<string> {
  const facts = JSON.stringify(factsFor(topic, a)).slice(0, 60000);
  const q = question?.trim() || "Analyse this: what stands out across the apps, why, and what should we do?";
  const prompt = `${SYSTEM}\n\nTopic: ${topic}\nFACTS (JSON):\n${facts}\n\nQuestion: ${q}`;
  const { rows } = await runSql(`SELECT AI_COMPLETE('${MODEL}', '${prompt.replace(/'/g, "''")}') AS RESPONSE`);
  const text = String(rows?.[0]?.[0] ?? "").trim();
  if (!text) throw new Error("AI_COMPLETE returned no text");
  return text;
}

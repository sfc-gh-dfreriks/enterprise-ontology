import crypto from "node:crypto";
import { Router } from "express";
import { loadBusinessOntology, boSummary, boNodeFor, buildBoGraph } from "../services/businessOntology.js";
import { loadEnterprise, loadLineage, summary as entSummary, customer as entCustomer, supplier as entSupplier,
         askEnterprise, ENTERPRISE_TOPICS } from "../services/enterprise.js";

export const apiRouter = Router();

// the sync `wrap` below cannot catch a rejected promise, so async handlers need
// their own wrapper or a Cortex failure surfaces as an unhandled rejection and
// the request hangs instead of returning an error
function wrapAsync(handler: (req: any, res: any) => Promise<void>) {
  return (req: any, res: any) => {
    handler(req, res).catch((e: any) =>
      res.status(500).json({
        error: String(e?.message || e),
      })
    );
  };
}

function wrap(handler: (req: any, res: any) => void) {
  return (req: any, res: any) => {
    try {
      handler(req, res);
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  };
}

apiRouter.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---- Snowflake Business Ontology: the governed Enterprise model -------------
// The Enterprise domain plus the Supply Chain concepts it reuses, as exported by
// tools/export_business_ontology.py.
apiRouter.get("/api/bo/summary", wrap((_req, res) => res.json(boSummary(loadBusinessOntology()))));

apiRouter.get("/api/bo/graph", wrap((_req, res) => {
  const bo = loadBusinessOntology();
  if (!bo) { res.status(404).json({ error: "Business Ontology export not found. Run: python3 tools/export_business_ontology.py" }); return; }
  res.json({ elements: buildBoGraph(bo), counts: bo.counts, exportedAt: bo.exportedAt });
}));

apiRouter.get("/api/bo/node/:name", wrap((req, res) => {
  const n = boNodeFor(loadBusinessOntology(), String(req.params.name));
  if (!n) { res.status(404).json({ error: `No such concept: ${req.params.name}` }); return; }
  res.json(n);
}));

// ---------------------------------------------------------------- Ask Cortex
// Grounded analysis of the page on screen: enterprise.ts picks the facts for the
// topic and passes them to AI_COMPLETE.
interface AskJob { status: "running" | "done" | "error"; answer?: string; error?: string; started: number }
const askJobs = new Map<string, AskJob>();

// POST starts a background job and returns {id}; poll GET /api/ask-cortex/:id.
// body.wait=true answers synchronously ({text}) — used by tools/bake_static.py.
apiRouter.post("/api/ask-cortex", wrapAsync(async (req, res) => {
  const topic = String(req.body?.topic ?? "");
  if (!ENTERPRISE_TOPICS.includes(topic)) { res.status(400).json({ error: `unknown topic: ${topic}` }); return; }
  const raw = (req.body?.args && typeof req.body.args === "object") ? req.body.args : {};
  // scenario/levers specs are JSON objects from the page; plain string args are capped
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v !== "string" || v.length < (k === "question" ? 400 : 80) || k === "scenario" || k === "levers") args[k] = v;
  const question = String(req.body?.question ?? "").slice(0, 1000);
  if (req.body?.wait) { res.json({ text: await askEnterprise(topic, args, question) }); return; }
  const id = crypto.randomUUID();
  askJobs.set(id, { status: "running", started: Date.now() });
  askEnterprise(topic, args, question)
    .then((answer) => askJobs.set(id, { status: "done", answer, started: Date.now() }))
    .catch((e) => askJobs.set(id, { status: "error", error: String(e?.message || e), started: Date.now() }));
  for (const [k, j] of askJobs) if (Date.now() - j.started > 3_600_000) askJobs.delete(k);
  res.json({ id });
}));

apiRouter.get("/api/ask-cortex/:id", wrap((req, res) => {
  const j = askJobs.get(String(req.params.id));
  if (!j) return res.status(404).json({ error: "job not found" });
  res.json(j);
}));

// ---------------------------------------------------------------- enterprise master ontology
apiRouter.get("/api/ent/summary", wrap((_req, res) => res.json(entSummary())));
apiRouter.get("/api/ent/customers", wrap((_req, res) => res.json(loadEnterprise().customers)));
apiRouter.get("/api/ent/suppliers", wrap((_req, res) => res.json(loadEnterprise().suppliers)));
apiRouter.get("/api/ent/customer/:id", wrap((req, res) => {
  const c = entCustomer(String(req.params.id)); if (!c) return res.status(404).json({ error: "not found" }); res.json(c);
}));
apiRouter.get("/api/ent/supplier/:id", wrap((req, res) => {
  const s = entSupplier(String(req.params.id)); if (!s) return res.status(404).json({ error: "not found" }); res.json(s);
}));
apiRouter.get("/api/ent/crosswalk", wrap((_req, res) => {
  const e = loadEnterprise(); res.json({ summary: e.crosswalk_summary, records: e.crosswalk, notes: e.notes });
}));
apiRouter.get("/api/ent/scenario-data", wrap((_req, res) => {
  const e = loadEnterprise();
  res.json({ scenario: e.scenario, companies: e.companies, customers: e.customers, suppliers: e.suppliers });
}));
apiRouter.get("/api/ent/lineage", wrap((_req, res) => res.json(loadLineage())));
// Which governed concept and object each part of the export came from.
apiRouter.get("/api/ent/ontology-source", wrap((_req, res) => res.json(loadEnterprise().ontology_source ?? null)));

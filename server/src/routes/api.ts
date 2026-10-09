import { Router } from "express";
import { ask, askConfigured, SEMANTIC_VIEWS } from "../services/analyst.js";
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
        // present when Cortex Analyst produced SQL that failed to execute
        sql: e?.generatedSql ?? null,
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

// --------------------------------------------------------------------------
// Cortex Analyst — ask questions of the ontology in natural language
// --------------------------------------------------------------------------
apiRouter.get("/api/ask/status", wrap((_req, res) => {
  const cfg = askConfigured();
  res.json({ ...cfg, semantic_view: SEMANTIC_VIEWS.enterprise.name });
}));

apiRouter.post("/api/ask", wrapAsync(async (req, res) => {
  const cfg = askConfigured();
  if (!cfg.ok) {
    res.status(503).json({
      error: `Cortex Analyst is not configured. Missing: ${cfg.missing.join(", ")}`,
    });
    return;
  }
  const body = req.body ?? {};
  // accept either a single question or a full turn history for follow-ups
  const history = Array.isArray(body.history) && body.history.length
    ? body.history
    : [{ role: "user", text: String(body.question ?? "").trim() }];
  if (!history[history.length - 1]?.text) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  res.json(await ask(history, String(body.view ?? "enterprise")));
}));

apiRouter.get("/api/ask/views", wrap((_req, res) =>
  res.json(Object.entries(SEMANTIC_VIEWS).map(([key, v]) => ({ key, ...v })))));

apiRouter.get("/api/ask/examples", wrap((_req, res) => res.json([
  "Which company has the best revenue per employee and how does its cash conversion cycle compare?",
  "Which suppliers have the highest open payables and how much spend do they have?",
  "Which customers have overdue receivables and late-delivery cost at the same time?",
  "Which suppliers put the most customer order value at risk through deviating lots?",
  "Rank companies by OTIF and operating rate",
  "How many Sales records map to each golden customer?",
])));

// ---------------------------------------------------------------- Ask Cortex
// Grounded analysis of the page on screen: enterprise.ts picks the facts for the
// topic and passes them to AI_COMPLETE.
apiRouter.post("/api/ask-cortex", wrapAsync(async (req, res) => {
  const topic = String(req.body?.topic ?? "");
  if (!ENTERPRISE_TOPICS.includes(topic)) { res.status(400).json({ error: `unknown topic: ${topic}` }); return; }
  const args = (req.body?.args && typeof req.body.args === "object") ? req.body.args : {};
  const question = String(req.body?.question ?? "").slice(0, 1000);
  res.json({ text: await askEnterprise(topic, args, question) });
}));

// ---------------------------------------------------------------- enterprise master ontology
apiRouter.get("/api/ent/summary", wrap((_req, res) => res.json(entSummary())));
apiRouter.get("/api/ent/model", wrap((_req, res) => {
  const e = loadEnterprise(); res.json({ classes: e.classes, relations: e.relations, modules: e.modules });
}));
apiRouter.get("/api/ent/graph", wrap((_req, res) => res.json(loadEnterprise().graph)));
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

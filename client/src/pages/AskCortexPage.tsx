import { AskCortex } from "../components/AskCortex";

const SUGGESTIONS = [
  "Which legal entity is the weakest across all six apps, and why?",
  "Which customers combine overdue receivables with late deliveries?",
  "Which suppliers put the most customer value at risk through quality exposure?",
  "How does revenue per employee compare with the cash conversion cycle by company?",
  "How much of this picture rests on demo enrichment rather than BDC data products?",
  "What are the three cross-app risks management should act on first?",
];

/** Landing page for Ask Cortex: a compact cross-app fact set (topic `general`) explained by Cortex COMPLETE. */
export default function AskCortexPage() {
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-slate-600">
        Ask a question about the enterprise. Cortex answers only from the master ontology's facts — the three legal
        entities, golden customers and suppliers, quality exposure, the crosswalk and BDC lineage — and says when
        those facts don't cover the question. For governed SQL over the semantic view, use <b>Ask the Enterprise</b>.
      </p>
      <AskCortex topic="general" label="Ask Cortex about the enterprise" suggestions={SUGGESTIONS} />
    </div>
  );
}

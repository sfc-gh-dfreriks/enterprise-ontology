import { AskCortex } from "../components/AskCortex";
import { BuiltOn } from "../components/SourceBadge";

const SUGGESTIONS = [
  "Which legal entity is the weakest across all six apps, and why?",
  "Which customers combine overdue receivables with late deliveries?",
  "Which suppliers put the most customer value at risk through quality exposure?",
  "How does revenue per employee compare with the cash conversion cycle by company?",
  "How much of this picture rests on demo enrichment rather than BDC data products?",
  "What does the ontology say a Legal Entity is, and how do the apps connect through it?",
];

/**
 * Landing page for Ask Cortex: a compact cross-app fact set (topic `general`) with the
 * governed concepts and relationships, explained by AI_COMPLETE.
 */
export default function AskCortexPage() {
  return (
    <div className="max-w-4xl space-y-4">
      <BuiltOn walks="Cortex answers from the governed Enterprise domain (concepts, definitions, relationships) plus the data each concept represents, and names the relationships it relied on." />
      <p className="text-sm text-slate-600">
        Ask a question about the enterprise. Cortex answers only from the governed ontology and its facts — the three
        legal entities, golden customers and suppliers, quality exposure, the crosswalk and BDC lineage — and says when
        those facts don't cover the question.
      </p>
      <AskCortex topic="general" label="Ask Cortex about the enterprise" suggestions={SUGGESTIONS} />
    </div>
  );
}

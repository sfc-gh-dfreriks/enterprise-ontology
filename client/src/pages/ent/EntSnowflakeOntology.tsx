import { useState } from "react";
import { SourceBadge } from "../../components/SourceBadge";
import { AgentSearch } from "../../components/AgentSearch";

/**
 * What the governed Enterprise domain looks like inside Snowflake itself.
 *
 * Snowsight screenshots of the Business Ontology page, not app renderings, so a
 * viewer can match what the app reads to the place it is defined and approved.
 * Captured from the US demo account into client/public/snowsight/.
 */
const SHOTS: { file: string; title: string; where: string; points: string[]; why: string }[] = [
  {
    file: "ent_bo_graph.png", title: "The Enterprise domain graph", where: "Business Ontology → Graph",
    points: [
      "The Enterprise domain with its Finance, Sales, People, Spend and Working Capital subdomains",
      "Cross-domain relationships into the governed Supply Chain concepts: Legal Entity buys from Supplier, sells to Customer, owns Plant",
    ],
    why: "One governed model spans all six 360 apps. Supplier and Customer are defined once, in Supply Chain, and reused here.",
  },
  {
    file: "ent_bo_list.png", title: "Every concept, by domain", where: "Business Ontology → List",
    points: ["Each concept has an approved definition, a type and the domain that governs it", "State filter shows Active or Draft"],
    why: "Finance, Sales, People, Spend and Working Capital each own their own concepts, so access can be granted per domain.",
  },
  {
    file: "ent_bo_legal_entity.png", title: "Legal Entity: the hub of the enterprise", where: "Legal Entity node",
    points: [
      "Relationships: employs Employee, buys from Supplier, sells to Customer; Plant owned by Legal Entity",
      "Representations: VW_ONT_LEGALENTITY, DT_COMPANY_360, GOLDEN_COMPANY, COMPANY_MEMBER, DT_WC_MONTHLY_KPI",
    ],
    why: "The Executive Dashboard and every scenario roll up to this concept; the node points at the exact objects the app reads.",
  },
  {
    file: "ent_bo_local_supplier.png", title: "Local Supplier: golden records, governed", where: "Local Supplier node",
    points: ["Local Supplier same as Supplier: 351 local records conform to 25 golden suppliers",
             "Representations: VW_ONT_LOCALSUPPLIER, SUPPLIER_MEMBER, V_CROSSWALK"],
    why: "The crosswalk the Supplier 360 and Crosswalk pages show is a governed concept, not a hidden join.",
  },
  {
    file: "ent_bo_history.png", title: "The audit trail", where: "Legal Entity → History",
    points: ["Who created the concept, approved it, and added each relationship and representation, and when"],
    why: "Every change to the enterprise model is attributable, which the app-owned class tables never were.",
  },
];

function Shot({ file, title, onOpen }: { file: string; title: string; onOpen: () => void }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[12px] text-slate-500">
        Snowsight screenshot not captured yet ({file}). Open the domain in Snowsight to see it live.
      </div>
    );
  }
  return (
    <button className="overflow-hidden rounded-md border border-gray-200" onClick={onOpen}>
      <img src={`${import.meta.env.BASE_URL}snowsight/${file}`} alt={title} className="w-full" loading="lazy"
        onError={() => setMissing(true)} />
    </button>
  );
}

export default function EntSnowflakeOntology() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm text-slate-600">
        <SourceBadge source="native" href="https://app.snowflake.com/sfsenorthamerica/dfreriks_aws1_w2/#/data/business-ontology" />
        <span>
          Screenshots from <b>Snowsight → Horizon Catalog → Business Ontology</b>, the native Snowflake feature. The
          Ontology page renders the same domain inside the app; this page shows where it is defined, approved and
          audited. Click any image to enlarge it.
        </span>
      </div>

      {SHOTS.map((s, i) => (
        <section key={s.file} className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 lg:grid-cols-[3fr_2fr]">
          <Shot file={s.file} title={s.title} onOpen={() => setOpen(s.file)} />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">{i + 1}. {s.where}</div>
            <h2 className="mt-1 text-base font-bold text-slate-800">{s.title}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {s.points.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <p className="mt-3 text-sm text-slate-700"><b>Why it matters:</b> {s.why}</p>
          </div>
        </section>
      ))}

      <AgentSearch />

      <p className="text-xs text-slate-500">
        Business Ontology is in private preview and enabled on the US demo account.
      </p>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setOpen(null)}>
          <img src={`${import.meta.env.BASE_URL}snowsight/${open}`} alt="" className="max-h-full max-w-full rounded-md shadow-2xl" />
        </div>
      )}
    </div>
  );
}

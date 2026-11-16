/**
 * Where a card or field comes from. Two sources, never to be mistaken for each other:
 *
 *   native  Snowflake Business Ontology — governed, steward-approved meaning
 *   kg      the knowledge graph: instance links (which employee is in which
 *           department), which Business Ontology does not hold
 *   app     retained for parity with the Supply Chain app; not used here
 *
 * `why` says why this field comes from this source, shown on hover.
 */
export type OntologySource = "native" | "app" | "kg";

const STYLE: Record<OntologySource, { label: string; cls: string; dot: string; why: string }> = {
  native: {
    label: "Snowflake Business Ontology",
    cls: "bg-sky-50 text-sky-800 ring-sky-300",
    dot: "bg-[#29B5E8]",
    why: "Governed in Snowflake (Horizon Catalog): approved definitions, typed relationships, representations and change history.",
  },
  app: {
    label: "App model",
    cls: "bg-slate-100 text-slate-700 ring-slate-300",
    dot: "bg-slate-500",
    why: "Logic in the app itself (the scenario engine), not part of the governed model.",
  },
  kg: {
    label: "Knowledge graph · instances",
    cls: "bg-emerald-50 text-emerald-800 ring-emerald-300",
    dot: "bg-emerald-500",
    why: "Instance links in SAP_ENTERPRISE_ONTOLOGY.CORE (KG_NODE / KG_EDGE): the actual records and how they connect. Each edge type instantiates a governed relationship.",
  },
};

export function SourceBadge({ source, why, asOf, href, compact = false }: {
  source: OntologySource; why?: string; asOf?: string | null; href?: string; compact?: boolean;
}) {
  const s = STYLE[source];
  const title = why ?? s.why;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${s.cls}`}
      title={title}>
      {source === "native"
        ? <SnowflakeMark />
        : <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />}
      {compact && source === "app" ? "App ontology" : s.label}
      {asOf && <span className="font-normal opacity-70">· as of {asOf}</span>}
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="font-normal underline decoration-dotted hover:opacity-80"
          onClick={(e) => e.stopPropagation()}>
          open in Snowsight
        </a>
      )}
    </span>
  );
}

function SnowflakeMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#29B5E8" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" />
    </svg>
  );
}

/** "13 Nov 2026" from an ISO timestamp. */
export function asOfDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line at the top of a page saying which governed concepts it walks. */
export function BuiltOn({ walks }: { walks: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-[11.5px] text-slate-600">
      <SourceBadge source="native" />
      <span>{walks}</span>
    </div>
  );
}

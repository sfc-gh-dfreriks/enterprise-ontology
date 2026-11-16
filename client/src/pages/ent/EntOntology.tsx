import { useMemo, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { entApi, type BoNode } from "../../lib/api";
import { GraphCanvas } from "../../components/GraphCanvas";
import { Kpi } from "../../components/EntBits";
import { AskCortex } from "../../components/AskCortex";
import { SourceBadge, asOfDate } from "../../components/SourceBadge";

// The governed Enterprise model in Snowflake Business Ontology. Not a copy for
// display: data/enterprise_ontology.json is exported by walking these relationships
// and reading each concept's representations, so the lineage table below is the
// app's real data lineage.

// What each part of the app reads, and through which governed concept.
const USES: { part: string; key: string; via: string }[] = [
  { part: "Legal entities: revenue, margin, headcount, spend, OTIF", key: "companies", via: "Legal Entity" },
  { part: "Customer 360", key: "customers", via: "Customer (reused from Supply Chain)" },
  { part: "Supplier 360", key: "suppliers", via: "Supplier (reused from Supply Chain)" },
  { part: "Supplier quality exposure", key: "exposure", via: "Supplier" },
  { part: "Golden-record crosswalk", key: "crosswalk", via: "Local Customer / Local Supplier same as Customer / Supplier" },
  { part: "Departments and cost", key: "departments", via: "Employee in department Department, funded by Cost Center" },
  { part: "Scenario: plants, lots, flows, working capital", key: "scenario", via: "Plant owned by Legal Entity; Sales Order; Component Lot; Material Flow" },
];

function NativePanel({ n, asOf }: { n: BoNode; asOf: string | null }) {
  const label = (e: BoNode["edges"][number]) => e.label ?? e.type.toLowerCase().replace("_", " ");
  return (
    <div className="space-y-2 rounded-lg bg-sky-50/60 p-3 ring-1 ring-sky-200">
      <SourceBadge source="native" asOf={asOf} href={n.snowsightUrl} />
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-800">{n.name}</h3>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-800 ring-1 ring-emerald-300">
          {(n.status ?? "").toLowerCase()}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${n.owner === "Enterprise"
          ? "bg-indigo-50 text-indigo-800 ring-indigo-300" : "bg-amber-50 text-amber-800 ring-amber-300"}`}>
          {n.owner === "Enterprise" ? `governed in ${n.domain}` : "reused from Supply Chain"}
        </span>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Governed definition</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">{n.description}</p>
      </div>
      {n.edges.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Relationships ({n.edges.length})</div>
          {n.edges.map((e, i) => (
            <div key={i} className="flex items-baseline gap-1 border-b border-sky-100 py-0.5 text-[11px] last:border-0">
              {e.direction === "out"
                ? <><span className="text-slate-800">{n.name}</span><span className="font-medium text-sky-800">{label(e)}</span><span className="text-slate-700">{e.node}</span></>
                : <><span className="text-slate-700">{e.node}</span><span className="font-medium text-sky-800">{label(e)}</span><span className="text-slate-800">{n.name}</span></>}
              <span className="ml-auto text-[10px] text-slate-400">{e.type}</span>
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Representations</div>
        {n.representations.length === 0
          ? <div className="text-[11px] text-slate-500">None. An abstract concept, or one with no source object yet.</div>
          : n.representations.map((r) => (
            <div key={r.fqn} className="font-mono text-[11px] text-slate-700">{r.fqn}
              <span className="ml-1 font-sans text-[10px] text-slate-400">{r.objectType.toLowerCase()} · {r.role.toLowerCase()}</span></div>
          ))}
      </div>
      <div className="text-[11px] text-slate-500">
        History: {n.history.events} change{n.history.events === 1 ? "" : "s"} recorded
        {n.history.changedBy.length > 0 && ` by ${n.history.changedBy.join(", ")}`}
      </div>
    </div>
  );
}

export default function EntOntology() {
  const [sel, setSel] = useState<any | null>(null);
  const bo = useQuery(() => entApi.boSummary(), []);
  const graph = useQuery(() => entApi.boGraph(), []);
  const src = useQuery(() => entApi.ontologySource(), []);
  const selName: string | null = sel?.boName ?? null;
  const node = useQuery<BoNode | null>(() => (selName ? entApi.boNode(selName) : Promise.resolve(null)), [selName]);
  const asOf = bo.data?.available ? asOfDate(bo.data.exportedAt) : null;
  const lineage = (src.data ?? {}) as Record<string, Record<string, string>>;

  const rels = useMemo(() => {
    const els = graph.data?.elements ?? [];
    const name = new Map<string, string>(els.filter((e: any) => e.data?.kind === "class").map((e: any) => [e.data.id, e.data.boName]));
    return els.filter((e: any) => e.data?.source).map((e: any) => ({
      source: name.get(e.data.source) ?? "", target: name.get(e.data.target) ?? "",
      label: e.data.kind === "subClassOf" ? "is a" : e.data.label,
    })).sort((a: any, b: any) => (a.label === "is a" ? 1 : 0) - (b.label === "is a" ? 1 : 0) || a.source.localeCompare(b.source));
  }, [graph.data]);

  if (bo.data && !bo.data.available) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-900">
      The Business Ontology snapshot is missing. Run <code className="font-mono">python3 tools/export_business_ontology.py</code>.
    </div>;
  }
  const b = bo.data?.available ? bo.data : null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white p-4">
        <SourceBadge source="native" asOf={asOf} href={b?.snowsightUrl} />
        <p className="mt-2 text-[12.5px] leading-relaxed text-slate-600">
          The app is built on the governed <b>Enterprise</b> domain, with a subdomain for each 360 app (Finance, Sales,
          People, Spend, Working Capital). It does not redefine Supplier, Customer, Plant or Sales Order: those are
          <b> reused</b> from the governed Supply Chain domain, so one Supplier means the same thing in every app. Every
          page finds its data by walking these relationships and reading each concept's <b>representations</b>.
        </p>
      </div>

      {b && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Governed concepts" value={String(b.counts.nodes)}
            sub={`${b.counts.owned} governed in Enterprise · ${b.counts.reused} reused from Supply Chain`} />
          <Kpi label="Relationships" value={String(b.counts.relationships)}
            sub={Object.entries(b.relationshipTypes).map(([k, v]) => `${v} ${k.toLowerCase().replace("_", " ")}`).join(" · ")} />
          <Kpi label="Representations" value={String(b.counts.representations)} sub="concept → Snowflake object links" />
          <Kpi label="Domains" value={String(b.domains.length)}
            sub={b.domains.map((d) => d.replace("Enterprise.", "")).join(" · ")} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {graph.error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12px] text-red-800">{String(graph.error)}</div>}
          <GraphCanvas elements={graph.data?.elements ?? []} onSelectNode={setSel} height={660} layout="tree" />
          <div className="mt-1 text-[11px] text-slate-500">
            Colour = branch (Org Unit, Party, Transaction, Product). The second line of each box says which domain governs
            the concept and whether Enterprise owns it or reuses it from Supply Chain.
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {!selName && (
            <div className="text-[12px] text-slate-500">
              Select a concept to see its governed definition, relationships, the Snowflake objects that represent it,
              and its change history.
            </div>
          )}
          {selName && node.data && (
            <div className="space-y-3">
              <AskCortex compact topic="ent-model" args={{ concept: node.data.name }} label={`Explain ${node.data.name}`}
                suggestions={[`How does ${node.data.name} connect the 360 apps?`]} />
              <NativePanel n={node.data} asOf={asOf} />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">What the app reads through the ontology</h3>
          <SourceBadge source="native" />
        </div>
        <p className="mt-0.5 text-[12px] text-slate-600">
          No page names a table. Each input is found from a governed concept, then read from the representation the
          steward linked to it. Instance links (which employee is in which department) come from the knowledge graph
          beside the class views, and each edge type is checked against the governed relationship it instantiates.
        </p>
        <table className="mt-2 w-full text-[12px]">
          <thead><tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-1 pr-3 font-semibold">App input</th><th className="py-1 pr-3 font-semibold">Through</th>
            <th className="py-1 pr-3 font-semibold">Concept</th><th className="py-1 font-semibold">Representation read</th></tr></thead>
          <tbody>
            {USES.map((u) => Object.entries(lineage[u.key] ?? {}).map(([concept, fqn], i) => (
              <tr key={u.key + concept} className="border-b border-gray-100 last:border-0">
                <td className="py-1 pr-3 text-slate-800">{i === 0 ? u.part : ""}</td>
                <td className="py-1 pr-3 text-slate-500">{i === 0 ? u.via : ""}</td>
                <td className="py-1 pr-3 font-medium text-sky-800">{concept}</td>
                <td className="py-1 font-mono text-[11px] text-slate-700">{fqn}</td>
              </tr>)))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-800">Relationships ({rels.length})</h3>
          <div className="mt-2 grid grid-cols-1 gap-x-6 md:grid-cols-2">
            {rels.map((r: any, i: number) => (
              <div key={i} className="flex items-baseline gap-1 border-b border-gray-100 py-0.5 text-[11.5px]">
                <span className="text-slate-800">{r.source}</span>
                <span className={`font-medium ${r.label === "is a" ? "text-slate-500" : "text-sky-800"}`}>{r.label}</span>
                <span className="text-slate-700">{r.target}</span>
              </div>))}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 text-[12px] leading-relaxed text-slate-600">
          <h3 className="text-sm font-semibold text-slate-800">Not modelled in Business Ontology</h3>
          <p className="mt-1">Business Ontology governs meaning, not instances or mechanics. These stay outside it:</p>
          <ul className="mt-1 list-disc pl-4">
            <li>Which local record is the same as which golden record (the crosswalk rows)</li>
            <li>Instance links in the knowledge graph (1 employee, 1 department)</li>
            <li>One custom relationship per concept pair: "owes to" is modelled as AP Invoice payable to Supplier</li>
            <li>The shock-propagation and mitigation rules of the scenario engine</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

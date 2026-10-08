import { useMemo, useState } from "react";
import { useQuery } from "../hooks/useQuery";
import { api } from "../lib/api";
import { GraphCanvas } from "../components/GraphCanvas";
import { ProcessBadge } from "../components/Cards";

export default function Graph() {
  const meta = useQuery(() => api.meta(), []);
  const [selProcs, setSelProcs] = useState<string[]>([]);
  const [lob, setLob] = useState("All");
  const [industry, setIndustry] = useState("All");
  const [source, setSource] = useState("All");
  const [provenance, setProvenance] = useState("All");
  const [search, setSearch] = useState("");
  const [cross, setCross] = useState(true);
  const [expand, setExpand] = useState<string | null>(null);
  const [sel, setSel] = useState<any | null>(null);

  const opts = { processes: selProcs, lob, industry, source, provenance, search, expand, cross };
  const dkey = [selProcs.join(","), lob, industry, source, provenance, search];
  const graph = useQuery(() => api.graph(opts), [...dkey, expand, cross]);
  const products = useQuery(() => api.products({ processes: selProcs, lob, industry, source, provenance, search }), dkey);

  const procDefs = useMemo(
    () => (meta.data?.processes ?? []).filter((p) => p.products > 0),
    [meta.data],
  );
  const colorOf = useMemo(
    () => Object.fromEntries((meta.data?.processes ?? []).map((p) => [p.code, p.color])),
    [meta.data],
  );

  const toggleProc = (code: string) =>
    setSelProcs((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const nodeCount = (graph.data?.elements ?? []).filter(
    (e: any) => e.data.kind && e.data.kind !== "process" && !e.data.source).length;
  const edgeCount = (graph.data?.elements ?? []).filter((e: any) => e.data.source).length;

  return (
    <div className="space-y-4">
      {/* process chips */}
      <div className="flex flex-wrap items-center gap-2">
        {procDefs.map((p) => {
          const on = selProcs.length === 0 || selProcs.includes(p.code);
          return (
            <button key={p.code} onClick={() => toggleProc(p.code)}
              className="rounded-full px-2.5 py-1 text-xs font-medium transition"
              style={{
                backgroundColor: on ? `${p.color}22` : "#f1f5f9",
                color: on ? p.color : "#94a3b8",
                outline: selProcs.includes(p.code) ? `1.5px solid ${p.color}` : "none",
              }}>
              <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: p.color }} />
              {p.name} <span className="opacity-60">({p.products})</span>
            </button>
          );
        })}
        {selProcs.length > 0 && (
          <button onClick={() => setSelProcs([])} className="text-xs text-slate-400 underline">clear</button>
        )}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
        <select value={lob} onChange={(e) => setLob(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="All">All lines of business</option>
          {(meta.data?.lobs ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={industry} onChange={(e) => setIndustry(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="All">All industries</option>
          {(meta.data?.industries ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="All">All source systems</option>
          {(meta.data?.sources ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={provenance} onChange={(e) => setProvenance(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="All">Any provenance</option>
          {(meta.data?.provenance ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="w-44 rounded-md border border-gray-300 px-2 py-1 text-sm" />
        <select value={expand ?? ""} onChange={(e) => setExpand(e.target.value || null)}
          className="min-w-[16rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="">— expand a product into entities —</option>
          {(products.data ?? []).filter((p) => p.entity_count > 0).map((p) => (
            <option key={p.tech} value={p.tech}>{p.label} · {p.entity_count} entities</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={cross} onChange={(e) => setCross(e.target.checked)} />
          cross-process edges
        </label>
        <span className="ml-auto text-xs text-slate-400">{nodeCount} nodes · {edgeCount} edges</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3">
          {graph.error ? (
            <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-600">{graph.error}</div>
          ) : (
            <GraphCanvas elements={graph.data?.elements ?? []} onSelectNode={setSel} height={660} />
          )}
        </div>
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Details</h3>
            {sel ? (
              <div className="mt-2 space-y-2">
                <div className="text-sm font-semibold text-slate-800">{sel.label}</div>
                {sel.process && colorOf[sel.process] && (
                  <ProcessBadge code={sel.process} color={colorOf[sel.process]} />
                )}
                {sel.sub && (
                  <div className="text-xs leading-relaxed text-slate-500"
                    dangerouslySetInnerHTML={{ __html: sel.sub }} />
                )}
                <div className="text-[10px] uppercase tracking-wide text-slate-300">{sel.kind}</div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                Click any node to focus its neighbourhood and see details. Use the picker
                above to expand a product into its CDS entities and associations.
              </p>
            )}
          </div>
          <Legend procDefs={procDefs} roles={meta.data?.roles ?? []} expanded={!!expand} />
        </div>
      </div>
    </div>
  );
}

function Legend({ procDefs, roles, expanded }: { procDefs: any[]; roles: any[]; expanded: boolean }) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-xs">
      <div className="mb-2 font-semibold text-slate-700">Legend</div>
      {expanded ? (
        <div className="space-y-1">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Entity semantic role</div>
          {roles.filter((r) => r.count > 0).map((r) => (
            <div key={r.role} className="flex items-center gap-2 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
              {r.label} <span className="opacity-50">({r.count})</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {procDefs.map((p) => (
            <div key={p.code} className="flex items-center gap-2 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />{p.name}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-slate-500">
        <span className="inline-block h-0.5 w-4" style={{ backgroundColor: "#ef4444" }} />ODM master-data link
      </div>
      <div className="flex items-center gap-2 text-slate-500">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-green-600" />has semantic model
      </div>
    </div>
  );
}

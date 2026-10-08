import { useMemo, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { GraphCanvas } from "../../components/GraphCanvas";
import { Panel, ModuleChips, MODULE_COLOR, usd, num } from "../../components/EntBits";

const TYPE_COLOR: Record<string, string> = { LegalEntity: "#0f172a", Customer: "#16a34a", Supplier: "#d97706",
  Department: "#a855f7", Plant: "#ef4444", SpendCategory: "#f59e0b", Equipment: "#f87171" };
const SHAPE: Record<string, string> = { LegalEntity: "star", Customer: "ellipse", Supplier: "diamond", Department: "round-rectangle",
  Plant: "hexagon", SpendCategory: "tag", Equipment: "triangle" };

/** The cross-domain graph: golden entities in the core, module nodes around them, edges coloured by module. */
export default function EntGraph() {
  const q = useQuery(() => entApi.graph(), []);
  const [mods, setMods] = useState<string[]>(["CORE", "FIN", "PPL", "SPD", "WCP", "SCM"]);
  const [sel, setSel] = useState<any>(null);
  const elements = useMemo(() => {
    if (!q.data) return [];
    const edges = q.data.edges.filter((e: any) => mods.includes(e.module));
    const used = new Set(edges.flatMap((e: any) => [e.source, e.target]));
    const nodes = q.data.nodes.filter((n: any) => used.has(n.id) || n.type === "LegalEntity");
    return [
      ...nodes.map((n: any) => ({ data: { ...n, label: n.label, processColor: TYPE_COLOR[n.type] ?? MODULE_COLOR[n.module], shape: SHAPE[n.type] ?? "ellipse",
        size: n.type === "LegalEntity" ? 44 : n.type === "Customer" || n.type === "Supplier" ? 22 + Math.min(18, (n.members ?? 0)) : 16 } })),
      ...edges.map((e: any, i: number) => ({ data: { id: `e${i}`, ...e, label: "", ecolor: MODULE_COLOR[e.module] } })),
    ];
  }, [q.data, mods]);
  if (q.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (q.error) return <p className="text-sm text-rose-600">{q.error}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Edges from:</span>
        {["CORE", "FIN", "PPL", "SPD", "WCP", "SCM"].map((m) => (
          <button key={m} onClick={() => setMods((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))}
            className={`rounded px-2 py-1 font-bold ${mods.includes(m) ? "text-white" : "bg-white text-slate-400 border border-slate-200"}`}
            style={mods.includes(m) ? { background: MODULE_COLOR[m] } : {}}>{m}</button>
        ))}
        <span className="ml-2 text-slate-400">★ company · ◆ supplier (amber) · ● customer (green) · ⬢ plant · ▲ tool · ▭ department · tag = spend category · edges coloured by the app that asserts them</span>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
        <div className="rounded-xl border border-slate-200 bg-white"><GraphCanvas elements={elements} onSelectNode={setSel} height={640} /></div>
        <Panel title={sel ? sel.label : "Select a node"}>
          {sel ? (
            <div className="space-y-2 text-xs">
              <div className="flex gap-2"><ModuleChips list={sel.module} /><span className="text-slate-500">{sel.type}</span></div>
              {sel.members != null && <p>{num(sel.members)} local records across apps resolve here.</p>}
              {sel.employees != null && <p>{num(sel.employees)} active employees.</p>}
              <h4 className="pt-2 font-bold text-slate-700">Links</h4>
              <ul className="space-y-1">
                {q.data!.edges.filter((e: any) => e.source === sel.id || e.target === sel.id)
                  .sort((a: any, b: any) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 14).map((e: any, i: number) => {
                    const other = q.data!.nodes.find((n: any) => n.id === (e.source === sel.id ? e.target : e.source));
                    return <li key={i}><span className="font-semibold" style={{ color: MODULE_COLOR[e.module] }}>{e.type}</span> {other?.label}
                      {e.weight > 1 && <span className="text-slate-400"> · {e.type === "supplies" ? `${num(e.weight)} lots` : usd(e.weight)}</span>}</li>;
                  })}
              </ul>
            </div>
          ) : <p className="text-xs text-slate-500">Click any node. Golden customers and suppliers show how many app records resolve to them.</p>}
        </Panel>
      </div>
    </div>
  );
}

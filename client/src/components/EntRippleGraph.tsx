import { useEffect, useMemo, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type cytoscape from "cytoscape";
import type { ImpactLink, ImpactNode, LinkHit, NodeHit } from "../lib/entImpact";
import { hopColor, severityColor, TYPE_COLOR } from "../lib/entSeverity";

/**
 * Topology of the enterprise ripple: how far from the event each object sits, in
 * five columns that read left to right as the shock travels — suppliers, plants,
 * customers, legal entities, then the six 360 apps that record it.
 */
const COLUMN: Record<string, number> = { Supplier: 0, Currency: 0, Plant: 1, Customer: 2, LegalEntity: 3, App: 4 };
export const COLUMN_LABELS = ["Suppliers", "Plants", "Customers", "Legal entities", "360 apps"];

export function EntRippleGraph({ nodes, links, nodeHits = {}, linkHits = {}, revealHop, highlight, spof, height = 440, protectedNodes }: {
  nodes: ImpactNode[]; links: ImpactLink[]; nodeHits?: Record<string, NodeHit>; linkHits?: Record<string, LinkHit>;
  revealHop?: number; highlight?: Set<string>; spof?: Set<string>; height?: number; protectedNodes?: Set<string>;
}) {
  const cyRef = useRef<cytoscape.Core | null>(null);
  const show = (hop: number) => revealHop === undefined || hop <= revealHop;
  const spot = !!highlight && highlight.size > 0;

  // Only columns the scenario reaches are drawn, so a terms or FX shock is not
  // padded out with an untouched supply network.
  const used = useMemo(() => {
    const ids = new Set(Object.keys(nodeHits));
    for (const l of links) if (linkHits[l.id]) { ids.add(l.source); ids.add(l.target); }
    return nodes.filter((n) => ids.has(n.id));
  }, [nodes, links, nodeHits, linkHits]);

  const elements = useMemo(() => {
    const els: any[] = [];
    const cols = new Map<number, ImpactNode[]>();
    for (const n of used) { const c = COLUMN[n.type] ?? 2; (cols.get(c) ?? cols.set(c, []).get(c)!).push(n); }
    for (const list of cols.values()) list.sort((a, b) => (nodeHits[b.id]?.valueUsd ?? 0) - (nodeHits[a.id]?.valueUsd ?? 0) || a.name.localeCompare(b.name));
    const tallest = Math.max(1, ...[...cols.values()].map((l) => l.length));
    for (const [col, list] of cols) {
      const step = Math.min(78, (tallest * 62) / list.length);
      const top = -((list.length - 1) * step) / 2;
      list.forEach((n, i) => {
        const h = nodeHits[n.id];
        const vis = !!(h && show(h.hop));
        els.push({ data: {
          id: n.id, label: n.name, shape: n.type === "Plant" ? "round-rectangle" : n.type === "LegalEntity" ? "diamond" : n.type === "App" ? "round-tag" : "ellipse",
          color: vis ? (protectedNodes?.has(n.id) ? "#22c55e" : severityColor(h!.severity)) : TYPE_COLOR[n.type],
          ring: vis ? hopColor(h!.hop) : "#cbd5e1", ringWidth: vis ? 4 : 1.2,
          size: n.type === "App" ? 30 : n.type === "Plant" ? 40 : 32, opacity: vis || revealHop === undefined ? 1 : 0.35,
          spof: spof?.has(n.id) ? "yes" : "no",
        }, position: { x: col * 230, y: top + i * step } });
      });
    }
    const present = new Set(used.map((n) => n.id));
    for (const l of links) {
      if (!present.has(l.source) || !present.has(l.target)) continue;
      const h = linkHits[l.id];
      const vis = !!(h && show(h.hop));
      if (!vis && l.rel === "reportsIn") continue;
      const lit = !spot || highlight!.has(l.id);
      els.push({ data: { id: l.id, source: l.source, target: l.target,
        color: vis ? severityColor(h!.severity) : "#cbd5e1", width: vis ? (lit ? 3.5 : 1.5) : 1,
        opacity: vis ? (lit ? 0.95 : 0.25) : 0.25 } });
    }
    return els;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [used, links, nodeHits, linkHits, revealHop, highlight, spof, protectedNodes]);

  useEffect(() => { const cy = cyRef.current; if (cy) requestAnimationFrame(() => cy.fit(undefined, 30)); }, [used.length]);

  const colsShown = [...new Set(used.map((n) => COLUMN[n.type] ?? 2))].sort();
  return (
    <div>
      <div className="mb-1 grid text-[10px] font-semibold uppercase tracking-wide text-slate-400"
           style={{ gridTemplateColumns: `repeat(${colsShown.length}, minmax(0, 1fr))` }}>
        {colsShown.map((c) => <span key={c} className="text-center">{COLUMN_LABELS[c]}</span>)}
      </div>
      <CytoscapeComponent elements={elements} cy={(cy: cytoscape.Core) => { cyRef.current = cy; }}
        layout={{ name: "preset", fit: true, padding: 30 }} userZoomingEnabled={false} userPanningEnabled={false} autoungrabify
        style={{ width: "100%", height }}
        stylesheet={[
          { selector: "node", style: { "background-color": "data(color)", shape: "data(shape)" as any, width: "data(size)", height: "data(size)",
            "border-color": "data(ring)", "border-width": "data(ringWidth)", opacity: "data(opacity)" as any, label: "data(label)",
            "font-size": 15, color: "#1e293b", "text-valign": "bottom", "text-margin-y": 5, "text-wrap": "wrap", "text-max-width": "150px",
            "transition-property": "background-color, border-color, opacity", "transition-duration": 300 } as any },
          { selector: "node[spof = 'yes']", style: { "border-color": "#facc15", "border-style": "double", "border-width": 6 } as any },
          { selector: "edge", style: { "line-color": "data(color)", width: "data(width)", opacity: "data(opacity)" as any, "curve-style": "bezier",
            "target-arrow-shape": "triangle", "target-arrow-color": "data(color)", "arrow-scale": 0.7 } as any },
        ]} />
      <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-slate-500">
        <span>the shock travels left to right</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-yellow-400" /> single point of failure</span>
        <span>ring colour = hops from the event</span>
      </div>
    </div>
  );
}

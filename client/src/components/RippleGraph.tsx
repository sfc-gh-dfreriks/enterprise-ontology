import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { edgeWidth, hopColor, severityColor, TYPE_COLOR } from "../lib/severity";
import type { AffectedFlow, ImpairedNode, Reroute, ScFlow, ScNode } from "../lib/api";

cytoscape.use(fcose);

/**
 * Topological view of the same disruption the map shows.
 *
 * Geography answers "where"; topology answers "how far from the event". They are
 * different questions and the same reader needs both — Penang being two hops
 * downstream of Austin is invisible on a map, and Austin being in a hurricane belt
 * is invisible in a graph.
 *
 * Layout is left-to-right by role (supplier → plant → customer) rather than
 * force-directed, because supply chains have an inherent direction and a physics
 * layout throws it away, putting customers upstream of suppliers at random.
 */

export interface RippleGraphProps {
  nodes: ScNode[];
  flows: ScFlow[];
  affected?: Map<string, AffectedFlow>;
  impaired?: Map<string, ImpairedNode>;
  reroutes?: Reroute[];
  revealHop?: number;
  /** Flow ids to spotlight. Everything else drops back, matching the map. */
  highlightFlows?: Set<string>;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Node ids that are a single point of failure, badged on the graph. */
  spof?: Set<string>;
  height?: number;
}

const COLUMN: Record<string, number> = { Supplier: 0, Plant: 1, Customer: 2 };

export function RippleGraph({
  nodes, flows, affected, impaired, reroutes,
  revealHop, highlightFlows, selected, onSelect, spof, height = 460,
}: RippleGraphProps) {
  const spotlight = highlightFlows && highlightFlows.size > 0;
  const cyRef = useRef<cytoscape.Core | null>(null);
  // Once the viewer zooms or pans deliberately, stop re-framing the graph on
  // every beat: being yanked back mid-inspection is worse than a stale frame.
  // The reset control below is the way back.
  const userMoved = useRef(false);
  const programmatic = useRef(false);
  const [moved, setMoved] = useState(false);
  const maxVol = useMemo(() => Math.max(1, ...flows.map((f) => f.monthly_volume)), [flows]);
  const show = (hop: number) => revealHop === undefined || hop <= revealHop;

  const frame = (cy: cytoscape.Core) => {
    programmatic.current = true;
    cy.fit(undefined, 44);
    // cy.fit emits zoom and pan, which would otherwise look like user input
    requestAnimationFrame(() => { programmatic.current = false; });
  };

  const resetView = () => {
    const cy = cyRef.current;
    if (!cy) return;
    userMoved.current = false;
    setMoved(false);
    frame(cy);
  };

  const elements = useMemo(() => {
    const els: any[] = [];

    // Deterministic tiers keep suppliers left and customers right. Within a tier
    // nodes are spread by latitude so the vertical order still carries a hint of
    // geography and does not reshuffle between renders.
    const tiers = new Map<number, ScNode[]>();
    for (const n of nodes) {
      const c = COLUMN[n.node_type] ?? 1;
      (tiers.get(c) ?? tiers.set(c, []).get(c)!).push(n);
    }
    for (const list of tiers.values()) list.sort((a, b) => b.latitude - a.latitude);

    for (const [col, list] of tiers) {
      list.forEach((n, i) => {
        const imp = impaired?.get(n.node_id);
        const visible = !imp || show(imp.hop);
        const sev = imp && visible ? imp.impairment : 0;
        els.push({
          data: {
            id: n.node_id,
            label: n.node_name,
            kind: n.node_type,
            color: sev > 0 ? severityColor(sev) : TYPE_COLOR[n.node_type],
            ring: imp && visible ? hopColor(imp.hop) : "#e2e8f0",
            ringWidth: imp && visible ? 4 : 1.4,
            size: n.node_type === "Plant" ? 46 : 34,
            spof: spof?.has(n.node_id) ? "yes" : "no",
            hop: imp && visible ? imp.hop : -1,
            impairment: sev,
          },
          position: { x: col * 340, y: i * 92 },
        });
      });
    }

    for (const f of flows) {
      const a = affected?.get(f.flow_id);
      const visible = !a || show(a.hop);
      const hit = !!(a && visible);
      const lit = !spotlight || highlightFlows!.has(f.flow_id);
      els.push({
        data: {
          id: f.flow_id, source: f.source_id, target: f.target_id,
          label: f.material_category,
          color: hit ? severityColor(a!.impactFactor) : "#94a3b8",
          width: edgeWidth(f.monthly_volume, maxVol, 1, 7) + (hit && lit ? 3 : hit ? 1 : 0),
          opacity: hit ? (lit ? 1 : 0.2) : spotlight ? 0.12 : 0.35,
          cls: "flow",
        },
      });
    }

    // Reroutes are added as extra edges rather than by restyling existing ones:
    // a reroute is a NEW lane that does not exist in the baseline network, and
    // recolouring an old edge would misrepresent what is being proposed.
    const byName = new Map(nodes.map((n) => [n.node_name, n]));
    for (const r of reroutes ?? []) {
      const from = byName.get(r.toPlant), to = byName.get(r.customer);
      if (!from || !to) continue;
      els.push({
        data: {
          id: `rr-${r.flow_id}`, source: from.node_id, target: to.node_id,
          label: `${r.material_category} (rerouted)`,
          color: "#38bdf8", width: 3, opacity: 1, cls: "reroute",
        },
      });
    }
    return els;
  }, [nodes, flows, affected, impaired, reroutes, revealHop, spof, maxVol,
      highlightFlows, spotlight]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    // positions are preset and already correct; fit is applied separately so a
    // deliberate zoom survives the next beat
    cy.layout({ name: "preset", fit: false, animate: false } as any).run();
    if (!userMoved.current) frame(cy);
  }, [elements]);

  return (
    <div className="relative rounded-lg bg-white">
      {/* Reset sits over the canvas, and only appears once there is something to
          reset — a permanent button on an unmoved graph is just noise. */}
      {moved && (
        <button
          onClick={resetView}
          title="Refit the graph to the panel"
          className="absolute right-2 top-2 z-10 rounded-md border border-gray-300 bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Reset view
        </button>
      )}
      <CytoscapeComponent
        elements={elements}
        style={{ width: "100%", height }}
        cy={(cy: cytoscape.Core) => {
          cyRef.current = cy;
          cy.removeAllListeners();
          cy.on("tap", "node", (e: cytoscape.EventObject) => onSelect?.(e.target.id()));
          cy.on("tap", (e: cytoscape.EventObject) => {
            if (e.target === cy) onSelect?.(null);
          });
          cy.on("zoom pan", () => {
            if (programmatic.current || userMoved.current) return;
            userMoved.current = true;
            setMoved(true);
          });
        }}
        stylesheet={[
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              "border-color": "data(ring)",
              "border-width": "data(ringWidth)",
              width: "data(size)", height: "data(size)",
              label: "data(label)",
              "font-size": 10, color: "#334155",
              "text-valign": "bottom", "text-margin-y": 5,
              "text-wrap": "wrap", "text-max-width": "96px",
            } as any,
          },
          { selector: 'node[kind = "Plant"]', style: { shape: "round-rectangle" } as any },
          // SPOF badge: a dashed halo, chosen because it survives the node already
          // being recoloured by severity
          {
            selector: 'node[spof = "yes"]',
            style: {
              "background-blacken": 0.06,
              "overlay-color": "#f59e0b", "overlay-opacity": 0.18, "overlay-padding": 8,
            } as any,
          },
          {
            selector: "node:selected",
            style: { "border-color": "#0f172a", "border-width": 5 } as any,
          },
          {
            selector: "edge",
            style: {
              "line-color": "data(color)", "target-arrow-color": "data(color)",
              "target-arrow-shape": "triangle", "arrow-scale": 0.85,
              width: "data(width)", opacity: "data(opacity)",
              "curve-style": "bezier", "control-point-step-size": 46,
            } as any,
          },
          {
            selector: 'edge[cls = "reroute"]',
            style: { "line-style": "dashed", "line-dash-pattern": [7, 5] } as any,
          },
        ]}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-2 text-[11px] text-slate-500">
        <span>suppliers → plants → customers, left to right</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-amber-400" /> single point of failure
        </span>
        <span>ring colour = hops from the event</span>
      </div>
    </div>
  );
}

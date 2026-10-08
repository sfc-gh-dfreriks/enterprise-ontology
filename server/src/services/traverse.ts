/**
 * Graph traversal over the supply-chain entity association graph.
 *
 * The agent repo does this with Snowflake graph UDFs against a KG_NODE/KG_EDGE
 * pair. Here the whole graph is 338 entities and 281 undirected associations —
 * small enough to traverse in-process, which avoids a warehouse round-trip per
 * click and keeps expansion interactive.
 *
 * Associations are treated as undirected. SAP CDS declares an association from
 * one entity to another, but for "what is connected to this" the direction is
 * not meaningful — a BOM item pointing at a material and a material pointed at
 * by a BOM item are the same neighbourhood.
 */
import { loadOntology, type Ontology } from "./ontology.js";

export interface TraverseNode {
  id: string;
  label: string;
  product: string;
  productLabel: string;
  process: string;
  role: string;
  elements: number;
  depth: number;
}

export interface TraverseEdge {
  source: string;
  target: string;
  crossProduct: boolean;
}

let _adj: Map<string, Set<string>> | null = null;

/** Undirected adjacency, built once and reused across requests. */
function adjacency(ont: Ontology): Map<string, Set<string>> {
  if (_adj) return _adj;
  const a = new Map<string, Set<string>>();
  const link = (x: string, y: string) => {
    if (!a.has(x)) a.set(x, new Set());
    a.get(x)!.add(y);
  };
  for (const e of ont.entity_edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  _adj = a;
  return a;
}

/**
 * Whether an association crosses a data product boundary.
 *
 * Derived from the two endpoints' owning products rather than read from
 * EntityEdge.cross_product: that flag is present in the source ontology but is
 * never set true, so trusting it would paint every edge as internal.
 */
function crosses(ont: Ontology, a: string, b: string): boolean {
  const ta = (ont.entities as any)[a]?.tech;
  const tb = (ont.entities as any)[b]?.tech;
  return !!ta && !!tb && ta !== tb;
}

function node(ont: Ontology, id: string, depth: number): TraverseNode | null {
  const e: any = (ont.entities as any)[id];
  if (!e) return null;
  const p: any = (ont.products as any)[e.tech] || {};
  return {
    id,
    label: e.label || e.name || id,
    product: e.tech,
    productLabel: p.label || e.tech,
    process: p.process || "NONE",
    role: e.role || "other",
    elements: e.element_count ?? 0,
    depth,
  };
}

/**
 * Breadth-first expansion from a seed entity.
 *
 * `limit` caps the number of nodes returned. Without it a hub entity in a
 * densely-associated product can pull in most of its product at depth 2 and
 * the canvas becomes unreadable. Nodes are emitted in BFS order so the cap
 * truncates the outer ring rather than an arbitrary slice.
 */
export function traverse(seed: string, depth = 1, limit = 60) {
  const ont = loadOntology();
  if (!(ont.entities as any)[seed]) {
    return { error: `entity not found: ${seed}` };
  }
  const adj = adjacency(ont);
  const seen = new Map<string, number>([[seed, 0]]);
  const order: string[] = [seed];
  let frontier = [seed];

  for (let d = 1; d <= depth && order.length < limit; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of adj.get(cur) ?? []) {
        if (seen.has(nb)) continue;
        seen.set(nb, d);
        order.push(nb);
        next.push(nb);
        if (order.length >= limit) break;
      }
      if (order.length >= limit) break;
    }
    frontier = next;
    if (!next.length) break;
  }

  const keep = new Set(order);
  const nodes = order
    .map((id) => node(ont, id, seen.get(id) ?? 0))
    .filter((n): n is TraverseNode => n !== null);
  // include every edge among the kept nodes, not just tree edges, so the
  // rendered subgraph shows the real local density
  const edges: TraverseEdge[] = ont.entity_edges
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .map((e) => ({ source: e.source, target: e.target,
                   crossProduct: crosses(ont, e.source, e.target) }));

  return {
    seed,
    depth,
    nodes,
    edges,
    truncated: order.length >= limit,
    reachable: reachableCount(adj, seed),
  };
}

/** Size of the connected component containing `seed`. */
function reachableCount(adj: Map<string, Set<string>>, seed: string): number {
  const seen = new Set([seed]);
  const q = [seed];
  while (q.length) {
    for (const nb of adj.get(q.shift()!) ?? []) {
      if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  return seen.size;
}

/**
 * Shortest association path between two entities.
 *
 * Returns null when the two sit in different connected components, which is
 * common here: the supply-chain slice is not one graph but several islands,
 * so "no path" is a real answer rather than an error.
 */
export function shortestPath(from: string, to: string) {
  const ont = loadOntology();
  if (!(ont.entities as any)[from]) return { error: `entity not found: ${from}` };
  if (!(ont.entities as any)[to]) return { error: `entity not found: ${to}` };
  if (from === to) return { from, to, hops: 0, path: [node(ont, from, 0)], edges: [] };

  const adj = adjacency(ont);
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  let found = false;

  while (q.length && !found) {
    const cur = q.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      if (nb === to) { found = true; break; }
      q.push(nb);
    }
  }
  if (!found) {
    return { from, to, hops: null, path: [], edges: [],
             reason: "no association path — these entities are in different components" };
  }

  const ids: string[] = [];
  for (let cur: string | null = to; cur !== null; cur = prev.get(cur) ?? null) ids.unshift(cur);
  const edges: TraverseEdge[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i], b = ids[i + 1];
    edges.push({ source: a, target: b, crossProduct: crosses(ont, a, b) });
  }
  return {
    from, to,
    hops: ids.length - 1,
    path: ids.map((id, i) => node(ont, id, i)).filter(Boolean),
    edges,
    crossesProducts: new Set(ids.map((id) => (ont.entities as any)[id]?.tech)).size,
  };
}

/** Entities ranked by degree — the useful starting points for a traversal. */
export function hubs(limit = 25) {
  const ont = loadOntology();
  const adj = adjacency(ont);
  return [...adj.entries()]
    .map(([id, nbs]) => ({ ...node(ont, id, 0)!, degree: nbs.size }))
    .filter((h) => h.id)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, limit);
}

/**
 * Shape of the supply-chain graph, reported so the traversal UI can state its
 * own limits instead of implying a richer graph than exists.
 *
 * Two facts drive this. First, no entity association in the BDC catalog crosses
 * a data product boundary — every declared association stays inside its own
 * product — so an entity-level shortest path can never leave the product it
 * started in. Second, cross-product linkage lives one level up in the ODM
 * overlay, and in the supply-chain slice that overlay is a star centred on a
 * single canonical object.
 */
export function topology() {
  const ont = loadOntology();
  const adj = adjacency(ont);

  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const n of adj.keys()) {
    if (seen.has(n)) continue;
    const q = [n]; let size = 0; seen.add(n);
    while (q.length) {
      size++;
      for (const nb of adj.get(q.pop()!) ?? []) {
        if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);

  const entityIds = Object.keys(ont.entities as any);
  const crossEntityEdges = ont.entity_edges.filter(
    (e) => crosses(ont, e.source, e.target)).length;

  // product-level ODM overlay
  const padj = new Map<string, Set<string>>();
  for (const k of Object.keys(ont.product_pairs)) {
    const [a, b] = k.split("||");
    if (!padj.has(a)) padj.set(a, new Set());
    if (!padj.has(b)) padj.set(b, new Set());
    padj.get(a)!.add(b); padj.get(b)!.add(a);
  }
  const pdeg = [...padj.entries()]
    .map(([tech, nbs]) => ({
      tech,
      label: (ont.products as any)[tech]?.label || tech,
      degree: nbs.size,
    }))
    .sort((a, b) => b.degree - a.degree);

  const canon = new Map<string, number>();
  for (const e of ont.odm_edges) canon.set(e.canonical, (canon.get(e.canonical) ?? 0) + 1);

  return {
    entities: {
      total: entityIds.length,
      connected: adj.size,
      isolated: entityIds.length - adj.size,
      components: sizes.length,
      largestComponent: sizes[0] ?? 0,
      componentSizes: sizes.slice(0, 12),
      crossProductEdges: crossEntityEdges,
      totalEdges: ont.entity_edges.length,
    },
    products: {
      total: Object.keys(ont.products as any).length,
      inOdmGraph: padj.size,
      hubs: pdeg.slice(0, 5),
      canonicalObjects: [...canon.entries()]
        .map(([canonical, links]) => ({ canonical, links }))
        .sort((a, b) => b.links - a.links),
    },
  };
}

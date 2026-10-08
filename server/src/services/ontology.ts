// Loads the precomputed SAP BDC ontology (data/bdc_ontology.json) and shapes
// Cytoscape graph elements. Mining is done offline by tools/export_ontology.py
// (the validated Python engine); this module is a thin, typed server over it.

import fs from "fs";
import path from "path";

export interface ProcessDef { code: string; name: string; color: string; }

export interface ProductNode {
  tech: string; label: string; process: string; lob: string; products: string;
  source_systems: string[]; industries: string[]; suite_package: string;
  provenance: string; category: string; business_process_field: string;
  has_semantic: boolean; entity_count: number; assoc_count: number;
  roles: Record<string, number>; canonical: string[]; odm_refs: string[];
  cross_process_refs: string[]; cross_product_assoc: number; centrality: number;
}
export interface EntityNode {
  id: string; name: string; label: string; tech: string; process: string;
  element_count: number; role: string; modeling_pattern: string;
  canonical: string | null; associations: any[];
}
export interface EntityEdge { source: string; target: string; cross_product: boolean; }
export interface OdmEdge { source: string; target: string; canonical: string; }

export interface Ontology {
  processes: ProcessDef[];
  role_label: Record<string, string>;
  role_color: Record<string, string>;
  products: Record<string, ProductNode>;
  entities: Record<string, EntityNode>;
  entity_edges: EntityEdge[];
  product_pairs: Record<string, number>;
  odm_owner: Record<string, string>;
  odm_edges: OdmEdge[];
  rollup: any[];
  correlation: { codes: string[]; names: string[]; matrix: number[][]; top: any[] };
  scorecard: { overall: number; items: any[]; totals: Record<string, number> };
  insight_apps: any[];
  semantic_roles: any[];
  lens_summary: { source_systems: [string, number][]; industries: [string, number][]; provenance: [string, number][] };
}

const DATA_FILE = path.resolve(import.meta.dirname, "../../../data/sc_ontology.json");

let _cache: Ontology | null = null;

export function loadOntology(): Ontology {
  if (_cache) return _cache;
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Ontology data not found at ${DATA_FILE}. Run: npm run export-data`);
  }
  _cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Ontology;
  return _cache;
}

export interface GraphOpts {
  processes?: string[];
  lob?: string;
  search?: string;
  expand?: string | null;
  cross?: boolean;
  industry?: string;
  source?: string;
  provenance?: string;
}

function psize(entityCount: number): number {
  return Math.round(Math.min(58, 18 + Math.sqrt(entityCount) * 4) * 10) / 10;
}

// Port of ontology_builder.graph_elements: Process -> Product (+ ODM cross-product
// edges), optionally expanding one product into its CDS entities (colored by role).
export function buildGraph(ont: Ontology, opts: GraphOpts): any[] {
  const pcolor: Record<string, string> = Object.fromEntries(ont.processes.map((p) => [p.code, p.color]));
  const pname: Record<string, string> = Object.fromEntries(ont.processes.map((p) => [p.code, p.name]));
  const search = (opts.search || "").toLowerCase().trim();
  const procSet = opts.processes && opts.processes.length ? new Set(opts.processes) : null;
  const lob = opts.lob && opts.lob !== "All" ? opts.lob : null;
  const industry = opts.industry && opts.industry !== "All" ? opts.industry : null;
  const source = opts.source && opts.source !== "All" ? opts.source : null;
  const provenance = opts.provenance && opts.provenance !== "All" ? opts.provenance : null;
  const showCross = opts.cross !== false;

  const keep = (tech: string, pn: ProductNode): boolean => {
    if (procSet && !procSet.has(pn.process)) return false;
    if (lob && pn.lob !== lob) return false;
    if (industry && !pn.industries.includes(industry)) return false;
    if (source && !pn.source_systems.includes(source)) return false;
    if (provenance && pn.provenance !== provenance) return false;
    if (search && !pn.label.toLowerCase().includes(search) && !tech.toLowerCase().includes(search)) return false;
    return true;
  };

  const kept: Record<string, ProductNode> = {};
  for (const [tech, pn] of Object.entries(ont.products)) if (keep(tech, pn)) kept[tech] = pn;

  const usedProcs = Array.from(new Set(Object.values(kept).map((p) => p.process))).sort();
  const nodes: any[] = [];
  const edges: any[] = [];

  for (const code of usedProcs) {
    const cnt = Object.values(kept).filter((p) => p.process === code).length;
    nodes.push({ data: {
      id: `proc::${code}`, label: pname[code] || code,
      processColor: pcolor[code] || "#94a3b8", size: 64, kind: "process",
      sub: `Business process · ${cnt} products`,
    }});
  }

  for (const [tech, pn] of Object.entries(kept)) {
    nodes.push({ data: {
      id: `prod::${tech}`, label: pn.label, processColor: pcolor[pn.process] || "#94a3b8",
      size: psize(pn.entity_count), kind: "product", mapped: pn.has_semantic, process: pn.process,
      centrality: pn.centrality,
      sub: `${pname[pn.process]} · ${pn.lob}<br>${pn.entity_count} entities · ${pn.assoc_count} associations<br>` +
           `source: ${pn.source_systems.join(", ") || "—"} · ${pn.provenance}<br>` +
           `ODM refs: ${pn.odm_refs.slice(0, 6).join(", ") || "—"}<br>` +
           `semantic model: ${pn.has_semantic ? "yes" : "no"}`,
    }});
    edges.push({ data: {
      id: `c::${tech}`, source: `proc::${pn.process}`, target: `prod::${tech}`,
      kind: "contain", weight: 1, crossProcess: false,
    }});
  }

  if (showCross) {
    const seen = new Set<string>();
    for (const e of ont.odm_edges) {
      const a = e.source, b = e.target;
      if (!(a in kept) || !(b in kept)) continue;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ data: {
        id: `x::${a}::${b}`, source: `prod::${a}`, target: `prod::${b}`,
        kind: "cross", weight: 2, canonical: e.canonical, crossProcess: true,
      }});
    }
  }

  const expand = opts.expand && opts.expand in ont.products ? opts.expand : null;
  if (expand) {
    const rcolor = ont.role_color;
    const ents = Object.values(ont.entities).filter((e) => e.tech === expand);
    for (const e of ents) {
      nodes.push({ data: {
        id: e.id, label: e.name, processColor: rcolor[e.role] || "#94a3b8",
        size: Math.round(Math.min(34, 12 + Math.sqrt(e.element_count) * 1.5) * 10) / 10,
        kind: "entity", role: e.role,
        sub: `${e.label}<br>role: ${ont.role_label[e.role]} · ${e.element_count} columns` +
             (e.canonical ? `<br>ODM: ${e.canonical}` : ""),
      }});
      edges.push({ data: {
        id: `pe::${e.id}`, source: `prod::${expand}`, target: e.id,
        kind: "contain", weight: 1, crossProcess: false,
      }});
    }
    for (const ed of ont.entity_edges) {
      if (ed.source.startsWith(`${expand}::`) && ed.target.startsWith(`${expand}::`)) {
        edges.push({ data: {
          id: `a::${ed.source}->${ed.target}`, source: ed.source, target: ed.target,
          kind: "assoc", weight: 1, crossProcess: false,
        }});
      }
    }
  }

  return [...nodes, ...edges];
}

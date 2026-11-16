/**
 * Snowflake Business Ontology: the governed Enterprise model.
 *
 * The app is built on this: data/enterprise_ontology.json is exported by walking
 * the governed relationships and reading each concept's representations
 * (tools/export_enterprise_ontology.py), and the Ontology page shows the model as
 * governed: definitions, typed relationships, representations and change history.
 *
 * Source: the "Enterprise" domain on MSB89522 (subdomains Finance, Sales, People,
 * Spend, Working Capital) plus the Supply Chain concepts it reuses, exported
 * read-only by tools/export_business_ontology.py. Read from JSON so the static
 * site needs no credentials.
 */

import fs from "fs";
import path from "path";

export interface BoEdge { type: string; label: string | null; direction: "out" | "in"; node: string | null }
export interface BoRepresentation { object: string; fqn: string; objectType: string; role: string; validity: string | null }
export interface BoNode {
  termId: string; name: string; fqn: string; kind: string; domain: string; owner: "Enterprise" | "Supply Chain";
  status: string | null; description: string | null; synonyms: string[]; appClass: string;
  edges: BoEdge[]; representations: BoRepresentation[];
  history: { events: number; truncated: boolean; last: number | null; changedBy: string[] };
  createdOn: number | null; lastModifiedOn: number | null; snowsightUrl: string;
}
export interface BusinessOntology {
  domain: string; domains: string[]; account: string; exportedAt: string; snowsightUrl: string;
  counts: { nodes: number; owned: number; reused: number; relationships: number; representations: number };
  nodes: BoNode[];
  relationships: { source: string | null; target: string | null; type: string; label: string | null }[];
}

const DATA_FILE = path.resolve(import.meta.dirname, "../../../data/ent_business_ontology.json");

let _cache: BusinessOntology | null | undefined;

/** null when the export is missing; the pages that need it say so. */
export function loadBusinessOntology(): BusinessOntology | null {
  if (_cache !== undefined) return _cache;
  _cache = fs.existsSync(DATA_FILE)
    ? (JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as BusinessOntology)
    : null;
  return _cache;
}

export function boSummary(bo: BusinessOntology | null) {
  if (!bo) return { available: false as const };
  const types: Record<string, number> = {};
  for (const r of bo.relationships) types[r.type] = (types[r.type] ?? 0) + 1;
  const byDomain: Record<string, number> = {};
  for (const n of bo.nodes) byDomain[n.domain] = (byDomain[n.domain] ?? 0) + 1;
  return {
    available: true as const,
    domain: bo.domain, domains: bo.domains, account: bo.account, exportedAt: bo.exportedAt,
    snowsightUrl: bo.snowsightUrl, counts: bo.counts, relationshipTypes: types, byDomain,
  };
}

/** The governed concept for a name, by concept name or its no-space key. */
export function boNodeFor(bo: BusinessOntology | null, name: string): BoNode | null {
  if (!bo) return null;
  const k = name.toLowerCase().replace(/\s+/g, "");
  return bo.nodes.find((n) => n.appClass.toLowerCase() === k || n.name.toLowerCase().replace(/\s+/g, "") === k) ?? null;
}

function boxFor(name: string, sub: string) {
  const w = Math.round(Math.min(215, Math.max(150, Math.max(name.length * 7.4, sub.length * 5.3) + 30)));
  return { w, h: 54, tw: w - 20 };
}

// Grid slots (column, row). Organisation on the left, parties and the plant in the
// middle, money documents on the right, products and the supply chain underneath.
// Every concept in scope has a slot; a new one lands at the origin until added.
const SLOT: Record<string, [number, number]> = {
  OrgUnit: [0, 0], ProfitCenter: [-1, 1.4], SalesOrg: [-1, 2.8],
  LegalEntity: [1, 1.4], Department: [0, 2.8], CostCenter: [0, 4.2], Employee: [1, 2.8],
  Party: [3, 0], LocalCustomer: [3, 1.4], Customer: [4, 2.8], Plant: [2, 4.2],
  Supplier: [4, 4.2], LocalSupplier: [3, 5.6], SpendCategory: [5, 5.6],
  ComponentLot: [2, 5.6], MaterialFlow: [1, 5.6],
  Transaction: [6, 0], ARInvoice: [5, 1.4], APInvoice: [5, 4.2], SalesOrder: [6, 2.8],
  JournalEntry: [7, 1.4], Opportunity: [7, 2.8], PurchaseOrder: [7, 4.2],
  Product: [5, 7], Material: [4, 7], SellableProduct: [6, 7],
};

// Colour by branch: the concept's topmost IS_A ancestor. Borrowed Supply Chain
// concepts keep their branch colour and are marked as reused in the label.
const BRANCH: Record<string, string> = {
  "Org Unit": "#1B3A57", Party: "#0369a1", Transaction: "#7c3aed", Product: "#0f766e",
};

function branchOf(bo: BusinessOntology, name: string): string {
  const parent = new Map(bo.relationships.filter((r) => r.type === "IS_A").map((r) => [r.source, r.target]));
  let n = name;
  for (let i = 0; i < 10 && parent.has(n); i++) n = parent.get(n)!;
  return BRANCH[n] ?? "#334155";
}

export function buildBoGraph(bo: BusinessOntology): any[] {
  const byName = new Map(bo.nodes.map((n) => [n.name, n]));
  const nodes = bo.nodes.map((n) => {
    const s = SLOT[n.appClass] ?? [0, 0];
    const sub = `${n.domain.replace("Enterprise.", "")} · ${n.owner === "Enterprise" ? "owned" : "reused"}`;
    return {
      data: {
        id: `bo::${n.name}`, label: `${n.name}\n${sub}`,
        name: n.appClass, boName: n.name, kind: "class", native: true, reused: n.owner !== "Enterprise",
        processColor: branchOf(bo, n.name), ...boxFor(n.name, sub), abstract: false,
        sub: [n.description ?? "", `${n.representations.length} representation(s)`].filter(Boolean).join("<br>"),
      },
      position: { x: s[0] * 200, y: s[1] * 80 },
    };
  });
  const edges = bo.relationships
    .filter((r) => r.source && r.target && byName.has(r.source) && byName.has(r.target))
    .map((r, i) => ({
      data: {
        id: `bo-rel::${i}`, source: `bo::${r.source}`, target: `bo::${r.target}`, native: true,
        kind: r.type === "IS_A" ? "subClassOf" : "relation",
        label: r.type === "IS_A" ? undefined : (r.label ?? r.type.toLowerCase().replace("_", " ")),
        weight: r.type === "IS_A" ? 2 : 1,
      },
    }));
  return [...nodes, ...edges];
}

// Typed API client for the Enterprise Ontology server.
//
// Two modes:
//   - live (default): call the Express API on /api
//   - static (VITE_STATIC=1): read pre-baked JSON written by tools/bake_static.py,
//     for the public GitHub Pages build where there is no server and no Snowflake
//     credentials. Query strings are folded into the filename by the baker, so
//     the same call signatures work in both modes.
export const STATIC = import.meta.env.VITE_STATIC === "1";
const BASE = "/api";
const SNAP = `${import.meta.env.BASE_URL}data`;

/**
 * Mirror of the baker's filename rule: /products?a=1 -> products__a=1.json
 *
 * Percent-escapes are folded to "-": a literal "%3A" in a filename is decoded
 * back to ":" by the web server on the way in, so the request would never match
 * the file on disk. tools/bake_static.py applies the identical substitution.
 */
function snapshotName(pathname: string): string {
  const [p, q] = pathname.split("?");
  // a percent-escape in the path (a concept name with a space) is folded too: the web
  // server decodes "%20" in the request, so a filename keeping it would never match
  const stem = p.replace(/^\//, "").replace(/\//g, "_").replace(/%[0-9A-Fa-f]{2}/g, "-");
  if (!q) return `${stem}.json`;
  return `${stem}__${q.replace(/[^A-Za-z0-9=&._-]/g, "-")}.json`;
}

async function get<T>(pathname: string): Promise<T> {
  if (STATIC) {
    const res = await fetch(`${SNAP}/${snapshotName(pathname)}`);
    if (!res.ok) {
      throw new Error(
        "not in this snapshot — the public build ships a fixed set of views");
    }
    return res.json() as Promise<T>;
  }
  const res = await fetch(`${BASE}${pathname}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(pathname: string, body: unknown): Promise<T> {
  if (STATIC) {
    throw new Error(
      "This needs a live Snowflake connection and is disabled in the public build");
  }
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------- Snowflake Business Ontology
export interface BoEdge { type: string; label: string | null; direction: "out" | "in"; node: string | null }
export interface BoRepresentation { object: string; fqn: string; objectType: string; role: string; validity: string | null }
export interface BoNode {
  termId: string; name: string; fqn: string; kind: string; domain: string; owner: "Enterprise" | "Supply Chain";
  status: string | null; description: string | null; synonyms: string[]; appClass: string;
  edges: BoEdge[]; representations: BoRepresentation[];
  history: { events: number; truncated: boolean; last: number | null; changedBy: string[] };
  snowsightUrl: string;
}
export type BoSummary =
  | { available: false }
  | { available: true; domain: string; domains: string[]; account: string; exportedAt: string; snowsightUrl: string;
      counts: { nodes: number; owned: number; reused: number; relationships: number; representations: number };
      relationshipTypes: Record<string, number>; byDomain: Record<string, number> };

/** Stable key for a baked Ask Cortex answer: topic plus sorted args. */
export function askKey(topic: string, args: Record<string, unknown> = {}): string {
  const a = Object.keys(args).sort().map((k) => `${k}=${typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]}`).join("&");
  return a ? `${topic}?${a}` : topic;
}

/**
 * Grounded analysis of the view on screen. Live: the server traverses the graph
 * (or runs the scenario) and passes the result to AI_COMPLETE. Static: answers
 * for each view's default question are baked by tools/bake_static.py.
 */
export async function askCortex(topic: string, args: Record<string, unknown> = {}, question = ""): Promise<string> {
  if (STATIC) {
    const res = await fetch(`${SNAP}/ask_cortex.json`);
    const baked: Record<string, string> = res.ok ? await res.json() : {};
    return (!question && baked[askKey(topic, args)]) ||
      "_Live Cortex analysis needs a Snowflake connection. In this public build only the default analysis for preset views is available._";
  }
  const { id } = await post<{ id: string }>("/ask-cortex", { topic, args, question });
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const j = await get<{ status: string; answer?: string; error?: string }>(`/ask-cortex/${id}`);
    if (j.status === "done") return j.answer ?? "";
    if (j.status === "error") throw new Error(j.error);
  }
  throw new Error("Ask Cortex timed out");
}

// ---------------------------------------------------------------- enterprise master ontology
export const entApi = {
  summary: () => get<any>("/ent/summary"),
  boSummary: () => get<BoSummary>("/bo/summary"),
  boGraph: () => get<{ elements: any[]; counts: Record<string, number>; exportedAt: string }>("/bo/graph"),
  boNode: (name: string) => get<BoNode>(`/bo/node/${encodeURIComponent(name)}`),
  ontologySource: () => get<any>("/ent/ontology-source"),
  customers: () => get<any[]>("/ent/customers"),
  suppliers: () => get<any[]>("/ent/suppliers"),
  customer: (id: string) => get<any>(`/ent/customer/${encodeURIComponent(id)}`),
  supplier: (id: string) => get<any>(`/ent/supplier/${encodeURIComponent(id)}`),
  crosswalk: () => get<any>("/ent/crosswalk"),
  scenarioData: () => get<any>("/ent/scenario-data"),
  lineage: () => get<any>("/ent/lineage"),
};

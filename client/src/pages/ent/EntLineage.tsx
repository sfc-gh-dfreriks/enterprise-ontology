import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { AskCortex } from "../../components/AskCortex";
import { Panel, ModuleChips, MODULE_COLOR, MODULE_NAME, num } from "../../components/EntBits";

/**
 * SAP BDC lineage for the enterprise ontology — the same medallion view the 360
 * apps show, one layer higher. Served from data/enterprise_lineage.json, which
 * tools/export_lineage.py derives from the enterprise SQL and Snowflake's own
 * OBJECT_DEPENDENCIES, so nothing on this page is hand-listed.
 */

// Layer tones match the 360 apps' Lineage pages, plus one for the enterprise layer.
const TONE: Record<string, string> = {
  sap: "border-slate-300 bg-slate-50 text-slate-800",
  bronze: "border-amber-300 bg-amber-50 text-amber-900",
  silver: "border-sky-300 bg-sky-50 text-sky-900",
  gold: "border-emerald-300 bg-emerald-50 text-emerald-900",
  ent: "border-indigo-300 bg-indigo-50 text-indigo-900",
  ai: "border-purple-300 bg-purple-50 text-purple-900",
};

// Provenance badges: BDC-backed sources are the strong colours, enrichment is muted.
const PROV: Record<string, { label: string; cls: string }> = {
  bdc: { label: "SAP BDC data product", cls: "bg-emerald-100 text-emerald-800" },
  "bdc-landed": { label: "BDC product, landed in L1", cls: "bg-emerald-100 text-emerald-800" },
  "bdc-shaped": { label: "BDC-shaped table", cls: "bg-sky-100 text-sky-800" },
  "crm-export": { label: "CRM export", cls: "bg-amber-100 text-amber-800" },
  kg: { label: "SC knowledge graph", cls: "bg-rose-100 text-rose-800" },
  demo: { label: "Demo enrichment", cls: "bg-slate-100 text-slate-600" },
};

/** Long Snowflake identifiers break at dots/underscores instead of widening the table. */
function Ident({ value }: { value: unknown }) {
  const s = String(value ?? "");
  return <span className="font-mono text-[11px] leading-snug [overflow-wrap:anywhere]">{s.replace(/([._])/g, "$1\u200b")}</span>;
}

/** Drop the database prefix inside a module card, where the module already says which app. */
const local = (fqn: string) => fqn.split(".").slice(1).join(".");

/** Conformed facts and golden records first, graph plumbing (CORE.*) after. */
const factsFirst = (xs: Iterable<string>) =>
  [...xs].sort((a, b) => Number(a.startsWith("CORE.")) - Number(b.startsWith("CORE.")) || a.localeCompare(b));

export default function EntLineage() {
  const { data, loading, error } = useQuery(() => entApi.lineage(), []);
  const [mod, setMod] = useState<string>("ALL");

  const modules: any[] = data?.modules ?? [];
  // Collapse the per-chain rows into one row per terminal source for the source table.
  const sources = useMemo(() => {
    const by = new Map<string, any>();
    for (const m of modules) {
      for (const r of m.products) {
        const k = `${m.code}|${r.source}`;
        const cur = by.get(k) ?? { ...r, appObjects: new Set<string>(), readBy: new Set<string>() };
        cur.appObjects.add(r.appObject);
        r.enterpriseObjects.forEach((o: string) => cur.readBy.add(o));
        by.set(k, cur);
      }
    }
    const order = ["bdc", "bdc-landed", "bdc-shaped", "crm-export", "kg", "demo"];
    return [...by.values()].sort((a, b) =>
      order.indexOf(a.provenance) - order.indexOf(b.provenance) || a.module.localeCompare(b.module) || a.source.localeCompare(b.source));
  }, [modules]);

  // The medallion strip, built from the chains so every object carries its app.
  // L0 lists non-BDC sources by provenance too, so an app with no mounted data
  // product (Supply Chain) still shows where its data starts.
  const strip = useMemo(() => {
    if (!data) return [];
    const uniq = (xs: { mod: string; label: string; sub?: string }[]) =>
      [...new Map(xs.map((x) => [`${x.mod}|${x.label}`, x])).values()];
    const rowsAll = modules.flatMap((m) => m.products.map((r: any) => ({ ...r, mod: m.code })));
    // BDC sources one per data product; anything else one line per app and provenance.
    const bdc = uniq(rowsAll.filter((r: any) => r.l0Object).map((r: any) =>
      ({ mod: r.mod, label: r.l0Object.split(".")[0].replace(/^SAP_BDC_(DEMO_)?/, ""), sub: r.dataProduct ?? undefined })));
    const other = new Map<string, { mod: string; prov: string; srcs: Set<string> }>();
    for (const r of rowsAll.filter((r: any) => !r.l0Object)) {
      const k = `${r.mod}|${r.provenance}`;
      const g = other.get(k) ?? { mod: r.mod, prov: r.provenance, srcs: new Set<string>() };
      g.srcs.add(local(r.source)); other.set(k, g);
    }
    const l0 = [...bdc, ...[...other.values()].map((g) => {
      const srcs = [...g.srcs];
      const schemas = [...new Set(srcs.map((x) => x.split(".")[0]))];
      const label = srcs.length === 1 ? srcs[0] : schemas.length === 1 ? `${schemas[0]}.* (${srcs.length} tables)` : `${srcs.length} tables`;
      return { mod: g.mod, label, sub: PROV[g.prov]?.label };
    })];
    const l1 = uniq(rowsAll.filter((r: any) => r.l1Object).map((r: any) => ({ mod: r.mod, label: r.l1Object.split(".").pop() })));
    const l2 = uniq(rowsAll.map((r: any) => ({ mod: r.mod, label: r.appObject.split(".").pop() })));
    const tone = Object.fromEntries((data.layers ?? []).map((l: any) => [l.tone, l]));
    return [
      { tone: "sap", name: "SAP Source Systems", plain: (data.sourceSystems ?? []) as string[] },
      { tone: "bronze", name: "L0 — Sources", note: "SAP BDC data products, and labelled non-BDC sources", items: l0 },
      { tone: "silver", name: "L1 — 360 Curated", note: "SAP_BDC_L1 in each app", items: l1 },
      { tone: "gold", name: "L2 — 360 Gold", note: "objects the enterprise layer reads", items: l2 },
      { tone: "ent", name: "Enterprise Ontology", note: "golden records + 360 facts", plain: tone.ent?.objects ?? [] },
      { tone: "ai", name: "AI + Application", plain: tone.ai?.objects ?? [] },
    ] as { tone: string; name: string; note?: string; plain?: string[]; items?: { mod: string; label: string; sub?: string }[] }[];
  }, [data, modules]);

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-200" />;
  if (error) return <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">Error: {error}</div>;
  if (!data) return null;

  const shown = mod === "ALL" ? sources : sources.filter((s) => s.module === mod);
  const bdcBacked = sources.filter((s) => s.provenance === "bdc" || s.provenance === "bdc-landed").length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-indigo-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Source Systems</p>
            <p className="mt-1 text-lg font-bold text-slate-800">{(data.sourceSystems ?? []).join("  ·  ")}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{data.summary}</p>
            <p className="mt-2 text-xs text-slate-500">
              Snowflake database: <span className="font-mono">{data.database}</span>
              {" · "}traced {data.generated_at?.slice(0, 10)} on <span className="font-mono">{data.connection}</span>
            </p>
          </div>
          <AskCortex topic="ent-lineage" suggestions={[
            "Which apps depend on demo enrichment rather than BDC data products?",
            "What would change if Supply Chain moved to real BDC shares?",
          ]} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["360 apps", data.counts.modules],
            ["SAP BDC data products", data.counts.bdcProducts],
            ["Upstream sources", data.counts.sources],
            ["360 objects read", data.counts.appObjects],
            ["Enterprise objects", data.counts.enterpriseObjects],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-lg border border-white bg-white/70 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{l}</p>
              <p className="text-xl font-bold tabular-nums text-slate-800">{num(v)}</p>
            </div>
          ))}
        </div>
      </div>

      <Panel title="Medallion Lineage — SAP BDC → 360 apps → Enterprise Ontology → Application">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
          {strip.map((layer, i) => (
            <div key={layer.name} className="flex min-w-0 flex-1 items-stretch gap-2">
              <div className={`min-w-0 flex-1 rounded-xl border p-3 ${TONE[layer.tone] ?? TONE.sap}`}>
                <p className="text-sm font-bold">{layer.name}</p>
                {layer.note && <p className="text-[10px] opacity-70">{layer.note}</p>}
                <ul className="mt-2 space-y-1.5">
                  {(layer.plain ?? []).map((o) => (
                    <li key={o} className="text-xs leading-snug">{layer.tone === "sap" ? o : <Ident value={o} />}</li>
                  ))}
                  {(layer.items ?? []).map((o) => (
                    <li key={`${o.mod}|${o.label}`} className="flex items-start gap-1.5 text-xs leading-snug">
                      <span className="mt-0.5 shrink-0 rounded px-1 text-[9px] font-bold text-white"
                            style={{ background: MODULE_COLOR[o.mod] }}>{o.mod}</span>
                      <span className="min-w-0">
                        <Ident value={o.label} />
                        {o.sub && <span className="block text-[10px] opacity-70">{o.sub}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {i < strip.length - 1 && (
                <div className="hidden shrink-0 items-center xl:flex"><ChevronRight className="h-5 w-5 text-slate-400" /></div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="What each 360 app contributes">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => {
            const objs = [...new Set(m.products.map((r: any) => r.appObject))] as string[];
            const provs = [...new Set(m.products.map((r: any) => r.provenance))] as string[];
            return (
              <button key={m.code} onClick={() => setMod(mod === m.code ? "ALL" : m.code)}
                className={`flex flex-col justify-start rounded-xl border p-3 text-left transition hover:shadow ${mod === m.code ? "ring-2 ring-sky-400" : ""}`}
                style={{ borderColor: MODULE_COLOR[m.code] }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-800">{m.name}</span>
                  <ModuleChips list={m.code} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {m.bdcProducts.length
                    ? <>SAP BDC: <b className="text-slate-700">{m.bdcProducts.join(", ")}</b></>
                    : <>No mounted BDC data product — see note below</>}
                </p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Read by the enterprise layer</p>
                <ul className="mt-1 space-y-0.5">
                  {objs.map((o) => <li key={o} className="text-slate-700"><Ident value={local(o)} /></li>)}
                </ul>
                <div className="mt-2 flex flex-wrap gap-1">
                  {provs.map((p) => (
                    <span key={p} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${PROV[p]?.cls}`}>{PROV[p]?.label ?? p}</span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Upstream Sources"
        right={
          <div className="flex flex-wrap items-center gap-1">
            {["ALL", ...modules.map((m) => m.code)].map((c) => (
              <button key={c} onClick={() => setMod(c)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${mod === c ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {c === "ALL" ? "All apps" : MODULE_NAME[c]}
              </button>
            ))}
          </div>
        }>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[7%]" /><col className="w-[13%]" /><col className="w-[15%]" /><col className="w-[22%]" />
              <col className="w-[21%]" /><col className="w-[15%]" /><col className="w-[7%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-800 text-left text-white">
                <th className="px-3 py-2.5 font-medium">App</th>
                <th className="px-3 py-2.5 font-medium">Provenance</th>
                <th className="px-3 py-2.5 font-medium">BDC Data Product</th>
                <th className="px-3 py-2.5 font-medium">Source Object</th>
                <th className="px-3 py-2.5 font-medium">360 Object Read</th>
                <th className="px-3 py-2.5 font-medium">Enterprise Object</th>
                <th className="px-3 py-2.5 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r: any, i: number) => (
                <tr key={`${r.module}-${r.source}`} className={`align-top ${i % 2 === 0 ? "bg-white" : "bg-sky-50/40"}`}>
                  <td className="px-3 py-2"><ModuleChips list={r.module} /></td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${PROV[r.provenance]?.cls}`}>
                      {PROV[r.provenance]?.label ?? r.provenance}</span>
                    {r.declared && <span className="ml-1 text-[10px] text-slate-400" title={data.notes.declared}>declared</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-700">
                    {r.dataProduct ?? <span className="text-slate-400">—</span>}
                    {r.sapSystem && <span className="block text-[10px] text-slate-400">{r.sapSystem}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-700"><Ident value={r.l0Object ?? r.source} /></td>
                  <td className="px-3 py-2 text-slate-700">
                    {[...r.appObjects].map((o: string) => <div key={o}><Ident value={local(o)} /></div>)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {factsFirst(r.readBy).slice(0, 3).map((o: string) => <div key={o}><Ident value={o} /></div>)}
                    {r.readBy.size > 3 && (
                      <div className="text-[10px] italic text-slate-400" title={factsFirst(r.readBy).slice(3).join("\n")}>+{r.readBy.size - 3} more</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.rows == null ? "—" : num(r.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {bdcBacked} of {sources.length} upstream sources are SAP BDC data products; the rest are labelled with where they come from.
        </p>
      </Panel>

      <Panel title="Read this before demoing">
        <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-slate-600">
          {Object.values(data.notes ?? {}).map((n: any) => <li key={n}>{n}</li>)}
        </ul>
      </Panel>
    </div>
  );
}

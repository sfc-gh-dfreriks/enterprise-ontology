import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { AskCortex } from "../../components/AskCortex";
import { Panel, RankBars, ModuleChips, MODULE_COLOR, MODULE_NAME, num } from "../../components/EntBits";

/** The master ontology itself: upper classes, golden classes and each module's classes, plus relations. */
export default function EntModel() {
  const q = useQuery(() => entApi.model(), []);
  if (q.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (q.error) return <p className="text-sm text-rose-600">{q.error}</p>;
  const { classes, relations, modules } = q.data!;
  const byMod = (m: string) => (classes as any[]).filter((c) => c.module === m);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          <b>{classes.length} classes</b> and <b>{relations.length} relations</b>. Abstract upper classes are the
          shared vocabulary; golden classes (LegalEntity, Customer, Supplier, Department) live in the core; every module adds only what it
          alone owns and points at the shared classes, so a relation like <i>buysFrom</i> (Spend) and <i>supplies</i> (Supply Chain)
          land on the same Supplier.
        </p>
        <AskCortex topic="ent-model" label="Ask Cortex about the model"
          suggestions={["Explain how a question travels from Spend to Supply Chain", "What is missing from this ontology?"]} />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {(modules as any[]).map((m) => (
          <Panel key={m.module} title={`${MODULE_NAME[m.module]} (${byMod(m.module).length})`}>
            <ul className="space-y-1 text-xs">
              {byMod(m.module).map((c) => (
                <li key={c.class_name} className="flex items-center justify-between gap-2" title={c.description}>
                  <span style={{ color: MODULE_COLOR[m.module] }} className={c.is_abstract ? "italic" : "font-semibold"}>
                    {c.class_name}{c.parent_class_name ? <span className="text-slate-400"> ⊂ {c.parent_class_name}</span> : null}
                  </span>
                  <span className="tabular-nums text-slate-500">{c.instances ? num(c.instances) : c.is_abstract ? "abstract" : "via view"}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
      <Panel title="Relations ranked by instance edges">
        <RankBars rows={relations} max={20} value={(r) => r.edges} label={(r) => `${r.rel_name} (${r.domain_class} → ${r.range_class})`}
          format={(v) => num(v)} color={(r) => MODULE_COLOR[r.module] ?? "#64748b"} />
        <table className="mt-4 w-full text-xs">
          <thead className="text-left text-slate-500"><tr><th>Relation</th><th>Module</th><th>Domain → Range</th><th>Edges</th><th>Meaning</th></tr></thead>
          <tbody>{[...relations].sort((a: any, b: any) => b.edges - a.edges).map((r: any) => (
            <tr key={r.rel_name} className="border-t border-slate-100"><td className="py-1 font-semibold">{r.rel_name}</td>
              <td><ModuleChips list={r.module} /></td><td>{r.domain_class} → {r.range_class}</td><td>{num(r.edges)}</td>
              <td className="text-slate-500">{r.description}</td></tr>))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

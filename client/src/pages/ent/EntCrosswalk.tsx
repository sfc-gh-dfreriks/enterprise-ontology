import { useMemo, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { AskCortex } from "../../components/AskCortex";
import { Panel, RankBars, ModuleChips, MODULE_COLOR, num, Caveat } from "../../components/EntBits";

/** How every app's local records resolve to golden records, with the match method kept visible. */
export default function EntCrosswalk() {
  const q = useQuery(() => entApi.crosswalk(), []);
  const [entity, setEntity] = useState("Customer");
  const [text, setText] = useState("");
  const recs = useMemo(() => (q.data?.records ?? []).filter((r: any) => r.entity === entity &&
    (!text || `${r.local_id} ${r.local_name} ${r.golden_id}`.toLowerCase().includes(text.toLowerCase()))), [q.data, entity, text]);
  if (q.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (q.error) return <p className="text-sm text-rose-600">{q.error}</p>;
  const sum = (q.data!.summary as any[]).filter((s) => s.entity === entity);
  const perModule = Object.values(sum.reduce((acc: any, s: any) => {
    acc[s.module] ??= { module: s.module, records: 0 }; acc[s.module].records += s.records; return acc; }, {}));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {["Customer", "Supplier", "LegalEntity"].map((e) => (
            <button key={e} onClick={() => setEntity(e)} className={`rounded-lg px-3 py-1.5 text-sm ${entity === e ? "bg-indigo-600 text-white" : "bg-white text-slate-600 border border-slate-200"}`}>{e}</button>
          ))}
        </div>
        <AskCortex topic="ent-crosswalk" label="Ask Cortex about identity"
          suggestions={["How trustworthy is this crosswalk?", "What would it take to replace it with MDG?"]} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={`${entity} records per app`}>
          <RankBars rows={perModule} value={(r: any) => r.records} label={(r: any) => r.module} format={(v) => num(v)}
            color={(r: any) => MODULE_COLOR[r.module]} />
        </Panel>
        <Panel title="Match method">
          <table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th>App</th><th>Method</th><th>Records</th><th>Golden</th></tr></thead>
            <tbody>{[...sum].sort((a, b) => b.records - a.records).map((s) => (
              <tr key={s.module + s.match_method} className="border-t border-slate-100"><td className="py-1"><ModuleChips list={s.module} /></td>
                <td>{s.match_method}</td><td>{num(s.records)}</td><td>{num(s.golden)}</td></tr>))}</tbody></table>
        </Panel>
      </div>
      <Panel title={`${num(recs.length)} records`} right={<input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by id or name…"
        className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />}>
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="w-full text-xs"><thead className="sticky top-0 bg-white text-left text-slate-500"><tr><th>Golden</th><th>App</th><th>Local id</th><th>Local name</th><th>Match</th></tr></thead>
            <tbody>{recs.slice(0, 500).map((r: any) => (
              <tr key={r.module + r.local_id} className="border-t border-slate-100"><td className="py-1 font-mono">{r.golden_id}</td>
                <td><ModuleChips list={r.module} /></td><td className="font-mono">{r.local_id}</td><td>{r.local_name}</td>
                <td className="text-slate-500">{r.match_method}</td></tr>))}</tbody></table>
        </div>
      </Panel>
      <Caveat>{q.data!.notes.identity}</Caveat>
    </div>
  );
}

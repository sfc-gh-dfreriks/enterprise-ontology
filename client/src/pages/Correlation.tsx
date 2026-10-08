import ReactECharts from "echarts-for-react";
import { useQuery } from "../hooks/useQuery";
import { api } from "../lib/api";
import { MetricCard, ChartCard } from "../components/Cards";

export default function Correlation() {
  const corr = useQuery(() => api.correlation(), []);
  if (corr.error) return <div className="text-sm text-rose-600">{corr.error}</div>;
  if (!corr.data) return <div className="text-sm text-slate-400">Loading…</div>;

  const { codes, names, matrix, top, process_name, product_pairs } = corr.data;
  // keep only processes with any coupling, for readability
  const keepIdx = codes.map((_: string, i: number) =>
    matrix[i].reduce((a: number, b: number) => a + b, 0) +
    matrix.reduce((a: number, row: number[]) => a + row[i], 0) > 0 ? i : -1).filter((i: number) => i >= 0);
  const L = keepIdx.map((i: number) => names[i]);
  const cells: any[] = [];
  let maxV = 1;
  keepIdx.forEach((ri: number, r: number) => keepIdx.forEach((ci: number, c: number) => {
    const v = matrix[ri][ci]; if (v > maxV) maxV = v; cells.push([c, r, v]);
  }));

  const crossPairs = top.filter((t: any) => t.cross_process);
  const distinctPairs = new Set(crossPairs.map((t: any) => [t.pa, t.pb].sort().join("|"))).size;
  const strongest = crossPairs[0];

  const option = {
    tooltip: { position: "top", formatter: (p: any) => `${L[p.value[1]]} ↔ ${L[p.value[0]]}<br/>weight: ${p.value[2]}` },
    grid: { top: 80, left: 140, right: 20, bottom: 20 },
    xAxis: { type: "category", data: L, splitArea: { show: true }, axisLabel: { rotate: 35, fontSize: 10 }, position: "top" },
    yAxis: { type: "category", data: L, splitArea: { show: true }, axisLabel: { fontSize: 10 } },
    visualMap: { min: 0, max: maxV, calculable: true, orient: "horizontal", left: "center", bottom: 0,
      inRange: { color: ["#eff6ff", "#93c5fd", "#2563eb", "#1e3a8a"] } },
    series: [{ type: "heatmap", data: cells, label: { show: true, fontSize: 9, formatter: (p: any) => p.value[2] || "" },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.3)" } } }],
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Correlated process pairs" value={distinctPairs} accent="from-cyan-50 to-sky-50 border-cyan-200" />
        <MetricCard label="Coupled product pairs" value={product_pairs} accent="from-violet-50 to-indigo-50 border-violet-200" />
        <MetricCard label="Strongest coupling"
          value={strongest ? `${strongest.pa}↔${strongest.pb}` : "—"}
          accent="from-rose-50 to-pink-50 border-rose-200" />
      </div>

      <ChartCard title="Process × process correlation"
        subtitle="weight = ODM master-data links between the two processes (diagonal = intra-process)">
        <ReactECharts option={option} style={{ height: 30 + L.length * 46 }} />
      </ChartCard>

      <ChartCard title="Top cross-process product couplings"
        subtitle="products in Process A reference ODM master data owned by Process B">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-slate-400">
            <th className="py-2">Process A</th><th>Product A</th><th>Process B</th><th>Product B</th><th>Weight</th>
          </tr></thead>
          <tbody>
            {crossPairs.slice(0, 20).map((t: any, i: number) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-1.5 text-slate-500">{process_name[t.pa]}</td>
                <td>{t.a}</td>
                <td className="text-slate-500">{process_name[t.pb]}</td>
                <td>{t.b}</td>
                <td className="font-semibold">{t.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  );
}

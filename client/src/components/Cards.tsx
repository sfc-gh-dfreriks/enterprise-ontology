import type { ReactNode } from "react";

export function MetricCard({ label, value, sub, accent = "from-cyan-50 to-sky-50 border-cyan-200" }: {
  label: string; value: ReactNode; sub?: string; accent?: string;
}) {
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${accent} p-4 shadow-sm`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-slate-800">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function ChartCard({ title, subtitle, children, className = "" }: {
  title: string; subtitle?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 shadow-md ${className}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function ProcessBadge({ code, color, name }: { code: string; color: string; name?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${color}1a`, color }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {name || code}
    </span>
  );
}

export function Bar({ pct, color = "#29B5E8" }: { pct: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }} />
    </div>
  );
}

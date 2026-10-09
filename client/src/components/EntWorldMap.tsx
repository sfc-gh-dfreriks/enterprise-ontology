import { useEffect, useMemo, useRef, useState } from "react";
import type { ImpactLink, ImpactNode, LinkHit, NodeHit } from "../lib/entImpact";
import { fmt } from "../lib/entScenario";
import { hopColor, severityColor, TYPE_COLOR } from "../lib/entSeverity";

/**
 * World map of the enterprise ripple — the Supply Chain Ripple Map's renderer,
 * fed enterprise nodes (suppliers, plants, customers and legal entities) and the
 * ontology edges between them (supplies, shipsTo, ownedBy). Equirectangular SVG
 * over a static land outline; the camera eases to whatever the current step frames.
 */
export interface Overlay { id: string; from: string; to: string; label: string; color?: string }
export interface EntMapProps {
  nodes: ImpactNode[]; links: ImpactLink[];
  nodeHits?: Record<string, NodeHit>; linkHits?: Record<string, LinkHit>;
  revealHop?: number; highlight?: Set<string>; focus?: string[];
  overlays?: Overlay[]; height?: number;
  /** Nodes whose hit is shown as protected (green) rather than at risk. */
  protectedNodes?: Set<string>;
}

const W = 1000, H = 500, LAT_TOP = 78, LAT_BOTTOM = -58, MIN_SPAN = 190, CAMERA_MS = 780;
interface Box { x: number; y: number; w: number; h: number }
const FULL: Box = { x: 0, y: 0, w: W, h: H };
const project = (lon: number, lat: number): [number, number] =>
  [((lon + 180) / 360) * W, ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * H];

function arcPath(x1: number, y1: number, x2: number, y2: number, lift = 0.22) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1, k = len * lift;
  return `M${x1},${y1} Q${mx + (-dy / len) * k},${my + (dx / len) * k} ${x2},${y2}`;
}

function frame(pts: [number, number][]): Box {
  if (!pts.length) return FULL;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = Math.max(60, Math.max(maxX - minX, maxY - minY) * 0.35);
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  let w = Math.max(maxX - minX, MIN_SPAN), h = w / (W / H);
  if (maxY - minY > h) { h = maxY - minY; w = h * (W / H); }
  w = Math.min(w, W); h = Math.min(h, H);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)), w, h };
}
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function EntWorldMap({ nodes, links, nodeHits = {}, linkHits = {}, revealHop, highlight, focus, overlays = [], height = 440, protectedNodes }: EntMapProps) {
  const [land, setLand] = useState<number[][][][] | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const [box, setBox] = useState<Box>(FULL);
  const wrap = useRef<HTMLDivElement>(null);
  const anim = useRef<number | null>(null);

  useEffect(() => {
    let dead = false;
    fetch(`${import.meta.env.BASE_URL}land.geo.json`).then((r) => (r.ok ? r.json() : null))
      .then((g) => { if (!dead && g) setLand(g.features?.[0]?.geometry?.coordinates ?? null); }).catch(() => {});
    return () => { dead = true; };
  }, []);

  const geo = useMemo(() => nodes.filter((n) => n.lat != null && n.lon != null), [nodes]);
  const byId = useMemo(() => new Map(geo.map((n) => [n.id, n])), [geo]);
  const target = useMemo(() => {
    const pts = (focus ?? []).map((id) => byId.get(id)).filter(Boolean).map((n) => project(n!.lon!, n!.lat!));
    return pts.length ? frame(pts) : FULL;
  }, [focus, byId]);

  useEffect(() => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = box, to = target;
    if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + Math.abs(from.w - to.w) + Math.abs(from.h - to.h) < 2) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / CAMERA_MS), k = ease(t);
      setBox({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k });
      if (t < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
    return () => { if (anim.current) cancelAnimationFrame(anim.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const k = box.w / W;
  const show = (hop: number) => revealHop === undefined || hop <= revealHop;
  const spot = !!highlight && highlight.size > 0;
  const landPath = useMemo(() => {
    if (!land) return "";
    const parts: string[] = [];
    for (const poly of land) for (const ring of poly) {
      if (ring.length < 4) continue;
      parts.push("M" + ring.map(([lo, la]) => project(lo, la).map((v) => v.toFixed(1)).join(",")).join("L") + "Z");
    }
    return parts.join(" ");
  }, [land]);
  const maxLink = Math.max(1, ...Object.values(linkHits).map((h) => h.valueUsd));
  const tip = (e: React.MouseEvent, lines: string[]) => {
    const b = wrap.current?.getBoundingClientRect();
    setHover({ x: e.clientX - (b?.left ?? 0), y: e.clientY - (b?.top ?? 0), lines });
  };

  return (
    <div ref={wrap} className="relative">
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} style={{ width: "100%", height }} className="rounded-lg bg-slate-900">
        <g stroke="#1e293b" strokeWidth={0.6 * k}>
          {[-40, -20, 0, 20, 40, 60].map((lat) => { const [, y] = project(0, lat); return <line key={lat} x1={0} y1={y} x2={W} y2={y} />; })}
          {[-120, -60, 0, 60, 120].map((lon) => { const [x] = project(lon, 0); return <line key={lon} x1={x} y1={0} x2={x} y2={H} />; })}
        </g>
        {landPath && <path d={landPath} fill="#243244" stroke="#31445c" strokeWidth={0.5 * k} />}

        <g fill="none">
          {links.map((l) => {
            const a = byId.get(l.source), b = byId.get(l.target);
            if (!a || !b) return null;
            const h = linkHits[l.id];
            const hit = !!(h && show(h.hop));
            const lit = !spot || highlight!.has(l.id);
            const [x1, y1] = project(a.lon!, a.lat!), [x2, y2] = project(b.lon!, b.lat!);
            const w = (hit ? 1.2 + 4 * Math.sqrt(h!.valueUsd / maxLink) : 0.8) * k;
            return (
              <path key={l.id} d={arcPath(x1, y1, x2, y2)} stroke={hit ? severityColor(h!.severity) : "#475569"}
                strokeWidth={hit && lit ? w * 1.6 : w} strokeOpacity={hit ? (lit ? 1 : 0.22) : spot ? 0.1 : 0.28}
                strokeDasharray={l.rel === "ownedBy" ? `${3 * k} ${3 * k}` : undefined}
                style={{ transition: "stroke-opacity 300ms, stroke-width 300ms" }}
                onMouseEnter={(e) => tip(e, [`${a.name} → ${b.name}`, l.rel, ...(hit && h!.valueUsd ? [`${fmt(h!.valueUsd)} at risk · hop ${h!.hop}`] : [])])}
                onMouseLeave={() => setHover(null)} />
            );
          })}
        </g>

        <g fill="none">
          {overlays.map((o) => {
            const a = byId.get(o.from), b = byId.get(o.to);
            if (!a || !b) return null;
            const [x1, y1] = project(a.lon!, a.lat!), [x2, y2] = project(b.lon!, b.lat!);
            return <path key={o.id} d={arcPath(x1, y1, x2, y2, -0.3)} stroke={o.color ?? "#22c55e"} strokeWidth={2.6 * k}
              strokeDasharray={`${7 * k} ${5 * k}`} strokeOpacity={0.95}
              onMouseEnter={(e) => tip(e, [o.label])} onMouseLeave={() => setHover(null)} />;
          })}
        </g>

        <g>
          {geo.map((n) => {
            const h = nodeHits[n.id];
            const vis = !!(h && show(h.hop));
            const [x, y] = project(n.lon!, n.lat!);
            const square = n.type === "Plant" || n.type === "LegalEntity";
            const r = (n.type === "LegalEntity" ? 7 : n.type === "Plant" ? 9 : 6.5) * k;
            const saved = protectedNodes?.has(n.id);
            const fill = vis ? (saved ? "#22c55e" : severityColor(h!.severity)) : TYPE_COLOR[n.type];
            const inFocus = !focus?.length || focus.includes(n.id);
            // legal entities sit on top of their first plant, so their label goes underneath
            const below = n.type === "LegalEntity";
            return (
              <g key={n.id} style={{ opacity: inFocus ? 1 : 0.45, transition: "opacity 300ms" }}
                 onMouseEnter={(e) => tip(e, [`${n.name} · ${n.type === "LegalEntity" ? "legal entity" : n.type.toLowerCase()}`,
                   [n.city, n.country].filter(Boolean).join(", ") + (n.assumed ? " (sited at its first plant)" : ""),
                   ...(vis ? [h!.note, h!.valueUsd ? `${fmt(h!.valueUsd)} at risk` : "", h!.daysToImpact != null ? `felt from day ${h!.daysToImpact}` : ""].filter(Boolean) : [])])}
                 onMouseLeave={() => setHover(null)}>
                {vis && <circle cx={x} cy={y} r={r + (7 + h!.hop * 3) * k} fill="none" stroke={hopColor(h!.hop)} strokeWidth={1.6 * k} strokeOpacity={0.55} />}
                {square
                  ? <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={(n.type === "LegalEntity" ? 1 : 2) * k} fill={fill}
                      stroke={n.type === "LegalEntity" ? "#fbbf24" : "#e2e8f0"} strokeWidth={1.3 * k}
                      transform={n.type === "LegalEntity" ? `rotate(45 ${x} ${y})` : undefined} />
                  : <circle cx={x} cy={y} r={r} fill={fill} stroke="#e2e8f0" strokeWidth={1.2 * k} />}
                <text x={x} y={below ? y + r + 12 * k : y - r - 5 * k} textAnchor="middle" fontSize={9.5 * k}
                      fill={n.type === "LegalEntity" ? "#fde68a" : "#cbd5e1"} style={{ pointerEvents: "none" }}>{n.name}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR.Supplier }} /> supplier</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5" style={{ background: TYPE_COLOR.Plant }} /> plant</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR.Customer }} /> customer</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rotate-45 border border-amber-400" style={{ background: TYPE_COLOR.LegalEntity }} /> legal entity</span>
        {overlays.length > 0 && <span className="flex items-center gap-1"><svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke="#22c55e" strokeWidth="2.4" strokeDasharray="7 5" /></svg> mitigation</span>}
        <span>thickness = value at risk · colour = share hit · ring = hop</span>
        {k < 0.99 && <span className="ml-auto rounded bg-slate-100 px-1.5 text-[10px]">zoomed {(1 / k).toFixed(1)}×</span>}
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-20 max-w-xs rounded bg-slate-900/95 px-2.5 py-1.5 text-[11px] leading-snug text-slate-100 shadow-lg ring-1 ring-white/10"
             style={{ left: Math.min(hover.x + 12, 560), top: hover.y + 12 }}>
          {hover.lines.filter(Boolean).map((l, i) => <div key={i} className={i === 0 ? "font-semibold" : "text-slate-300"}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

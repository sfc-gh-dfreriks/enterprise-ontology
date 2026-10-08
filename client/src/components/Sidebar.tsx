import { Network, Workflow, Grid3x3, ShieldCheck, LayoutDashboard, Boxes,
         MessageSquare, Share2, PlayCircle, CloudLightning, Globe2,
         Wrench , Route, Layers, Cable, Building2, Users, Truck, GitMerge} from "lucide-react";

export type PageId = "ent-overview" | "ent-model" | "ent-customers" | "ent-suppliers" | "ent-crosswalk" | "ent-graph"
                   | "overview" | "model" | "graph" | "traverse" | "processes" | "usecases"
                   | "correlation" | "coverage" | "ask" | "demo"
                   | "scenario" | "ripple" | "optimize" | "mitigation" | "thread";

const NAV: { id: PageId; label: string; icon: any; group?: string }[] = [
  { id: "ent-overview", label: "Enterprise Overview", icon: Building2, group: "Enterprise ontology" },
  { id: "ent-model", label: "Master Ontology Model", icon: Layers },
  { id: "ent-customers", label: "Customer 360", icon: Users },
  { id: "ent-suppliers", label: "Supplier 360", icon: Truck },
  { id: "ent-crosswalk", label: "Golden-Record Crosswalk", icon: GitMerge },
  { id: "ent-graph", label: "Enterprise Graph", icon: Network },
  { id: "ask", label: "Ask the Enterprise", icon: MessageSquare },
  { id: "overview", label: "SCM Overview", icon: LayoutDashboard, group: "Supply Chain module (baseline)" },
  // The ontology proper sits above the catalog: it is the model the catalog's
  // contents conform to, and the page most people actually want when they say
  // "show me the ontology".
  { id: "model", label: "Ontology Model", icon: Layers },
  { id: "graph", label: "SAP BDC Catalog", icon: Network },
  { id: "traverse", label: "Graph Traversal", icon: Share2 },
  { id: "thread", label: "Digital Thread", icon: Cable },
  { id: "processes", label: "Business Processes", icon: Workflow },
  { id: "usecases", label: "Use Cases / Insight Apps", icon: Boxes },
  { id: "correlation", label: "Correlation", icon: Grid3x3 },
  { id: "coverage", label: "Coverage & Scorecard", icon: ShieldCheck },
  { id: "demo", label: "Guided Demo", icon: PlayCircle },
  { id: "scenario", label: "Scenario Studio", icon: CloudLightning },
  { id: "ripple", label: "Ripple Map", icon: Globe2 },
  { id: "mitigation", label: "Mitigation", icon: Wrench },
  { id: "optimize", label: "Optimization Map", icon: Route },
];

export function Sidebar({ active, onNavigate, products, entities }: {
  active: PageId; onNavigate: (p: PageId) => void; products: number; entities: number;
}) {
  return (
    <aside className="flex w-64 flex-col bg-gradient-to-b from-sf-dark to-sf-deeper text-white">
      <div className="px-5 py-5">
        <div className="inline-flex rounded-md bg-sf-primary px-3 py-1 text-lg font-extrabold tracking-widest">SAP</div>
        <div className="mt-2 text-base font-semibold leading-tight">Enterprise Ontology</div>
        <div className="text-xs text-sf-pale">Finance · Sales · People · Spend · Working Capital · Supply Chain</div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map(({ id, label, icon: Icon, group }) => (<div key={id}>
          {group && <div className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-sf-pale/70">{group}</div>}
          <button onClick={() => onNavigate(id)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              active === id ? "bg-white/15 font-semibold text-white" : "text-sf-pale hover:bg-white/10"
            }`}>
            <Icon size={18} /> {label}
          </button></div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-4 py-4 text-[10px] leading-tight text-sf-pale/70">
        Master ontology over six SAP BDC 360 apps, Supply Chain ontology as baseline
      </div>
    </aside>
  );
}

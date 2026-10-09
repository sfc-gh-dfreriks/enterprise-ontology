import { Network, Boxes, MessageSquare, CloudLightning, Layers, Building2, Users, Truck, GitMerge,
         Database, Globe2, ShieldAlert, Wrench } from "lucide-react";

export type PageId = "ent-overview" | "ent-usecases" | "ent-scenario" | "ent-model" | "ent-customers" | "ent-suppliers"
                   | "ent-crosswalk" | "ent-graph" | "ent-lineage" | "ent-impact" | "ent-risk" | "ent-mitigation" | "ask";

const NAV: { id: PageId; label: string; icon: any; group?: string }[] = [
  { id: "ent-overview", label: "Enterprise Overview", icon: Building2, group: "Enterprise ontology" },
  { id: "ent-usecases", label: "Management Use Cases", icon: Boxes },
  { id: "ent-scenario", label: "Enterprise Scenario Studio", icon: CloudLightning },
  { id: "ent-impact", label: "Impact Map", icon: Globe2 },
  { id: "ent-risk", label: "Risk Outcome", icon: ShieldAlert },
  { id: "ent-mitigation", label: "Mitigation & Recovery", icon: Wrench },
  { id: "ent-model", label: "Master Ontology Model", icon: Layers },
  { id: "ent-customers", label: "Customer 360", icon: Users },
  { id: "ent-suppliers", label: "Supplier 360", icon: Truck },
  { id: "ent-crosswalk", label: "Golden-Record Crosswalk", icon: GitMerge },
  { id: "ent-graph", label: "Enterprise Graph", icon: Network },
  { id: "ent-lineage", label: "BDC Lineage", icon: Database },
  { id: "ask", label: "Ask the Enterprise", icon: MessageSquare },
];

export function Sidebar({ active, onNavigate }: {
  active: PageId; onNavigate: (p: PageId) => void;
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
        Master ontology over six SAP BDC 360 apps
      </div>
    </aside>
  );
}

import { Boxes, CloudLightning, Layers, Building2, Users, Truck, GitMerge,
         Database, Globe2, Wrench, Sparkles, Snowflake } from "lucide-react";

export type PageId = "ent-ontology" | "ent-overview" | "ent-snowflake" | "ask-cortex" | "ent-usecases" | "ent-scenario"
                   | "ent-impact" | "ent-mitigation" | "ent-customers" | "ent-suppliers" | "ent-crosswalk" | "ent-lineage";

// Same order as the Supply Chain Ontology app: the governed model first, then the
// dashboard, the model inside Snowflake, Ask Cortex and the guided use cases, then
// the scenario pages and the instance-level pages.
const NAV: { id: PageId; label: string; icon: any; group?: string }[] = [
  { id: "ent-ontology", label: "Ontology", icon: Layers },
  { id: "ent-overview", label: "Executive Dashboard", icon: Building2 },
  { id: "ent-snowflake", label: "Snowflake Ontology Details", icon: Snowflake },
  { id: "ask-cortex", label: "Ask Cortex", icon: Sparkles },
  { id: "ent-usecases", label: "Management Use Cases", icon: Boxes },
  { id: "ent-scenario", label: "Scenario Studio", icon: CloudLightning, group: "Scenarios" },
  { id: "ent-impact", label: "Impact Map", icon: Globe2 },
  { id: "ent-mitigation", label: "Mitigation & Recovery", icon: Wrench },
  { id: "ent-customers", label: "Customer 360", icon: Users, group: "Golden records" },
  { id: "ent-suppliers", label: "Supplier 360", icon: Truck },
  { id: "ent-crosswalk", label: "Golden-Record Crosswalk", icon: GitMerge },
  { id: "ent-lineage", label: "BDC Lineage", icon: Database },
];

export function Sidebar({ active, onNavigate, concepts }: {
  active: PageId; onNavigate: (p: PageId) => void; concepts: number;
}) {
  return (
    <aside className="flex w-64 flex-col bg-gradient-to-b from-sf-dark to-sf-deeper text-white">
      <div className="px-5 py-5">
        <div className="inline-flex rounded-md bg-sf-primary px-3 py-1 text-lg font-extrabold tracking-widest">SAP</div>
        <div className="mt-2 text-base font-semibold leading-tight">Enterprise Ontology</div>
        <div className="text-xs text-sf-pale">Enterprise domain{concepts ? ` • ${concepts} governed concepts` : ""}</div>
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
        Built on Snowflake Business Ontology · six SAP BDC 360 apps
      </div>
    </aside>
  );
}

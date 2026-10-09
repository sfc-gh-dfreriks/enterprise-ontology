import { useQuery } from "../../hooks/useQuery";
import { entApi } from "../../lib/api";
import { runScenario, PRESETS, fmt } from "../../lib/entScenario";
import { AskCortex } from "../../components/AskCortex";
import { Panel, ModuleChips } from "../../components/EntBits";

type Ctx = { s: any; d: any };
interface UseCase { id: string; role: string; question: string; apps: string; path: string; open: string; preset?: string;
  metric: (c: Ctx) => string; why: string }


/** Management questions the master ontology answers that no single 360 app can. Every figure is live. */
const CASES: UseCase[] = [
  { id: "uc-entity-health", role: "CEO / CFO", question: "Which legal entity is weakest across finance, cash, people and delivery?",
    apps: "FIN,WCP,PPL,SPD,SCM", path: "LegalEntity ← ownedBy Plant · employs Employee · buysFrom Supplier", open: "ent-overview",
    metric: ({ s }) => { const w = [...s.companies].sort((a, b) => a.otif_pct - b.otif_pct)[0]; return `${w.company}: ${w.otif_pct}% OTIF, ${fmt(w.late_cost_usd)} late cost`; },
    why: "Finance sees margin, Supply Chain sees OTIF — only the ontology puts them on the same company." },
  { id: "uc-supplier-risk", role: "CPO", question: "Which supplier is cheap to buy from but expensive to depend on?",
    apps: "SPD,WCP,FIN,SCM", path: "Supplier ← buysFrom / owesTo · supplies → Plant", open: "ent-suppliers",
    metric: ({ s }) => { const t = s.top_suppliers[0]; return `${t.supplier}: ${fmt(t.spend_usd)} spend vs ${fmt(t.ap_open_usd)} open payables`; },
    why: "Spend shows a small supplier; Supply Chain shows it inside most of our systems." },
  { id: "uc-supplier-failure", role: "COO", question: "If our top supplier stops shipping for eight weeks, who feels it and how much?",
    apps: "SPD,SCM,SAL,FIN,WCP", path: "Supplier → supplies → Plant → shipsTo → Customer; Plant → ownedBy → LegalEntity", open: "ent-scenario", preset: "sup-teledyne",
    metric: ({ d }) => { const r = runScenario(d, PRESETS.find((p) => p.id === "sup-teledyne")!.scenario); return `${fmt(r.headline[0].value)} output lost, ${r.headline[3].value} customers`; },
    why: "A disruption plan needs the customer and revenue consequence, not just the shortage." },
  { id: "uc-dual-source", role: "CPO / COO", question: "What is a second source worth before we pay for it?",
    apps: "SPD,SCM,FIN", path: "Supplier → supplies → Plant, with mitigation share", open: "ent-scenario", preset: "sup-festo-dual",
    metric: ({ d }) => { const base = runScenario(d, { kind: "supplier", supplierId: "GS-005", weeks: 8, mitigationPct: 0 });
      const dual = runScenario(d, PRESETS.find((p) => p.id === "sup-festo-dual")!.scenario);
      return `50% dual-sourcing of Festo saves ${fmt(base.headline[0].value - dual.headline[0].value)} of output in 8 weeks`; },
    why: "Compares the same failure with and without mitigation in one model." },
  { id: "uc-plant-outage", role: "COO / CFO", question: "What does a four-week outage at our largest plant cost the enterprise?",
    apps: "SCM,FIN,WCP,SAL", path: "Plant → ownedBy → LegalEntity; Plant → shipsTo → Customer", open: "ent-scenario", preset: "plant-sanjose",
    metric: ({ d }) => { const r = runScenario(d, PRESETS.find((p) => p.id === "plant-sanjose")!.scenario);
      const c = r.companies[0]; return `${fmt(r.headline[0].value)} output; ${c.company} CCC ${c.ccc} → ${c.cccNew?.toFixed(1)} days`; },
    why: "Turns an operations event into P&L and working-capital language." },
  { id: "uc-account-health", role: "CRO / Credit", question: "Which customers are both late to pay and badly served?",
    apps: "FIN,WCP,SAL,SCM", path: "Customer ← sameAs LocalCustomer (FIN, WCP, SAL, SCM)", open: "ent-customers",
    metric: ({ s }) => { const c = [...s.top_customers].sort((a: any, b: any) => (b.ar_overdue_usd + b.late_cost_usd) - (a.ar_overdue_usd + a.late_cost_usd))[0];
      return `${c.customer}: ${fmt(c.ar_overdue_usd)} overdue, ${fmt(c.late_cost_usd)} late-delivery cost`; },
    why: "Collections chases a customer that operations is failing — the ontology shows both at once." },
  { id: "uc-customer-default", role: "CFO / Credit", question: "If our most overdue customer defaults, where does the loss land?",
    apps: "WCP,FIN,SAL,SCM", path: "LegalEntity → sellsToCustomer → Customer ← shipsTo Plant", open: "ent-scenario", preset: "cust-skhynix",
    metric: ({ d }) => { const r = runScenario(d, PRESETS.find((p) => p.id === "cust-skhynix")!.scenario); return `${fmt(r.headline[0].value)} write-off across ${r.headline[3].value} entities`; },
    why: "Splits a credit loss by legal entity and shows the order book it frees." },
  { id: "uc-terms", role: "Treasurer", question: "How much cash do longer payment terms release, and which critical suppliers pay for it?",
    apps: "WCP,SPD,SCM", path: "LegalEntity → owesTo → Supplier → supplies → Plant", open: "ent-scenario", preset: "terms",
    metric: ({ d }) => { const r = runScenario(d, PRESETS.find((p) => p.id === "terms")!.scenario); return `${fmt(r.headline[0].value)} released; ${r.headline[2].value} critical suppliers squeezed`; },
    why: "Working Capital alone would recommend it; Supply Chain shows who might break." },
  { id: "uc-fx", role: "CFO", question: "What does a weaker euro do to reported results, spend and payroll?",
    apps: "FIN,SPD,PPL", path: "LegalEntity reports in currency", open: "ent-scenario", preset: "fx-eur",
    metric: ({ d }) => { const r = runScenario(d, PRESETS.find((p) => p.id === "fx-eur")!.scenario); return `EUR −10%: revenue ${fmt(r.headline[0].value)}, payroll ${fmt(r.headline[3].value)}`; },
    why: "One translation across three apps that report the same entity in USD." },
  { id: "uc-workforce", role: "CHRO / COO", question: "Where is a headcount reduction safe — and where would it compound a delivery problem?",
    apps: "PPL,FIN,SCM", path: "LegalEntity → employs → Employee; LegalEntity ← ownedBy Plant", open: "ent-scenario", preset: "wf-us",
    metric: ({ s }) => `revenue / employee: ${s.companies.map((c: any) => `${c.company.split(" ")[0]} ${fmt(c.revenue_usd / c.headcount)}`).join(", ")}`,
    why: "People sees cost; the ontology adds the plants' OTIF before the decision." },
];

export default function EntUseCases({ onNavigate }: { onNavigate: (p: string) => void }) {
  const s = useQuery(() => entApi.summary(), []);
  const d = useQuery(() => entApi.scenarioData(), []);
  if (s.loading || d.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (s.error || d.error) return <p className="text-sm text-rose-600">{s.error || d.error}</p>;
  const ctx = { s: s.data, d: d.data };
  const go = (u: UseCase) => {
    if (u.preset) sessionStorage.setItem("ent.preset", u.preset);
    onNavigate(u.open);
  };
  return (
    <div className="space-y-4">
      <p className="max-w-4xl text-sm text-slate-600">
        Ten management questions that <b>no single 360 app can answer</b>, because each needs facts from two or more apps joined on
        the same company, customer or supplier. Each card shows the live answer, the ontology path it travels and the page that explores it.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {CASES.map((u) => (
          <Panel key={u.id} title={u.question} right={<ModuleChips list={u.apps} />}>
            <div className="space-y-2 text-xs">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{u.role}</div>
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900">{u.metric(ctx)}</div>
              <div className="text-slate-600">{u.why}</div>
              <div className="font-mono text-[10px] text-slate-500">{u.path}</div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button onClick={() => go(u)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50">
                  {u.preset ? "Run the scenario →" : "Open the page →"}</button>
                <AskCortex compact topic="ent-usecase" args={{ id: u.id, question: u.question }} label="Ask Cortex" />
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

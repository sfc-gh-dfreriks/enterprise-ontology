import { useEffect, useState } from "react";
import { Sidebar, type PageId } from "./components/Sidebar";
import { useQuery } from "./hooks/useQuery";
import { entApi } from "./lib/api";
import AskCortexPage from "./pages/AskCortexPage";
import EntOntology from "./pages/ent/EntOntology";
import EntSnowflakeOntology from "./pages/ent/EntSnowflakeOntology";
import EntOverview from "./pages/ent/EntOverview";
import EntParty from "./pages/ent/EntParty";
import EntCrosswalk from "./pages/ent/EntCrosswalk";
import EntScenario from "./pages/ent/EntScenario";
import EntUseCases from "./pages/ent/EntUseCases";
import EntLineage from "./pages/ent/EntLineage";
import EntImpact from "./pages/ent/EntImpact";
import EntRisk from "./pages/ent/EntRisk";
import EntMitigation from "./pages/ent/EntMitigation";

const TITLES: Record<PageId, string> = {
  "ent-ontology": "Ontology — the governed Enterprise domain",
  "ent-overview": "Executive Dashboard — six 360 apps, one governed ontology",
  "ent-snowflake": "Snowflake Ontology Details — the domain inside Snowsight",
  "ask-cortex": "Ask Cortex — grounded analysis across all six apps",
  "ent-usecases": "Management Use Cases — questions only the master ontology can answer",
  "ent-scenario": "Scenario Studio — one shock, six apps",
  "ent-impact": "Impact Map — the ripple through the ontology, hop by hop",
  "ent-mitigation": "Mitigation & Recovery — what protects value, what stays exposed, and the risk left",
  "ent-customers": "Customer 360 — golden customers across Finance, Sales, Working Capital and Supply Chain",
  "ent-suppliers": "Supplier 360 — golden suppliers across Spend, Working Capital, Finance and Supply Chain",
  "ent-crosswalk": "Golden-Record Crosswalk",
  "ent-lineage": "SAP BDC Lineage — from data products, through the 360 apps, into the ontology",
};

const PAGE_IDS = Object.keys(TITLES) as PageId[];

// Old links keep working: the class model and the graph are now the Ontology page,
// and Risk Outcome is part of Mitigation & Recovery.
const ALIASES: Record<string, PageId> = { "ent-model": "ent-ontology", "ent-graph": "ent-ontology", "ent-risk": "ent-mitigation" };

/** Read the page from the URL hash, falling back to the Ontology page (first in the nav). */
function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (ALIASES[h]) return ALIASES[h];
  return PAGE_IDS.includes(h as PageId) ? (h as PageId) : "ent-ontology";
}

export default function App() {
  // The page lives in the hash so every view can be linked to, bookmarked and
  // handed to someone else — links straight to any page.
  const [page, setPage] = useState<PageId>(pageFromHash);
  const bo = useQuery(() => entApi.boSummary(), []);
  const nav = (p: string) => setPage((ALIASES[p] ?? p) as PageId);

  // Push the current page into the URL, and follow the URL when it changes
  // underneath us (back button, or a link pasted into the same tab).
  useEffect(() => {
    if (pageFromHash() !== page) window.location.hash = page;
  }, [page]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const render = () => {
    switch (page) {
      case "ent-ontology": return <EntOntology />;
      case "ent-overview": return <EntOverview onNavigate={nav} />;
      case "ent-snowflake": return <EntSnowflakeOntology />;
      case "ask-cortex": return <AskCortexPage />;
      case "ent-usecases": return <EntUseCases onNavigate={nav} />;
      case "ent-scenario": return <EntScenario onNavigate={nav} />;
      case "ent-impact": return <EntImpact onNavigate={nav} />;
      case "ent-mitigation": return (<>
        <EntMitigation onNavigate={nav} />
        <div className="mt-6"><EntRisk onNavigate={nav} embedded /></div></>);
      case "ent-customers": return <EntParty kind="customer" />;
      case "ent-suppliers": return <EntParty kind="supplier" />;
      case "ent-crosswalk": return <EntCrosswalk />;
      case "ent-lineage": return <EntLineage />;
    }
  };

  return (
    <div className="flex h-full">
      <Sidebar active={page} onNavigate={setPage} concepts={bo.data?.available ? bo.data.counts.nodes : 0} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
          <h1 className="text-lg font-bold text-slate-800">{TITLES[page]}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            built on Snowflake Business Ontology
          </span>
        </header>
        <main className="flex-1 overflow-auto bg-slate-50 p-6">{render()}</main>
      </div>
    </div>
  );
}

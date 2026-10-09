import { useEffect, useState } from "react";
import { Sidebar, type PageId } from "./components/Sidebar";
import { useQuery } from "./hooks/useQuery";
import { api } from "./lib/api";
import Overview from "./pages/Overview";
import OntologyModel from "./pages/OntologyModel";
import Graph from "./pages/Graph";
import Processes from "./pages/Processes";
import UseCases from "./pages/UseCases";
import Correlation from "./pages/Correlation";
import Coverage from "./pages/Coverage";
import Ask from "./pages/Ask";
import Traverse from "./pages/Traverse";
import Demo from "./pages/Demo";
import ScenarioStudio from "./pages/ScenarioStudio";
import RippleMap from "./pages/RippleMap";
import OptimizeMap from "./pages/OptimizeMap";
import Mitigation from "./pages/Mitigation";
import DigitalThread from "./pages/DigitalThread";
import { AskCortex } from "./components/AskCortex";
import { OperationsPulse } from "./components/OperationsPulse";
import EntOverview from "./pages/ent/EntOverview";
import EntModel from "./pages/ent/EntModel";
import EntParty from "./pages/ent/EntParty";
import EntCrosswalk from "./pages/ent/EntCrosswalk";
import EntGraph from "./pages/ent/EntGraph";
import EntScenario from "./pages/ent/EntScenario";
import EntUseCases from "./pages/ent/EntUseCases";

const TITLES: Record<PageId, string> = {
  "ent-overview": "Enterprise Overview — six 360 apps, one ontology",
  "ent-usecases": "Management Use Cases — questions only the master ontology can answer",
  "ent-scenario": "Enterprise Scenario Studio — one shock, six apps",
  "ent-model": "Master Ontology Model — upper classes, golden records, modules",
  "ent-customers": "Customer 360 — golden customers across Finance, Sales, Working Capital and Supply Chain",
  "ent-suppliers": "Supplier 360 — golden suppliers across Spend, Working Capital, Finance and Supply Chain",
  "ent-crosswalk": "Golden-Record Crosswalk",
  "ent-graph": "Enterprise Knowledge Graph",
  overview: "Supply Chain module — Portfolio Overview",
  model: "Ontology Model — classes and relations",
  graph: "SAP BDC Catalog — data products and CDS entities",
  traverse: "Graph Traversal",
  processes: "Business-Process Ontology",
  usecases: "Use Cases / Intelligent Applications",
  correlation: "Process Correlation",
  coverage: "Coverage & Scorecard",
  ask: "Ask the Enterprise",
  demo: "Guided Demo",
  scenario: "Scenario Studio",
  ripple: "Ripple Map — geography and topology",
  mitigation: "Mitigation Plan",
  optimize: "Optimization Map — the recovery, step by step",
  thread: "Digital Thread — orders, systems, lots and tools in the graph",
};

const PAGE_IDS = Object.keys(TITLES) as PageId[];

/** Read the page from the URL hash, falling back to overview for anything unknown. */
function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, "");
  return PAGE_IDS.includes(h as PageId) ? (h as PageId) : "ent-overview";
}

export default function App() {
  // The page lives in the hash so every view can be linked to, bookmarked and
  // handed to someone else — the dashboard app links straight to Scenario Studio.
  const [page, setPage] = useState<PageId>(pageFromHash);
  const meta = useQuery(() => api.meta(), []);

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
      case "ent-overview": return <EntOverview onNavigate={(p) => setPage(p as PageId)} />;
      case "ent-usecases": return <EntUseCases onNavigate={(p) => setPage(p as PageId)} />;
      case "ent-scenario": return <EntScenario />;
      case "ent-model": return <EntModel />;
      case "ent-customers": return <EntParty kind="customer" />;
      case "ent-suppliers": return <EntParty kind="supplier" />;
      case "ent-crosswalk": return <EntCrosswalk />;
      case "ent-graph": return <EntGraph />;
      case "overview": return (<>
        <div className="mb-6"><OperationsPulse onNavigate={(p) => setPage(p as PageId)} /></div>
        <Overview /></>);
      case "thread": return <DigitalThread />;
      case "model": return <OntologyModel />;
      case "graph": return <Graph />;
      case "traverse": return <Traverse />;
      case "processes": return <Processes />;
      case "usecases": return <UseCases />;
      case "correlation": return <Correlation />;
      case "coverage": return <Coverage />;
      case "ask": return <Ask />;
      case "demo": return <Demo onNavigate={setPage} />;
      case "scenario": return <ScenarioStudio />;
      case "ripple": return <RippleMap />;
      case "mitigation": return <Mitigation />;
      case "optimize": return <OptimizeMap />;
    }
  };

  return (
    <div className="flex h-full">
      <Sidebar active={page} onNavigate={setPage}
        products={meta.data?.totals.products ?? 0}
        entities={meta.data?.totals.entities ?? 0} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
          <h1 className="text-lg font-bold text-slate-800">{TITLES[page]}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {page.startsWith("ent-") || page === "ask" ? "SAP_ENTERPRISE_ONTOLOGY · six modules" : "Supply Chain module"}
          </span>
          {meta.error && <span className="ml-auto text-xs text-rose-500">{meta.error}</span>}
        </header>
        <main className="flex-1 overflow-auto bg-slate-50 p-6">{render()}</main>
      </div>
    </div>
  );
}

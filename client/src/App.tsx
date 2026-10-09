import { useEffect, useState } from "react";
import { Sidebar, type PageId } from "./components/Sidebar";
import Ask from "./pages/Ask";
import EntOverview from "./pages/ent/EntOverview";
import EntModel from "./pages/ent/EntModel";
import EntParty from "./pages/ent/EntParty";
import EntCrosswalk from "./pages/ent/EntCrosswalk";
import EntGraph from "./pages/ent/EntGraph";
import EntScenario from "./pages/ent/EntScenario";
import EntUseCases from "./pages/ent/EntUseCases";
import EntLineage from "./pages/ent/EntLineage";
import EntImpact from "./pages/ent/EntImpact";
import EntRisk from "./pages/ent/EntRisk";
import EntMitigation from "./pages/ent/EntMitigation";

const TITLES: Record<PageId, string> = {
  "ent-overview": "Enterprise Overview — six 360 apps, one ontology",
  "ent-usecases": "Management Use Cases — questions only the master ontology can answer",
  "ent-scenario": "Enterprise Scenario Studio — one shock, six apps",
  "ent-impact": "Impact Map — the ripple through the ontology, hop by hop",
  "ent-risk": "Risk Outcome — how bad, where, and when",
  "ent-mitigation": "Mitigation & Recovery — what protects value, and what stays exposed",
  "ent-model": "Master Ontology Model — upper classes, golden records, modules",
  "ent-customers": "Customer 360 — golden customers across Finance, Sales, Working Capital and Supply Chain",
  "ent-suppliers": "Supplier 360 — golden suppliers across Spend, Working Capital, Finance and Supply Chain",
  "ent-crosswalk": "Golden-Record Crosswalk",
  "ent-graph": "Enterprise Knowledge Graph",
  "ent-lineage": "SAP BDC Lineage — from data products, through the 360 apps, into the ontology",
  ask: "Ask the Enterprise",
};

const PAGE_IDS = Object.keys(TITLES) as PageId[];

/** Read the page from the URL hash, falling back to overview for anything unknown. */
function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, "");
  return PAGE_IDS.includes(h as PageId) ? (h as PageId) : "ent-overview";
}

export default function App() {
  // The page lives in the hash so every view can be linked to, bookmarked and
  // handed to someone else — links straight to any page.
  const [page, setPage] = useState<PageId>(pageFromHash);

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
      case "ent-scenario": return <EntScenario onNavigate={(p) => setPage(p as PageId)} />;
      case "ent-impact": return <EntImpact onNavigate={(p) => setPage(p as PageId)} />;
      case "ent-risk": return <EntRisk onNavigate={(p) => setPage(p as PageId)} />;
      case "ent-mitigation": return <EntMitigation onNavigate={(p) => setPage(p as PageId)} />;
      case "ent-model": return <EntModel />;
      case "ent-customers": return <EntParty kind="customer" />;
      case "ent-suppliers": return <EntParty kind="supplier" />;
      case "ent-crosswalk": return <EntCrosswalk />;
      case "ent-graph": return <EntGraph />;
      case "ent-lineage": return <EntLineage />;
      case "ask": return <Ask />;
    }
  };

  return (
    <div className="flex h-full">
      <Sidebar active={page} onNavigate={setPage} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
          <h1 className="text-lg font-bold text-slate-800">{TITLES[page]}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            SAP_ENTERPRISE_ONTOLOGY · six modules
          </span>
        </header>
        <main className="flex-1 overflow-auto bg-slate-50 p-6">{render()}</main>
      </div>
    </div>
  );
}

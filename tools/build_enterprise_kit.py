#!/usr/bin/env python3
"""Build the Enterprise Ontology docs and presales kit from live facts.

Writes, from /tmp/enterprise_facts.json only (tools/enterprise_facts.py):

  README.md, docs/enterprise/0[1-4]-*.md                      repository documentation
  ~/Documents/SAP/Enterprise_Ontology_Presales_Kit/
      00_START_HERE.docx            what is in the kit, which file to open
      01_Management_Summary.docx    the case, in numbers
      02_Demo_Scripts_by_Persona.docx  five personas, beat by beat
      03_SE_Quick_Start.docx        10-minute path, questions, objections
      05_Architecture_and_Install.docx  the layers and how to stand them up
      06_Setup_and_Access.docx      regions, repo, public site, access

    python3 tools/enterprise_facts.py && python3 tools/build_enterprise_kit.py
"""
from __future__ import annotations

import json
import pathlib
import sys
from datetime import date

from docx import Document

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from docx_kit import AMBER, GREY, SAP_NAVY, body, bullet, callout, h1, h2, money, setup_page, table  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
FACTS = json.loads(pathlib.Path("/tmp/enterprise_facts.json").read_text())["facts"]
KIT = pathlib.Path.home() / "Documents" / "SAP" / "Enterprise_Ontology_Presales_Kit"
F = FACTS

MOD_NAME = {"CORE": "Enterprise core", "FIN": "Finance 360", "SAL": "Sales 360", "PPL": "People 360",
            "SPD": "Spend 360", "WCP": "Working Capital 360", "SCM": "Supply Chain 360"}


def n(v, d=0):
    return f"{float(v):,.{d}f}"


def pct(v):
    return "—" if v is None else f"{float(v):.1f}%"


# ------------------------------------------------------------------ shared text
def eight_numbers():
    us = next(c for c in F["companies"] if c["company"] == "US Operations")
    exp = F["quality_exposure"][0]
    return [
        (f"{F['classes']} classes, {F['relations']} relations", "one ontology over six 360 apps, Supply Chain ontology as baseline"),
        (f"{n(F['kg_nodes'])} nodes / {n(F['kg_edges'])} edges", f"knowledge graph, {F['dangling_edges']} dangling edges"),
        (f"{n(F['crosswalk_records'])} records → {F['golden_customers'] + F['golden_suppliers']} golden",
         f"{F['golden_customers']} customers and {F['golden_suppliers']} suppliers conformed across apps"),
        (f"{F['four_app_customers']} customers in 4 apps", "Finance, Sales, Working Capital and Supply Chain see the same account"),
        (money(F["revenue_usd"]), f"revenue across {F['golden_companies']} legal entities (Finance 360, USD)"),
        (f"{pct(us['otif_pct'])} OTIF", f"US Operations — the weakest entity; {money(us['late_cost_usd'])} late cost"),
        (money(exp["order_value_usd"]), f"customer orders containing {exp['supplier']} deviating lots"),
        ("3 regions, parity", "US, EU, APAC each rebuilt and checked against US totals"),
    ]


def caveats():
    return [
        ("Demo crosswalk.", "The six apps came from different SAP BDC demo tenants and share no customer or supplier keys. "
         "Golden records come from a deterministic, rank-based crosswalk; every record carries its match method. "
         "In production this is SAP MDG or a match-merge output."),
        ("Currency.", "Money is USD at the Working Capital planning rates (" +
         ", ".join(f"{r['currency']} {float(r['rate_to_usd']):g}" for r in F["fx"]) +
         "). Sales order value counts USD orders only."),
        ("Scale between apps.", "Sales 360 order values come from the BDC demo tenant and are far larger than the Supply Chain demo "
         "orders. Compare within an app, not across."),
        ("Company mapping.", "Supply Chain plants carry company codes 1000/2000/3000; they are mapped to US, EU and Japan "
         "Operations by region."),
    ]


# ------------------------------------------------------------------ markdown
def md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def write_markdown():
    docs = ROOT / "docs" / "enterprise"
    docs.mkdir(parents=True, exist_ok=True)
    comp = md_table(["Company", "Revenue", "Net margin", "DSO / DPO / CCC", "Headcount", "Spend", "OTIF", "Late cost"],
                    [[c["company"], money(c["revenue_usd"]), pct(c["net_margin_pct"]),
                      f"{n(c['dso'], 1)} / {n(c['dpo'], 1)} / {n(c['ccc'], 1)}", n(c["headcount"]), money(c["spend_usd"]),
                      pct(c["otif_pct"]), money(c["late_cost_usd"])] for c in F["companies"]])
    (ROOT / "README.md").write_text(f"""# SAP Enterprise Ontology

A **master ontology over six SAP BDC 360 applications** — Finance, Sales, People, Spend, Working Capital and
Supply Chain — built on the Supply Chain ontology as its baseline. Golden legal entities, customers and
suppliers conform each app's local records, so one question can cross all six apps in a single traversal.

- **Live app:** React + Express, `npm run dev` (server 3011, client 5186)
- **Public build (no Snowflake needed):** {F['site']}
- **Snowflake:** `{F['database']}` — semantic view `{F['semantic_view']}`, agent `{F['agent']}`

## In numbers

{md_table(["Measure", "Value"], [[a, b] for a, b in eight_numbers()])}

## Legal entities across every app

{comp}

## Pages

{chr(10).join(f"- **{p}**" for p in F['enterprise_pages'])}
- The original Supply Chain ontology pages ({F['scm_pages']}) are kept as the *Supply Chain module (baseline)*.

Every enterprise page has **Ask Cortex** ({F['ask_topics']} grounded topics): the server passes the view's facts to
`AI_COMPLETE`. The public build ships the default analysis baked at build time.

## Build

```bash
# Snowflake layer (US is the source of truth)
for f in sql/enterprise/0*.sql; do snow sql -c dfreriksdemo -f "$f"; done
python3 tools/deploy_region.py dfreriks_eu_demo     # and dfreriks_apac_demo — gated on parity with US
# App data + public snapshots
python3 tools/export_enterprise.py
npm install && npm run dev                          # then, with the server up:
python3 tools/bake_static.py
# Docs and presales kit
python3 tools/enterprise_facts.py && python3 tools/build_enterprise_kit.py && python3 tools/build_enterprise_decks.py
```

## Read this before demoing

{chr(10).join(f"- **{a}** {b}" for a, b in caveats())}

More: [`docs/enterprise`](docs/enterprise). The Supply Chain baseline docs remain in [`docs`](docs).
""")

    (docs / "01-concepts.md").write_text(f"""# 1. Concepts

**Why a master ontology.** Each 360 app answers its own domain well and nothing across domains: Spend knows a
supplier's spend, Working Capital its payables, Supply Chain its lots — but none knows they are the same supplier.
The master ontology adds one shared vocabulary and one identity per real-world party.

**Upper ontology.** {F['abstract_classes']} abstract classes — Entity, Party, OrgUnit, Facility, Transaction, Item, Asset,
Product — generalise the Supply Chain baseline. Every module class hangs off one of them.

**Golden records.** LegalEntity ({F['golden_companies']}), Customer ({F['golden_customers']}), Supplier
({F['golden_suppliers']}) and Department ({F['golden_departments']}) live in the core. Each app's local record is a
`LocalCustomer` / `LocalSupplier` linked by `sameAs`, carrying its match method.

**Modules.** One per app; each adds only what it alone owns:

{md_table(["Module", "Name", "Source database", "Classes"],
          [[m['module'], m['name'], f"`{m['source_database']}`",
            next((c['n'] for c in F['classes_by_module'] if c['module'] == m['module']), 0)] for m in F['modules']])}

**Cross-module relations.** `buysFrom` (Spend) and `owesTo` (Working Capital) and `supplies` (Supply Chain) all land on
the same golden Supplier; `sellsToCustomer` (Working Capital) and `shipsTo` (Supply Chain) on the same Customer;
`employs` (People) and `ownedBy` (Supply Chain) on the same LegalEntity.
""")

    (docs / "02-architecture.md").write_text(f"""# 2. Architecture

```
six 360 databases (L2 dynamic tables)
        │
SAP_ENTERPRISE_ONTOLOGY
  CORE       ONT_CLASS / ONT_RELATION_DEF / ONT_MODULE, KG_NODE / KG_EDGE, VW_ONT_* views
  XWALK      GOLDEN_COMPANY / CUSTOMER / SUPPLIER / DEPARTMENT, *_MEMBER, V_CROSSWALK
  ANALYTICS  DT_COMPANY_360, DT_CUSTOMER_360, DT_SUPPLIER_360   ({F['dynamic_tables']} dynamic tables, 1-day lag)
  SEMANTIC   SAP_ENTERPRISE_360       AGENTS   SAP_ENTERPRISE_ANALYST
        │
tools/export_enterprise.py → data/enterprise_ontology.json → Express API (3011) → React (5186)
                                                          └→ tools/bake_static.py → GitHub Pages
```

**Aggregate before join.** Every source is summed to the golden id first, then joined, so a one-to-many crosswalk
cannot multiply amounts. That is why the enterprise totals equal each app's own:

{md_table(["Metric", "Source app", "App total", "Enterprise total"],
          [[r['metric'], r['app'], n(r['source']), n(r['enterprise'])] for r in F['reconciliation']])}

**Graph holds identity, not transactions.** {n(F['kg_nodes'])} nodes and {n(F['kg_edges'])} edges: golden and member
records, plants, tools, departments, categories, employees. Transactions stay in the source apps; edge `WEIGHT` carries
the money that makes a link matter (spend, open AP, AR, order value, lots).

**Supplier quality exposure.** `CORE.VW_SUPPLIER_QUALITY_EXPOSURE` walks golden supplier → Supply Chain lots →
serials → orders → golden customer, reduced to one row per (supplier, order) before summing.
""")

    (docs / "03-build-and-deploy.md").write_text(f"""# 3. Build and deploy

| Step | Command | Notes |
|---|---|---|
| Core ontology | `sql/enterprise/01_core_schema.sql` | DB, schemas, {F['classes']} classes, {F['relations']} relations, modules |
| Crosswalk | `sql/enterprise/02_crosswalk.sql` | deterministic; same input, same mapping |
| Facts | `sql/enterprise/03_facts.sql` | dynamic tables; lag must be ≥ the 1-day upstream lag |
| Graph | `sql/enterprise/04_kg_load.sql` | truncate-and-reload, idempotent |
| Semantic view + agent | `sql/enterprise/05_semantic_agent.sql` | |
| Regions | `tools/deploy_region.py <connection>` | copies Supply Chain OPS_EXT + ONTOLOGY from US, runs 01–05, **fails unless totals match US** |
| App data | `tools/export_enterprise.py` | writes `data/enterprise_ontology.json` |
| Public snapshots | `tools/bake_static.py` | needs the local server; bakes Ask Cortex answers |

**Why the region script copies operations data rather than regenerating it.** The Supply Chain generator reads two
base tables without `ORDER BY`; another account can return rows in a different order and the seeded draws diverge.
Copying from US keeps every region identical.

## Regions

{md_table(["Region", "Connection", "Parity with US", "Agent", "KG nodes", "Crosswalk", "Spend"],
          [[r['region'], f"`{r['connection']}`", "yes" if r.get('parity') else "NO", "yes" if r.get('agent') else "no",
            n(r.get('kg_nodes', 0)), n(r.get('crosswalk', 0)), money(r.get('spend_usd', 0))] for r in F['regions']])}
""")

    (docs / "04-limits.md").write_text("# 4. Limits and caveats\n\n" + "\n\n".join(f"**{a}** {b}" for a, b in caveats()) + f"""

**Ask Cortex** answers from the facts of the view on screen; it does not run new SQL. For open questions use
*Ask the Enterprise* (Cortex Analyst over `{F['semantic_view']}`). The public build has no Snowflake connection: it shows
the baked default analysis only.
""")
    print("wrote README.md and docs/enterprise/01-04")


# ------------------------------------------------------------------ docx
def new_doc(title, subtitle):
    d = Document()
    setup_page(d)
    h1(d, title, size=20)
    body(d, subtitle, color=GREY)
    body(d, f"Generated {date.today():%d %B %Y} from live account facts. {F['repo']}", size=8.5, color=GREY)
    return d


def eight_table(d):
    table(d, ["", "What it means"], [[f"**{a}**", b] for a, b in eight_numbers()], [2.3, 4.6], zebra=True)


def caveat_block(d):
    for a, b in caveats():
        callout(d, a, b, fill="FFF4E5")


def doc_start_here():
    d = new_doc("SAP Enterprise Ontology — Start Here", "Presales kit: a master ontology across six SAP BDC 360 apps")
    callout(d, "In one line.", "Six 360 apps, one ontology: the same supplier, customer and company seen through Finance, "
            "Sales, People, Spend, Working Capital and Supply Chain at once — and Cortex reasoning across all of them.")
    h2(d, "The demo in eight numbers")
    eight_table(d)
    h2(d, "Which file to open")
    table(d, ["If you need…", "Open"], [
        ["the business case for an executive", "01_Management_Summary.docx"],
        ["a script for a specific audience", "02_Demo_Scripts_by_Persona.docx"],
        ["to demo in 10 minutes tomorrow", "03_SE_Quick_Start.docx"],
        ["how it is built, and to install it", "05_Architecture_and_Install.docx"],
        ["regions, links and access", "06_Setup_and_Access.docx"],
        ["slides", "00_Presales_Overview.pptx (10 slides), SAP_Enterprise_Ontology_Demo.pptx (one per page)"],
        ["the narrated walkthrough", "SAP_Enterprise_Ontology_Walkthrough.mp4"],
    ], [3.0, 3.9])
    h2(d, "Read before you demo")
    caveat_block(d)
    return d


def doc_management():
    d = new_doc("Management Summary", "Why a master ontology over the 360 apps, and what it shows")
    h2(d, "The problem")
    body(d, "Each SAP BDC 360 app answers its own domain. None can say that the supplier with the most open payables is "
            "also the one whose deviating lots sit in a top customer's orders — because each app holds its own copy of "
            "that supplier, under its own key.")
    h2(d, "What we built")
    for t in [f"One ontology: {F['classes']} classes and {F['relations']} relations, the Supply Chain ontology's upper classes "
              "generalised to all six apps.",
              f"Golden records: {F['golden_companies']} legal entities, {F['golden_customers']} customers, "
              f"{F['golden_suppliers']} suppliers, {F['golden_departments']} departments, resolving {n(F['crosswalk_records'])} app records.",
              f"A knowledge graph of {n(F['kg_nodes'])} nodes and {n(F['kg_edges'])} edges with {F['dangling_edges']} dangling edges.",
              "Cross-app 360 facts, a semantic view and a Cortex Agent, deployed identically in US, EU and APAC.",
              f"An app with {len(F['enterprise_pages'])} enterprise pages and grounded Ask Cortex on each."]:
        bullet(d, t)
    h2(d, "What it shows")
    table(d, ["Company", "Revenue", "Margin", "CCC (days)", "Headcount", "OTIF", "Late cost"],
          [[c["company"], money(c["revenue_usd"]), pct(c["net_margin_pct"]), n(c["ccc"], 1), n(c["headcount"]),
            pct(c["otif_pct"]), money(c["late_cost_usd"])] for c in F["companies"]], [1.5, 0.9, 0.8, 0.9, 0.9, 0.8, 1.1])
    body(d, "Supplier quality reaches customers: order value containing each supplier's deviating component lots.")
    table(d, ["Supplier", "Customers", "Orders", "Order value exposed"],
          [[r["supplier"], n(r["customers"]), n(r["orders"]), money(r["order_value_usd"])] for r in F["quality_exposure"]],
          [2.6, 1.2, 1.2, 1.9], align_right=(1, 2, 3))
    h2(d, "Proof it is right")
    table(d, ["Metric", "Source app", "App total", "Enterprise total"],
          [[r["metric"], r["app"], n(r["source"]), n(r["enterprise"])] for r in F["reconciliation"]],
          [2.0, 1.7, 1.6, 1.6], align_right=(2, 3))
    h2(d, "Caveats")
    caveat_block(d)
    return d


PERSONAS = [
    ("CFO", "Where is cash and margin leaking across entities?", [
        ("Enterprise Overview", "Legal entities across every app: revenue, margin, CCC, headcount, spend, OTIF in one table."),
        ("Ask Cortex (companies)", "“Rank the companies on cash conversion and OTIF together.”"),
        ("Supplier 360", "Open payables next to spend and risk — where early-pay discounts are lost."),
    ]),
    ("CPO / Procurement", "Which suppliers carry risk the spend view cannot see?", [
        ("Supplier 360", "Spend, open AP and deviating lots side by side; open the top supplier."),
        ("Quality exposure", "Customer orders containing that supplier's deviating lots."),
        ("Ask Cortex (supplier)", "“Should we pay this supplier early, hold, or dual-source?”"),
    ]),
    ("COO / Supply Chain", "Which customers feel our operational problems?", [
        ("Customer 360", "Late-delivery cost ranked; open a customer that is also overdue on AR."),
        ("Enterprise Graph", "Plants → customers and suppliers → plants, edges coloured by app."),
        ("Ask Cortex (customer)", "“Is this account healthy across finance, sales and delivery?”"),
    ]),
    ("CIO / Data leader", "How is this governed and how does it scale?", [
        ("Master Ontology Model", "Upper classes, golden classes, one module per app."),
        ("Golden-Record Crosswalk", "Every local record and its match method — nothing hidden."),
        ("Ask the Enterprise", "Cortex Analyst over the enterprise semantic view."),
    ]),
    ("CHRO", "Is headcount where the revenue and the problems are?", [
        ("Enterprise Overview", "Headcount and revenue per employee per entity, next to OTIF."),
        ("Ask Cortex (overview)", "“Is US Operations' late cost a people or a supplier problem?”"),
    ]),
]


def doc_personas():
    d = new_doc("Demo Scripts by Persona", "Five audiences, beat by beat — every page and figure is in the live app")
    for role, question, beats in PERSONAS:
        h1(d, role, size=14)
        callout(d, "Their question.", question)
        table(d, ["Beat", "Show / say"], [[f"**{a}**", b] for a, b in beats], [2.0, 4.9])
    return d


def doc_quickstart():
    d = new_doc("SE Quick Start", "Positioning, the 10-minute path, questions and objections")
    callout(d, "Positioning.", "The 360 apps answer domains. The enterprise ontology answers the business: one identity per "
            "party across apps, and AI that reasons across all of them with the evidence on screen.")
    h2(d, "10-minute path")
    for i, t in enumerate([
        "Enterprise Overview — the eight numbers, then the legal-entity table (point at the US OTIF).",
        "Supplier 360 — open the top-spend supplier: spend, AP, lots and the crosswalk members in one record.",
        "Ask Cortex on that supplier — a recommendation that cites Spend, Working Capital and Supply Chain.",
        "Customer 360 — the customers that are both overdue and late.",
        "Golden-Record Crosswalk — show the match methods; say plainly it is a demo crosswalk.",
        "Ask the Enterprise — run one sample question live.",
    ], 1):
        body(d, f"{i}. {t}")
    h2(d, "Questions that land")
    for q in ["Which suppliers have the highest open payables and how much spend do they have?",
              "Which customers have overdue receivables and late-delivery cost at the same time?",
              "Which company has the best revenue per employee and how does its cash conversion cycle compare?"]:
        bullet(d, q)
    h2(d, "Objections")
    table(d, ["They say", "You say"], [
        ["“The customer matching is fake.”", "It is a demo crosswalk and labelled as such on every page. The ontology, graph and facts "
         "are built to take MDG or match-merge output in its place — swap XWALK, nothing else changes."],
        ["“We already have a data warehouse.”", "The warehouse has tables; the ontology adds shared meaning and identity, "
         "which is what lets Cortex answer across domains without hand-written joins."],
        ["“Is it real-time?”", "The facts are dynamic tables on a one-day lag, matching the upstream 360 apps."],
        ["“Does it work outside the US?”", "Deployed in US, EU and APAC with a parity check against US."],
    ], [2.2, 4.7])
    h2(d, "Caveats to state")
    caveat_block(d)
    return d


def doc_architecture():
    d = new_doc("Architecture and Install", "The layers, why they are shaped this way, and how to stand them up")
    h2(d, "Schemas")
    table(d, ["Schema", "Holds"], [
        ["CORE", "ONT_CLASS, ONT_RELATION_DEF, ONT_MODULE; KG_NODE / KG_EDGE; VW_ONT_* and exposure views"],
        ["XWALK", "GOLDEN_COMPANY / CUSTOMER / SUPPLIER / DEPARTMENT, *_MEMBER tables, V_CROSSWALK"],
        ["ANALYTICS", f"DT_COMPANY_360, DT_CUSTOMER_360, DT_SUPPLIER_360 ({F['dynamic_tables']} dynamic tables)"],
        ["SEMANTIC / AGENTS", "SAP_ENTERPRISE_360 semantic view; SAP_ENTERPRISE_ANALYST Cortex Agent"],
    ], [1.6, 5.3])
    h2(d, "Modules")
    table(d, ["Module", "App", "Source database", "Classes"],
          [[m["module"], m["name"], m["source_database"],
            n(next((c["n"] for c in F["classes_by_module"] if c["module"] == m["module"]), 0))] for m in F["modules"]],
          [0.9, 2.0, 2.9, 1.1])
    h2(d, "Design rules")
    for t in ["Aggregate each source to the golden id before joining — amounts cannot multiply.",
              "The graph holds identities and relationships; transactions stay in the source apps.",
              "Every golden link keeps its match method, so provenance is visible to users and to Cortex.",
              "Ask Cortex is grounded: the server sends the view's facts to AI_COMPLETE and asks it not to invent numbers."]:
        bullet(d, t)
    h2(d, "Install")
    table(d, ["Step", "Run"], [
        ["1. Snowflake layer", "sql/enterprise/01..05 on the US account"],
        ["2. Regions", "python3 tools/deploy_region.py dfreriks_eu_demo (and dfreriks_apac_demo)"],
        ["3. App data", "python3 tools/export_enterprise.py"],
        ["4. App", "npm install && npm run dev — server 3011, client 5186"],
        ["5. Public build", "python3 tools/bake_static.py, then push; GitHub Actions publishes"],
    ], [1.8, 5.1])
    return d


def doc_access():
    d = new_doc("Setup and Access", "Where everything lives and how to reach it")
    table(d, ["Thing", "Where"], [
        ["Repository", F["repo"]], ["Public site (no login)", F["site"]], ["Local app", f"{F['app_url']} ({F['ports']})"],
        ["Database", F["database"]], ["Semantic view", F["semantic_view"]], ["Agent", F["agent"]],
    ], [2.0, 4.9])
    h2(d, "Regions")
    table(d, ["Region", "Connection", "Parity", "Agent", "KG nodes", "Crosswalk"],
          [[r["region"], r["connection"], "yes" if r.get("parity") else "NO", "yes" if r.get("agent") else "no",
            n(r.get("kg_nodes", 0)), n(r.get("crosswalk", 0))] for r in F["regions"]], [0.9, 1.9, 0.9, 0.8, 1.2, 1.2])
    h2(d, "Access")
    body(d, "The public site needs nothing. The live app needs a Snowflake key-pair connection with read access to the "
            "six 360 databases and SAP_ENTERPRISE_ONTOLOGY; set it in server/.env (see server/.env.example).")
    return d


def main():
    write_markdown()
    KIT.mkdir(parents=True, exist_ok=True)
    for name, fn in [("00_START_HERE", doc_start_here), ("01_Management_Summary", doc_management),
                     ("02_Demo_Scripts_by_Persona", doc_personas), ("03_SE_Quick_Start", doc_quickstart),
                     ("05_Architecture_and_Install", doc_architecture), ("06_Setup_and_Access", doc_access)]:
        p = KIT / f"{name}.docx"
        fn().save(p)
        print(f"wrote {p.name} ({p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

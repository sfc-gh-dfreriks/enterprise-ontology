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
# Scenario results come from the app's own engine (client/src/lib/entScenario.ts), exported
# by running it on the same data the app serves — never re-implemented here.
SC = json.loads(pathlib.Path("/tmp/enterprise_scenarios.json").read_text())
_P = json.loads((ROOT / "data" / "enterprise_ontology.json").read_text())["scenario"]["period"]
PERIOD = f"{_P['d0']} to {_P['d1']}, {_P['days']} days"


def hv(h):
    v = h["value"]
    return money(v) if h["unit"] == "usd" else (f"{v:.1f}%" if h["unit"] == "pct" else (f"{v:+.0f} days" if h["unit"] == "days" else f"{v:,.0f}"))


def scenario_rows():
    return [[s["label"], " · ".join(f"{h['label']} {hv(h)}" for h in s["headline"][:3]), ", ".join(s["apps"])] for s in SC]


def mitigation_rows():
    """Impact, risk and mitigation per preset, from the same engine the pages run."""
    out = []
    for s in SC:
        m, r = s["mitigation"], s["risk"]
        share = f"{100 * m['protected'] / m['at_risk']:.0f}%" if m["at_risk"] else "—"
        out.append([s["label"], money(m["at_risk"]), f"{money(m['protected'])} ({share})", money(m["residual"]),
                    f"{r['inherent']} → {r['residual']}", m["top_action"] or "—"])
    return out


MIT_HEAD = ["Preset", "At risk", "Protected", "Still exposed", "Risk", "First action"]
LIN = F["lineage"]


def lineage_rows():
    return [[m["name"], ", ".join(m["bdc_products"]) or "— (BDC-shaped tables)", len(m["app_objects"]), "; ".join(m["provenance"])]
            for m in LIN["modules"]]


LIN_HEAD = ["360 app", "SAP BDC data products", "Objects read", "Provenance"]


USE_CASES = [
    ("CEO / CFO", "Which legal entity is weakest across finance, cash, people and delivery?"),
    ("CPO", "Which supplier is cheap to buy from but expensive to depend on?"),
    ("COO", "If our top supplier stops shipping for eight weeks, who feels it and how much?"),
    ("CPO / COO", "What is a second source worth before we pay for it?"),
    ("COO / CFO", "What does a four-week outage at our largest plant cost the enterprise?"),
    ("CRO / Credit", "Which customers are both late to pay and badly served?"),
    ("CFO / Credit", "If our most overdue customer defaults, where does the loss land?"),
    ("Treasurer", "How much cash do longer payment terms release, and which critical suppliers pay for it?"),
    ("CFO", "What does a weaker euro do to reported results, spend and payroll?"),
    ("CHRO / COO", "Where is a headcount reduction safe — and where would it compound a delivery problem?"),
]

BO = F["bo"]
REL_TYPES = ", ".join(f"{v} {k}" for k, v in sorted(BO["relationships_by_type"].items(), key=lambda kv: kv[0] != "IS_A"))


def domain_rows():
    return [[d["domain"], d["concepts"], ", ".join(d["names"])] for d in BO["domains"]]


DOMAIN_HEAD = ["Governed domain", "Concepts", "Names"]


def n(v, d=0):
    return f"{float(v):,.{d}f}"


def pct(v):
    return "—" if v is None else f"{float(v):.1f}%"


# ------------------------------------------------------------------ shared text
def eight_numbers():
    us = next(c for c in F["companies"] if c["company"] == "US Operations")
    top = SC[0]
    return [
        (f"{BO['concepts']} governed concepts, {BO['enterprise_relationships']} relationships",
         f"Snowflake Business Ontology: {BO['owned']} owned by Enterprise, {BO['reused']} reused from Supply Chain; "
         f"{BO['representations']} representations"),
        (f"{n(F['kg_nodes'])} nodes / {n(F['kg_edges'])} edges", f"knowledge graph, {F['dangling_edges']} dangling edges"),
        (f"{n(F['crosswalk_records'])} records → {F['golden_customers'] + F['golden_suppliers'] + F['golden_companies']} golden",
         f"{F['golden_customers']} customers, {F['golden_suppliers']} suppliers and {F['golden_companies']} legal entities conformed across apps"),
        (f"{F['four_app_customers']} customers in 4 apps", "Finance, Sales, Working Capital and Supply Chain see the same account"),
        (money(F["revenue_usd"]), f"revenue across {F['golden_companies']} legal entities (Finance 360, USD)"),
        (f"{pct(us['otif_pct'])} OTIF", f"US Operations — the weakest entity; {money(us['late_cost_usd'])} late cost"),
        (f"{LIN['counts']['bdcProducts']} SAP BDC data products", f"traced through the six 360 apps into the ontology ({LIN['counts']['appObjects']} app objects read)"),
        (f"{100 * top['mitigation']['protected'] / top['mitigation']['at_risk']:.0f}% protected",
         f"of {money(top['mitigation']['at_risk'])} at risk when the top supplier fails — the rest cannot be rerouted"),
    ]


AG = F["agent_search"]
AG_HEAD = ["Question", "What changed"]
AG_LEAD = (f"The Cortex agent `{AG['agent']}` now searches the governed Business Ontology (tool `business_ontology`, "
           f"plus read-only ontology reads through `system_execute_sql`) before it answers: {AG['domains']}. It cites "
           "each concept as domain.concept, labels every number Governed, Derived or Bound table, and declines rather "
           "than guess when no governed definition exists. The same change gave the Analyst tool a warehouse: without "
           "one, every SQL API call failed with error 391920.")


def agent_rows():
    return [[r["question"], r["verdict"]] for r in AG["rows"]]


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
         "Operations by region. On the maps each legal entity sits at its first plant."),
        ("Private preview.", f"Snowflake Business Ontology is enabled on the US account only ({BO['account']}). The EU and "
         "APAC copies keep serving the exported snapshot (data/ent_business_ontology.json); their instance data is "
         "parity-checked against US, the governed graph is not replicated. For the same reason the agent's "
         "ontology search runs in US only."),
        ("Demo enrichment.", "Some 360 inputs are demo enrichment or CRM export rather than an SAP BDC data product; "
         "BDC Lineage labels each one."),
        ("Mitigation.", "Reroutes, stock cover and capacity come from Supply Chain 360 data and are planning grade. Second source, "
         "hedging, insurance and re-sale are labelled assumptions you set."),
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
Supply Chain. Golden legal entities, customers and suppliers conform each app's local records, so one question
can cross all six apps in a single traversal — and one shock can be traced, graded and mitigated across all six.

- **Live app:** React + Express, `npm run dev` (server 3011, client 5186)
- **Public build (no Snowflake needed):** {F['site']}
- **Ontology:** Snowflake Business Ontology on `{BO['account']}` — governed domain **{BO['domain']}** with subdomains
  {', '.join(d.split('.', 1)[1] for d in BO['subdomains'])}, reusing {BO['reused']} concepts of the governed
  **Supply Chain** domain
- **Agent:** `{AG['agent']}` searches the governed ontology before it answers, cites domain.concept and declines when
  no governed definition exists (US only) — see [Concepts](docs/enterprise/01-concepts.md#agent-ontology-search)
- **Instance data:** `{F['database']}` — crosswalk, knowledge graph (`CORE.KG_NODE` / `KG_EDGE`), 360 facts, scenario network

## In numbers

{md_table(["Measure", "Value"], [[a, b] for a, b in eight_numbers()])}

## Legal entities across every app

{comp}

## Governed ontology

The model is no longer app-owned tables: it is the **Snowflake Business Ontology**. {BO['owned']} concepts are governed in
{BO['domain']} and its subdomains; {BO['reused']} ({', '.join(BO['reused_names'])}) are reused from Supply Chain, not
redefined. {BO['enterprise_relationships']} Enterprise relationships ({REL_TYPES}; custom verbs: {', '.join(BO['custom_verbs'])}),
{BO['relationships']} in the snapshot including Supply Chain's own between reused concepts. {BO['representations']}
representations link concepts to the Snowflake objects that implement them, including {len(BO['new_class_views'])} class views
(`sql/enterprise/07_business_ontology_views.sql`). {', '.join(BO['unrepresented'])} have no representation (abstract, or no
source object).

{md_table(DOMAIN_HEAD, domain_rows())}

The exporter finds every input through a representation, so a concept that loses its representation fails the export.
Instance links stay in the knowledge graph — {n(F['kg_nodes'])} nodes, {n(F['kg_edges'])} edges — and each edge type is
checked against the governed relationship it instantiates.

## Pages

{chr(10).join(f"- **{p}**" for p in F['enterprise_pages'])}

The app opens on **Ontology**, the governed graph drawn natively. Every enterprise page has an *Ask Cortex* button under its
header with two suggested questions ({F['ask_topics']} grounded topics), and a "built on Snowflake Business Ontology" line.
The server gathers the view's live facts plus the governed definitions and relationships of the concepts on screen and asks
`AI_COMPLETE` (default `claude-opus-5-5`, override with `CORTEX_MODEL`) for a markdown analysis,
run as a background job the client polls every 2 s (`POST`/`GET /api/ask-cortex`). The public build ships the default
analysis baked at build time.

## Build

```bash
# Snowflake layer (US is the source of truth): 01..08 (07 = class views the Business Ontology represents,
# 08 = agent ontology search; US only)
for f in sql/enterprise/0*.sql; do snow sql -c dfreriksdemo -f "$f"; done
python3 tools/export_business_ontology.py            # governed graph -> data/ent_business_ontology.json
python3 tools/export_enterprise_ontology.py --check  # parity gate: walk representations, compare with the served export
python3 tools/deploy_region.py dfreriks_eu_demo     # and dfreriks_apac_demo — gated on parity with US
# Everything else in one command: export, verify the engine, bake the public site,
# regenerate README, docs and presales kit, then reconcile against Snowflake
npm install && npm run dev                          # the kit's screenshots need the app on :5186
python3 tools/refresh_all.py                        # --check to reconcile only
```

## Scenario modelling

**Scenario Studio** propagates one shock along the governed relationships into all six apps. Apps run at
different scales, so the shock travels as a *share* of activity and each app applies it to its own baseline.

{md_table(["Preset", "Headline", "Apps that move"], scenario_rows())}

## Impact, risk and mitigation

The scenario pages are tabs: **Studio / Impact Map / Mitigation & Recovery**. **Impact Map** plays the ripple hop by hop
on a world map and a five-column topology (suppliers → plants → customers → legal entities → apps). **Mitigation &
Recovery** runs the levers — stock on hand, reroutes to plants that make the category within their free hours, payables,
POs, collections, plus labelled assumptions — and plays the recovery step by step: red marks a lane being replaced,
dashed green its reroute. The risk outcome (each app graded against its own base, time to impact, single points of
failure) is embedded below it.

{md_table(MIT_HEAD, mitigation_rows())}

## SAP BDC lineage

The **BDC Lineage** page traces every SAP BDC data product through the 360 app that curates it into the enterprise
objects that read it, from Snowflake's own dependency graph (`tools/export_lineage.py`).

{md_table(LIN_HEAD, lineage_rows())}

## Management use cases

{md_table(["Role", "Question no single 360 app can answer"], [list(u) for u in USE_CASES])}

## Read this before demoing

{chr(10).join(f"- **{a}** {b}" for a, b in caveats())}

More: [`docs/enterprise`](docs/enterprise).

*History:* until November 2026 the model lived in app-owned tables (`CORE.ONT_CLASS` / `ONT_RELATION_DEF` / `ONT_MODULE`,
seven modules), was browsed on *Master Ontology Model* and *Enterprise Graph* pages, Ask went through Cortex Analyst on
`SEMANTIC.SAP_ENTERPRISE_360`, and the export was `tools/export_enterprise.py`. Those tables, the semantic view and the
agent still exist in Snowflake but the app no longer reads them.
""")

    (docs / "01-concepts.md").write_text(f"""# 1. Concepts

**Why a master ontology.** Each 360 app answers its own domain well and nothing across domains: Spend knows a
supplier's spend, Working Capital its payables, Supply Chain its lots — but none knows they are the same supplier.
The master ontology adds one shared vocabulary and one identity per real-world party.

**Governed, not app-owned.** The vocabulary is the Snowflake Business Ontology on `{BO['account']}`: domain
**{BO['domain']}** with subdomains {', '.join(BO['subdomains'])}. {BO['owned']} concepts are governed there; {BO['reused']}
are reused from the governed **Supply Chain** domain and not redefined: {', '.join(BO['reused_names'])}.

{md_table(DOMAIN_HEAD, domain_rows())}

**Relationships.** {BO['enterprise_relationships']} Enterprise relationships: {REL_TYPES}. Custom verbs:
{', '.join(BO['custom_verbs'])}. Business Ontology allows one custom relationship per concept pair, so money owed to a
supplier is modelled on the invoice — *AP Invoice payable to Supplier*, *AR Invoice owed by Customer*.

**Golden records.** Legal Entity ({F['golden_companies']}), Customer ({F['golden_customers']}), Supplier
({F['golden_suppliers']}) and Department ({F['golden_departments']}). Each app's local record is a *Local Customer* /
*Local Supplier* linked by *same as*, carrying its match method.

**Representations.** {BO['representations']} links from concepts to the Snowflake objects that implement them (golden and
member tables, 360 dynamic tables, class views). {', '.join(BO['unrepresented'])} have none: abstract, or no source object.

**Instances.** Concepts are governed; their instances and links stay in `CORE.KG_NODE` / `KG_EDGE`
({n(F['kg_nodes'])} nodes, {n(F['kg_edges'])} edges), each edge type tied to the governed relationship it instantiates.

## Agent ontology search

{AG_LEAD}

Before and after, {AG['checks']} checks run {AG['run_date']}:

{md_table(AG_HEAD, agent_rows())}

{AG['note']} The app shows the same comparison on *Snowflake Ontology Details*.

*History:* the first version modelled 32 classes and 17 relations in seven modules in app-owned `ONT_*` tables
(`owesTo` was a relation then). Those tables remain in Snowflake but are no longer the model.
""")

    (docs / "02-architecture.md").write_text(f"""# 2. Architecture

```
six 360 databases (L2 dynamic tables)
        │
SAP_ENTERPRISE_ONTOLOGY
  CORE       KG_NODE / KG_EDGE (instances), VW_ONT_* class views ({len(BO['new_class_views'])} new for the Business Ontology)
  XWALK      GOLDEN_COMPANY / CUSTOMER / SUPPLIER / DEPARTMENT, *_MEMBER, V_CROSSWALK
  ANALYTICS  DT_COMPANY_360, DT_CUSTOMER_360, DT_SUPPLIER_360   ({F['dynamic_tables']} dynamic tables, 1-day lag)
  SCENARIO   V_GEO, V_FLOW, V_PLANT_CAPACITY, V_PLANT_BUFFER, V_SUBSTITUTION   (from Supply Chain 360 tables)
        │  represented by
Snowflake Business Ontology ({BO['account']})
  {BO['domain']} (+ {', '.join(d.split('.', 1)[1] for d in BO['subdomains'])})   {BO['owned']} concepts
  Supply Chain (governed elsewhere)   {BO['reused']} concepts reused
  {BO['relationships']} relationships, {BO['representations']} representations
        │
tools/export_business_ontology.py  → data/ent_business_ontology.json  (governed snapshot)
tools/export_enterprise_ontology.py → data/enterprise_ontology.json ┐  (inputs found via representations)
tools/export_lineage.py            → data/enterprise_lineage.json  ┴→ Express API (3011) → React (5186)
                                                                     └→ tools/bake_static.py → GitHub Pages
```

**Representations are the wiring.** `tools/ent_ontology.py` reads the governed graph; `export_enterprise_ontology.py`
resolves every input it reads (golden tables, 360 facts, class views) through a concept's representation and records it
in `ontology_source`. `--check` is the parity gate: it rebuilds the export and compares it with the served file.

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
| Core schema | `sql/enterprise/01_core_schema.sql` | DB, schemas, KG tables (the legacy `ONT_*` tables it still creates are not read) |
| Crosswalk | `sql/enterprise/02_crosswalk.sql` | deterministic; same input, same mapping |
| Facts | `sql/enterprise/03_facts.sql` | dynamic tables; lag must be ≥ the 1-day upstream lag |
| Graph | `sql/enterprise/04_kg_load.sql` | truncate-and-reload, idempotent |
| Semantic view + agent | `sql/enterprise/05_semantic_agent.sql` | still deployed; the app no longer uses Cortex Analyst |
| Scenario network | `sql/enterprise/06_scenario_network.sql` | geography, capacity, buffers, capability — Supply Chain 360 tables only |
| Class views | `sql/enterprise/07_business_ontology_views.sql` | {len(BO['new_class_views'])} `VW_ONT_*` views the Business Ontology represents: {', '.join(BO['new_class_views'])} |
| Agent ontology search | `{AG['sql']}` | adds `business_ontology` search, read-only ontology reads and the Analyst warehouse to `{AG['agent']}` (US only); `tools/export_agent_search.py` → `client/src/data/agent_search.json` |
| Governed ontology | Business Ontology on `{BO['account']}` | {BO['domain']} domain + subdomains; reuses Supply Chain concepts |
| Snapshot | `tools/export_business_ontology.py` | → `data/ent_business_ontology.json` ({BO['concepts']} concepts, {BO['relationships']} relationships, {BO['representations']} representations) |
| App export | `tools/export_enterprise_ontology.py [--check]` | every input via representations; `--check` = parity gate vs the served export |
| Regions | `tools/deploy_region.py <connection>` | copies Supply Chain OPS_EXT + ONTOLOGY from US, runs 01–06, **fails unless totals match US** |
| Everything else | `tools/refresh_all.py` | exports, engine checks, public snapshots, docs and kit, then reconciles against Snowflake |

*History:* `tools/export_enterprise.py` was replaced by `tools/export_enterprise_ontology.py`; its first `--check` run was
identical to the old export.

**Business Ontology is private preview and enabled on the US account only.** EU and APAC serve the exported snapshot.

**Why the region script copies operations data rather than regenerating it.** The Supply Chain generator reads two
base tables without `ORDER BY`; another account can return rows in a different order and the seeded draws diverge.
Copying from US keeps every region identical.

## Regions

{md_table(["Region", "Connection", "Parity with US", "Agent", "KG nodes", "Crosswalk", "Spend"],
          [[r['region'], f"`{r['connection']}`", "yes" if r.get('parity') else "NO", "yes" if r.get('agent') else "no",
            n(r.get('kg_nodes', 0)), n(r.get('crosswalk', 0)), money(r.get('spend_usd', 0))] for r in F['regions']])}
""")

    (docs / "05-scenarios-and-use-cases.md").write_text(f"""# 5. Scenario modelling and use cases

## How the engine works

`client/src/lib/entScenario.ts` is pure and deterministic. The page runs it in the browser (so the public build works
without Snowflake); the server imports the same file to give Ask Cortex the identical result.

| Scenario | Path through the ontology | Inputs |
|---|---|---|
| Supplier failure | Supplier → supplies → Plant → ships to → Customer; Plant → owned by → Legal Entity; Legal Entity → buys from → Supplier ← payable to AP Invoice | weeks out, share covered by an alternate source |
| Plant outage | Plant → ships to → Customer; Plant → owned by → Legal Entity; Supplier → supplies → Plant | weeks down |
| Customer default | Legal Entity → sells to → Customer ← owed by AR Invoice; Customer ← ships to Plant | recovery % |
| FX shock | Legal Entity reports in currency | currency, % vs USD |
| Payment terms | AP Invoice → payable to → Supplier → supplies → Plant | days later to pay, days sooner to collect |
| Workforce | Legal Entity → employs → Employee; Legal Entity ← owned by Plant | company, % headcount |

Paths use the governed relationship names; *supplies*, *ships to* and *owned by* are Supply Chain relationships between
reused concepts.

**Shares, not summed dollars.** Supply Chain plant value and margin are weekly rates over the measured order period ({PERIOD});
Finance and Working Capital use their own monthly revenue; Sales uses each customer's CRM pipeline. A lost share of plant
output becomes the same share of the owning company's revenue and of each affected customer's pipeline.

**Cash conversion cycle** under an output shock is measured against a year of turnover: lost sales of x of the year,
with receivables and inventory already held, stretch DSO and DIO by x / (1 − x).

## Presets

{md_table(["Preset", "Question", "Headline"], [[s['label'], s['question'], ' · '.join(f"{h['label']} {hv(h)}" for h in s['headline'])] for s in SC])}

## Use cases

{md_table(["Role", "Question"], [list(u) for u in USE_CASES])}

Each card on the *Management Use Cases* page shows the live answer, the ontology path and a button that opens the page or
runs the scenario, plus its own Ask Cortex.

## Impact, risk and mitigation

`client/src/lib/entImpact.ts` builds on the scenario result, so every figure reconciles to the Studio.

- **Impact Map** — the same propagation as nodes and hops. Plants, suppliers and customers are placed at their Supply Chain 360
  addresses; legal entities at their first plant (an assumption). Timing uses each plant's minimum days of inventory.
- **Risk outcome** (embedded below Mitigation & Recovery; a separate page until November 2026) — each app graded against its own base (Low < 1%, Moderate 1–5%, High 5–15%, Critical ≥ 15%), a
  time-to-impact view, single points of failure (single-source suppliers, sole-maker plants) and a register. Inherent
  and residual risk side by side.
- **Mitigation & Recovery** — levers *from data*: run on stock held, reroute a category only to a plant that has shipped it and
  only within its free work-center hours (a plant fed by the failed supplier is excluded), hold payables, pause POs,
  collect overdue receivables. During playback red marks a lane being replaced and dashed green its reroute. Levers that are *assumptions* are labelled: second source, hedge ratio, credit insurance,
  re-sale of freed capacity, plant-facing share of a headcount cut. Re-sold capacity is new margin, never netted
  against a write-off.

{md_table(MIT_HEAD, mitigation_rows())}

`tools/verify_ent_mitigation.ts` checks every preset: protected + residual = at risk, exposure equals the Studio's output
lost, reroutes stay within free hours and capable plants, and mitigation never raises the risk band.
""")
    (docs / "06-bdc-lineage.md").write_text(f"""# 6. SAP BDC lineage

The enterprise ontology never reads an SAP BDC data product directly. Each product flows into the 360 app that curates it
(L0 data product → L1 `SAP_BDC_L1` → L2 gold), and the enterprise layer reads those gold objects. The *BDC Lineage* page,
and this table, come from `tools/export_lineage.py`, which parses `sql/enterprise/*.sql` and walks Snowflake's
`ACCOUNT_USAGE.OBJECT_DEPENDENCIES` to each terminal source (traced {LIN['generated_at'][:10]}).

{md_table(LIN_HEAD, lineage_rows())}

{chr(10).join(f"- {v}" for v in LIN['notes'].values())}
""")
    (docs / "04-limits.md").write_text("# 4. Limits and caveats\n\n" + "\n\n".join(f"**{a}** {b}" for a, b in caveats()) + f"""

**Mitigation is planning grade.** Hours per unit are blended across a plant's work centers; reroutes do not model freight or
qualification cost. Levers marked *your assumption* are inputs, not findings.

**Ask Cortex** answers from the facts of the view on screen plus the governed definitions and relationships; it does not
run new SQL. The app no longer offers a text-to-SQL path. The public build has no Snowflake connection: it shows the baked
default analysis only.

**Business Ontology coverage.** {', '.join(BO['unrepresented'])} have no representation, so nothing in the app reads them
directly. Business Ontology allows one custom relationship per concept pair.
""")
    print("wrote README.md and docs/enterprise/01-06")


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
    d = new_doc("SAP Enterprise Ontology — Start Here", "Presales kit: a governed Snowflake Business Ontology across six SAP BDC 360 apps")
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
        ["slides", "00_Presales_Overview.pptx, SAP_Enterprise_Ontology_Demo.pptx (one slide per page)"],
        ["the narrated walkthrough", "SAP_Enterprise_Ontology_Walkthrough.mp4 (4 min 38, on Snowflake Business Ontology, including the agent searching it; "
                                     "script in tools/video/segments.py)"],
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
    for t in [f"One governed ontology in Snowflake Business Ontology: {BO['owned']} concepts in the {BO['domain']} domain and "
              f"{len(BO['subdomains'])} subdomains, plus {BO['reused']} reused from Supply Chain; {BO['enterprise_relationships']} "
              f"relationships and {BO['representations']} representations to the objects behind them.",
              f"Golden records: {F['golden_companies']} legal entities, {F['golden_customers']} customers, "
              f"{F['golden_suppliers']} suppliers, {F['golden_departments']} departments, resolving {n(F['crosswalk_records'])} app records.",
              f"A knowledge graph of {n(F['kg_nodes'])} nodes and {n(F['kg_edges'])} edges with {F['dangling_edges']} dangling edges.",
              "Cross-app 360 facts deployed identically in US, EU and APAC (Business Ontology itself: US only, private preview).",
              f"Lineage from {LIN['counts']['bdcProducts']} SAP BDC data products through the 360 apps into the ontology.",
              "Scenario modelling that maps the ripple, grades the risk per app and plans the mitigation.",
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
    h2(d, "Scenario modelling: one shock, six apps")
    table(d, ["Scenario", "Headline", "Apps"], scenario_rows(), [2.1, 3.6, 1.2])
    h2(d, "Impact, risk and mitigation")
    body(d, "Every preset traced through the ontology, graded per app and mitigated with levers from Supply Chain 360 data.")
    table(d, MIT_HEAD, mitigation_rows(), [1.6, 0.8, 1.2, 0.9, 1.1, 1.3])
    h2(d, "Where the data comes from")
    table(d, LIN_HEAD, lineage_rows(), [1.5, 2.0, 0.9, 2.5])
    h2(d, "Proof it is right")
    table(d, ["Metric", "Source app", "App total", "Enterprise total"],
          [[r["metric"], r["app"], n(r["source"]), n(r["enterprise"])] for r in F["reconciliation"]],
          [2.0, 1.7, 1.6, 1.6], align_right=(2, 3))
    h2(d, "Caveats")
    caveat_block(d)
    return d


PERSONAS = [
    ("CFO", "Where is cash and margin leaking across entities?", [
        ("Executive Dashboard", "Legal entities across every app: revenue, margin, CCC, headcount, spend, OTIF in one table."),
        ("Mitigation & Recovery", "One shock graded per app against its own base (risk outcome below the plan); inherent versus residual."),
        ("Ask Cortex (companies)", "“Rank the companies on cash conversion and OTIF together.”"),
        ("Supplier 360", "Open payables next to spend and risk — where early-pay discounts are lost."),
    ]),
    ("CPO / Procurement", "Which suppliers carry risk the spend view cannot see?", [
        ("Supplier 360", "Spend, open AP and deviating lots side by side; open the top supplier."),
        ("Quality exposure", "Customer orders containing that supplier's deviating lots."),
        ("Ask Cortex (supplier)", "“Should we pay this supplier early, hold, or dual-source?”"),
    ]),
    ("COO / Supply Chain", "Which customers feel our operational problems?", [
        ("Impact Map", "Top supplier fails: play the ripple — plants by day of stock-out, then customers, entities, apps."),
        ("Mitigation & Recovery", "Run on stock, reroute where a plant can make it; show what stays exposed and why."),
        ("Customer 360", "Late-delivery cost ranked; open a customer that is also overdue on AR."),
        ("Ontology", "Plant, Supplier and Customer reused from Supply Chain; ships to and supplies are its relationships."),
        ("Ask Cortex (customer)", "“Is this account healthy across finance, sales and delivery?”"),
    ]),
    ("CIO / Data leader", "How is this governed and how does it scale?", [
        ("Ontology", "The governed Enterprise domain and subdomains, Supply Chain concepts reused, each with its representations."),
        ("Snowflake Ontology Details", "The same graph in Snowsight: definitions, representations and the audit trail."),
        ("BDC Lineage", "Every SAP BDC data product traced through the 360 apps into the ontology, with provenance."),
        ("Golden-Record Crosswalk", "Every local record and its match method — nothing hidden."),
    ]),
    ("CHRO", "Is headcount where the revenue and the problems are?", [
        ("Executive Dashboard", "Headcount and revenue per employee per entity, next to OTIF."),
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
        "Ontology — the governed Enterprise graph; click Supplier to show it is reused from Supply Chain, with representations.",
        "Executive Dashboard — the eight numbers, then the legal-entity table (point at the US OTIF).",
        "Management Use Cases — pick the question your audience owns; run it.",
        "Scenario Studio — top supplier fails for 8 weeks: path, per-app effects, ranked customers.",
        "Impact Map, then Mitigation & Recovery — play the ripple, then the recovery (red lane replaced, dashed green reroute); land on what cannot be mitigated.",
        "Supplier 360 — open the top-spend supplier: spend, AP, lots and the crosswalk members in one record.",
        "Ask Cortex on that supplier — a recommendation that cites Spend, Working Capital and Supply Chain.",
        "Customer 360 — the customers that are both overdue and late.",
        "Golden-Record Crosswalk — show the match methods; say plainly it is a demo crosswalk.",
        "Ask Cortex — ask one open cross-app question live.",
    ], 1):
        body(d, f"{i}. {t}")
    h2(d, "Scenario beats (Scenario Studio)")
    table(d, ["Preset", "Say"], [[x["label"], x["summary"]] for x in SC], [2.1, 4.8])
    h2(d, "Use cases to open with")
    for role, q in USE_CASES[:5]:
        bullet(d, f"**{role}** — {q}")
    h2(d, "Questions that land")
    for q in ["Which suppliers have the highest open payables and how much spend do they have?",
              "Which customers have overdue receivables and late-delivery cost at the same time?",
              "Which company has the best revenue per employee and how does its cash conversion cycle compare?"]:
        bullet(d, q)
    h2(d, "Objections")
    table(d, ["They say", "You say"], [
        ["“The customer matching is fake.”", "It is a demo crosswalk and labelled as such on every page. The ontology, graph and facts "
         "are built to take MDG or match-merge output in its place — swap XWALK, nothing else changes."],
        ["“Who owns the definitions?”", "Snowflake Business Ontology: governed domains with review and history. Enterprise reuses "
         "the Supply Chain domain's Supplier, Customer and Plant instead of redefining them."],
        ["“Will the agent make things up?”", "It searches the governed ontology first, cites domain.concept, labels each "
         "number Governed, Derived or Bound table, and says so when no governed definition exists — e.g. supplier spend "
         "is not yet a governed concept. US only."],
        ["“We already have a data warehouse.”", "The warehouse has tables; the ontology adds shared meaning and identity, "
         "which is what lets Cortex answer across domains without hand-written joins."],
        ["“Is it real-time?”", "The facts are dynamic tables on a one-day lag, matching the upstream 360 apps."],
        ["“Does it work outside the US?”", "Deployed in US, EU and APAC with a parity check against US."],
        ["“Is the mitigation real?”", "Reroutes, stock cover and capacity come from Supply Chain 360 data and are checked by a test "
         "harness; anything you set yourself is labelled as an assumption on screen."],
        ["“Where does the data come from?”", "Open BDC Lineage: each SAP BDC data product, the 360 object that curates it and "
         "the enterprise object that reads it, with honest labels for what is demo enrichment."],
    ], [2.2, 4.7])
    h2(d, "Caveats to state")
    caveat_block(d)
    return d


def doc_architecture():
    d = new_doc("Architecture and Install", "The layers, why they are shaped this way, and how to stand them up")
    h2(d, "Schemas")
    table(d, ["Schema", "Holds"], [
        ["CORE", f"KG_NODE / KG_EDGE (instances); VW_ONT_* class views ({len(BO['new_class_views'])} added for the Business Ontology) and exposure views"],
        ["XWALK", "GOLDEN_COMPANY / CUSTOMER / SUPPLIER / DEPARTMENT, *_MEMBER tables, V_CROSSWALK"],
        ["ANALYTICS", f"DT_COMPANY_360, DT_CUSTOMER_360, DT_SUPPLIER_360 ({F['dynamic_tables']} dynamic tables)"],
        ["SCENARIO", f"V_GEO, V_FLOW, V_PLANT_CAPACITY, V_PLANT_BUFFER, V_SUBSTITUTION ({F['scenario_views']} views over Supply Chain 360)"],
        ["Business Ontology", f"{BO['domain']} + {len(BO['subdomains'])} subdomains on {BO['account']}; Supply Chain concepts reused"],
        ["SEMANTIC / AGENTS", "SAP_ENTERPRISE_360 and SAP_ENTERPRISE_ANALYST still deployed; the app does not call them. "
         "The agent now searches the Business Ontology (US only)"],
    ], [1.6, 5.3])
    h2(d, "Governed domains")
    table(d, DOMAIN_HEAD, domain_rows(), [1.9, 0.9, 4.1])
    body(d, f"{BO['enterprise_relationships']} Enterprise relationships ({REL_TYPES}); {BO['representations']} representations. "
            f"No representation: {', '.join(BO['unrepresented'])}.", size=9, color=GREY)
    h2(d, "Agent ontology search")
    body(d, AG_LEAD.replace("`", ""))
    table(d, AG_HEAD, agent_rows(), [2.6, 4.3], zebra=True)
    body(d, AG["note"] + f" Spec: {AG['sql']}.", size=9, color=GREY)
    h2(d, "Design rules")
    for t in ["The model is governed in Snowflake Business Ontology; the app reads it, never defines it.",
              "Reuse governed concepts from other domains (Supply Chain) instead of redefining them.",
              "Every input is found through a representation; export_enterprise_ontology.py --check is the parity gate.",
              "Aggregate each source to the golden id before joining — amounts cannot multiply.",
              "The graph holds identities and relationships; transactions stay in the source apps.",
              "Every golden link keeps its match method, so provenance is visible to users and to Cortex.",
              "Ask Cortex is grounded: the server sends the view's facts and governed definitions to AI_COMPLETE and asks it not to invent numbers."]:
        bullet(d, t)
    h2(d, "Install")
    table(d, ["Step", "Run"], [
        ["1. Snowflake layer", "sql/enterprise/01..08 on the US account (07 = class views, 08 = agent ontology search)"],
        ["2. Governed ontology", "Enterprise domain + subdomains in Business Ontology; export_business_ontology.py, then export_enterprise_ontology.py --check"],
        ["3. Regions", "python3 tools/deploy_region.py dfreriks_eu_demo (and dfreriks_apac_demo)"],
        ["4. App", "npm install && npm run dev — server 3011, client 5186"],
        ["5. Data, public build, kit", "python3 tools/refresh_all.py — exports, checks the engine, bakes, reconciles"],
        ["6. Publish", "push to main; GitHub Actions publishes the public site"],
    ], [1.8, 5.1])
    return d


def doc_access():
    d = new_doc("Setup and Access", "Where everything lives and how to reach it")
    table(d, ["Thing", "Where"], [
        ["Repository", F["repo"]], ["Public site (no login)", F["site"]], ["Local app", f"{F['app_url']} ({F['ports']})"],
        ["Business Ontology", f"{BO['domain']} domain on {BO['account']} — {BO['snowsight_url']}"],
        ["Database (instances)", F["database"]],
    ], [2.0, 4.9])
    h2(d, "Regions")
    table(d, ["Region", "Connection", "Parity", "Agent", "KG nodes", "Crosswalk"],
          [[r["region"], r["connection"], "yes" if r.get("parity") else "NO", "yes" if r.get("agent") else "no",
            n(r.get("kg_nodes", 0)), n(r.get("crosswalk", 0))] for r in F["regions"]], [0.9, 1.9, 0.9, 0.8, 1.2, 1.2])
    h2(d, "Access")
    body(d, "The public site needs nothing. The live app needs a Snowflake key-pair connection with read access to the "
            "six 360 databases and SAP_ENTERPRISE_ONTOLOGY, and READ on the Enterprise and Supply Chain ontology domains; "
            "set it in server/.env (see server/.env.example). Business Ontology is private preview, US account only.")
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

# SAP Enterprise Ontology

A **master ontology over six SAP BDC 360 applications** — Finance, Sales, People, Spend, Working Capital and
Supply Chain. Golden legal entities, customers and suppliers conform each app's local records, so one question
can cross all six apps in a single traversal — and one shock can be traced, graded and mitigated across all six.

- **Live app:** React + Express, `npm run dev` (server 3011, client 5186)
- **Public build (no Snowflake needed):** https://sfc-gh-dfreriks.github.io/enterprise-ontology/
- **Ontology:** Snowflake Business Ontology on `MSB89522` — governed domain **Enterprise** with subdomains
  Finance, People, Sales, Spend, Working Capital, reusing 8 concepts of the governed
  **Supply Chain** domain
- **Instance data:** `SAP_ENTERPRISE_ONTOLOGY` — crosswalk, knowledge graph (`CORE.KG_NODE` / `KG_EDGE`), 360 facts, scenario network

## In numbers

| Measure | Value |
|---|---|
| 27 governed concepts, 28 relationships | Snowflake Business Ontology: 19 owned by Enterprise, 8 reused from Supply Chain; 52 representations |
| 1,928 nodes / 3,790 edges | knowledge graph, 0 dangling edges |
| 474 records → 48 golden | 20 customers, 25 suppliers and 3 legal entities conformed across apps |
| 8 customers in 4 apps | Finance, Sales, Working Capital and Supply Chain see the same account |
| $44.37M | revenue across 3 legal entities (Finance 360, USD) |
| 64.8% OTIF | US Operations — the weakest entity; $3.62M late cost |
| 6 SAP BDC data products | traced through the six 360 apps into the ontology (27 app objects read) |
| 55% protected | of $15.89M at risk when the top supplier fails — the rest cannot be rerouted |

## Legal entities across every app

| Company | Revenue | Net margin | DSO / DPO / CCC | Headcount | Spend | OTIF | Late cost |
|---|---|---|---|---|---|---|---|
| US Operations | $14.96M | 25.3% | 46.1 / 46.8 / 54.9 | 444 | $1.57M | 64.8% | $3.62M |
| Japan Operations | $14.89M | 24.0% | 45.1 / 41.7 / 66.0 | 403 | $1.56M | 85.9% | $362K |
| EU Operations | $14.52M | 22.9% | 47.7 / 43.6 / 56.6 | 445 | $1.52M | 82.3% | $423K |

## Governed ontology

The model is no longer app-owned tables: it is the **Snowflake Business Ontology**. 19 concepts are governed in
Enterprise and its subdomains; 8 (Component Lot, Customer, Material Flow, Party, Plant, Sales Order, Supplier, Transaction) are reused from Supply Chain, not
redefined. 28 Enterprise relationships (15 IS_A, 13 CUSTOM; custom verbs: buys from, employs, funded by, in category, in department, member of, owed by, owned by, payable to, same as, sells to, supplies component),
36 in the snapshot including Supply Chain's own between reused concepts. 52
representations link concepts to the Snowflake objects that implement them, including 7 class views
(`sql/enterprise/07_business_ontology_views.sql`). Material, Product, Sales Org, Transaction have no representation (abstract, or no
source object).

| Governed domain | Concepts | Names |
|---|---|---|
| Enterprise | 7 | Department, Legal Entity, Local Customer, Local Supplier, Material, Org Unit, Product |
| Enterprise.Finance | 4 | Cost Center, GL Account, Journal Entry, Profit Center |
| Enterprise.People | 1 | Employee |
| Enterprise.Sales | 3 | Opportunity, Sales Org, Sellable Product |
| Enterprise.Spend | 2 | Purchase Order, Spend Category |
| Enterprise.Working Capital | 2 | AP Invoice, AR Invoice |
| Supply Chain | 8 | Component Lot, Customer, Material Flow, Party, Plant, Sales Order, Supplier, Transaction |

The exporter finds every input through a representation, so a concept that loses its representation fails the export.
Instance links stay in the knowledge graph — 1,928 nodes, 3,790 edges — and each edge type is
checked against the governed relationship it instantiates.

## Pages

- **Ontology**
- **Executive Dashboard**
- **Snowflake Ontology Details**
- **Ask Cortex**
- **Management Use Cases**
- **Scenario Studio**
- **Impact Map**
- **Mitigation & Recovery**
- **Customer 360**
- **Supplier 360**
- **Golden-Record Crosswalk**
- **BDC Lineage**

The app opens on **Ontology**, the governed graph drawn natively. Every enterprise page has an *Ask Cortex* button under its
header with two suggested questions (16 grounded topics), and a "built on Snowflake Business Ontology" line.
The server gathers the view's live facts plus the governed definitions and relationships of the concepts on screen and asks
`AI_COMPLETE` (default `claude-opus-5-5`, override with `CORTEX_MODEL`) for a markdown analysis,
run as a background job the client polls every 2 s (`POST`/`GET /api/ask-cortex`). The public build ships the default
analysis baked at build time.

## Build

```bash
# Snowflake layer (US is the source of truth): 01..07 (07 = class views the Business Ontology represents)
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

| Preset | Headline | Apps that move |
|---|---|---|
| Top-spend supplier fails (8 weeks) | Output value lost $15.89M · Revenue at risk $746K · Pipeline at risk $5.52M | SCM, SAL, FIN, WCP, SPD |
| Festo fails, 50% dual-sourced | Output value lost $17.50M · Revenue at risk $889K · Pipeline at risk $6.10M | SCM, SAL, FIN, WCP, SPD |
| San Jose HQ down 4 weeks | Output value lost $15.35M · Revenue at risk $374K · Pipeline at risk $10.54M | SCM, SAL, FIN, WCP |
| SK Hynix defaults (40% recovery) | Write-off $3.69M · Pipeline lost $4.12M · Order book freed $44.33M | WCP, FIN, SAL, SCM |
| EUR −10% vs USD | Reported revenue $-1.45M · Reported net income $-332K · Spend in USD $-152K | FIN, SPD, PPL |
| Pay 10 days later, collect 5 sooner | Cash released $2.00M · CCC change (days) -15 days · At-risk suppliers squeezed 4 | WCP, SPD, SCM |
| US Operations −5% headcount | Payroll change $-2.60M · Headcount change -22 · Revenue / employee $35K | PPL, FIN, SCM |

## Impact, risk and mitigation

The scenario pages are tabs: **Studio / Impact Map / Mitigation & Recovery**. **Impact Map** plays the ripple hop by hop
on a world map and a five-column topology (suppliers → plants → customers → legal entities → apps). **Mitigation &
Recovery** runs the levers — stock on hand, reroutes to plants that make the category within their free hours, payables,
POs, collections, plus labelled assumptions — and plays the recovery step by step: red marks a lane being replaced,
dashed green its reroute. The risk outcome (each app graded against its own base, time to impact, single points of
failure) is embedded below it.

| Preset | At risk | Protected | Still exposed | Risk | First action |
|---|---|---|---|---|---|
| Top-spend supplier fails (8 weeks) | $15.89M | $8.80M (55%) | $7.09M | Critical → Critical | Build from stock at Austin Fab |
| Festo fails, 50% dual-sourced | $17.50M | $7.96M (45%) | $9.54M | Critical → Critical | Build from stock at Austin Fab |
| San Jose HQ down 4 weeks | $15.35M | $6.70M (44%) | $8.65M | Critical → Critical | Move Inspection Systems from San Jose HQ to Austin Fab |
| SK Hynix defaults (40% recovery) | $3.69M | $0 (0%) | $3.69M | Critical → Critical | Place the freed order book with other customers |
| EUR −10% vs USD | $332K | $166K (50%) | $166K | High → Moderate | Hedge 50% of EUR net income |
| Pay 10 days later, collect 5 sooner | $27.33M | $27.33M (100%) | $0 | Critical → Low | Keep current terms for 6 critical suppliers |
| US Operations −5% headcount | $2.60M | $780K (30%) | $1.82M | Moderate → Moderate | Exempt plant roles at San Jose HQ |

## SAP BDC lineage

The **BDC Lineage** page traces every SAP BDC data product through the 360 app that curates it into the enterprise
objects that read it, from Snowflake's own dependency graph (`tools/export_lineage.py`).

| 360 app | SAP BDC data products | Objects read | Provenance |
|---|---|---|---|
| SAP BDC Finance 360 | Cost Center, Entry View Journal Entry, Supplier Invoice | 4 | Demo enrichment generated in the app build (not in the standard products); SAP BDC data product |
| SAP BDC Sales 360 | Sales Orders — Sales Order | 3 | SAP BDC data product, landed as an L1 table; SAP CRM / Sales Cloud export (no BDC share in this account) |
| SAP BDC People 360 | Core Workforce Data | 1 | SAP BDC data product |
| SAP BDC Spend 360 | Purchase Order | 2 | Demo enrichment generated in the app build (not in the standard products); SAP BDC data product |
| SAP BDC Working Capital 360 | Entry View Journal Entry | 6 | Demo enrichment generated in the app build (not in the standard products); SAP BDC data product |
| SAP BDC Supply Chain 360 | — (BDC-shaped tables) | 11 | BDC-shaped native table following the SAP standard data product; Demo enrichment keyed to SAP master data (no BDC standard product); Supply Chain 360 knowledge graph (SCM customer and supplier identities) |

## Management use cases

| Role | Question no single 360 app can answer |
|---|---|
| CEO / CFO | Which legal entity is weakest across finance, cash, people and delivery? |
| CPO | Which supplier is cheap to buy from but expensive to depend on? |
| COO | If our top supplier stops shipping for eight weeks, who feels it and how much? |
| CPO / COO | What is a second source worth before we pay for it? |
| COO / CFO | What does a four-week outage at our largest plant cost the enterprise? |
| CRO / Credit | Which customers are both late to pay and badly served? |
| CFO / Credit | If our most overdue customer defaults, where does the loss land? |
| Treasurer | How much cash do longer payment terms release, and which critical suppliers pay for it? |
| CFO | What does a weaker euro do to reported results, spend and payroll? |
| CHRO / COO | Where is a headcount reduction safe — and where would it compound a delivery problem? |

## Read this before demoing

- **Demo crosswalk.** The six apps came from different SAP BDC demo tenants and share no customer or supplier keys. Golden records come from a deterministic, rank-based crosswalk; every record carries its match method. In production this is SAP MDG or a match-merge output.
- **Currency.** Money is USD at the Working Capital planning rates (EUR 1.08, JPY 0.0067, USD 1). Sales order value counts USD orders only.
- **Scale between apps.** Sales 360 order values come from the BDC demo tenant and are far larger than the Supply Chain demo orders. Compare within an app, not across.
- **Company mapping.** Supply Chain plants carry company codes 1000/2000/3000; they are mapped to US, EU and Japan Operations by region. On the maps each legal entity sits at its first plant.
- **Private preview.** Snowflake Business Ontology is enabled on the US account only (MSB89522). The EU and APAC copies keep serving the exported snapshot (data/ent_business_ontology.json); their instance data is parity-checked against US, the governed graph is not replicated.
- **Demo enrichment.** Some 360 inputs are demo enrichment or CRM export rather than an SAP BDC data product; BDC Lineage labels each one.
- **Mitigation.** Reroutes, stock cover and capacity come from Supply Chain 360 data and are planning grade. Second source, hedging, insurance and re-sale are labelled assumptions you set.

More: [`docs/enterprise`](docs/enterprise).

*History:* until November 2026 the model lived in app-owned tables (`CORE.ONT_CLASS` / `ONT_RELATION_DEF` / `ONT_MODULE`,
seven modules), was browsed on *Master Ontology Model* and *Enterprise Graph* pages, Ask went through Cortex Analyst on
`SEMANTIC.SAP_ENTERPRISE_360`, and the export was `tools/export_enterprise.py`. Those tables, the semantic view and the
agent still exist in Snowflake but the app no longer reads them.

# SAP Enterprise Ontology

A **master ontology over six SAP BDC 360 applications** — Finance, Sales, People, Spend, Working Capital and
Supply Chain. Golden legal entities, customers and suppliers conform each app's local records, so one question
can cross all six apps in a single traversal — and one shock can be traced, graded and mitigated across all six.

- **Live app:** React + Express, `npm run dev` (server 3011, client 5186)
- **Public build (no Snowflake needed):** https://sfc-gh-dfreriks.github.io/enterprise-ontology/
- **Snowflake:** `SAP_ENTERPRISE_ONTOLOGY` — semantic view `SAP_ENTERPRISE_ONTOLOGY.SEMANTIC.SAP_ENTERPRISE_360`, agent `SAP_ENTERPRISE_ONTOLOGY.AGENTS.SAP_ENTERPRISE_ANALYST`

## In numbers

| Measure | Value |
|---|---|
| 32 classes, 17 relations | one ontology over six 360 apps |
| 1,928 nodes / 3,790 edges | knowledge graph, 0 dangling edges |
| 474 records → 45 golden | 20 customers and 25 suppliers conformed across apps |
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

## Pages

- **Enterprise Overview**
- **Management Use Cases**
- **Enterprise Scenario Studio**
- **Impact Map**
- **Risk Outcome**
- **Mitigation & Recovery**
- **Master Ontology Model**
- **Customer 360**
- **Supplier 360**
- **Golden-Record Crosswalk**
- **Enterprise Graph**
- **BDC Lineage**
- **Ask the Enterprise**

Every enterprise page has **Ask Cortex** (15 grounded topics): the server passes the view's facts to
`AI_COMPLETE`. The public build ships the default analysis baked at build time.

## Build

```bash
# Snowflake layer (US is the source of truth): 01..06
for f in sql/enterprise/0*.sql; do snow sql -c dfreriksdemo -f "$f"; done
python3 tools/deploy_region.py dfreriks_eu_demo     # and dfreriks_apac_demo — gated on parity with US
# Everything else in one command: export, verify the engine, bake the public site,
# regenerate README, docs and presales kit, then reconcile against Snowflake
npm install && npm run dev                          # the kit's screenshots need the app on :5186
python3 tools/refresh_all.py                        # --check to reconcile only
```

## Scenario modelling

The **Enterprise Scenario Studio** propagates one shock through golden-record edges into all six apps. Apps run at
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

Each scenario opens on three more pages. **Impact Map** plays the ripple hop by hop on a world map and a five-column
topology (suppliers → plants → customers → legal entities → apps). **Risk Outcome** grades every app against its own base,
shows when each effect lands and names the single points of failure. **Mitigation & Recovery** runs the levers — stock on
hand, reroutes to plants that make the category within their free hours, payables, POs, collections, plus labelled
assumptions — and plays the recovery step by step.

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
- **Mitigation.** Reroutes, stock cover and capacity come from Supply Chain 360 data and are planning grade. Second source, hedging, insurance and re-sale are labelled assumptions you set.

More: [`docs/enterprise`](docs/enterprise).

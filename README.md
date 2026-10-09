# SAP Enterprise Ontology

A **master ontology over six SAP BDC 360 applications** — Finance, Sales, People, Spend, Working Capital and
Supply Chain — built on the Supply Chain ontology as its baseline. Golden legal entities, customers and
suppliers conform each app's local records, so one question can cross all six apps in a single traversal.

- **Live app:** React + Express, `npm run dev` (server 3011, client 5186)
- **Public build (no Snowflake needed):** https://sfc-gh-dfreriks.github.io/enterprise-ontology/
- **Snowflake:** `SAP_ENTERPRISE_ONTOLOGY` — semantic view `SAP_ENTERPRISE_ONTOLOGY.SEMANTIC.SAP_ENTERPRISE_360`, agent `SAP_ENTERPRISE_ONTOLOGY.AGENTS.SAP_ENTERPRISE_ANALYST`

## In numbers

| Measure | Value |
|---|---|
| 32 classes, 17 relations | one ontology over six 360 apps, Supply Chain ontology as baseline |
| 1,928 nodes / 3,790 edges | knowledge graph, 0 dangling edges |
| 474 records → 45 golden | 20 customers and 25 suppliers conformed across apps |
| 8 customers in 4 apps | Finance, Sales, Working Capital and Supply Chain see the same account |
| $44.37M | revenue across 3 legal entities (Finance 360, USD) |
| 64.8% OTIF | US Operations — the weakest entity; $3.62M late cost |
| $38.73M | customer orders containing Festo AG deviating lots |
| 3 regions, parity | US, EU, APAC each rebuilt and checked against US totals |

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
- **Master Ontology Model**
- **Customer 360**
- **Supplier 360**
- **Golden-Record Crosswalk**
- **Enterprise Graph**
- **Ask the Enterprise**
- The original Supply Chain ontology pages (14) are kept as the *Supply Chain module (baseline)*.

Every enterprise page has **Ask Cortex** (11 grounded topics): the server passes the view's facts to
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
- **Company mapping.** Supply Chain plants carry company codes 1000/2000/3000; they are mapped to US, EU and Japan Operations by region.

More: [`docs/enterprise`](docs/enterprise). The Supply Chain baseline docs remain in [`docs`](docs).

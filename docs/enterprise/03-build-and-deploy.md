# 3. Build and deploy

| Step | Command | Notes |
|---|---|---|
| Core schema | `sql/enterprise/01_core_schema.sql` | DB, schemas, KG tables (the legacy `ONT_*` tables it still creates are not read) |
| Crosswalk | `sql/enterprise/02_crosswalk.sql` | deterministic; same input, same mapping |
| Facts | `sql/enterprise/03_facts.sql` | dynamic tables; lag must be ≥ the 1-day upstream lag |
| Graph | `sql/enterprise/04_kg_load.sql` | truncate-and-reload, idempotent |
| Semantic view + agent | `sql/enterprise/05_semantic_agent.sql` | still deployed; the app no longer uses Cortex Analyst |
| Scenario network | `sql/enterprise/06_scenario_network.sql` | geography, capacity, buffers, capability — Supply Chain 360 tables only |
| Class views | `sql/enterprise/07_business_ontology_views.sql` | 7 `VW_ONT_*` views the Business Ontology represents: VW_ONT_COSTCENTER, VW_ONT_DEPARTMENT, VW_ONT_EMPLOYEE, VW_ONT_LEGALENTITY, VW_ONT_LOCALCUSTOMER, VW_ONT_LOCALSUPPLIER, VW_ONT_SPENDCATEGORY |
| Governed ontology | Business Ontology on `MSB89522` | Enterprise domain + subdomains; reuses Supply Chain concepts |
| Snapshot | `tools/export_business_ontology.py` | → `data/ent_business_ontology.json` (27 concepts, 36 relationships, 52 representations) |
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

| Region | Connection | Parity with US | Agent | KG nodes | Crosswalk | Spend |
|---|---|---|---|---|---|---|
| US | `dfreriksdemo` | yes | yes | 1,928 | 474 | $4.66M |
| EU | `dfreriks_eu_demo` | yes | yes | 1,928 | 474 | $4.66M |
| APAC | `dfreriks_apac_demo` | yes | yes | 1,928 | 474 | $4.66M |

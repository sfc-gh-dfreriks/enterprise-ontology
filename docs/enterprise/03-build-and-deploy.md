# 3. Build and deploy

| Step | Command | Notes |
|---|---|---|
| Core ontology | `sql/enterprise/01_core_schema.sql` | DB, schemas, 32 classes, 17 relations, modules |
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

| Region | Connection | Parity with US | Agent | KG nodes | Crosswalk | Spend |
|---|---|---|---|---|---|---|
| US | `dfreriksdemo` | yes | yes | 1,928 | 474 | $4.66M |
| EU | `dfreriks_eu_demo` | yes | yes | 1,928 | 474 | $4.66M |
| APAC | `dfreriks_apac_demo` | yes | yes | 1,928 | 474 | $4.66M |

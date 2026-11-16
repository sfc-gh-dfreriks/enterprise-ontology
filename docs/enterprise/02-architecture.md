# 2. Architecture

```
six 360 databases (L2 dynamic tables)
        │
SAP_ENTERPRISE_ONTOLOGY
  CORE       KG_NODE / KG_EDGE (instances), VW_ONT_* class views (7 new for the Business Ontology)
  XWALK      GOLDEN_COMPANY / CUSTOMER / SUPPLIER / DEPARTMENT, *_MEMBER, V_CROSSWALK
  ANALYTICS  DT_COMPANY_360, DT_CUSTOMER_360, DT_SUPPLIER_360   (3 dynamic tables, 1-day lag)
  SCENARIO   V_GEO, V_FLOW, V_PLANT_CAPACITY, V_PLANT_BUFFER, V_SUBSTITUTION   (from Supply Chain 360 tables)
        │  represented by
Snowflake Business Ontology (MSB89522)
  Enterprise (+ Finance, People, Sales, Spend, Working Capital)   19 concepts
  Supply Chain (governed elsewhere)   8 concepts reused
  36 relationships, 52 representations
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

| Metric | Source app | App total | Enterprise total |
|---|---|---|---|
| Spend (USD) | Spend 360 | 4,658,904 | 4,658,904 |
| Late-delivery cost (USD) | Supply Chain 360 | 4,404,745 | 4,404,745 |
| Headcount | People 360 | 1,292 | 1,292 |

**Graph holds identity, not transactions.** 1,928 nodes and 3,790 edges: golden and member
records, plants, tools, departments, categories, employees. Transactions stay in the source apps; edge `WEIGHT` carries
the money that makes a link matter (spend, open AP, AR, order value, lots).

**Supplier quality exposure.** `CORE.VW_SUPPLIER_QUALITY_EXPOSURE` walks golden supplier → Supply Chain lots →
serials → orders → golden customer, reduced to one row per (supplier, order) before summing.

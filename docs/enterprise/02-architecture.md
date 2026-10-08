# 2. Architecture

```
six 360 databases (L2 dynamic tables)
        │
SAP_ENTERPRISE_ONTOLOGY
  CORE       ONT_CLASS / ONT_RELATION_DEF / ONT_MODULE, KG_NODE / KG_EDGE, VW_ONT_* views
  XWALK      GOLDEN_COMPANY / CUSTOMER / SUPPLIER / DEPARTMENT, *_MEMBER, V_CROSSWALK
  ANALYTICS  DT_COMPANY_360, DT_CUSTOMER_360, DT_SUPPLIER_360   (3 dynamic tables, 1-day lag)
  SEMANTIC   SAP_ENTERPRISE_360       AGENTS   SAP_ENTERPRISE_ANALYST
        │
tools/export_enterprise.py → data/enterprise_ontology.json → Express API (3011) → React (5186)
                                                          └→ tools/bake_static.py → GitHub Pages
```

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

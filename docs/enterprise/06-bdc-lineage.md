# 6. SAP BDC lineage

The enterprise ontology never reads an SAP BDC data product directly. Each product flows into the 360 app that curates it
(L0 data product → L1 `SAP_BDC_L1` → L2 gold), and the enterprise layer reads those gold objects. The *BDC Lineage* page,
and this table, come from `tools/export_lineage.py`, which parses `sql/enterprise/*.sql` and walks Snowflake's
`ACCOUNT_USAGE.OBJECT_DEPENDENCIES` to each terminal source (traced 2026-10-09).

| 360 app | SAP BDC data products | Objects read | Provenance |
|---|---|---|---|
| SAP BDC Finance 360 | Cost Center, Entry View Journal Entry, Supplier Invoice | 4 | Demo enrichment generated in the app build (not in the standard products); SAP BDC data product |
| SAP BDC Sales 360 | Sales Orders — Sales Order | 3 | SAP BDC data product, landed as an L1 table; SAP CRM / Sales Cloud export (no BDC share in this account) |
| SAP BDC People 360 | Core Workforce Data | 1 | SAP BDC data product |
| SAP BDC Spend 360 | Purchase Order | 2 | Demo enrichment generated in the app build (not in the standard products); SAP BDC data product |
| SAP BDC Working Capital 360 | Entry View Journal Entry | 6 | Demo enrichment generated in the app build (not in the standard products); SAP BDC data product |
| SAP BDC Supply Chain 360 | — (BDC-shaped tables) | 11 | BDC-shaped native table following the SAP standard data product; Demo enrichment keyed to SAP master data (no BDC standard product); Supply Chain 360 knowledge graph (SCM customer and supplier identities) |

- The SAP_BDC_* databases hold SAP BDC standard data product content. In this demo account they are standard databases rather than catalog-linked BDC Connect shares; the 360 apps read them through SAP_BDC_L1 passthrough views exactly as they would a share.
- Rows marked 'declared' are data loads Snowflake keeps no dependency record for (a table landed from a data product); every other hop is read from OBJECT_DEPENDENCIES.
- Supply Chain 360's L0 objects are BDC-shaped native tables, and its operations objects (OPS_EXT) are demo enrichment. Its knowledge graph supplies the Supply Chain customer and supplier identities that seed the golden-record crosswalk.
- Sales CRM opportunities and customers come from a CRM / Sales Cloud export, not a BDC share.

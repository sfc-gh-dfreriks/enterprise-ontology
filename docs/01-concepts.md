# 1. Concepts

What an ontology is in this context, and why the SAP BDC catalog is a reasonable
place to build one.

---

## The problem this addresses

A supply chain does not live in one system. The material master sits in
S/4HANA, the supplier profile in Ariba, the sensor feed and the risk score
outside SAP entirely. Each system names the same real-world object differently,
and nothing in any of them declares how they relate.

The usual response is to hard-code joins in each report. That works until
someone asks a question nobody anticipated, at which point the relationships
have to be rediscovered from column names and tribal knowledge.

An ontology inverts this: **the relationships become data**, queryable in the
same way the rows are.

---

## Why SAP BDC is a good starting point

SAP Business Data Cloud publishes the supply chain as **data products**. Each
one is a set of CDS entities carrying declared associations and semantic
annotations. That declaration is the raw material for an ontology — the
relationships are already in the metadata, not reverse-engineered.

Three layers matter here:

| Layer | What it is | Count in this slice |
|---|---|---|
**Business process** | SAP's end-to-end value chain (Design to Operate, Source to Pay, Lead to Cash) | 3 |
**Data product** | A governed publication unit, e.g. Bill of Material | 36 |
**CDS entity** | A view inside a product, e.g. `BillOfMaterialItem` | 338 |

Entities associate with one another (281 associations here), and products link
to one another through shared master data.

---

## Semantic roles

Every CDS entity carries annotations that say what it is *for*, not merely what
it contains. Classifying on those annotations gives each entity a role:

| Role | Meaning | Entities |
|---|---|---|
`dimension` | A business object you slice by | 115 |
`other` | No role annotation present | 101 |
`text` | Language-dependent descriptions | 87 |
`fact` | Measures and transactional cubes | 35 |

This is the difference between a catalog and an ontology. A catalog tells you
`BillOfMaterialItem` exists. The roles tell you it is a fact table, which is
what makes automated semantic-model generation possible.

That `other` bucket is 30% of entities and is not noise to be ignored — it is a
concrete measure of how much of the catalog carries no usable role annotation.

---

## The ODM overlay

Data products also reference **canonical objects** from SAP's One Domain Model:
shared master-data concepts that several products describe from different
angles. Where two products reference the same canonical object, they are
talking about the same real-world thing.

This is the layer at which cross-product linkage exists. In this slice it is
remarkably concentrated — see [findings](05-findings.md).

---

## What this is not

This models **metadata about SAP data products**: which entities exist, how they
are annotated, and how they associate.

It is **not transactional supply chain data**. There are no shipments, inventory
levels, purchase orders or supplier risk scores in here. Questions like "which
supplier is late" cannot be answered by this ontology, and the semantic view
says so explicitly so Cortex Analyst does not try.

For transactional supply chain analytics see
[`sap-bdc-supply-chain-360`](https://github.com/sfc-gh-dfreriks/sap-bdc-supply-chain-360).
For a knowledge graph of actual supply-chain objects — suppliers, shipments,
plants, risk — see
[`supplychain_ontology_agent`](https://github.com/sfc-gh-tjia/supplychain_ontology_agent).
Both are credited in [references](06-references.md).

---

## Scope rule

A data product is in scope when **either**

- its business process is **Design to Operate** — SAP's supply-chain process — **or**
- its line of business names **Supply Chain**, **Manufacturing**,
  **Sourcing and Procurement**, or **R&D Engineering**.

Line of business is a delimited multi-value string such as
`"Manufacturing,Supply Chain"`, so it is matched **per token**. Matching the
whole string would drop every product carrying Supply Chain alongside another
line of business — which is most of the cross-functional ones, and the ones
worth having.

This narrows the parent catalog from 334 products and 2,243 entities to 36 and
338.

The same rule is implemented twice — once for the app's JSON and once for the
Snowflake views — and the deploy script asserts the two agree. See
[architecture](02-architecture.md#one-rule-two-implementations) for why that
check exists.

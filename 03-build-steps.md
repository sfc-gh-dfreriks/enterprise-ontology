# 3. Build steps

The sequence actually followed, in order, with what each step verified. Anyone
reproducing this should get the same numbers at the same checkpoints.

Prerequisites: Node 20+, Python 3.10+, a Snowflake account with the parent
`SAP_BDC_ONTOLOGY.CORE` tables already deployed, and the
[parent explorer](06-references.md#parent-project) checked out as a sibling so
its `ontology_builder` can be imported.

---

## Step 0 — Decide what "ontology" means here

Four foundations were available, and they model different things. The choice
determines everything downstream:

| Option | Models | Cost |
|---|---|---|
BDC catalog slice | metadata about data products | reuses deployed tables |
KG agent stack | supply-chain objects (suppliers, shipments, risk) | full SQL deploy |
Both as two lenses | both | roughly double |
Existing SC 360 semantic view | real SAP transactional data | already deployed |

**Chosen: the BDC catalog slice.** It reuses the parent's `CORE` tables, so no
new base data is deployed, and the ontology is genuinely about how SAP publishes
supply chain rather than about one synthetic dataset.

Worth being explicit that this is a *metadata* ontology — it is the single most
common misunderstanding about the result. See
[concepts](01-concepts.md#what-this-is-not).

---

## Step 1 — Scaffold from the parent explorer

```bash
rsync -a --exclude node_modules --exclude 'data/*.json' \
      --exclude .git --exclude cortex_project \
      sap_bdc_ontology_react/ supply_chain_ontology_react/
```

Then retarget: data path → `sc_ontology.json`, server port → 3009, client port
→ 5179, proxy target, workspace names, page title, sidebar branding.

Three of the parent's tools came along and were deleted:
`deploy_ontology_to_snowflake.py`, `export_ontology.py`, `export_explore.py`.
The first writes to the parent's `CORE` tables — leaving it in a derived project
invites someone to run it from the wrong directory.

**Verify:** `npm run export-data` still succeeds after the deletions, proving
nothing depended on them.

---

## Step 2 — Build the filtered ontology

```bash
npm run export-data      # tools/export_sc_ontology.py
```

Expected:

```
products      36  (of 334)
entities     338  (of 2243)
edges        281  (of 2376)
odm edges     19   pairs 19
scorecard overall: 96

by process:
   Design to Operate      27 products   267 entities
   Source to Pay           7 products    51 entities
   Lead to Cash            2 products    20 entities
```

27 + 7 + 2 = 36 and 267 + 51 + 20 = 338. If those do not add up, the filter and
the rollup disagree.

**The trap:** the exporter must emit `correlation`, `scorecard` and
`insight_apps`, because three pages read them. The first version omitted all
three. Compare the exported keys against the `Ontology` interface in
`server/src/services/ontology.ts` rather than assuming.

---

## Step 3 — Deploy the Snowflake views

```bash
npm run deploy-views     # tools/deploy_sc_views.py
```

This creates six views and then asserts parity against the JSON. All five checks
must read `OK`; the script exits non-zero otherwise.

`V_PRODUCT` projects explicit columns and renames three of them
(`PRODUCT_ENTITY_COUNT`, `PRODUCT_ASSOCIATION_COUNT`, `PRODUCT_CROSS_ASSOC`).
Do this **before** generating the semantic view — retrofitting it means
regenerating the model.

---

## Step 4 — Generate the semantic view

Use the `cortex agent-studio` CLI. Do not hand-edit `.sv.yaml`.

```bash
cortex agent-studio sv-generate --file-path proto.json --out-path response.json
cortex agent-studio sv-write --yaml-content "$(cat model.sv.yaml)" \
  --source-object SAP_BDC_ONTOLOGY.SUPPLY_CHAIN.SUPPLY_CHAIN_ONTOLOGY_MODEL
cortex agent-studio sv-edit --file-path SUPPLY_CHAIN_ONTOLOGY_MODEL.sv.yaml \
  --operations '[{"operation":"add_metric","params":{…}}]'
cortex agent-studio sv-deploy --file-path cortex_project/SUPPLY_CHAIN_ONTOLOGY_MODEL.sv.yaml \
  --fqn SAP_BDC_ONTOLOGY.SUPPLY_CHAIN.SUPPLY_CHAIN_ONTOLOGY_MODEL
```

The proto declares tables, columns, a `semanticDescription`, and nine
representative queries with their questions — those become verified queries.

**Add metrics. Leave numerics as dimensions.** The instinct to promote every
numeric column to a fact is wrong here and produces a model that validates,
deploys, and then fails every query. The full explanation is in
[findings](05-findings.md#the-semantic-view-trap); it cost three rebuilds.

Two things the description must state:

- this is metadata, not transactional data
- `V_ENTITY.PROCESS_CODE` must not join to `V_PROCESS`

**Verify against ground truth**, not just that it deploys:

```sql
SELECT * FROM SEMANTIC_VIEW(
  SAP_BDC_ONTOLOGY.SUPPLY_CHAIN.SUPPLY_CHAIN_ONTOLOGY_MODEL
  DIMENSIONS V_PROCESS.PROCESS_NAME
  METRICS V_PRODUCT.SC_TOTAL_DATA_PRODUCTS, V_PRODUCT.SC_TOTAL_PRODUCT_ENTITIES
) ORDER BY SC_TOTAL_DATA_PRODUCTS DESC;
```

Must return 27/267, 7/51, 2/20 — matching step 2 exactly.

---

## Step 5 — Graph traversal

`server/src/services/traverse.ts` adds undirected adjacency, BFS expansion,
shortest path, and a `topology()` report. Routes: `/api/hubs`,
`/api/traverse`, `/api/path`, `/api/entities`, `/api/topology`.

Design points worth keeping:

- **Associations are undirected.** A BOM item pointing at a material and a
  material pointed at by a BOM item are the same neighbourhood.
- **Seed defaults to the highest-degree entity.** An arbitrary pick in a
  338-node graph usually lands on a leaf with one edge.
- **`limit` caps nodes and BFS order is preserved**, so truncation removes the
  outer ring rather than an arbitrary slice.
- **`crossProduct` is derived from the endpoints' products**, not read from
  `EntityEdge.cross_product` — that flag exists but is never set true, so
  trusting it paints every edge as internal.

Investigating that flag produced the most useful finding in the project. See
[findings](05-findings.md#the-graph-is-not-what-it-looks-like).

---

## Step 6 — Guided demo

`client/src/pages/Demo.tsx` — five steps adapted from the AI309 Summit deck
("Enterprise Supply Chain Ontology Agent"): the problem, the catalog, the
ontology, traversal, the agent.

The deck's argument is kept. The **figures are read live** from `/api/demo`
rather than transcribed from the slides, so the walkthrough cannot quote numbers
that have drifted from the ontology being served.

---

## Step 7 — Public static build

```bash
npm run dev            # in one shell — the baker reads the live API
npm run bake           # 93 snapshots → client/public/data/
npm run build:static
npm run preview:static # http://localhost:8899
```

`VITE_STATIC=1` switches `api.ts` from `/api` to pre-baked JSON. Ask and
shortest path are disabled with on-screen explanations rather than left to fail.

**The filename trap:** the baker first used `urllib.parse.urlencode`, so entity
IDs containing `::` produced filenames with `%3A%3A`. The web server decodes
`%3A` back to `:` on the way in, so every traversal snapshot 404'd. Both sides
now fold unsafe characters to `-` using the identical rule.

**Verify:** fetch a traversal snapshot through the HTTP server, not off disk —
that is the only way to catch this class of bug.

---

## Step 8 — Verify end to end

| Check | Expected |
|---|---|
Endpoints | 18/18 respond without error |
Ask | 10/10 example questions return rows |
Answer correctness | semantic roles sum to 338; processes sum to 36 |
Parity | Snowflake and JSON agree on all five counts |
Builds | both workspaces compile clean |
Static | 93 snapshots served over HTTP |

Endpoints responding is not the same as answers being right. Both were checked
separately, and the Ask check is what exposed the fact bug — the model had
already validated and deployed clean.

---

## Step 9 — the scenario layer

The steps above build the ontology explorer. Disruption scenario modelling was
added afterwards, on a **different data foundation**, and has its own build
sequence:

```bash
npm run deploy-scenario   # SAP_SUPPLY_CHAIN.SCENARIO — 5 views
npm run export-network    # data/sc_network.json — 19 nodes, 27 flows
npm run build-land        # client/public/land.geo.json — once only
npm run verify-scenario   # 20 assertions across all five disruption kinds
```

Full detail, including the propagation model, the optimizer and the visualization
choices, is in [scenario modelling](07-scenario-modelling.md).

Two things to know before starting it:

- The BDC catalog ontology **cannot** model ripple effects — it is metadata about
  data products, with no plants, flows or inventory. Attempting it there is the
  first wrong turn available.
- Run `verify-scenario` before trusting any figure. It caught a unit-rate mismatch
  and a lane closure that silently reported zero exposure, and both looked entirely
  plausible on screen.

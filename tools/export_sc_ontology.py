#!/usr/bin/env python3
"""Build the supply-chain slice of the SAP BDC ontology.

Filters the ontology to supply chain and then re-runs the SAME derivation
functions the parent explorer uses (ontology_builder.process_rollup /
correlation / scorecard / insight_apps / semantic_roles / lens_summary) over
the filtered dict.

Reusing those functions matters: copying the parent's precomputed blocks would
publish 334-product figures inside a 36-product app, and reimplementing them
here would drift from the parent the first time either side changed.

Scope rule
----------
A data product is in scope when either
  * its business process is Design to Operate (D2O, SAP's supply-chain process), or
  * its line of business names Supply Chain / Manufacturing / Sourcing and
    Procurement / R&D Engineering.

LOB is a delimited multi-value string ("Manufacturing,Supply Chain"), so it is
matched per token. Matching the whole string would drop every product that
carries Supply Chain alongside another LOB, which is most of the interesting
cross-functional ones.

Run:  python3 tools/export_sc_ontology.py
Out:  data/sc_ontology.json
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent / "sap_bdc_explorer"
sys.path.insert(0, str(APP))

from utils import ontology_builder as ob  # noqa: E402

IN_SCOPE_PROCESS = {"D2O"}
LOB_TOKENS = ("supply chain", "manufacturing", "sourcing and procurement", "r&d engineering")


def in_scope(p: dict) -> bool:
    if p.get("process") in IN_SCOPE_PROCESS:
        return True
    toks = [t.strip().lower() for t in re.split(r"[,;/|]", p.get("lob") or "") if t.strip()]
    return any(t in LOB_TOKENS for t in toks)


def narrow(ont: dict) -> dict:
    """Return a copy of ont containing only supply-chain products and their graph."""
    products = {k: v for k, v in ont["products"].items() if in_scope(v)}
    keep = set(products)
    entities = {k: v for k, v in ont["entities"].items() if v.get("tech") in keep}
    ekeep = set(entities)

    # Keep an edge only when BOTH endpoints survive. A half-edge renders as a
    # dangling node and would inflate the association counts.
    edges = [e for e in ont["entity_edges"]
             if e["source"] in ekeep and e["target"] in ekeep]
    odm = [e for e in ont["odm_edges"]
           if e["source"] in keep and e["target"] in keep]
    pairs = {k: v for k, v in ont["product_pairs"].items()
             if all(part in keep for part in k.split("||"))}

    present = {p["process"] for p in products.values()}
    sub = dict(ont)
    sub.update({
        "products": products,
        "entities": entities,
        "entity_index": {k: v for k, v in (ont.get("entity_index") or {}).items()
                         if k in ekeep},
        "entity_edges": edges,
        "odm_edges": odm,
        "product_pairs": pairs,
        "processes": [t for t in ont["processes"] if t[0] in present],
        "odm_owner": {k: v for k, v in ont["odm_owner"].items() if v in keep},
    })
    return sub


def main() -> None:
    full = ob.build_ontology()
    ont = narrow(full)

    payload = {
        "domain": "Supply Chain",
        "processes": [{"code": c, "name": n, "color": col} for c, n, col in ont["processes"]],
        "role_label": ont["role_label"],
        "role_color": ont["role_color"],
        "products": ont["products"],
        "entities": ont["entities"],
        "entity_edges": ont["entity_edges"],
        "product_pairs": ont["product_pairs"],
        "odm_owner": ont["odm_owner"],
        "odm_edges": ont["odm_edges"],
        # every block below is re-derived from the filtered dict
        "rollup": ob.process_rollup(ont),
        "correlation": ob.correlation(ont),
        "scorecard": ob.scorecard(ont),
        "insight_apps": ob.insight_apps(ont),
        "semantic_roles": ob.semantic_roles(ont),
        "lens_summary": ob.lens_summary(ont),
        "scope": {
            "rule": "process D2O, or LOB token in: " + ", ".join(LOB_TOKENS),
            "parent_products": len(full["products"]),
            "parent_entities": len(full["entities"]),
        },
    }

    out = HERE.parent / "data" / "sc_ontology.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload))

    print(f"wrote {out}")
    print(f"  products   {len(ont['products']):>5}  (of {len(full['products'])})")
    print(f"  entities   {len(ont['entities']):>5}  (of {len(full['entities'])})")
    print(f"  edges      {len(ont['entity_edges']):>5}  (of {len(full['entity_edges'])})")
    print(f"  odm edges  {len(ont['odm_edges']):>5}   pairs {len(ont['product_pairs'])}")
    print(f"  size       {out.stat().st_size / 1048576:.2f} MB")

    print(f"\n  scorecard overall: {payload['scorecard']['overall']}")
    print("  by process:")
    for r in payload["rollup"]:
        print(f"     {r['name']:34} {r['products']:>3} products  {r['entities']:>4} entities")
    apps = [a for a in payload["insight_apps"] if a.get("products")]
    print(f"\n  insight apps with members: {len(apps)} of {len(payload['insight_apps'])}")
    for a in sorted(apps, key=lambda x: -x["products"]):
        print(f"     {a['name']:34} {a['products']:>3} products  {a.get('entities', 0):>4} entities")
    print("\n  by line of business:")
    for lob, n in Counter(p.get("lob") or "—" for p in ont["products"].values()).most_common():
        print(f"     {lob[:48]:50} {n}")


if __name__ == "__main__":
    main()

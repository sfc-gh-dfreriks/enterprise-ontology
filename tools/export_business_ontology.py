#!/usr/bin/env python3
"""Export the governed Enterprise ontology to data/ent_business_ontology.json.

What the Ontology page and the Ask Cortex explanations show: approved definitions,
typed relationships, representations (concept -> Snowflake object) and change
history, for the Enterprise domain tree plus the Supply Chain concepts it reuses
(see ent_ontology.py). Each node records the domain it is governed in, so the app
can show which concepts Enterprise owns and which it borrows from Supply Chain.

Read-only: only SYSTEM$GET_GLOSSARY_* calls. Exported rather than queried live
because tools/bake_static.py builds a credential-free static site.

Run:  python3 tools/export_business_ontology.py
Out:  data/ent_business_ontology.json
"""
import datetime as dt
import json
import pathlib
import sys
from urllib.parse import quote

import snowflake.connector

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ent_ontology import ROOT_DOMAIN, Ontology, lit  # noqa: E402
from sf_conn import conn_params  # noqa: E402

ACCOUNT_URL = "https://app.snowflake.com/sfsenorthamerica/dfreriks_aws1_w2"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "ent_business_ontology.json"


def sysfn(cur, sql: str) -> dict:
    cur.execute(sql)
    v = json.loads(cur.fetchone()[0])
    if isinstance(v, dict) and v.get("error") not in (None, False):
        raise RuntimeError(f"{sql}: {v.get('error')}")
    return v


def snowsight_url(domain_fqn: str, name: str) -> str:
    return (f"{ACCOUNT_URL}/#/data/business-ontology/domain/{quote(domain_fqn.split('.')[-1])}"
            f"/entity/{quote(name)}")


def main() -> None:
    con = snowflake.connector.connect(**conn_params())
    cur = con.cursor()
    ont = Ontology(cur)
    in_scope = ont.scope
    rels = [r for r in ont.raw_relationships
            if r["sourceTermId"] in in_scope and r["targetTermId"] in in_scope]

    nodes = []
    for tid in sorted(in_scope, key=lambda i: ont.name[i]):
        t = ont.terms[tid]
        d = sysfn(cur, f"SELECT SYSTEM$GET_GLOSSARY_TERM({lit(tid)})")
        h = sysfn(cur, f"SELECT SYSTEM$GET_GLOSSARY_TERM_HISTORY({lit(tid)}, " + lit(json.dumps({"pageSize": 100})) + ")")
        domain = t["fqn"].rsplit(".", 1)[0]
        edges = []
        for r in rels:
            if tid not in (r["sourceTermId"], r["targetTermId"]):
                continue
            out = r["sourceTermId"] == tid
            edges.append({"type": r["relationshipType"], "label": r.get("label") or None,
                          "direction": "out" if out else "in",
                          "node": ont.name[r["targetTermId"] if out else r["sourceTermId"]]})
        reps = [{"object": a["objectName"], "fqn": a["fqn"], "objectType": a["objectType"],
                 "role": a["associationRole"], "validity": a.get("validity")}
                for a in ont.associations if a["termId"] == tid]
        ev = h.get("events") or []
        nodes.append({
            "termId": tid, "name": t["name"], "fqn": t["fqn"], "kind": t["itemKind"],
            "domain": domain, "owner": "Enterprise" if domain.split(".")[0] == ROOT_DOMAIN else "Supply Chain",
            "status": d.get("status"), "description": d.get("description"), "synonyms": d.get("synonyms") or [],
            "appClass": t["name"].replace(" ", ""), "edges": edges, "representations": reps,
            "history": {"events": len(ev), "truncated": bool(h.get("truncated")),
                        "last": max((e["createdOn"] for e in ev), default=None),
                        "changedBy": sorted({e["changedBy"] for e in ev if e.get("changedBy")})},
            "createdOn": d.get("createdOn"), "lastModifiedOn": d.get("lastModifiedOn"),
            "snowsightUrl": snowsight_url(domain, t["name"]),
        })
    con.close()

    by_id = {n["termId"]: n["name"] for n in nodes}
    domains = sorted({n["domain"] for n in nodes})
    out = {
        "domain": ROOT_DOMAIN,
        "domains": domains,
        "account": "MSB89522",
        "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "snowsightUrl": f"{ACCOUNT_URL}/#/data/business-ontology",
        "counts": {"nodes": len(nodes),
                   "owned": sum(n["owner"] == "Enterprise" for n in nodes),
                   "reused": sum(n["owner"] != "Enterprise" for n in nodes),
                   "relationships": len(rels),
                   "representations": sum(len(n["representations"]) for n in nodes)},
        "nodes": nodes,
        "relationships": [{"source": by_id[r["sourceTermId"]], "target": by_id[r["targetTermId"]],
                           "type": r["relationshipType"], "label": r.get("label") or None} for r in rels],
    }
    OUT.write_text(json.dumps(out, indent=1))
    print(f"{OUT.name}: {out['counts']}  domains={domains}")


if __name__ == "__main__":
    main()

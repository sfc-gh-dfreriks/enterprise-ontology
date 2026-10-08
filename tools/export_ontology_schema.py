#!/usr/bin/env python3
"""Export the ontology SCHEMA layer to data/sc_ontology_schema.json.

This is the abstract layer, and it is a different thing from the two artifacts
that already exist:

  data/sc_ontology.json  SAP BDC catalog  — which data products and CDS entities
                                            exist. Metadata about data.
  data/sc_network.json   scenario network — 19 nodes and 27 flows. Instances.
  data/sc_ontology_schema.json (this)     — 15 CLASSES and 11 RELATIONS. The
                                            model those instances conform to.

The distinction matters because the app previously called the BDC catalog "the
ontology". A catalog tells you what data exists; an ontology tells you what
kinds of thing exist and how they relate. Only the latter lets you ask "which
parties are affected" and get suppliers and customers in one answer.

Five abstract classes (Entity, Party, Facility, MaterialFlow, CatalogObject)
have no physical table by design — they are unions over their children. That is
why ONT_CLASS_MAP has 10 rows for 15 classes, and the exporter treats a missing
mapping as expected for an abstract class and a defect for a concrete one.

Exporting rather than querying live is deliberate: tools/bake_static.py builds a
static site for GitHub Pages, so the served app must run with no credentials.

Run:  python3 tools/export_ontology_schema.py
Out:  data/sc_ontology_schema.json
"""
import json
import pathlib
import sys

import snowflake.connector

DB, SC = "SAP_SUPPLY_CHAIN", "ONTOLOGY"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "sc_ontology_schema.json"

# Abstract classes carry no instances of their own; their size in the UI comes
# from the concrete children beneath them.
ABSTRACT_EXPECTED = {"Entity", "Party", "Facility", "MaterialFlow", "CatalogObject"}


def conn_params(name="dfreriksdemo"):
    try:
        import tomllib
    except ModuleNotFoundError:
        import tomli as tomllib
    p = pathlib.Path.home() / ".snowflake" / "connections.toml"
    cfg = tomllib.loads(p.read_text())
    # connections.toml keeps entries at the top level, not under [connections].
    c = dict(cfg.get("connections", cfg)[name])
    if "private_key_path" in c:
        c["private_key_file"] = str(pathlib.Path(c.pop("private_key_path")).expanduser())
    c.setdefault("warehouse", "COMPUTE_WH")
    c["database"], c["schema"] = DB, SC
    return c


def rows(cur, sql: str) -> list[dict]:
    cur.execute(sql)
    cols = [d[0].lower() for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def one_val(cur, sql: str):
    cur.execute(sql)
    return cur.fetchone()[0]


def num(v):
    """Snowflake NUMBER arrives as Decimal, which json cannot serialize."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    return int(f) if f.is_integer() else f


def main() -> int:
    cn = snowflake.connector.connect(**conn_params())
    cur = cn.cursor()

    # ---- classes ---------------------------------------------------------
    classes = rows(cur, """
        SELECT CLASS_NAME, PARENT_CLASS_NAME, IS_ABSTRACT, DESCRIPTION
        FROM ONT_CLASS ORDER BY CLASS_NAME
    """)

    # ---- physical mapping (provenance) -----------------------------------
    # NOTE: ONT_CLASS_MAP records SOURCE_TABLE as KG_NODE with a NODE_TYPE
    # filter, not the originating SAP view. That is correct for the KG path but
    # means this is KG provenance, not SAP provenance. Surfaced as-is rather
    # than invented, so the UI cannot imply a lineage the metadata lacks.
    cmap = {
        r["class_name"]: r
        for r in rows(cur, """
            SELECT CLASS_NAME, SOURCE_DATABASE, SOURCE_SCHEMA, SOURCE_TABLE,
                   FILTER_COL, FILTER_VAL
            FROM ONT_CLASS_MAP
        """)
    }

    # ---- instance counts, straight from the KG ---------------------------
    inst = {
        r["node_type"]: num(r["n"])
        for r in rows(cur, """
            SELECT NODE_TYPE, COUNT(*) AS N FROM KG_NODE
            WHERE NODE_TYPE <> 'OntologyClass' GROUP BY 1
        """)
    }

    # ---- hierarchy stats -------------------------------------------------
    stats = {
        r["class_name"]: r
        for r in rows(cur, """
            SELECT CLASS_NAME, IS_ABSTRACT, DEPTH, DESCENDANTS, DIRECT_INSTANCES
            FROM VW_ONT_HIERARCHY_STATS
        """)
    }

    out_classes = []
    defects = []
    for c in classes:
        name = c["class_name"]
        abstract = bool(c["is_abstract"])
        m = cmap.get(name)
        if abstract and m:
            defects.append(f"{name} is abstract but has a physical mapping")
        if not abstract and not m:
            defects.append(f"{name} is concrete but has no physical mapping")
        st = stats.get(name, {})
        out_classes.append({
            "name": name,
            "parent": c["parent_class_name"],
            "is_abstract": abstract,
            "description": c["description"],
            "depth": num(st.get("depth")),
            "descendants": num(st.get("descendants")),
            "instances": inst.get(name, 0),
            "source": None if not m else {
                "database": m["source_database"],
                "schema": m["source_schema"],
                "table": m["source_table"],
                "filter_col": m["filter_col"],
                "filter_val": m["filter_val"],
            },
        })

    # ---- relations -------------------------------------------------------
    # ONT_RELATION_DEF has no IS_ABSTRACT column, so abstractness of a relation
    # cannot be read directly. A relation is treated as abstract when it has no
    # ONT_REL_MAP row AND no inference rule: nothing stores it and nothing
    # derives it, so it exists only as an umbrella over concrete relations.
    relations = rows(cur, """
        SELECT REL_NAME, DOMAIN_CLASS, RANGE_CLASS, CARDINALITY,
               IS_HIERARCHICAL, IS_TRANSITIVE, INVERSE_REL_NAME, DESCRIPTION
        FROM ONT_RELATION_DEF ORDER BY REL_NAME
    """)
    mapped = {r["rel_name"] for r in rows(cur, "SELECT DISTINCT REL_NAME FROM ONT_REL_MAP")}
    ruled = {
        r["target_rel"]: r
        for r in rows(cur, """
            SELECT r.RULE_ID, r.RULE_KIND, r.TARGET_REL, r.IS_ENABLED,
                   COUNT(e.SRC_ID) AS EDGES
            FROM ONT_RULE r
            LEFT JOIN REL_EDGE_INFERRED e ON e.RULE_ID = r.RULE_ID
            GROUP BY 1, 2, 3, 4
        """)
    }

    out_relations = []
    for r in relations:
        nm = r["rel_name"]
        rule = ruled.get(nm)
        is_stored = nm in mapped
        is_inferred = rule is not None
        out_relations.append({
            "name": nm,
            "domain": r["domain_class"],
            "range": r["range_class"],
            "cardinality": r["cardinality"],
            "is_hierarchical": bool(r["is_hierarchical"]),
            "is_transitive": bool(r["is_transitive"]),
            "inverse": r["inverse_rel_name"],
            "description": r["description"],
            "is_stored": is_stored,
            "is_inferred": is_inferred,
            # neither stored nor derived => umbrella over concrete relations
            "is_abstract": not is_stored and not is_inferred,
            "rule": None if not rule else {
                "id": rule["rule_id"],
                "kind": rule["rule_kind"],
                "enabled": bool(rule["is_enabled"]),
                "edges": num(rule["edges"]),
            },
        })

    # ---- subClassOf edges ------------------------------------------------
    subclass = [
        {"child": r["child_class"], "parent": r["parent_class"]}
        for r in rows(cur, "SELECT CHILD_CLASS, PARENT_CLASS FROM VW_ONT_SUBCLASS_OF")
    ]

    # ---- abstract rollup: the proof that abstraction works ---------------
    # For each abstract view, the concrete type breakdown. VW_ONT_PARTY
    # returning 8 customers and 6 suppliers in one query is the whole point of
    # the layer, so it is exported rather than recomputed in the client.
    rollup = {}
    for cls, view in [("Entity", "VW_ONT_ENTITY"), ("Party", "VW_ONT_PARTY"),
                      ("Facility", "VW_ONT_FACILITY"), ("MaterialFlow", "VW_ONT_MATERIALFLOW"),
                      ("CatalogObject", "VW_ONT_CATALOGOBJECT")]:
        br = rows(cur, f"SELECT ENTITY_TYPE, COUNT(*) AS N FROM {view} GROUP BY 1 ORDER BY 2 DESC")
        rollup[cls] = {
            "view": view,
            "total": sum(num(b["n"]) for b in br),
            "breakdown": [{"type": b["entity_type"], "count": num(b["n"])} for b in br],
        }

    # ---- descendants / ancestors for the traversal panel -----------------
    descendants = [
        {"root": r["root_class"], "descendant": r["descendant_class"],
         "depth": num(r["depth"]), "path": r["path"]}
        for r in rows(cur, "SELECT ROOT_CLASS, DESCENDANT_CLASS, DEPTH, PATH FROM VW_DESCENDANTS")
    ]
    ancestors = [
        {"start": r["start_class"], "ancestor": r["ancestor_class"], "depth": num(r["depth"])}
        for r in rows(cur, "SELECT START_CLASS, ANCESTOR_CLASS, DEPTH FROM VW_ANCESTORS")
    ]

    # ---- properties per class -------------------------------------------
    props: dict[str, list[dict]] = {}
    for r in rows(cur, """
        SELECT CLASS_NAME, PROP_NAME, DATA_TYPE, IS_REQUIRED
        FROM ONT_PROPERTY ORDER BY CLASS_NAME, PROP_NAME
    """):
        props.setdefault(r["class_name"], []).append({
            "name": r["prop_name"],
            "type": r["data_type"],
            "required": bool(r["is_required"]),
        })

    # ---- the deployed stack, L1 to L5 ------------------------------------
    # Read rather than hardcoded: the UI draws this, and a diagram that claims
    # objects exist when they do not is worse than no diagram.
    #
    # Counts come from INFORMATION_SCHEMA, not SHOW. SHOW PROCEDURES reports 43
    # in this schema because it includes built-ins; the real figure is 10.
    def show_names(kind: str) -> list[str]:
        cur.execute(f"SHOW {kind} IN SCHEMA {DB}.{SC}")
        cols = [d[0] for d in cur.description]
        i = cols.index("name")
        return sorted(r[i] for r in cur.fetchall())

    n_views = one_val(cur, f"""
        SELECT COUNT(*) FROM {DB}.INFORMATION_SCHEMA.VIEWS
        WHERE TABLE_SCHEMA = '{SC}'""")
    n_tables = one_val(cur, f"""
        SELECT COUNT(*) FROM {DB}.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '{SC}' AND TABLE_TYPE = 'BASE TABLE'""")
    n_ont_tables = one_val(cur, f"""
        SELECT COUNT(*) FROM {DB}.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '{SC}' AND TABLE_TYPE = 'BASE TABLE'
          AND TABLE_NAME LIKE 'ONT\\_%'""")
    n_procs = one_val(cur, f"""
        SELECT COUNT(*) FROM {DB}.INFORMATION_SCHEMA.PROCEDURES
        WHERE PROCEDURE_SCHEMA = '{SC}'""")
    n_udfs = len(show_names("USER FUNCTIONS"))
    sem_views = show_names("SEMANTIC VIEWS")
    agents = show_names("AGENTS")
    kg_nodes = one_val(cur, "SELECT COUNT(*) FROM KG_NODE")
    kg_edges = one_val(cur, "SELECT COUNT(*) FROM KG_EDGE")

    stack = [
        {"layer": "L1", "name": "Physical",
         "detail": f"KG_NODE {kg_nodes:,} \u00b7 KG_EDGE {kg_edges:,}",
         "note": "instances plus 15 schema nodes for the class hierarchy",
         "objects": n_tables},
        {"layer": "L2", "name": "Metadata",
         "detail": f"{n_ont_tables} ONT_* tables",
         "note": "classes, relations, properties, rules, permissions",
         "objects": n_ont_tables},
        {"layer": "L3", "name": "Abstract views",
         "detail": f"{n_views} views \u00b7 {n_udfs} UDFs \u00b7 {n_procs} procedures",
         "note": "VW_ONT_* span several concrete types in one query",
         "objects": n_views},
        {"layer": "L4", "name": "Semantic",
         "detail": " \u00b7 ".join(sem_views) or "none",
         "note": "base for concrete lookups, ontology for cross-type, metadata for governance",
         "objects": len(sem_views)},
        {"layer": "L5", "name": "Agent",
         "detail": " \u00b7 ".join(agents) or "none",
         "note": "routes a question to the right layer",
         "objects": len(agents)},
    ]

    doc = {
        "ontology": "SUPPLY_CHAIN",
        "source": f"{DB}.{SC}",
        "stack": stack,
        "classes": out_classes,
        "relations": out_relations,
        "subclass_of": subclass,
        "abstract_rollup": rollup,
        "descendants": descendants,
        "ancestors": ancestors,
        "properties": props,
        "counts": {
            "classes": len(out_classes),
            "abstract": sum(1 for c in out_classes if c["is_abstract"]),
            "concrete": sum(1 for c in out_classes if not c["is_abstract"]),
            "relations": len(out_relations),
            "relations_stored": sum(1 for r in out_relations if r["is_stored"]),
            "relations_inferred": sum(1 for r in out_relations if r["is_inferred"]),
            "relations_abstract": sum(1 for r in out_relations if r["is_abstract"]),
            "instances": sum(inst.values()),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2, default=str))
    cn.close()

    c = doc["counts"]
    print(f"  wrote {OUT.relative_to(OUT.parent.parent)}  ({OUT.stat().st_size:,} bytes)")
    print(f"  classes   {c['classes']:>5}  ({c['abstract']} abstract, {c['concrete']} concrete)")
    print(f"  relations {c['relations']:>5}  ({c['relations_stored']} stored, "
          f"{c['relations_inferred']} inferred, {c['relations_abstract']} abstract)")
    print(f"  instances {c['instances']:>5}")
    for cls, rl in doc["abstract_rollup"].items():
        if len(rl["breakdown"]) > 1:
            bits = ", ".join(f"{b['type']} {b['count']}" for b in rl["breakdown"][:4])
            print(f"    {cls:14} {rl['total']:>5} = {bits}")

    if defects:
        print("\n  mapping defects:")
        for d in defects:
            print(f"    - {d}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

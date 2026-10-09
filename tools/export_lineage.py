#!/usr/bin/env python3
"""Export SAP BDC lineage for the enterprise ontology to data/enterprise_lineage.json.

The 360 apps each show their own BDC lineage. The enterprise ontology sits one
layer higher: it reads the 360 apps' curated objects, not the BDC data products
directly. So its lineage is the 360 lineages, cut down to the objects it actually
reads, with the enterprise layer on top. Nothing here is hand-listed except the
hops Snowflake cannot see.

  1. parse sql/enterprise/*.sql      which 360-app objects each enterprise object reads
                                     (the crosswalk tables are CTAS, so Snowflake keeps
                                     no dependency record for them — the SQL is the truth)
  2. OBJECT_DEPENDENCIES             walk each of those upstream to its terminal sources
  3. classify every terminal         BDC data product, BDC-shaped table, CRM export,
                                     demo enrichment, or the Supply Chain knowledge graph
  4. COUNT(*)                        live rows for every object on the page
  5. reconcile                       fail if a module has no source or a count is missing

DECLARED hops are data loads that leave no dependency record (a table landed from a
data product). They are flagged `declared: true` and the page says so.

    python3 tools/export_lineage.py [connection]   (default dfreriksdemo)

ACCOUNT_USAGE.OBJECT_DEPENDENCIES lags by up to three hours, so run this after the
360 apps' objects have been stable for a while, not straight after a redeploy.
"""
import json
import os
import pathlib
import re
import sys
import tomllib
from collections import defaultdict
from datetime import datetime, timezone

import snowflake.connector

ROOT = pathlib.Path(__file__).resolve().parent.parent
SQL_DIR = ROOT / "sql" / "enterprise"
OUT = ROOT / "data" / "enterprise_lineage.json"
ENT = "SAP_ENTERPRISE_ONTOLOGY"

MODULES = {
    "SAP_FINANCE_360": ("FIN", "SAP BDC Finance 360"),
    "SAP_SALES_360": ("SAL", "SAP BDC Sales 360"),
    "SAP_PEOPLE_360": ("PPL", "SAP BDC People 360"),
    "SAP_SPEND_360": ("SPD", "SAP BDC Spend 360"),
    "SAP_WORKING_CAPITAL_360": ("WCP", "SAP BDC Working Capital 360"),
    "SAP_SUPPLY_CHAIN": ("SCM", "SAP BDC Supply Chain 360"),
}

# SAP source system per BDC data product database — matches the 360 apps' own lineage pages.
SAP_SYSTEM = {
    "SAP_BDC_DEMO_ENTRY_VIEW_JOURNAL_ENTRY": "S/4HANA Finance",
    "SAP_BDC_DEMO_SUPPLIER_INVOICE": "S/4HANA Finance",
    "SAP_BDC_DEMO_COST_CENTER": "S/4HANA Finance",
    "SAP_BDC_DEMO_PURCHASE_ORDER": "S/4HANA Procurement",
    "SAP_BDC_DEMO_CORE_WORKFORCE_DATA": "SAP SuccessFactors",
    "SAP_BDC_SALESORDERS_DATA_PRODUCT": "S/4HANA Sales (SD)",
}

# Hops Snowflake has no record of: tables loaded from a data product rather than
# defined over it. (terminal object) -> (upstream BDC object, data product, SAP system)
DECLARED_UPSTREAM = {
    "SAP_SALES_360.SAP_BDC_L1.SALESORDERS_SALESORDER": (
        "SAP_BDC_SALESORDERS_DATA_PRODUCT.SALESORDERS.SALESORDER", "Sales Orders — Sales Order", "S/4HANA Sales (SD)"),
}


def classify(fqn):
    """Provenance of a terminal source, in the 360 apps' own words."""
    db, sc, nm = fqn.split(".")
    if fqn in DECLARED_UPSTREAM:
        return "bdc-landed", "SAP BDC data product, landed as an L1 table"
    if db.startswith("SAP_BDC_"):
        return "bdc", "SAP BDC data product"
    if db == "SAP_SALES_360" and sc == "SAP_BDC_L1":
        return "crm-export", "SAP CRM / Sales Cloud export (no BDC share in this account)"
    if db == "SAP_SUPPLY_CHAIN" and sc == "ONTOLOGY":
        return "kg", "Supply Chain 360 knowledge graph (SCM customer and supplier identities)"
    if db == "SAP_SUPPLY_CHAIN" and sc == "OPS_EXT":
        return "demo", "Demo enrichment keyed to SAP master data (no BDC standard product)"
    if db == "SAP_SUPPLY_CHAIN":
        return "bdc-shaped", "BDC-shaped native table following the SAP standard data product"
    return "demo", "Demo enrichment generated in the app build (not in the standard products)"


def connect(name):
    cfg = tomllib.load(open(os.path.expanduser("~/.snowflake/connections.toml"), "rb"))[name]
    kw = {k: v for k, v in cfg.items() if k in ("account", "user", "role", "warehouse", "authenticator")}
    if cfg.get("private_key_path"):
        kw["private_key_file"] = cfg["private_key_path"]
    return snowflake.connector.connect(**kw)


# ---------------------------------------------------------------- 1. parse the enterprise SQL
CREATE = re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?(DYNAMIC\s+TABLE|SEMANTIC\s+VIEW|TABLE|VIEW|AGENT)"
                    r"\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Z_][A-Z0-9_.]*)", re.I)
INSERT = re.compile(r"INSERT\s+INTO\s+([A-Z_][A-Z0-9_.]*)", re.I)
EXT_REF = re.compile(r"\b(SAP_[A-Z0-9_]+\.[A-Z0-9_]+\.[A-Z0-9_$]+)\b")
ENT_REF = re.compile(r"\b((?:CORE|XWALK|ANALYTICS|SEMANTIC|AGENTS)\.[A-Z0-9_]+)\b")


def parse_enterprise():
    """enterprise object -> (kind, external reads, enterprise reads). Comments are stripped
    first so a table named in a comment is not mistaken for a read."""
    objs = {}
    for f in sorted(SQL_DIR.glob("0*.sql")):
        text = re.sub(r"--[^\n]*", "", f.read_text())
        for stmt in text.split(";"):
            m = CREATE.search(stmt)
            if m:
                kind, target = m.group(1).upper().replace("  ", " "), m.group(2).upper()
                if " LIKE " in stmt.upper():
                    # CREATE TABLE ... LIKE copies a shape, not data — not a lineage edge
                    objs.setdefault(target, {"kind": kind, "ext": set(), "ent": set()})
                    continue
                if target.count(".") == 0:
                    continue  # CREATE DATABASE / SCHEMA name
            else:
                m = INSERT.search(stmt)
                if not m:
                    continue
                kind, target = None, m.group(1).upper()
            target = target.split(".", 1)[1] if target.startswith(ENT + ".") else target
            if target.count(".") != 1:
                continue
            o = objs.setdefault(target, {"kind": kind or "TABLE", "ext": set(), "ent": set()})
            if kind:
                o["kind"] = kind
            body = stmt[m.end():].upper()
            o["ext"] |= {r for r in EXT_REF.findall(body) if not r.startswith(ENT + ".")}
            o["ent"] |= {r for r in ENT_REF.findall(body) if r != target}
    return objs


# ---------------------------------------------------------------- 2. walk upstream
def upstream(cur, seeds):
    """child -> set(parents), over every object reachable upstream of the seeds."""
    values = ",".join(f"('{s}')" for s in sorted(seeds))
    cur.execute(f"""
        WITH RECURSIVE seed(fqn) AS (SELECT column1 FROM VALUES {values}),
        up AS (
          SELECT d.REFERENCING_DATABASE||'.'||d.REFERENCING_SCHEMA||'.'||d.REFERENCING_OBJECT_NAME AS child,
                 d.REFERENCED_DATABASE||'.'||d.REFERENCED_SCHEMA||'.'||d.REFERENCED_OBJECT_NAME AS parent, 1 AS lvl
            FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES d JOIN seed s
              ON s.fqn = d.REFERENCING_DATABASE||'.'||d.REFERENCING_SCHEMA||'.'||d.REFERENCING_OBJECT_NAME
          UNION ALL
          SELECT d.REFERENCING_DATABASE||'.'||d.REFERENCING_SCHEMA||'.'||d.REFERENCING_OBJECT_NAME,
                 d.REFERENCED_DATABASE||'.'||d.REFERENCED_SCHEMA||'.'||d.REFERENCED_OBJECT_NAME, u.lvl + 1
            FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES d JOIN up u
              ON u.parent = d.REFERENCING_DATABASE||'.'||d.REFERENCING_SCHEMA||'.'||d.REFERENCING_OBJECT_NAME
           WHERE u.lvl < 10)
        SELECT DISTINCT child, parent FROM up""")
    g = defaultdict(set)
    for child, parent in cur.fetchall():
        if child != parent:
            g[child].add(parent)
    return g


def terminals(g, node, seen=None):
    """Terminal ancestors of node, each with the path from it down to node."""
    seen = seen or set()
    if node in seen:
        return []
    seen = seen | {node}
    parents = g.get(node, set())
    if not parents:
        return [[node]]
    out = []
    for p in sorted(parents):
        for path in terminals(g, p, seen):
            out.append(path + [node])
    return out


def count_rows(cur, fqns):
    counts = {}
    for f in sorted(fqns):
        try:
            cur.execute(f"SELECT COUNT(*) FROM {f}")
            counts[f] = cur.fetchone()[0]
        except snowflake.connector.errors.ProgrammingError as e:
            print(f"  WARN  could not count {f}: {e.msg}")
            counts[f] = None
    return counts


# ---------------------------------------------------------------- main
def main():
    conn_name = sys.argv[1] if len(sys.argv) > 1 else "dfreriksdemo"
    con = connect(conn_name)
    cur = con.cursor()

    ent = parse_enterprise()
    reads_by_ext = defaultdict(set)          # 360-app object -> enterprise objects that read it
    for target, o in ent.items():
        for r in o["ext"]:
            reads_by_ext[r].add(target)
    ext = set(reads_by_ext)
    print(f"  enterprise layer: {len(ent)} objects reading {len(ext)} 360-app objects")

    g = upstream(cur, ext)

    cur.execute("SHOW DATABASES LIKE 'SAP_BDC%'")
    cols = [c[0] for c in cur.description]
    dp_name = {r[cols.index("name")]: (r[cols.index("comment")] or "").replace("SAP BDC Data Product: ", "").strip()
               for r in cur.fetchall()}

    # one row per (terminal source, 360-app object the enterprise reads)
    rows = {}
    for e in sorted(ext):
        for path in terminals(g, e):
            term = path[0]
            prov, prov_label = classify(term)
            if term in DECLARED_UPSTREAM:
                l0, dp, system = DECLARED_UPSTREAM[term]
                l1 = term
                declared = True
            else:
                l0 = term if prov == "bdc" else None
                l1 = next((p for p in path if p.split(".")[1] == "SAP_BDC_L1"), None)
                tdb = term.split(".")[0]
                dp = dp_name.get(tdb) if prov == "bdc" else None
                system = SAP_SYSTEM.get(tdb) if prov == "bdc" else None
                declared = False
            key = (term, e)
            rows[key] = {
                "module": MODULES[e.split(".")[0]][0], "provenance": prov, "provenanceLabel": prov_label,
                "sapSystem": system, "dataProduct": dp, "source": term, "l0Object": l0, "l1Object": l1,
                "appObject": e, "enterpriseObjects": sorted(reads_by_ext[e]), "path": path, "declared": declared,
            }

    on_page = set()
    for r in rows.values():
        on_page |= {r["source"], r["appObject"]} | ({r["l0Object"]} if r["l0Object"] else set()) \
                   | ({r["l1Object"]} if r["l1Object"] else set())
    ent_fqn = {f"{ENT}.{k}" for k, o in ent.items() if o["kind"] in ("TABLE", "VIEW", "DYNAMIC TABLE")}
    counts = count_rows(cur, on_page | ent_fqn)

    modules = []
    for db, (code, name) in MODULES.items():
        mrows = sorted((r for r in rows.values() if r["module"] == code),
                       key=lambda r: (r["provenance"] not in ("bdc", "bdc-landed"), r["source"], r["appObject"]))
        for r in mrows:
            r["rows"] = counts.get(r["l0Object"] or r["source"])
            r["appRows"] = counts.get(r["appObject"])
        modules.append({"code": code, "name": name, "database": db, "products": mrows,
                        "bdcProducts": sorted({r["dataProduct"] for r in mrows if r["dataProduct"]})})

    enterprise = []
    for k, o in sorted(ent.items()):
        enterprise.append({"object": k, "kind": o["kind"], "rows": counts.get(f"{ENT}.{k}"),
                           "reads360": sorted(o["ext"]), "readsEnterprise": sorted(o["ent"])})

    bdc_dbs = sorted({r["l0Object"].split(".")[0] for r in rows.values() if r["l0Object"]})
    payload = {
        "app": "SAP Enterprise Ontology",
        "database": ENT,
        "connection": conn_name,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sourceSystems": sorted({r["sapSystem"] for r in rows.values() if r["sapSystem"]}),
        "summary": (
            "SAP BDC data products flow into each 360 app's own medallion (L0 data product → L1 curated → L2 "
            "dynamic tables). The enterprise ontology reads those 360 gold objects — never the data products "
            "directly — conforms them to golden legal entities, customers and suppliers, and serves the result "
            "through the enterprise semantic view and the SAP Enterprise Analyst agent."),
        "counts": {"modules": len(MODULES), "bdcProducts": len(bdc_dbs), "appObjects": len(ext),
                   "enterpriseObjects": len(ent), "sources": len({r["source"] for r in rows.values()})},
        "layers": [
            {"name": "SAP Source Systems", "tone": "sap",
             "objects": sorted({r["sapSystem"] for r in rows.values() if r["sapSystem"]})},
            {"name": "L0 — SAP BDC Data Products", "tone": "bronze", "objects": bdc_dbs},
            {"name": "L1 — 360 Curated (SAP_BDC_L1)", "tone": "silver",
             "objects": sorted({r["l1Object"] for r in rows.values() if r["l1Object"]})},
            {"name": "L2 — 360 App Gold (read by the enterprise layer)", "tone": "gold", "objects": sorted(ext)},
            {"name": "Enterprise — Golden Records + 360 Facts", "tone": "ent",
             "objects": [f"{e['object']}" for e in enterprise if e["object"].split(".")[0] in ("XWALK", "ANALYTICS")
                         and e["kind"] in ("TABLE", "DYNAMIC TABLE")]},
            {"name": "AI + Application", "tone": "ai",
             "objects": ["SEMANTIC.SAP_ENTERPRISE_360 (Semantic View)", "AGENTS.SAP_ENTERPRISE_ANALYST (Cortex Agent)",
                         "SAP Enterprise Ontology (React)"]},
        ],
        "modules": modules,
        "enterprise": enterprise,
        "notes": {
            "databases": ("The SAP_BDC_* databases hold SAP BDC standard data product content. In this demo account "
                          "they are standard databases rather than catalog-linked BDC Connect shares; the 360 apps "
                          "read them through SAP_BDC_L1 passthrough views exactly as they would a share."),
            "declared": ("Rows marked 'declared' are data loads Snowflake keeps no dependency record for (a table "
                         "landed from a data product); every other hop is read from OBJECT_DEPENDENCIES."),
            "supply_chain": ("Supply Chain 360's L0 objects are BDC-shaped native tables, and its operations "
                             "objects (OPS_EXT) are demo enrichment. Its knowledge graph supplies the Supply Chain "
                             "customer and supplier identities that seed the golden-record crosswalk."),
            "sales": "Sales CRM opportunities and customers come from a CRM / Sales Cloud export, not a BDC share.",
        },
    }

    # ------------------------------------------------------------ reconcile
    problems = [f"module {m['code']} has no upstream source" for m in modules if not m["products"]]
    problems += [f"no row count for {r['source']}" for m in modules for r in m["products"] if r["rows"] is None]
    if problems:
        for p in problems:
            print(f"  FAIL  {p}")
        sys.exit(1)

    OUT.write_text(json.dumps(payload, indent=1, default=str))
    print(f"wrote {OUT.name}: {payload['counts']['bdcProducts']} BDC data products, "
          f"{payload['counts']['appObjects']} 360 objects, {payload['counts']['enterpriseObjects']} enterprise objects")
    for m in modules:
        print(f"    {m['code']}: {len(m['products'])} chains, BDC products: {', '.join(m['bdcProducts']) or '—'}")
    con.close()


if __name__ == "__main__":
    main()

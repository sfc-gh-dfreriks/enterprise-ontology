#!/usr/bin/env python3
"""Deploy the enterprise master ontology to a regional account (EU / APAC).

US (dfreriksdemo) is the source of truth. A region already holds the six 360
databases but may lack the newer Supply Chain layers the enterprise ontology
reads, so this script brings them across in dependency order:

  1. SAP_SUPPLY_CHAIN.OPS_EXT       - copied from US (the generator reads two base tables
                                      without ORDER BY, so re-running it in another account
                                      can reorder its random draws; copying keeps parity)
  2. SAP_SUPPLY_CHAIN.ANALYTICS     - 06_ops_ext_dynamic_tables.sql
  3. SAP_SUPPLY_CHAIN.ONTOLOGY      - tables copied from US, views replayed from US DDL
  4. SAP_ENTERPRISE_ONTOLOGY        - sql/enterprise/01..05
  5. parity check against US (spend, late cost, headcount, revenue, crosswalk)

    python3 tools/deploy_region.py dfreriks_eu_demo
"""
import os
import pathlib
import sys
import tomllib

import snowflake.connector
from snowflake.connector.pandas_tools import write_pandas

ROOT = pathlib.Path(__file__).resolve().parent.parent
SC360 = pathlib.Path.home() / "Documents/SAP/SAP Skills/sap-bdc-supply-chain-360"
SOURCE = "dfreriksdemo"


def connect(name, **extra):
    cfg = tomllib.load(open(os.path.expanduser("~/.snowflake/connections.toml"), "rb"))[name]
    kw = {k: v for k, v in cfg.items() if k in ("account", "user", "role", "warehouse", "authenticator")}
    if cfg.get("private_key_path"):
        kw["private_key_file"] = cfg["private_key_path"]
    return snowflake.connector.connect(**kw, **extra)


def run_file(con, path):
    print(f"  · {path.name}")
    for _ in con.execute_string(path.read_text()):
        pass


def copy_schema(src, dst, schema, change_tracking=False):
    """Copy SAP_SUPPLY_CHAIN.<schema>: base tables by data, views by DDL (in dependency order)."""
    s, d = src.cursor(), dst.cursor()
    d.execute(f"CREATE SCHEMA IF NOT EXISTS SAP_SUPPLY_CHAIN.{schema}")
    tables = [r[0] for r in s.execute(f"""SELECT TABLE_NAME FROM SAP_SUPPLY_CHAIN.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '{schema}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY 1""").fetchall()]
    for t in tables:
        ddl = s.execute(f"SELECT GET_DDL('TABLE', 'SAP_SUPPLY_CHAIN.{schema}.{t}')").fetchone()[0]
        d.execute(f"USE SCHEMA SAP_SUPPLY_CHAIN.{schema}")
        d.execute(ddl.replace("create or replace TABLE", "CREATE OR REPLACE TABLE", 1))
        df = s.execute(f"SELECT * FROM SAP_SUPPLY_CHAIN.{schema}.{t}").fetch_pandas_all()
        if len(df):
            write_pandas(dst, df, t, database="SAP_SUPPLY_CHAIN", schema=schema, quote_identifiers=True)
        if change_tracking:
            d.execute(f"ALTER TABLE SAP_SUPPLY_CHAIN.{schema}.{t} SET CHANGE_TRACKING = TRUE")
        print(f"  · {schema}.{t}: {len(df)} rows")
    views = [r[0] for r in s.execute(f"""SELECT TABLE_NAME FROM SAP_SUPPLY_CHAIN.INFORMATION_SCHEMA.VIEWS
        WHERE TABLE_SCHEMA = '{schema}' ORDER BY 1""").fetchall()]
    pending = {v: s.execute(f"SELECT GET_DDL('VIEW', 'SAP_SUPPLY_CHAIN.{schema}.{v}')").fetchone()[0] for v in views}
    # Views reference each other; retry until a pass makes no progress.
    d.execute(f"USE SCHEMA SAP_SUPPLY_CHAIN.{schema}")
    while pending:
        done = []
        for v, ddl in pending.items():
            try:
                d.execute(ddl)
                done.append(v)
            except snowflake.connector.errors.ProgrammingError:
                pass
        if not done:
            raise RuntimeError(f"views that would not compile: {sorted(pending)}")
        for v in done:
            pending.pop(v)
    print(f"  · {schema} views: {len(views)}")


PARITY = {
    "spend_usd": "SELECT ROUND(SUM(SPEND_USD)) FROM SAP_ENTERPRISE_ONTOLOGY.ANALYTICS.DT_COMPANY_360",
    "revenue_usd": "SELECT ROUND(SUM(REVENUE_USD)) FROM SAP_ENTERPRISE_ONTOLOGY.ANALYTICS.DT_COMPANY_360",
    "headcount": "SELECT SUM(HEADCOUNT) FROM SAP_ENTERPRISE_ONTOLOGY.ANALYTICS.DT_COMPANY_360",
    "late_cost_usd": "SELECT SUM(LATE_COST_USD) FROM SAP_ENTERPRISE_ONTOLOGY.ANALYTICS.DT_CUSTOMER_360",
    "crosswalk": "SELECT COUNT(*) FROM SAP_ENTERPRISE_ONTOLOGY.XWALK.V_CROSSWALK",
    "kg_nodes": "SELECT COUNT(*) FROM SAP_ENTERPRISE_ONTOLOGY.CORE.KG_NODE",
    "kg_edges": "SELECT COUNT(*) FROM SAP_ENTERPRISE_ONTOLOGY.CORE.KG_EDGE",
    "exposure_usd": "SELECT ROUND(SUM(ORDER_VALUE_USD)) FROM SAP_ENTERPRISE_ONTOLOGY.CORE.VW_SUPPLIER_QUALITY_EXPOSURE",
}


def parity(src, dst):
    bad = []
    for k, q in PARITY.items():
        a, b = src.cursor().execute(q).fetchone()[0], dst.cursor().execute(q).fetchone()[0]
        flag = "ok" if a == b else "DIFF"
        if a != b:
            bad.append(k)
        print(f"  {k:<14} US={a}  region={b}  {flag}")
    return bad


def main():
    region = sys.argv[1]
    src, dst = connect(SOURCE), connect(region)
    dst.cursor().execute("USE WAREHOUSE LOAD_WH")
    print(f"[1] Supply Chain operations data (copied from US) -> {region}")
    copy_schema(src, dst, "OPS_EXT", change_tracking=True)
    print("[2] Supply Chain dynamic tables")
    dst.cursor().execute("CREATE SCHEMA IF NOT EXISTS SAP_SUPPLY_CHAIN.APP_REF")
    run_file(dst, SC360 / "sql/06_ops_ext_dynamic_tables.sql")
    print("[3] Supply Chain ontology (copied from US)")
    copy_schema(src, dst, "ONTOLOGY")
    print("[4] Enterprise ontology")
    for f in sorted((ROOT / "sql/enterprise").glob("0*.sql")):
        run_file(dst, f)
    print("[5] Parity with US")
    bad = parity(src, dst)
    if bad:
        sys.exit(f"parity failed: {bad}")
    print(f"{region}: enterprise ontology deployed and matches US")


if __name__ == "__main__":
    main()

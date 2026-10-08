#!/usr/bin/env python3
"""Create SAP_SUPPLY_CHAIN.SCENARIO — the network and constraint layer that
scenario modelling runs against.

Views only, over the existing SAP_SUPPLY_CHAIN tables. Nothing is copied, so the
scenario engine and the Supply Chain 360 app cannot disagree about the network.

Why a separate schema rather than querying the base tables directly: the base
tables express the network across three shapes (nodes, flows, and a denormalized
geo view) and the constraints across two more (work-center capacity by period,
material stock by plant). The scenario engine needs one flat, stable contract —
19 nodes, 27 flows, one capacity row per plant, one inventory row per plant, and
a substitution matrix. Putting that shaping in SQL keeps it inspectable and
means the server does no joins.

Derived figures are marked as such below. HRS_PER_UNIT in particular is an
approximation and the optimizer must present it as one.

Run:  python3 tools/deploy_scenario_views.py
"""
import pathlib
import sys

import snowflake.connector

DB = "SAP_SUPPLY_CHAIN"
SC = "SCENARIO"

DDL: list[tuple[str, str]] = [

 ("V_NODE", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_NODE AS
  SELECT
    NODE_ID, NODE_NAME, NODE_TYPE, CITY, COUNTRY,
    LATITUDE, LONGITUDE,
    PLANT                                   -- null for suppliers and customers
  FROM {DB}.MANUFACTURING_CODES.A_SUPPLY_CHAIN_NODES
 """),

 # Flows already exist denormalized with geography on both endpoints, which is
 # exactly what the map needs; NODE_ID is joined back on so the graph can key
 # on ids rather than names.
 ("V_FLOW", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_FLOW AS
  SELECT
    f.FLOW_ID, f.FLOW_TYPE, f.MATERIAL_CATEGORY,
    f.MONTHLY_VOLUME, f.MONTHLY_VALUE,
    s.NODE_ID  AS SOURCE_ID, g.SOURCE_NAME, g.SOURCE_TYPE,
    g.SOURCE_CITY, g.SOURCE_COUNTRY, g.SOURCE_LAT, g.SOURCE_LON, g.SOURCE_PLANT,
    t.NODE_ID  AS TARGET_ID, g.TARGET_NAME, g.TARGET_TYPE,
    g.TARGET_CITY, g.TARGET_COUNTRY, g.TARGET_LAT, g.TARGET_LON, g.TARGET_PLANT
  FROM {DB}.ANALYTICS.DT_SUPPLY_CHAIN_GEO g
  JOIN {DB}.MANUFACTURING_CODES.A_SUPPLY_CHAIN_FLOWS f ON f.FLOW_ID = g.FLOW_ID
  LEFT JOIN {DB}.MANUFACTURING_CODES.A_SUPPLY_CHAIN_NODES s ON s.NODE_ID = f.SOURCE_NODE
  LEFT JOIN {DB}.MANUFACTURING_CODES.A_SUPPLY_CHAIN_NODES t ON t.NODE_ID = f.TARGET_NODE
 """),

 # Capacity at the most recent period only. Averaging across 2025 would hide the
 # current position, and a scenario is always evaluated against where the plant
 # stands now.
 #
 # HRS_PER_UNIT is DERIVED: used hours divided by units shipped, blended across
 # every work center and product at the plant. Real routings differ per material,
 # so this is a planning-grade approximation for "can this plant absorb N more
 # units", not a substitute for a routing-level capacity check.
 ("V_PLANT_CAPACITY", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_PLANT_CAPACITY AS
  WITH latest AS (
    SELECT MAX(PERIOD_DATE) AS P FROM {DB}.ANALYTICS.DT_WORK_CENTER_UTILIZATION
  ),
  cap AS (
    SELECT u.PLANT, u.PLANT_NAME,
           COUNT(DISTINCT u.WORK_CENTER)       AS WORK_CENTERS,
           SUM(u.AVAILABLE_CAPACITY_HRS)       AS AVAILABLE_HRS,
           SUM(u.USED_CAPACITY_HRS)            AS USED_HRS
    FROM {DB}.ANALYTICS.DT_WORK_CENTER_UTILIZATION u, latest
    WHERE u.PERIOD_DATE = latest.P
    GROUP BY 1,2
  ),
  shipped AS (
    SELECT SOURCE_PLANT AS PLANT, SUM(MONTHLY_VOLUME) AS UNITS_SHIPPED
    FROM {DB}.ANALYTICS.DT_SUPPLY_CHAIN_GEO
    WHERE FLOW_TYPE IN ('Outbound','Inter-plant')
    GROUP BY 1
  )
  SELECT
    c.PLANT, c.PLANT_NAME, c.WORK_CENTERS,
    c.AVAILABLE_HRS, c.USED_HRS,
    c.AVAILABLE_HRS - c.USED_HRS                                  AS FREE_HRS,
    ROUND(100.0 * c.USED_HRS / NULLIF(c.AVAILABLE_HRS,0), 1)       AS UTILIZATION_PCT,
    ROUND(100.0 * (c.AVAILABLE_HRS - c.USED_HRS)
                / NULLIF(c.AVAILABLE_HRS,0), 1)                    AS HEADROOM_PCT,
    s.UNITS_SHIPPED,
    ROUND(c.USED_HRS / NULLIF(s.UNITS_SHIPPED,0), 2)               AS HRS_PER_UNIT,
    FLOOR((c.AVAILABLE_HRS - c.USED_HRS)
          / NULLIF(c.USED_HRS / NULLIF(s.UNITS_SHIPPED,0), 0))     AS SPARE_UNITS
  FROM cap c LEFT JOIN shipped s ON s.PLANT = c.PLANT
 """),

 # Inventory sets the TIMING of a ripple: a plant cannot be starved faster than
 # its thinnest buffer. MIN is the operative figure, not AVG — one component at
 # 12 days stops the line regardless of another sitting at 400.
 ("V_PLANT_INVENTORY", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_PLANT_INVENTORY AS
  SELECT
    s.PLANT,
    p.PLANT_NAME,
    COUNT(*)                                     AS MATERIALS,
    MIN(s.DAYS_OF_INVENTORY)                     AS MIN_DAYS_OF_INVENTORY,
    ROUND(AVG(s.DAYS_OF_INVENTORY),1)            AS AVG_DAYS_OF_INVENTORY,
    SUM(s.STOCK_VALUE)                           AS STOCK_VALUE,
    COUNT(CASE WHEN s.OBSOLETE_FLAG = 'X' THEN 1 END) AS OBSOLETE_MATERIALS
  FROM {DB}.MANUFACTURING_CODES.A_MATERIAL_STOCK s
  LEFT JOIN (SELECT DISTINCT PLANT, PLANT_NAME FROM {DB}.PLANT.A_PLANT) p
         ON p.PLANT = s.PLANT
  GROUP BY 1,2
 """),

 # Which plants can make a given material category, derived from what they
 # actually ship. Production versions were the obvious source but each material
 # there maps to exactly one plant, so they express no alternatives at all;
 # observed shipments do.
 #
 # A category with one capable plant is genuinely unmitigable by rerouting —
 # that is a finding to surface, not a gap to paper over.
 ("V_SUBSTITUTION", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_SUBSTITUTION AS
  WITH src AS (
    SELECT MATERIAL_CATEGORY, FLOW_TYPE, SOURCE_PLANT, SOURCE_NAME,
           SUM(MONTHLY_VOLUME) AS VOLUME,
           SUM(MONTHLY_VALUE)  AS VALUE
    FROM {DB}.ANALYTICS.DT_SUPPLY_CHAIN_GEO
    WHERE FLOW_TYPE IN ('Outbound','Inter-plant')
    GROUP BY 1,2,3,4
  )
  SELECT
    s.MATERIAL_CATEGORY, s.FLOW_TYPE,
    s.SOURCE_PLANT, s.SOURCE_NAME AS PLANT_NAME,
    s.VOLUME, s.VALUE,
    COUNT(*) OVER (PARTITION BY s.MATERIAL_CATEGORY)      AS CAPABLE_PLANTS,
    COUNT(*) OVER (PARTITION BY s.MATERIAL_CATEGORY) > 1  AS HAS_ALTERNATIVE
  FROM src s
 """),
]

CHECKS = [
    ("V_NODE", 19), ("V_FLOW", 27), ("V_PLANT_CAPACITY", 5),
    ("V_PLANT_INVENTORY", 5), ("V_SUBSTITUTION", 11),
]


def conn_params(name="dfreriksdemo"):
    try:
        import tomllib
    except ModuleNotFoundError:
        import tomli as tomllib
    p = pathlib.Path.home() / ".snowflake" / "connections.toml"
    c = dict(tomllib.loads(p.read_text())[name])
    if "private_key_path" in c:
        c["private_key_file"] = str(pathlib.Path(c.pop("private_key_path")).expanduser())
    c.setdefault("warehouse", "COMPUTE_WH")
    return c


def main() -> None:
    conn = snowflake.connector.connect(**conn_params())
    cur = conn.cursor()
    cur.execute(f"CREATE SCHEMA IF NOT EXISTS {DB}.{SC} "
                f"COMMENT = 'Network and constraint layer for supply-chain "
                f"scenario modelling. Views only over SAP_SUPPLY_CHAIN.'")
    for name, sql in DDL:
        cur.execute(sql)
        print(f"  created {name}")

    print("\n  row counts:")
    bad = 0
    for view, expect in CHECKS:
        cur.execute(f"SELECT COUNT(*) FROM {DB}.{SC}.{view}")
        got = cur.fetchone()[0]
        ok = got == expect
        bad += 0 if ok else 1
        print(f"  {'OK ' if ok else 'CHECK'} {view:20} {got:>4}  (expect {expect})")

    # The flow join must not fan out — a duplicated flow would double every
    # dollar figure the scenario reports.
    cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT FLOW_ID) FROM {DB}.{SC}.V_FLOW")
    n, d = cur.fetchone()
    print(f"\n  {'OK ' if n == d else 'FANOUT'} V_FLOW rows={n} distinct FLOW_ID={d}")
    if n != d:
        bad += 1

    cur.execute(f"""SELECT MATERIAL_CATEGORY, CAPABLE_PLANTS
                    FROM {DB}.{SC}.V_SUBSTITUTION
                    WHERE NOT HAS_ALTERNATIVE
                    GROUP BY 1,2 ORDER BY 1""")
    rows = cur.fetchall()
    print(f"\n  single-source categories (unmitigable by rerouting): {len(rows)}")
    for cat, _ in rows:
        print(f"     {cat}")

    cur.close(); conn.close()
    if bad:
        sys.exit(f"\n  {bad} check(s) failed")
    print("\n  scenario layer ready")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Create the supply-chain scoped views and verify parity with the JSON export.

Views only - the CORE tables are shared with the parent ontology so there is one
source of truth and nothing to keep in sync. V_PROCESS_ROLLUP is re-derived from
V_PRODUCT rather than selected from CORE.FCT_PROCESS_ROLLUP, because the parent
rollup counts all 334 products per process and would overstate every figure here.
"""
import json
import pathlib
import sys

import snowflake.connector

DB, SC, CORE = "SAP_BDC_ONTOLOGY", "SUPPLY_CHAIN", "CORE"


V_PRODUCT_DDL = f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_PRODUCT AS
  SELECT
    PRODUCT_TECH, PRODUCT_LABEL, PROCESS_CODE, LINE_OF_BUSINESS,
    SOURCE_APPLICATION, SOURCE_SYSTEMS, INDUSTRIES, SUITE_PACKAGE,
    PROVENANCE, CATEGORY, HAS_SEMANTIC_MODEL,
    -- renamed: ENTITY_COUNT / ASSOCIATION_COUNT / CROSS_PRODUCT_ASSOCIATIONS
    -- also exist on V_ENTITY and V_PROCESS_ROLLUP
    ENTITY_COUNT               AS PRODUCT_ENTITY_COUNT,
    ASSOCIATION_COUNT          AS PRODUCT_ASSOCIATION_COUNT,
    CROSS_PRODUCT_ASSOCIATIONS AS PRODUCT_CROSS_ASSOC,
    CENTRALITY, CANONICAL_OBJECTS, CROSS_PROCESS_REFS, ODM_REFS,
    ROLE_FACT_COUNT, ROLE_DIMENSION_COUNT, ROLE_TEXT_COUNT,
    ROLE_HIERARCHY_COUNT, ROLE_VALUE_HELP_COUNT, ROLE_OTHER_COUNT
  FROM {DB}.{CORE}.DIM_PRODUCT
  WHERE PROCESS_CODE = 'D2O'
     OR ARRAY_SIZE(ARRAY_INTERSECTION(
          TRANSFORM(SPLIT(LOWER(LINE_OF_BUSINESS), ','), x VARCHAR -> TRIM(x)),
          ARRAY_CONSTRUCT('supply chain','manufacturing',
                          'sourcing and procurement','r&d engineering')
        )) > 0
"""

DDL = [
 ("V_PRODUCT", V_PRODUCT_DDL),
 ("V_ENTITY", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_ENTITY AS
  SELECT e.* FROM {DB}.{CORE}.DIM_ENTITY e
  WHERE e.PRODUCT_TECH IN (SELECT PRODUCT_TECH FROM {DB}.{SC}.V_PRODUCT)"""),
 ("V_PROCESS", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_PROCESS AS
  SELECT p.* FROM {DB}.{CORE}.DIM_PROCESS p
  WHERE p.PROCESS_CODE IN (SELECT DISTINCT PROCESS_CODE FROM {DB}.{SC}.V_PRODUCT)"""),
 # both endpoints must be in scope; a half-edge is a dangling node in the graph
 ("V_ENTITY_EDGE", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_ENTITY_EDGE AS
  SELECT r.* FROM {DB}.{CORE}.REL_ENTITY_EDGE r
  WHERE r.SOURCE_ENTITY_ID IN (SELECT ENTITY_ID FROM {DB}.{SC}.V_ENTITY)
    AND r.TARGET_ENTITY_ID IN (SELECT ENTITY_ID FROM {DB}.{SC}.V_ENTITY)"""),
 ("V_ODM_EDGE", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_ODM_EDGE AS
  SELECT r.* FROM {DB}.{CORE}.REL_ODM_EDGE r
  WHERE r.SOURCE_PRODUCT_TECH IN (SELECT PRODUCT_TECH FROM {DB}.{SC}.V_PRODUCT)
    AND r.TARGET_PRODUCT_TECH IN (SELECT PRODUCT_TECH FROM {DB}.{SC}.V_PRODUCT)"""),
 ("V_PROCESS_ROLLUP", f"""
  CREATE OR REPLACE VIEW {DB}.{SC}.V_PROCESS_ROLLUP AS
  SELECT
    p.PROCESS_CODE, p.PROCESS_NAME,
    COUNT(*)                                            AS PRODUCT_COUNT,
    SUM(d.PRODUCT_ENTITY_COUNT)                         AS ENTITY_COUNT,
    COUNT(CASE WHEN d.HAS_SEMANTIC_MODEL THEN 1 END)    AS MAPPED_PRODUCT_COUNT,
    ROUND(100.0 * COUNT(CASE WHEN d.HAS_SEMANTIC_MODEL THEN 1 END) / COUNT(*), 1)
                                                        AS COVERAGE_PCT,
    SUM(d.PRODUCT_CROSS_ASSOC)                          AS CROSS_PRODUCT_ASSOCIATIONS
  FROM {DB}.{SC}.V_PRODUCT d
  JOIN {DB}.{SC}.V_PROCESS p ON d.PROCESS_CODE = p.PROCESS_CODE
  GROUP BY p.PROCESS_CODE, p.PROCESS_NAME"""),
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


def main():
    conn = snowflake.connector.connect(**conn_params())
    cur = conn.cursor()
    for name, sql in DDL:
        cur.execute(sql)
        print(f"  created {name}")

    print("\n  parity against the JSON export:")
    j = json.loads((pathlib.Path(__file__).parent.parent / "data" / "sc_ontology.json").read_text())
    checks = [
        ("products", "V_PRODUCT", len(j["products"])),
        ("entities", "V_ENTITY", len(j["entities"])),
        ("processes", "V_PROCESS", len(j["processes"])),
        ("entity edges", "V_ENTITY_EDGE", len(j["entity_edges"])),
        ("odm edges", "V_ODM_EDGE", len(j["odm_edges"])),
    ]
    bad = 0
    for label, view, expect in checks:
        cur.execute(f"SELECT COUNT(*) FROM {DB}.{SC}.{view}")
        got = cur.fetchone()[0]
        ok = got == expect
        bad += 0 if ok else 1
        print(f"  {'OK ' if ok else 'MISMATCH'} {label:14} snowflake={got:>5} json={expect:>5}")
    cur.close(); conn.close()
    if bad:
        sys.exit(f"\n  {bad} view(s) disagree with the JSON export - the scope rules "
                 f"have drifted apart and Ask would answer over a different set "
                 f"than the app displays")
    print("\n  all views agree with the app's JSON")


if __name__ == "__main__":
    main()

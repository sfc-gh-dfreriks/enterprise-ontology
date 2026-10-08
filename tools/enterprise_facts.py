#!/usr/bin/env python3
"""Live facts for the Enterprise Ontology presales kit and docs.

Every figure the kit prints comes from here: queried from SAP_ENTERPRISE_ONTOLOGY
in US (source of truth), with a parity row per region and counts read from the
app's own source (pages from Sidebar.tsx, Ask Cortex topics from enterprise.ts).
Builders read only /tmp/enterprise_facts.json, so the kit cannot drift.

    python3 tools/enterprise_facts.py [--print]
"""
import json
import os
import pathlib
import re
import sys
import tomllib
from decimal import Decimal

import snowflake.connector

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path("/tmp/enterprise_facts.json")
REGIONS = {"US": "dfreriksdemo", "EU": "dfreriks_eu_demo", "APAC": "dfreriks_apac_demo"}
DB = "SAP_ENTERPRISE_ONTOLOGY"
REPO = "https://github.com/sfc-gh-dfreriks/enterprise-ontology"
SITE = "https://sfc-gh-dfreriks.github.io/enterprise-ontology/"


def connect(name):
    cfg = tomllib.load(open(os.path.expanduser("~/.snowflake/connections.toml"), "rb"))[name]
    kw = {k: v for k, v in cfg.items() if k in ("account", "user", "role", "warehouse", "authenticator")}
    if cfg.get("private_key_path"):
        kw["private_key_file"] = cfg["private_key_path"]
    return snowflake.connector.connect(**kw)


def plain(v):
    return float(v) if isinstance(v, Decimal) else v


def rows(cur, sql):
    cur.execute(sql)
    cols = [c[0].lower() for c in cur.description]
    return [{k: plain(v) for k, v in zip(cols, r)} for r in cur.fetchall()]


def one(cur, sql):
    return plain(cur.execute(sql).fetchone()[0])


def main():
    us = connect(REGIONS["US"]).cursor()
    prov = {}

    def q(key, sql, fn=one):
        prov[key] = sql.strip()
        return fn(us, sql)

    f = {"repo": REPO, "site": SITE, "database": DB,
         "semantic_view": f"{DB}.SEMANTIC.SAP_ENTERPRISE_360", "agent": f"{DB}.AGENTS.SAP_ENTERPRISE_ANALYST",
         "app_url": "http://localhost:5186", "ports": "server 3011, client 5186"}
    f["classes"] = q("classes", f"SELECT COUNT(*) FROM {DB}.CORE.ONT_CLASS")
    f["abstract_classes"] = q("abstract_classes", f"SELECT COUNT_IF(IS_ABSTRACT) FROM {DB}.CORE.ONT_CLASS")
    f["relations"] = q("relations", f"SELECT COUNT(*) FROM {DB}.CORE.ONT_RELATION_DEF")
    f["modules"] = q("modules", f"SELECT MODULE, NAME, SOURCE_DATABASE FROM {DB}.CORE.ONT_MODULE ORDER BY MODULE='CORE' DESC, MODULE", rows)
    f["classes_by_module"] = q("classes_by_module", f"SELECT MODULE, COUNT(*) N FROM {DB}.CORE.ONT_CLASS GROUP BY 1 ORDER BY 2 DESC", rows)
    f["kg_nodes"] = q("kg_nodes", f"SELECT COUNT(*) FROM {DB}.CORE.KG_NODE")
    f["kg_edges"] = q("kg_edges", f"SELECT COUNT(*) FROM {DB}.CORE.KG_EDGE")
    f["dangling_edges"] = q("dangling_edges", f"""SELECT COUNT(*) FROM {DB}.CORE.KG_EDGE e
        LEFT JOIN {DB}.CORE.KG_NODE a ON a.NODE_ID = e.SRC_ID LEFT JOIN {DB}.CORE.KG_NODE b ON b.NODE_ID = e.DST_ID
        WHERE a.NODE_ID IS NULL OR b.NODE_ID IS NULL""")
    f["golden_customers"] = q("golden_customers", f"SELECT COUNT(*) FROM {DB}.XWALK.GOLDEN_CUSTOMER")
    f["golden_suppliers"] = q("golden_suppliers", f"SELECT COUNT(*) FROM {DB}.XWALK.GOLDEN_SUPPLIER")
    f["golden_companies"] = q("golden_companies", f"SELECT COUNT(*) FROM {DB}.XWALK.GOLDEN_COMPANY")
    f["golden_departments"] = q("golden_departments", f"SELECT COUNT(*) FROM {DB}.XWALK.GOLDEN_DEPARTMENT")
    f["crosswalk_records"] = q("crosswalk_records", f"SELECT COUNT(*) FROM {DB}.XWALK.V_CROSSWALK")
    f["crosswalk_by_app"] = q("crosswalk_by_app", f"""SELECT ENTITY, MODULE, COUNT(*) RECORDS, COUNT(DISTINCT GOLDEN_ID) GOLDEN
        FROM {DB}.XWALK.V_CROSSWALK GROUP BY 1, 2 ORDER BY 1, 3 DESC""", rows)
    f["companies"] = q("companies", f"SELECT * FROM {DB}.ANALYTICS.DT_COMPANY_360 ORDER BY REVENUE_USD DESC", rows)
    f["revenue_usd"] = sum(c["revenue_usd"] for c in f["companies"])
    f["headcount"] = sum(c["headcount"] for c in f["companies"])
    f["spend_usd"] = sum(c["spend_usd"] for c in f["companies"])
    f["late_cost_usd"] = sum(c["late_cost_usd"] for c in f["companies"])
    f["top_customers"] = q("top_customers", f"""SELECT CUSTOMER, MODULE_LIST, ORDER_VALUE_USD, AR_OVERDUE_USD, OPEN_PIPELINE_USD,
        OTIF_PCT, LATE_COST_USD FROM {DB}.ANALYTICS.DT_CUSTOMER_360 ORDER BY ORDER_VALUE_USD DESC LIMIT 5""", rows)
    f["customers_late_and_overdue"] = q("customers_late_and_overdue", f"""SELECT CUSTOMER, AR_OVERDUE_USD, LATE_COST_USD, OTIF_PCT
        FROM {DB}.ANALYTICS.DT_CUSTOMER_360 WHERE LATE_COST_USD > 0 AND AR_OVERDUE_USD > 0
        ORDER BY LATE_COST_USD DESC LIMIT 5""", rows)
    f["top_suppliers"] = q("top_suppliers", f"""SELECT SUPPLIER, MODULE_LIST, SPEND_USD, MAX_RISK_SCORE, AP_OPEN_USD, ON_CONTRACT_PCT,
        DEVIATING_LOTS FROM {DB}.ANALYTICS.DT_SUPPLIER_360 ORDER BY SPEND_USD DESC NULLS LAST LIMIT 5""", rows)
    f["quality_exposure"] = q("quality_exposure", f"""SELECT SUPPLIER, COUNT(DISTINCT CUSTOMER) CUSTOMERS, SUM(ORDERS) ORDERS,
        ROUND(SUM(ORDER_VALUE_USD)) ORDER_VALUE_USD FROM {DB}.CORE.VW_SUPPLIER_QUALITY_EXPOSURE
        GROUP BY 1 ORDER BY 4 DESC""", rows)
    f["four_app_customers"] = q("four_app_customers", f"SELECT COUNT_IF(MODULES = 4) FROM {DB}.ANALYTICS.DT_CUSTOMER_360")
    f["four_app_suppliers"] = q("four_app_suppliers", f"SELECT COUNT_IF(MODULES = 4) FROM {DB}.ANALYTICS.DT_SUPPLIER_360")
    f["dynamic_tables"] = q("dynamic_tables", f"""SELECT COUNT(*) FROM {DB}.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'ANALYTICS' AND IS_DYNAMIC = 'YES'""")

    # Source-of-truth reconciliation: enterprise totals equal each app's own total.
    f["reconciliation"] = [
        {"metric": "Spend (USD)", "app": "Spend 360", "enterprise": f["spend_usd"],
         "source": q("src_spend", """SELECT ROUND(SUM(s.SPEND * d.RATE_TO_USD)) FROM SAP_SPEND_360.ANALYTICS.DT_SPEND_360 s
            JOIN SAP_WORKING_CAPITAL_360.ANALYTICS.DIM_COMPANY d ON d.CURRENCY = s.CURRENCY""")},
        {"metric": "Late-delivery cost (USD)", "app": "Supply Chain 360", "enterprise": f["late_cost_usd"],
         "source": q("src_late", "SELECT SUM(LATE_COST_USD) FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_ORDER_FULFILLMENT")},
        {"metric": "Headcount", "app": "People 360", "enterprise": f["headcount"],
         "source": q("src_hc", "SELECT SUM(HEADCOUNT) FROM SAP_PEOPLE_360.ANALYTICS.DT_WORKFORCE_360")},
    ]

    # Regions: same checks the deploy script gates on.
    checks = {
        "kg_nodes": f"SELECT COUNT(*) FROM {DB}.CORE.KG_NODE",
        "crosswalk": f"SELECT COUNT(*) FROM {DB}.XWALK.V_CROSSWALK",
        "spend_usd": f"SELECT ROUND(SUM(SPEND_USD)) FROM {DB}.ANALYTICS.DT_COMPANY_360",
        "late_cost_usd": f"SELECT SUM(LATE_COST_USD) FROM {DB}.ANALYTICS.DT_CUSTOMER_360",
    }
    regions = []
    base = {k: one(us, s) for k, s in checks.items()}
    for r, conn in REGIONS.items():
        try:
            cur = connect(conn).cursor()
            vals = {k: one(cur, s) for k, s in checks.items()}
            agent = bool(cur.execute(f"SHOW AGENTS IN SCHEMA {DB}.AGENTS").fetchall())
            regions.append({"region": r, "connection": conn, "parity": all(vals[k] == base[k] for k in checks),
                            "agent": agent, **vals})
        except Exception as e:  # report, don't hide
            regions.append({"region": r, "connection": conn, "parity": False, "error": str(e)[:160]})
    f["regions"] = regions

    # From the app's own source, so page and topic counts can't be misquoted.
    sidebar = (ROOT / "client/src/components/Sidebar.tsx").read_text()
    f["enterprise_pages"] = re.findall(r'id: "(?:ent-[a-z]+|ask)", label: "([^"]+)"', sidebar)
    f["scm_pages"] = len(re.findall(r'\{ id: "[a-z]+", label:', sidebar)) - 1  # minus "ask"
    ent = (ROOT / "server/src/services/enterprise.ts").read_text()
    f["ask_topics"] = len(re.findall(r'case "ent-', ent))
    f["fx"] = q("fx", "SELECT CURRENCY, RATE_TO_USD FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DIM_COMPANY ORDER BY 1", rows)

    OUT.write_text(json.dumps({"facts": f, "provenance": prov}, indent=1, default=str))
    print(f"wrote {OUT} ({len(f)} facts)")
    if "--print" in sys.argv:
        for k in ("classes", "relations", "kg_nodes", "kg_edges", "dangling_edges", "crosswalk_records",
                  "revenue_usd", "headcount", "spend_usd", "late_cost_usd", "four_app_customers",
                  "four_app_suppliers", "dynamic_tables", "ask_topics", "enterprise_pages", "scm_pages"):
            print(f"  {k:22} {f[k]}")
        for r in f["regions"]:
            print("  region", r)
        for r in f["reconciliation"]:
            print("  recon", r)


if __name__ == "__main__":
    main()

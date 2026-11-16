#!/usr/bin/env python3
"""Live facts for the Enterprise Ontology presales kit and docs.

Every figure the kit prints comes from here. The ontology itself is the governed
Snowflake Business Ontology (domain "Enterprise" + subdomains, reusing concepts of
the governed "Supply Chain" domain), read from the exported snapshot
data/ent_business_ontology.json (tools/export_business_ontology.py). Instance facts
(KG, crosswalk, 360 tables, scenarios) are queried from SAP_ENTERPRISE_ONTOLOGY in US
(source of truth), with a parity row per region; pages come from Sidebar.tsx (the one
page list every builder uses) and Ask Cortex topics from enterprise.ts.
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


def governed(bo):
    """Counts and lists from the Business Ontology snapshot that the docs and decks print."""
    nodes, rels = bo["nodes"], bo["relationships"]
    owned = [x for x in nodes if x["owner"] == bo["domain"]]
    reused = [x for x in nodes if x["owner"] != bo["domain"]]
    ent_names = {x["name"] for x in owned}
    ent_rels = [r for r in rels if r["source"] in ent_names or r["target"] in ent_names]
    by_type = {}
    for r in ent_rels:
        by_type[r["type"]] = by_type.get(r["type"], 0) + 1
    domains = []
    for d in bo["domains"]:
        ns = [x["name"] for x in nodes if x["domain"] == d]
        domains.append({"domain": d, "concepts": len(ns), "names": ns})
    return {
        "account": bo["account"], "domain": bo["domain"], "exported_at": bo["exportedAt"],
        "snowsight_url": bo["snowsightUrl"], "counts": bo["counts"],
        "owned": len(owned), "reused": len(reused), "concepts": len(nodes),
        "owned_names": [x["name"] for x in owned], "reused_names": [x["name"] for x in reused],
        "reused_from": sorted({x["owner"] for x in reused}),
        "relationships": len(rels), "enterprise_relationships": len(ent_rels),
        "relationships_by_type": by_type,
        "custom_verbs": sorted({r["label"] for r in ent_rels if r["type"] == "CUSTOM"}),
        "representations": sum(len(x["representations"]) for x in nodes),
        "unrepresented": [x["name"] for x in nodes if not x["representations"]],
        "subdomains": [d for d in bo["domains"] if d.startswith(bo["domain"] + ".")],
        "domains": domains,
        "class_views": sorted({r["object"] for x in nodes for r in x["representations"] if r["object"].startswith("VW_ONT_")}),
    }


def main():
    us = connect(REGIONS["US"]).cursor()
    prov = {}

    def q(key, sql, fn=one):
        prov[key] = sql.strip()
        return fn(us, sql)

    f = {"repo": REPO, "site": SITE, "database": DB,
         "semantic_view": f"{DB}.SEMANTIC.SAP_ENTERPRISE_360", "agent": f"{DB}.AGENTS.SAP_ENTERPRISE_ANALYST",
         "app_url": "http://localhost:5186", "ports": "server 3011, client 5186"}
    # Governed ontology: Snowflake Business Ontology snapshot, not the legacy ONT_* tables.
    bo = json.loads((ROOT / "data/ent_business_ontology.json").read_text())
    f["bo"] = governed(bo)
    f["bo"]["new_class_views"] = sorted(set(re.findall(r"VIEW\s+(?:\w+\.)*(VW_ONT_\w+)",
                                                       (ROOT / "sql/enterprise/07_business_ontology_views.sql").read_text())))
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
        "geo_nodes": f"SELECT COUNT(*) FROM {DB}.SCENARIO.V_GEO",
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
    f["pages"] = [{"id": i, "label": l} for i, l in re.findall(r'id: "((?:ent-[a-z]+|ask-cortex))", label: "([^"]+)"', sidebar)]
    f["enterprise_pages"] = [p["label"] for p in f["pages"]]
    # SAP BDC lineage, as the BDC Lineage page shows it (tools/export_lineage.py)
    lin = json.loads((ROOT / "data/enterprise_lineage.json").read_text())
    f["lineage"] = {"counts": lin["counts"], "generated_at": lin["generated_at"], "notes": lin["notes"],
                    "modules": [{"code": m["code"], "name": m["name"], "bdc_products": m["bdcProducts"],
                                 "app_objects": sorted({r["appObject"] for r in m["products"]}),
                                 "provenance": sorted({r["provenanceLabel"] for r in m["products"]})} for m in lin["modules"]]}
    f["scenario_views"] = q("scenario_views", f"""SELECT COUNT(*) FROM {DB}.INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = 'SCENARIO'""")
    ent = (ROOT / "server/src/services/enterprise.ts").read_text()
    f["ask_topics"] = len(re.findall(r'case "ent-', ent))
    f["fx"] = q("fx", "SELECT CURRENCY, RATE_TO_USD FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DIM_COMPANY ORDER BY 1", rows)

    OUT.write_text(json.dumps({"facts": f, "provenance": prov}, indent=1, default=str))
    print(f"wrote {OUT} ({len(f)} facts)")
    if "--print" in sys.argv:
        print("  bo", {k: f["bo"][k] for k in ("owned", "reused", "relationships", "enterprise_relationships",
                                               "relationships_by_type", "representations", "unrepresented")})
        for k in ("kg_nodes", "kg_edges", "dangling_edges", "crosswalk_records",
                  "revenue_usd", "headcount", "spend_usd", "late_cost_usd", "four_app_customers",
                  "four_app_suppliers", "dynamic_tables", "ask_topics", "enterprise_pages", "scenario_views"):
            print(f"  {k:22} {f[k]}")
        for r in f["regions"]:
            print("  region", r)
        for r in f["reconciliation"]:
            print("  recon", r)


if __name__ == "__main__":
    main()

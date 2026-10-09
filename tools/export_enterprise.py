#!/usr/bin/env python3
"""Export the enterprise master ontology to data/enterprise_ontology.json.

Reads only SAP_ENTERPRISE_ONTOLOGY (CORE, XWALK, ANALYTICS). The app's server and
the credential-free static build both serve this one file.

    python3 tools/export_enterprise.py [connection]   (default dfreriksdemo)
"""
import json
import os
import pathlib
import sys
import tomllib
from decimal import Decimal

import snowflake.connector

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "enterprise_ontology.json"
DB = "SAP_ENTERPRISE_ONTOLOGY"


def connect(name):
    cfg = tomllib.load(open(os.path.expanduser("~/.snowflake/connections.toml"), "rb"))[name]
    kw = {k: v for k, v in cfg.items() if k in ("account", "user", "role", "warehouse", "authenticator")}
    if cfg.get("private_key_path"):
        kw["private_key_file"] = cfg["private_key_path"]
    return snowflake.connector.connect(**kw, database=DB)


def rows(cur, sql):
    cur.execute(sql)
    cols = [c[0].lower() for c in cur.description]
    out = []
    for r in cur.fetchall():
        d = {}
        for k, v in zip(cols, r):
            if isinstance(v, Decimal):
                v = float(v)
            elif hasattr(v, "isoformat"):
                v = v.isoformat()
            elif isinstance(v, str) and v[:1] in "{[":
                try:
                    v = json.loads(v)
                except ValueError:
                    pass
            d[k] = v
        out.append(d)
    return out


def main():
    con = connect(sys.argv[1] if len(sys.argv) > 1 else "dfreriksdemo")
    cur = con.cursor()
    q = lambda s: rows(cur, s)

    modules = q("SELECT * FROM CORE.ONT_MODULE ORDER BY MODULE = 'CORE' DESC, MODULE")
    classes = q("""SELECT c.CLASS_NAME, c.PARENT_CLASS_NAME, c.IS_ABSTRACT, c.DESCRIPTION, c.MODULE,
                          COUNT(n.NODE_ID) AS instances
                     FROM CORE.ONT_CLASS c LEFT JOIN CORE.KG_NODE n ON n.NODE_TYPE = c.CLASS_NAME
                    GROUP BY 1, 2, 3, 4, 5 ORDER BY c.MODULE, c.IS_ABSTRACT DESC, c.CLASS_NAME""")
    relations = q("""SELECT r.REL_NAME, r.DOMAIN_CLASS, r.RANGE_CLASS, r.CARDINALITY, r.DESCRIPTION, r.MODULE,
                            COUNT(e.EDGE_ID) AS edges, ROUND(SUM(e.WEIGHT)) AS weight
                       FROM CORE.ONT_RELATION_DEF r LEFT JOIN CORE.KG_EDGE e ON e.EDGE_TYPE = r.REL_NAME
                      GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY edges DESC""")
    companies = q("SELECT * FROM ANALYTICS.DT_COMPANY_360 ORDER BY REVENUE_USD DESC")
    customers = q("SELECT * FROM ANALYTICS.DT_CUSTOMER_360 ORDER BY ORDER_VALUE_USD DESC")
    suppliers = q("SELECT * FROM ANALYTICS.DT_SUPPLIER_360 ORDER BY SPEND_USD DESC NULLS LAST")
    exposure = q("SELECT * FROM CORE.VW_SUPPLIER_QUALITY_EXPOSURE ORDER BY ORDER_VALUE_USD DESC")
    crosswalk = q("SELECT * FROM XWALK.V_CROSSWALK ORDER BY ENTITY, GOLDEN_ID, MODULE, LOCAL_ID")
    xw_summary = q("""SELECT ENTITY, MODULE, MATCH_METHOD, COUNT(*) AS records, COUNT(DISTINCT GOLDEN_ID) AS golden
                        FROM XWALK.V_CROSSWALK GROUP BY 1, 2, 3 ORDER BY 1, 2, 3""")
    departments = q("""SELECT d.GOLDEN_ID, d.NAME, d.FIN_CODE, d.MATCH_METHOD,
                              (SELECT COUNT(*) FROM CORE.KG_EDGE e WHERE e.EDGE_TYPE = 'inDepartment' AND e.DST_ID = 'DEP:' || d.GOLDEN_ID) AS employees,
                              (SELECT ROUND(SUM(WEIGHT)) FROM CORE.KG_EDGE e WHERE e.EDGE_TYPE = 'fundedBy' AND e.SRC_ID = 'DEP:' || d.GOLDEN_ID) AS expense_usd
                         FROM XWALK.GOLDEN_DEPARTMENT d ORDER BY employees DESC""")
    stats = q("""SELECT (SELECT COUNT(*) FROM CORE.KG_NODE) nodes, (SELECT COUNT(*) FROM CORE.KG_EDGE) edges,
                        (SELECT COUNT(*) FROM CORE.ONT_CLASS) classes, (SELECT COUNT(*) FROM CORE.ONT_RELATION_DEF) relations,
                        (SELECT COUNT(*) FROM XWALK.V_CROSSWALK) crosswalk_records""")[0]

    # Graph: golden entities, plants, departments, categories, tools; local members and employees
    # are rolled up onto their golden record (counts in data) so the canvas stays readable.
    nodes = q("""SELECT NODE_ID, NODE_TYPE, NAME, MODULE FROM CORE.KG_NODE
                  WHERE NODE_TYPE IN ('LegalEntity', 'Customer', 'Supplier', 'Department', 'Plant', 'SpendCategory', 'Equipment')""")
    edges = q("""SELECT e.SRC_ID, e.DST_ID, e.EDGE_TYPE, e.WEIGHT, e.MODULE FROM CORE.KG_EDGE e
                  JOIN CORE.KG_NODE a ON a.NODE_ID = e.SRC_ID JOIN CORE.KG_NODE b ON b.NODE_ID = e.DST_ID
                 WHERE a.NODE_TYPE IN ('LegalEntity', 'Customer', 'Supplier', 'Department', 'Plant', 'SpendCategory', 'Equipment')
                   AND b.NODE_TYPE IN ('LegalEntity', 'Customer', 'Supplier', 'Department', 'Plant', 'SpendCategory', 'Equipment')""")
    members = {r["golden_id"]: r for r in q("""
        SELECT 'GC:' || GOLDEN_ID golden_id, COUNT(*) members FROM XWALK.CUSTOMER_MEMBER GROUP BY 1
        UNION ALL SELECT 'GS:' || GOLDEN_ID, COUNT(*) FROM XWALK.SUPPLIER_MEMBER GROUP BY 1""")}
    emp = {r["dst_id"]: r["n"] for r in q("SELECT DST_ID, COUNT(*) n FROM CORE.KG_EDGE WHERE EDGE_TYPE = 'inDepartment' GROUP BY 1")}
    graph = {
        "nodes": [{"id": n["node_id"], "type": n["node_type"], "label": n["name"], "module": n["module"],
                   "members": members.get(n["node_id"], {}).get("members"), "employees": emp.get(n["node_id"])} for n in nodes],
        "edges": [{"source": e["src_id"], "target": e["dst_id"], "type": e["edge_type"],
                   "weight": e["weight"], "module": e["module"]} for e in edges],
    }

    # ------------------------------------------------------------ scenario inputs
    # Everything the enterprise scenario engine (shared/entScenario.ts) propagates through.
    # Rates are per week over the measured Supply Chain order period so a shock of N
    # weeks scales linearly; Working Capital balances are the latest month.
    period = q("""SELECT MIN(REQUESTED_SHIP_DATE) d0, MAX(REQUESTED_SHIP_DATE) d1,
                         DATEDIFF(day, MIN(REQUESTED_SHIP_DATE), MAX(REQUESTED_SHIP_DATE)) + 1 days
                    FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_ORDER_FULFILLMENT""")[0]
    weeks = period["days"] / 7
    plants = q(f"""SELECT o.PLANT plant, ANY_VALUE(o.PLANT_NAME) name, m.GOLDEN_ID company_code,
                          SUM(o.NET_VALUE_USD) / {weeks} value_per_week,
                          SUM(o.ORDER_QTY * o.MARGIN_PER_UNIT_USD) / {weeks} margin_per_week,
                          COUNT(*) orders, ROUND(100 * COUNT_IF(o.OTIF) / COUNT(*), 1) otif_pct,
                          SUM(o.LATE_COST_USD) late_cost_usd
                     FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_ORDER_FULFILLMENT o
                     JOIN SAP_SUPPLY_CHAIN.PLANT.A_PLANT p ON p.PLANT = o.PLANT
                     JOIN XWALK.COMPANY_MEMBER m ON m.MODULE = 'SCM' AND m.LOCAL_ID = p.COMPANY_CODE
                    GROUP BY o.PLANT, m.GOLDEN_ID ORDER BY 1""")
    # share of each plant's built systems that contain at least one lot from the golden supplier
    supplier_plant = q("""WITH s AS (SELECT PLANT, COUNT(DISTINCT SERIAL_NO) n FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_SERIAL_GENEALOGY GROUP BY 1)
                          SELECT m.GOLDEN_ID supplier_id, g.PLANT plant, COUNT(DISTINCT g.SERIAL_NO) / ANY_VALUE(s.n) share,
                                 COUNT(DISTINCT IFF(g.INSPECTION_RESULT <> 'Accepted', g.LOT_ID, NULL)) deviating_lots
                            FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_SERIAL_GENEALOGY g
                            JOIN XWALK.SUPPLIER_MEMBER m ON m.MODULE = 'SCM' AND m.LOCAL_ID = g.SUPPLIER
                            JOIN s ON s.PLANT = g.PLANT GROUP BY 1, 2 ORDER BY 1, 2""")
    plant_customer = q("""SELECT SPLIT_PART(SRC_ID, ':', 2) plant, SPLIT_PART(DST_ID, ':', 2) customer_id, WEIGHT value_usd
                            FROM CORE.KG_EDGE WHERE EDGE_TYPE = 'shipsTo' ORDER BY 1, 3 DESC""")
    money_edges = q("""SELECT EDGE_TYPE type, SPLIT_PART(SRC_ID, ':', 2) company_code, SPLIT_PART(DST_ID, ':', 2) party_id, WEIGHT value_usd
                         FROM CORE.KG_EDGE WHERE EDGE_TYPE IN ('buysFrom', 'owesTo', 'sellsToCustomer') ORDER BY 1, 2, 4 DESC""")
    wc = q("""SELECT COMPANY_CODE company_code, MONTH_END month_end, REVENUE_USD revenue_usd, COGS_USD cogs_usd,
                     PURCHASES_USD purchases_usd, AR_BALANCE_USD ar_usd, AR_OVERDUE_USD ar_overdue_usd, AP_BALANCE_USD ap_usd,
                     INVENTORY_USD inventory_usd, NET_WORKING_CAPITAL_USD nwc_usd, DSO dso, DPO dpo, DIO dio, CCC ccc
                FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DT_WC_MONTHLY_KPI
             QUALIFY ROW_NUMBER() OVER (PARTITION BY COMPANY_CODE ORDER BY MONTH_END DESC) = 1""")
    pnl_ccy = q("""SELECT c.GOLDEN_ID company_code, c.CURRENCY currency, c.RATE_TO_USD rate_to_usd FROM XWALK.GOLDEN_COMPANY c""")
    scenario = {"period": period, "weeks": weeks, "plants": plants, "supplier_plant": supplier_plant,
                "plant_customer": plant_customer, "money_edges": money_edges, "working_capital": wc, "fx": pnl_ccy}

    payload = {"source": DB, "stats": stats, "modules": modules, "classes": classes, "relations": relations,
               "companies": companies, "customers": customers, "suppliers": suppliers, "exposure": exposure,
               "departments": departments, "scenario": scenario, "crosswalk": crosswalk, "crosswalk_summary": xw_summary, "graph": graph,
               "notes": {
                   "identity": "Customer and supplier golden records come from a deterministic demo crosswalk "
                               "(the six apps share no keys). A production build would use MDG / match-merge output.",
                   "currency": "USD at company planning rates (USD 1.00, EUR 1.08, JPY 0.0067). Sales order value is "
                               "USD orders only; CRM pipeline in other currencies is converted where a rate exists.",
                   "sales_scale": "Sales 360 order values come from the SAP BDC demo tenant and are much larger than the "
                                  "Supply Chain demo orders; compare within an app, not across.",
               }}
    OUT.write_text(json.dumps(payload, default=str))
    print(f"wrote {OUT.name}: {stats['nodes']} nodes, {stats['edges']} edges, {len(graph['nodes'])} graph nodes")
    con.close()


if __name__ == "__main__":
    main()

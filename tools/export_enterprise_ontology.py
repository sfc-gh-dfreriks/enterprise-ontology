#!/usr/bin/env python3
"""Export the enterprise data THROUGH Snowflake Business Ontology.

Writes data/enterprise_ontology.json, which the server and the credential-free
static build serve. Nothing here names a table: every input is found from a
governed concept in the Enterprise domain (or a Supply Chain concept it reuses),
via the representation a steward linked to it (see ent_ontology.py).

  companies, P&L       Legal Entity      DT_COMPANY_360, GOLDEN_COMPANY, DT_WC_MONTHLY_KPI
  customers, suppliers Customer/Supplier DT_CUSTOMER_360 / DT_SUPPLIER_360
  crosswalk            Local Customer    V_CROSSWALK, CUSTOMER_MEMBER (+ Local Supplier)
  departments          Department        GOLDEN_DEPARTMENT
  exposure             Supplier          VW_SUPPLIER_QUALITY_EXPOSURE
  scenario             Plant, Sales Order, Component Lot, Material Flow representations

Instance links (which employee is in which department) are not concepts, so they
stay in the knowledge graph beside the class views; each edge type used is checked
against the governed relationship it instantiates, so a relationship removed from
the ontology stops the export.

The model itself (modules, classes, relations) is no longer exported: it is the
governed domain, in data/ent_business_ontology.json.

Run:  python3 tools/export_enterprise.py [--check]
      --check compares with the current file instead of writing it.
"""
import json
import pathlib
import sys
from decimal import Decimal

import snowflake.connector

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ent_ontology import Ontology  # noqa: E402
from sf_conn import conn_params  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "enterprise_ontology.json"

# Knowledge-graph edge type -> the governed relationship it instantiates (source, label, target).
EDGE_RELATIONSHIP = {
    "inDepartment": ("Employee", "in department", "Department"),
    "fundedBy": ("Department", "funded by", "Cost Center"),
    "shipsTo": ("Plant", "ships to", "Customer"),
    "buysFrom": ("Legal Entity", "buys from", "Supplier"),
    "sellsToCustomer": ("Legal Entity", "sells to", "Customer"),
    # Money a legal entity owes a supplier: the governed path is AP Invoice payable to Supplier.
    "owesTo": ("AP Invoice", "payable to", "Supplier"),
}


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


def build(cur) -> dict:
    ont = Ontology(cur)
    q = lambda s: rows(cur, s)
    for edge, (s, label, t) in EDGE_RELATIONSHIP.items():
        if (s, t) not in ont.related(label):
            raise SystemExit(f"Business Ontology: no governed '{s} {label} {t}' for knowledge-graph edge {edge}")

    company_360 = ont.rep("Legal Entity", "DT_COMPANY_360")
    golden_company = ont.rep("Legal Entity", "GOLDEN_COMPANY")
    company_member = ont.rep("Legal Entity", "COMPANY_MEMBER")
    wc_kpi = ont.rep("Legal Entity", "DT_WC_MONTHLY_KPI")
    customer_360 = ont.rep("Customer", "DT_CUSTOMER_360")
    supplier_360 = ont.rep("Supplier", "DT_SUPPLIER_360")
    exposure_view = ont.rep("Supplier", "VW_SUPPLIER_QUALITY_EXPOSURE")
    crosswalk_view = ont.rep("Local Customer", "V_CROSSWALK")
    customer_member = ont.rep("Local Customer", "CUSTOMER_MEMBER")
    supplier_member = ont.rep("Local Supplier", "SUPPLIER_MEMBER")
    golden_department = ont.rep("Department", "GOLDEN_DEPARTMENT")
    orders = ont.rep("Sales Order", "DT_ORDER_FULFILLMENT")
    plant_master = ont.rep("Plant", "A_PLANT")
    genealogy = ont.rep("Component Lot", "DT_SERIAL_GENEALOGY")
    v_geo, v_capacity = ont.rep("Plant", "V_GEO"), ont.rep("Plant", "V_PLANT_CAPACITY")
    v_buffer, v_subst = ont.rep("Plant", "V_PLANT_BUFFER"), ont.rep("Plant", "V_SUBSTITUTION")
    v_flow = ont.rep("Material Flow", "V_FLOW")
    kg_node, kg_edge = ont.instance_graph("Legal Entity")

    companies = q(f"SELECT * FROM {company_360} ORDER BY REVENUE_USD DESC")
    customers = q(f"SELECT * FROM {customer_360} ORDER BY ORDER_VALUE_USD DESC")
    suppliers = q(f"SELECT * FROM {supplier_360} ORDER BY SPEND_USD DESC NULLS LAST")
    # Tiebreak on the ids: several pairs share an order value, and the old export's order
    # among them was arbitrary.
    exposure = q(f"SELECT * FROM {exposure_view} ORDER BY ORDER_VALUE_USD DESC, SUPPLIER_ID, CUSTOMER_ID")
    crosswalk = q(f"SELECT * FROM {crosswalk_view} ORDER BY ENTITY, GOLDEN_ID, MODULE, LOCAL_ID")
    xw_summary = q(f"""SELECT ENTITY, MODULE, MATCH_METHOD, COUNT(*) AS records, COUNT(DISTINCT GOLDEN_ID) AS golden
                         FROM {crosswalk_view} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3""")
    departments = q(f"""SELECT d.GOLDEN_ID, d.NAME, d.FIN_CODE, d.MATCH_METHOD,
                               (SELECT COUNT(*) FROM {kg_edge} e WHERE e.EDGE_TYPE = 'inDepartment' AND e.DST_ID = 'DEP:' || d.GOLDEN_ID) AS employees,
                               (SELECT ROUND(SUM(WEIGHT)) FROM {kg_edge} e WHERE e.EDGE_TYPE = 'fundedBy' AND e.SRC_ID = 'DEP:' || d.GOLDEN_ID) AS expense_usd
                          FROM {golden_department} d ORDER BY employees DESC""")
    stats = q(f"""SELECT (SELECT COUNT(*) FROM {kg_node}) nodes, (SELECT COUNT(*) FROM {kg_edge}) edges,
                         (SELECT COUNT(*) FROM {crosswalk_view}) crosswalk_records""")[0]

    # ------------------------------------------------------------ scenario inputs
    # Everything the enterprise scenario engine (server/src/lib/entScenario.ts) propagates
    # through. Rates are per week over the measured order period so a shock of N weeks
    # scales linearly; Working Capital balances are the latest month.
    period = q(f"""SELECT MIN(REQUESTED_SHIP_DATE) d0, MAX(REQUESTED_SHIP_DATE) d1,
                          DATEDIFF(day, MIN(REQUESTED_SHIP_DATE), MAX(REQUESTED_SHIP_DATE)) + 1 days
                     FROM {orders}""")[0]
    weeks = period["days"] / 7
    plants = q(f"""SELECT o.PLANT plant, ANY_VALUE(o.PLANT_NAME) name, m.GOLDEN_ID company_code,
                          SUM(o.NET_VALUE_USD) / {weeks} value_per_week,
                          SUM(o.ORDER_QTY * o.MARGIN_PER_UNIT_USD) / {weeks} margin_per_week,
                          COUNT(*) orders, ROUND(100 * COUNT_IF(o.OTIF) / COUNT(*), 1) otif_pct,
                          SUM(o.LATE_COST_USD) late_cost_usd
                     FROM {orders} o
                     JOIN {plant_master} p ON p.PLANT = o.PLANT
                     JOIN {company_member} m ON m.MODULE = 'SCM' AND m.LOCAL_ID = p.COMPANY_CODE
                    GROUP BY o.PLANT, m.GOLDEN_ID ORDER BY 1""")
    # share of each plant's built systems that contain at least one lot from the golden supplier
    supplier_plant = q(f"""WITH s AS (SELECT PLANT, COUNT(DISTINCT SERIAL_NO) n FROM {genealogy} GROUP BY 1)
                           SELECT m.GOLDEN_ID supplier_id, g.PLANT plant, COUNT(DISTINCT g.SERIAL_NO) / ANY_VALUE(s.n) share,
                                  COUNT(DISTINCT IFF(g.INSPECTION_RESULT <> 'Accepted', g.LOT_ID, NULL)) deviating_lots
                             FROM {genealogy} g
                             JOIN {supplier_member} m ON m.MODULE = 'SCM' AND m.LOCAL_ID = g.SUPPLIER
                             JOIN s ON s.PLANT = g.PLANT GROUP BY 1, 2 ORDER BY 1, 2""")
    plant_customer = q(f"""SELECT SPLIT_PART(SRC_ID, ':', 2) plant, SPLIT_PART(DST_ID, ':', 2) customer_id, WEIGHT value_usd
                             FROM {kg_edge} WHERE EDGE_TYPE = 'shipsTo' ORDER BY 1, 3 DESC""")
    money_edges = q(f"""SELECT EDGE_TYPE type, SPLIT_PART(SRC_ID, ':', 2) company_code, SPLIT_PART(DST_ID, ':', 2) party_id, WEIGHT value_usd
                          FROM {kg_edge} WHERE EDGE_TYPE IN ('buysFrom', 'owesTo', 'sellsToCustomer') ORDER BY 1, 2, 4 DESC""")
    wc = q(f"""SELECT COMPANY_CODE company_code, MONTH_END month_end, REVENUE_USD revenue_usd, COGS_USD cogs_usd,
                      PURCHASES_USD purchases_usd, AR_BALANCE_USD ar_usd, AR_OVERDUE_USD ar_overdue_usd, AP_BALANCE_USD ap_usd,
                      INVENTORY_USD inventory_usd, NET_WORKING_CAPITAL_USD nwc_usd, DSO dso, DPO dpo, DIO dio, CCC ccc
                 FROM {wc_kpi}
              QUALIFY ROW_NUMBER() OVER (PARTITION BY COMPANY_CODE ORDER BY MONTH_END DESC) = 1""")
    pnl_ccy = q(f"SELECT c.GOLDEN_ID company_code, c.CURRENCY currency, c.RATE_TO_USD rate_to_usd FROM {golden_company} c")
    geo = q(f"""SELECT GOLDEN_ID id, NODE_TYPE type, NODE_NAME name, CITY city, COUNTRY country, LATITUDE lat, LONGITUDE lon,
                       PLANT plant, LOCATION_ASSUMED location_assumed FROM {v_geo} ORDER BY NODE_TYPE, GOLDEN_ID""")
    flows = q(f"""SELECT FLOW_ID id, FLOW_TYPE type, MATERIAL_CATEGORY category, MONTHLY_VOLUME volume, MONTHLY_VALUE value_usd,
                         SOURCE_ID source, TARGET_ID target, SOURCE_PLANT source_plant, TARGET_PLANT target_plant
                    FROM {v_flow} ORDER BY FLOW_ID""")
    capacity = q(f"""SELECT PLANT plant, AVAILABLE_HRS available_hrs, USED_HRS used_hrs, FREE_HRS free_hrs, HEADROOM_PCT headroom_pct,
                            UTILIZATION_PCT utilization_pct, UNITS_SHIPPED units_shipped, HRS_PER_UNIT hrs_per_unit
                       FROM {v_capacity} ORDER BY PLANT""")
    buffer = q(f"""SELECT PLANT plant, MIN_DAYS_OF_INVENTORY min_days, AVG_DAYS_OF_INVENTORY avg_days, STOCK_VALUE stock_value_usd
                     FROM {v_buffer} ORDER BY PLANT""")
    substitution = q(f"""SELECT MATERIAL_CATEGORY category, PLANT plant, VOLUME volume, VALUE value_usd, CAPABLE_PLANTS capable_plants
                           FROM {v_subst} ORDER BY 1, 2""")
    scenario = {"period": period, "weeks": weeks, "plants": plants, "supplier_plant": supplier_plant,
                "plant_customer": plant_customer, "money_edges": money_edges, "working_capital": wc, "fx": pnl_ccy,
                "geo": geo, "flows": flows, "capacity": capacity, "buffer": buffer, "substitution": substitution}

    # Where each part came from, as concept -> object, for the app's lineage table.
    source = {
        "companies": {"Legal Entity": company_360}, "customers": {"Customer": customer_360},
        "suppliers": {"Supplier": supplier_360}, "exposure": {"Supplier": exposure_view},
        "crosswalk": {"Local Customer": crosswalk_view, "Local Supplier": supplier_member},
        "departments": {"Department": golden_department},
        "scenario": {"Sales Order": orders, "Plant": plant_master, "Component Lot": genealogy,
                     "Legal Entity": wc_kpi, "Material Flow": v_flow},
        "instances": {"knowledge graph": kg_edge, "edges": {k: " ".join(v) for k, v in EDGE_RELATIONSHIP.items()}},
    }
    return {"source": "Snowflake Business Ontology: Enterprise", "ontology_source": source, "stats": stats,
            "companies": companies, "customers": customers, "suppliers": suppliers, "exposure": exposure,
            "departments": departments, "scenario": scenario, "crosswalk": crosswalk, "crosswalk_summary": xw_summary,
            "notes": {
                "identity": "Customer and supplier golden records come from a deterministic demo crosswalk "
                            "(the six apps share no keys). A production build would use MDG / match-merge output.",
                "currency": "USD at company planning rates (USD 1.00, EUR 1.08, JPY 0.0067). Sales order value is "
                            "USD orders only; CRM pipeline in other currencies is converted where a rate exists.",
                "sales_scale": "Sales 360 order values come from the SAP BDC demo tenant and are much larger than the "
                               "Supply Chain demo orders; compare within an app, not across.",
            }}


# Keys the old, table-reading export produced that the ontology-driven one must reproduce.
PARITY_KEYS = ["companies", "customers", "suppliers", "exposure", "departments", "scenario",
               "crosswalk", "crosswalk_summary", "notes"]
# Compared as row sets: the old export left ties in an arbitrary order.
UNORDERED = {"exposure"}


def main():
    check = "--check" in sys.argv
    con = snowflake.connector.connect(**conn_params())
    payload = json.loads(json.dumps(build(con.cursor()), default=str))
    con.close()
    if check:
        old = json.loads(OUT.read_text())
        def same(k):
            if k in UNORDERED:
                canon = lambda rs: sorted(json.dumps(r, sort_keys=True) for r in rs or [])
                return canon(old.get(k)) == canon(payload.get(k))
            return old.get(k) == payload.get(k)
        diffs = [k for k in PARITY_KEYS if not same(k)]
        diffs += [f"stats.{k}" for k in ("nodes", "edges", "crosswalk_records")
                  if old.get("stats", {}).get(k) != payload["stats"].get(k)]
        print("parity: IDENTICAL" if not diffs else f"parity: DIFFERENT in {diffs}")
        sys.exit(1 if diffs else 0)
    OUT.write_text(json.dumps(payload))
    print(f"wrote {OUT.name}: {payload['stats']['nodes']} nodes, {payload['stats']['edges']} edges, "
          f"{len(payload['crosswalk'])} crosswalk records")


if __name__ == "__main__":
    main()

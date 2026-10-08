-- =====================================================================
-- SAP Enterprise Ontology — 03: cross-domain 360 facts per golden entity
--
-- Each source is aggregated to the golden id FIRST, then joined, so a
-- one-to-many crosswalk never multiplies amounts. Money is converted to USD
-- at the company planning rates in Working Capital 360 (USD 1.00, EUR 1.08,
-- JPY 0.0067); CRM pipeline in other currencies is excluded and counted.
-- Sales order value is USD orders only (Sales 360 also books EUR, AUD ...).
-- =====================================================================
USE DATABASE SAP_ENTERPRISE_ONTOLOGY;

CREATE OR REPLACE VIEW ANALYTICS.FX AS
SELECT CURRENCY, RATE_TO_USD FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DIM_COMPANY;

-- ---------------------------------------------------------------- company 360
CREATE OR REPLACE DYNAMIC TABLE ANALYTICS.DT_COMPANY_360
  TARGET_LAG = '1 day' REFRESH_MODE = FULL WAREHOUSE = LOAD_WH
  COMMENT = 'Golden legal entity across Finance, Working Capital, People, Spend and Supply Chain (USD).'
AS
WITH fin AS (
  SELECT p.COMPANYCODE gid, SUM(p.REVENUE * fx.RATE_TO_USD) revenue_usd, SUM(p.EXPENSES * fx.RATE_TO_USD) expenses_usd,
         SUM(p.NET_INCOME * fx.RATE_TO_USD) net_income_usd
  FROM SAP_FINANCE_360.ANALYTICS.DT_PNL_SUMMARY p JOIN ANALYTICS.FX fx ON fx.CURRENCY = p.COMPANYCODECURRENCY GROUP BY 1),
wcp AS (
  SELECT COMPANY_CODE gid, DSO, DPO, DIO, CCC, AR_OVERDUE_USD, NET_WORKING_CAPITAL_USD, MONTH_END wc_month
  FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DT_WC_MONTHLY_KPI
  QUALIFY ROW_NUMBER() OVER (PARTITION BY COMPANY_CODE ORDER BY MONTH_END DESC) = 1),
ppl AS (
  SELECT m.GOLDEN_ID gid, SUM(w.HEADCOUNT) headcount, SUM(w.TERMINATIONS) terminations,
         SUM(IFF(w.EMPLOYMENT_STATUS = 'Active', w.ANNUAL_SALARY * fx.RATE_TO_USD, 0)) salary_cost_usd
  FROM SAP_PEOPLE_360.ANALYTICS.DT_WORKFORCE_360 w
  JOIN XWALK.COMPANY_MEMBER m ON m.MODULE = 'PPL' AND m.LOCAL_ID = w.COMPANY
  JOIN ANALYTICS.FX fx ON fx.CURRENCY = w.CURRENCY GROUP BY 1),
spd AS (
  SELECT m.GOLDEN_ID gid, SUM(s.SPEND * fx.RATE_TO_USD) spend_usd,
         100 * SUM(IFF(s.IS_ON_CONTRACT, s.SPEND * fx.RATE_TO_USD, 0)) / NULLIF(SUM(s.SPEND * fx.RATE_TO_USD), 0) on_contract_pct,
         COUNT(DISTINCT s.SUPPLIER) spend_suppliers
  FROM SAP_SPEND_360.ANALYTICS.DT_SPEND_360 s
  JOIN XWALK.COMPANY_MEMBER m ON m.MODULE = 'SPD' AND m.LOCAL_ID = s.COMPANY
  JOIN ANALYTICS.FX fx ON fx.CURRENCY = s.CURRENCY GROUP BY 1),
scm AS (
  SELECT m.GOLDEN_ID gid, COUNT(DISTINCT p.PLANT) plants,
         ROUND(100 * COUNT_IF(o.OTIF) / NULLIF(COUNT(o.SALES_ORDER), 0), 1) otif_pct, SUM(o.LATE_COST_USD) late_cost_usd
  FROM SAP_SUPPLY_CHAIN.PLANT.A_PLANT p
  JOIN XWALK.COMPANY_MEMBER m ON m.MODULE = 'SCM' AND m.LOCAL_ID = p.COMPANY_CODE
  LEFT JOIN SAP_SUPPLY_CHAIN.ANALYTICS.DT_ORDER_FULFILLMENT o ON o.PLANT = p.PLANT GROUP BY 1),
opr AS (
  SELECT m.GOLDEN_ID gid, ROUND(100 * SUM(r.PRODUCED_UNITS) / NULLIF(SUM(r.NAMEPLATE_UNITS), 0), 1) operating_rate_pct
  FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_OPERATING_RATE r
  JOIN SAP_SUPPLY_CHAIN.PLANT.A_PLANT p ON p.PLANT = r.PLANT
  JOIN XWALK.COMPANY_MEMBER m ON m.MODULE = 'SCM' AND m.LOCAL_ID = p.COMPANY_CODE GROUP BY 1)
SELECT c.GOLDEN_ID AS COMPANY_CODE, c.NAME AS COMPANY, c.REGION, c.CURRENCY,
       ROUND(fin.revenue_usd) REVENUE_USD, ROUND(fin.expenses_usd) EXPENSES_USD, ROUND(fin.net_income_usd) NET_INCOME_USD,
       ROUND(100 * fin.net_income_usd / NULLIF(fin.revenue_usd, 0), 1) NET_MARGIN_PCT,
       wcp.DSO, wcp.DPO, wcp.DIO, wcp.CCC, ROUND(wcp.AR_OVERDUE_USD) AR_OVERDUE_USD,
       ROUND(wcp.NET_WORKING_CAPITAL_USD) NET_WORKING_CAPITAL_USD, wcp.wc_month WC_MONTH,
       ppl.headcount HEADCOUNT, ppl.terminations TERMINATIONS, ROUND(ppl.salary_cost_usd) SALARY_COST_USD,
       ROUND(fin.revenue_usd / NULLIF(ppl.headcount, 0)) REVENUE_PER_EMPLOYEE_USD,
       ROUND(spd.spend_usd) SPEND_USD, ROUND(spd.on_contract_pct, 1) ON_CONTRACT_PCT, spd.spend_suppliers SPEND_SUPPLIERS,
       scm.plants PLANTS, scm.otif_pct OTIF_PCT, scm.late_cost_usd LATE_COST_USD, opr.operating_rate_pct OPERATING_RATE_PCT
FROM XWALK.GOLDEN_COMPANY c
LEFT JOIN fin ON fin.gid = c.GOLDEN_ID LEFT JOIN wcp ON wcp.gid = c.GOLDEN_ID LEFT JOIN ppl ON ppl.gid = c.GOLDEN_ID
LEFT JOIN spd ON spd.gid = c.GOLDEN_ID LEFT JOIN scm ON scm.gid = c.GOLDEN_ID LEFT JOIN opr ON opr.gid = c.GOLDEN_ID;

-- ---------------------------------------------------------------- customer 360
CREATE OR REPLACE DYNAMIC TABLE ANALYTICS.DT_CUSTOMER_360
  TARGET_LAG = '1 day' REFRESH_MODE = FULL WAREHOUSE = LOAD_WH
  COMMENT = 'Golden customer across Finance AR, Working Capital AR, Sales orders + CRM pipeline, Supply Chain OTIF (USD).'
AS
WITH mem AS (SELECT GOLDEN_ID gid, COUNT(*) members, COUNT(DISTINCT MODULE) modules,
                    LISTAGG(DISTINCT MODULE, ',') WITHIN GROUP (ORDER BY MODULE) module_list
               FROM XWALK.CUSTOMER_MEMBER GROUP BY 1),
fin AS (SELECT m.GOLDEN_ID gid, SUM(a.OPENAMOUNT * fx.RATE_TO_USD) fin_ar_open_usd,
               SUM(IFF(a.IS_OVERDUE, a.OPENAMOUNT * fx.RATE_TO_USD, 0)) fin_ar_overdue_usd, AVG(a.DAYS_TO_PAY) fin_days_to_pay
          FROM SAP_FINANCE_360.ANALYTICS.DT_AR_AGING a
          JOIN XWALK.CUSTOMER_MEMBER m ON m.MODULE = 'FIN' AND m.LOCAL_ID = a.CUSTOMER
          JOIN ANALYTICS.FX fx ON fx.CURRENCY = a.DOCUMENTCURRENCY GROUP BY 1),
wcp AS (SELECT m.GOLDEN_ID gid, SUM(i.AMOUNT_USD) wc_ar_usd, SUM(IFF(i.IS_OPEN AND i.DAYS_PAST_DUE > 0, i.AMOUNT_USD, 0)) wc_ar_overdue_usd,
               COUNT_IF(i.IS_DISPUTED) wc_disputes, MAX(i.CREDIT_RISK) credit_risk
          FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DT_AR_ITEMS i
          JOIN XWALK.CUSTOMER_MEMBER m ON m.MODULE = 'WCP' AND m.LOCAL_ID = i.CUSTOMER_ID GROUP BY 1),
sal AS (SELECT m.GOLDEN_ID gid, COUNT(*) sales_orders, SUM(o.TOTALNETAMOUNT) sales_order_value_usd
          FROM SAP_SALES_360.SALES_360_L2.SALESORDERS_SALESORDER o
          JOIN XWALK.CUSTOMER_MEMBER m ON m.MODULE = 'SAL' AND m.LOCAL_ID = o.SOLDTOPARTY
         WHERE o.TRANSACTIONCURRENCY = 'USD' GROUP BY 1),
crm AS (SELECT m.GOLDEN_ID gid, SUM(IFF(NOT o.IS_CLOSED, o.AMOUNT * fx.RATE_TO_USD, 0)) open_pipeline_usd,
               SUM(IFF(NOT o.IS_CLOSED, o.AMOUNT * o.PROBABILITY / 100 * fx.RATE_TO_USD, 0)) weighted_pipeline_usd,
               COUNT_IF(o.IS_WON) won_opps, COUNT_IF(o.IS_CLOSED) closed_opps
          FROM SAP_SALES_360.SALES_360_L2.CRM_OPPORTUNITY_OPPORTUNITY o
          JOIN XWALK.CUSTOMER_MEMBER m ON m.MODULE = 'SAL' AND m.LOCAL_ID = o.SAP_CUSTOMER_KEY
          JOIN ANALYTICS.FX fx ON fx.CURRENCY = o.CURRENCY_ISO_CODE GROUP BY 1),
scm AS (SELECT m.GOLDEN_ID gid, COUNT(*) scm_orders, ROUND(100 * COUNT_IF(o.OTIF) / COUNT(*), 1) scm_otif_pct,
               SUM(o.LATE_COST_USD) scm_late_cost_usd, SUM(o.NET_VALUE_USD) scm_order_value_usd
          FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_ORDER_FULFILLMENT o
          JOIN SAP_SUPPLY_CHAIN.ONTOLOGY.KG_NODE n ON n.NODE_TYPE = 'Customer' AND n.NAME = o.SOLD_TO
          JOIN XWALK.CUSTOMER_MEMBER m ON m.MODULE = 'SCM' AND m.LOCAL_ID = n.NODE_ID GROUP BY 1)
SELECT g.GOLDEN_ID AS CUSTOMER_ID, g.NAME AS CUSTOMER, g.SEED_MODULE, mem.members MEMBERS, mem.modules MODULES, mem.module_list MODULE_LIST,
       ROUND(COALESCE(sal.sales_order_value_usd, 0) + COALESCE(scm.scm_order_value_usd, 0)) ORDER_VALUE_USD,
       sal.sales_orders SALES_ORDERS, ROUND(sal.sales_order_value_usd) SALES_ORDER_VALUE_USD,
       ROUND(crm.open_pipeline_usd) OPEN_PIPELINE_USD, ROUND(crm.weighted_pipeline_usd) WEIGHTED_PIPELINE_USD,
       ROUND(100 * crm.won_opps / NULLIF(crm.closed_opps, 0), 1) WIN_RATE_PCT,
       ROUND(COALESCE(fin.fin_ar_open_usd, 0) + COALESCE(wcp.wc_ar_usd, 0)) AR_USD,
       ROUND(COALESCE(fin.fin_ar_overdue_usd, 0) + COALESCE(wcp.wc_ar_overdue_usd, 0)) AR_OVERDUE_USD,
       ROUND(fin.fin_days_to_pay, 1) DAYS_TO_PAY, wcp.wc_disputes DISPUTES, wcp.credit_risk CREDIT_RISK,
       scm.scm_orders SCM_ORDERS, scm.scm_otif_pct OTIF_PCT, scm.scm_late_cost_usd LATE_COST_USD,
       'demo crosswalk' AS IDENTITY_SOURCE
FROM XWALK.GOLDEN_CUSTOMER g
LEFT JOIN mem ON mem.gid = g.GOLDEN_ID LEFT JOIN fin ON fin.gid = g.GOLDEN_ID LEFT JOIN wcp ON wcp.gid = g.GOLDEN_ID
LEFT JOIN sal ON sal.gid = g.GOLDEN_ID LEFT JOIN crm ON crm.gid = g.GOLDEN_ID LEFT JOIN scm ON scm.gid = g.GOLDEN_ID;

-- ---------------------------------------------------------------- supplier 360
CREATE OR REPLACE DYNAMIC TABLE ANALYTICS.DT_SUPPLIER_360
  TARGET_LAG = '1 day' REFRESH_MODE = FULL WAREHOUSE = LOAD_WH
  COMMENT = 'Golden supplier across Spend, Working Capital AP, Finance AP and Supply Chain component lots (USD).'
AS
WITH mem AS (SELECT GOLDEN_ID gid, COUNT(*) members, COUNT(DISTINCT MODULE) modules,
                    LISTAGG(DISTINCT MODULE, ',') WITHIN GROUP (ORDER BY MODULE) module_list
               FROM XWALK.SUPPLIER_MEMBER GROUP BY 1),
spd AS (SELECT m.GOLDEN_ID gid, SUM(s.SPEND * fx.RATE_TO_USD) spend_usd,
               100 * SUM(IFF(s.IS_ON_CONTRACT, s.SPEND * fx.RATE_TO_USD, 0)) / NULLIF(SUM(s.SPEND * fx.RATE_TO_USD), 0) on_contract_pct
          FROM SAP_SPEND_360.ANALYTICS.DT_SPEND_360 s
          JOIN XWALK.SUPPLIER_MEMBER m ON m.MODULE = 'SPD' AND m.LOCAL_ID = s.SUPPLIER
          JOIN ANALYTICS.FX fx ON fx.CURRENCY = s.CURRENCY GROUP BY 1),
rsk AS (SELECT m.GOLDEN_ID gid, MAX(r.RISK_SCORE) max_risk_score, BOOLOR_AGG(r.IS_SINGLE_SOURCE) any_single_source,
               AVG(r.ESG_SCORE) esg_score, ANY_VALUE(r.PRIMARY_CATEGORY) primary_category
          FROM SAP_SPEND_360.ANALYTICS.DT_SUPPLIER_RISK r
          JOIN XWALK.SUPPLIER_MEMBER m ON m.MODULE = 'SPD' AND m.LOCAL_ID = r.SUPPLIER GROUP BY 1),
wcp AS (SELECT m.GOLDEN_ID gid, SUM(IFF(a.IS_OPEN, a.AMOUNT_USD, 0)) ap_open_usd, SUM(a.DISCOUNT_LOST_USD) discount_lost_usd,
               SUM(a.DD_OPPORTUNITY_USD) dd_opportunity_usd, AVG(a.DAYS_TO_PAY) days_to_pay
          FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DT_AP_ITEMS a
          JOIN XWALK.SUPPLIER_MEMBER m ON m.MODULE = 'WCP' AND m.LOCAL_ID = a.SUPPLIER_ID GROUP BY 1),
fin AS (SELECT m.GOLDEN_ID gid, SUM(IFF(a.SUPPLIERINVOICESTATUS <> 'Paid', a.INVOICEGROSSAMOUNT * fx.RATE_TO_USD, 0)) fin_ap_open_usd
          FROM SAP_FINANCE_360.ANALYTICS.DT_AP_AGING a
          JOIN XWALK.SUPPLIER_MEMBER m ON m.MODULE = 'FIN' AND m.LOCAL_ID = a.VENDOR
          JOIN ANALYTICS.FX fx ON fx.CURRENCY = a.DOCUMENTCURRENCY GROUP BY 1),
lot AS (SELECT m.GOLDEN_ID gid, COUNT(DISTINCT g.LOT_ID) lots,
               COUNT(DISTINCT IFF(g.INSPECTION_RESULT <> 'Accepted', g.LOT_ID, NULL)) deviating_lots,
               COUNT(DISTINCT IFF(g.INSPECTION_RESULT <> 'Accepted', g.SERIAL_NO, NULL)) systems_with_deviating_lots
          FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_SERIAL_GENEALOGY g
          JOIN XWALK.SUPPLIER_MEMBER m ON m.MODULE = 'SCM' AND m.LOCAL_ID = g.SUPPLIER GROUP BY 1),
cov AS (SELECT m.GOLDEN_ID gid, COUNT_IF(c.STATUS = 'Critical') critical_components,
               MAX(c.SUPPLIER_LEAD_TIME_DAYS - c.DAYS_OF_COVER) worst_shortfall_days
          FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_COMPONENT_COVER c
          JOIN XWALK.SUPPLIER_MEMBER m ON m.MODULE = 'SCM' AND m.LOCAL_ID = c.SUPPLIER GROUP BY 1)
SELECT g.GOLDEN_ID AS SUPPLIER_ID, g.NAME AS SUPPLIER, g.SEED_MODULE, mem.members MEMBERS, mem.modules MODULES, mem.module_list MODULE_LIST,
       ROUND(spd.spend_usd) SPEND_USD, ROUND(spd.on_contract_pct, 1) ON_CONTRACT_PCT,
       rsk.max_risk_score MAX_RISK_SCORE, rsk.any_single_source SINGLE_SOURCE, ROUND(rsk.esg_score, 1) ESG_SCORE, rsk.primary_category PRIMARY_CATEGORY,
       ROUND(COALESCE(wcp.ap_open_usd, 0) + COALESCE(fin.fin_ap_open_usd, 0)) AP_OPEN_USD,
       ROUND(wcp.discount_lost_usd) DISCOUNT_LOST_USD, ROUND(wcp.dd_opportunity_usd) DYNAMIC_DISCOUNT_OPPORTUNITY_USD,
       ROUND(wcp.days_to_pay, 1) DAYS_TO_PAY,
       lot.lots COMPONENT_LOTS, lot.deviating_lots DEVIATING_LOTS, lot.systems_with_deviating_lots SYSTEMS_WITH_DEVIATING_LOTS,
       cov.critical_components CRITICAL_COMPONENTS, cov.worst_shortfall_days WORST_SHORTFALL_DAYS,
       'demo crosswalk' AS IDENTITY_SOURCE
FROM XWALK.GOLDEN_SUPPLIER g
LEFT JOIN mem ON mem.gid = g.GOLDEN_ID LEFT JOIN spd ON spd.gid = g.GOLDEN_ID LEFT JOIN rsk ON rsk.gid = g.GOLDEN_ID
LEFT JOIN wcp ON wcp.gid = g.GOLDEN_ID LEFT JOIN fin ON fin.gid = g.GOLDEN_ID LEFT JOIN lot ON lot.gid = g.GOLDEN_ID
LEFT JOIN cov ON cov.gid = g.GOLDEN_ID;

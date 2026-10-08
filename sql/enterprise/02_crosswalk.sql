-- =====================================================================
-- SAP Enterprise Ontology — 02: golden records and member crosswalk
--
-- The six 360 apps were built from different SAP BDC demo tenants and share
-- no customer or supplier keys. This crosswalk resolves each app's local
-- records to one golden record, deterministically (rank-based), so the same
-- build always produces the same mapping. It is DEMO ENRICHMENT: a real
-- deployment would replace it with MDG / match-merge output, and every
-- consumer reads MATCH_METHOD so the provenance is never hidden.
--
-- Seeds follow the Supply Chain baseline:
--   golden customers 1-8  = the Supply Chain customer nodes (TSMC, Samsung, ...)
--   golden customers 9-20 = Finance AR customers CUST009-CUST020
--   golden suppliers 1-6  = the Supply Chain suppliers (Hamamatsu, Coherent, ...)
--   golden suppliers 7-25 = Working Capital supplier names V0007-V0025
-- =====================================================================
USE DATABASE SAP_ENTERPRISE_ONTOLOGY;

-- ---------------------------------------------------------------- legal entities
CREATE OR REPLACE TABLE XWALK.GOLDEN_COMPANY AS
SELECT COMPANY_CODE AS GOLDEN_ID, COMPANY AS NAME, CURRENCY, REGION, RATE_TO_USD
FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DIM_COMPANY;

-- Each app's company identifier -> golden company code. Finance, Working Capital
-- and ERP use the codes; People and Spend use the names; Supply Chain plants
-- carry their own company codes (1000 / 2000 / 3000), mapped by region.
CREATE OR REPLACE TABLE XWALK.COMPANY_MEMBER (MODULE VARCHAR, LOCAL_ID VARCHAR, GOLDEN_ID VARCHAR, MATCH_METHOD VARCHAR);
INSERT INTO XWALK.COMPANY_MEMBER
SELECT m, c.GOLDEN_ID, c.GOLDEN_ID, 'exact code' FROM XWALK.GOLDEN_COMPANY c, (SELECT column1 m FROM VALUES ('FIN'), ('WCP'))
UNION ALL SELECT m, c.NAME, c.GOLDEN_ID, 'exact name' FROM XWALK.GOLDEN_COMPANY c, (SELECT column1 m FROM VALUES ('PPL'), ('SPD'))
UNION ALL SELECT 'SCM', column1, column2, 'regional mapping (demo)' FROM VALUES ('1000','1000'), ('2000','2100'), ('3000','5000');

-- ---------------------------------------------------------------- customers
CREATE OR REPLACE TABLE XWALK.GOLDEN_CUSTOMER AS
WITH sc AS (
  SELECT ROW_NUMBER() OVER (ORDER BY NODE_ID) AS n, NAME, PROPS:COUNTRY::STRING AS COUNTRY
  FROM SAP_SUPPLY_CHAIN.ONTOLOGY.KG_NODE WHERE NODE_TYPE = 'Customer'),
fin AS (
  SELECT DISTINCT TRY_TO_NUMBER(REGEXP_SUBSTR(CUSTOMER, '\\d+')) AS n, CUSTOMERNAME AS NAME
  FROM SAP_FINANCE_360.ANALYTICS.DT_AR_AGING)
SELECT 'GC-' || LPAD(n, 3, '0') AS GOLDEN_ID, NAME, COUNTRY, 'SCM' AS SEED_MODULE FROM sc
UNION ALL
SELECT 'GC-' || LPAD(n, 3, '0'), NAME, NULL, 'FIN' FROM fin WHERE n BETWEEN 9 AND 20;

CREATE OR REPLACE TABLE XWALK.CUSTOMER_MEMBER AS
WITH g AS (SELECT COUNT(*) k FROM XWALK.GOLDEN_CUSTOMER),
sc AS (SELECT 'SCM' MODULE, NODE_ID LOCAL_ID, NAME LOCAL_NAME, ROW_NUMBER() OVER (ORDER BY NODE_ID) r
         FROM SAP_SUPPLY_CHAIN.ONTOLOGY.KG_NODE WHERE NODE_TYPE = 'Customer'),
fin AS (SELECT DISTINCT 'FIN' MODULE, CUSTOMER LOCAL_ID, CUSTOMERNAME LOCAL_NAME,
               TRY_TO_NUMBER(REGEXP_SUBSTR(CUSTOMER, '\\d+')) r FROM SAP_FINANCE_360.ANALYTICS.DT_AR_AGING),
wcp AS (SELECT 'WCP' MODULE, CUSTOMER_ID LOCAL_ID, CUSTOMER_NAME LOCAL_NAME, ROW_NUMBER() OVER (ORDER BY CUSTOMER_ID) r
          FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DIM_CUSTOMER),
-- Sales: the 40 largest sold-to parties by USD order value (Sales also books EUR, AUD, ...; only USD is summed).
sal AS (SELECT 'SAL' MODULE, o.SOLDTOPARTY LOCAL_ID, ANY_VALUE(c.CUSTOMERNAME) LOCAL_NAME,
               ROW_NUMBER() OVER (ORDER BY SUM(o.TOTALNETAMOUNT) DESC) r
          FROM SAP_SALES_360.SALES_360_L2.SALESORDERS_SALESORDER o
          LEFT JOIN SAP_SALES_360.SALES_360_L2.CUSTOMER_CUSTOMER c ON c.CUSTOMER = o.SOLDTOPARTY
         WHERE o.TRANSACTIONCURRENCY = 'USD' GROUP BY o.SOLDTOPARTY QUALIFY r <= 40)
SELECT u.MODULE, u.LOCAL_ID, u.LOCAL_NAME,
       'GC-' || LPAD(MOD(u.r - 1, g.k) + 1, 3, '0') AS GOLDEN_ID,
       IFF(u.MODULE IN ('SCM', 'FIN') AND u.r <= g.k, 'seed record', 'rank-based demo crosswalk') AS MATCH_METHOD
FROM (SELECT * FROM sc UNION ALL SELECT * FROM fin UNION ALL SELECT * FROM wcp UNION ALL SELECT * FROM sal) u, g;

-- ---------------------------------------------------------------- suppliers
CREATE OR REPLACE TABLE XWALK.GOLDEN_SUPPLIER AS
WITH sc AS (SELECT ROW_NUMBER() OVER (ORDER BY NODE_ID) n, NAME, PROPS:COUNTRY::STRING COUNTRY
              FROM SAP_SUPPLY_CHAIN.ONTOLOGY.KG_NODE WHERE NODE_TYPE = 'Supplier'),
wc AS (SELECT TRY_TO_NUMBER(REGEXP_SUBSTR(SUPPLIER_ID, '\\d+')) n, SUPPLIER_NAME NAME, CATEGORY
         FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DIM_SUPPLIER)
SELECT 'GS-' || LPAD(n, 3, '0') GOLDEN_ID, NAME, COUNTRY, 'SCM' SEED_MODULE FROM sc
UNION ALL
SELECT 'GS-' || LPAD(n, 3, '0'), NAME, NULL, 'WCP' FROM wc WHERE n BETWEEN 7 AND 25;

CREATE OR REPLACE TABLE XWALK.SUPPLIER_MEMBER AS
WITH g AS (SELECT COUNT(*) k FROM XWALK.GOLDEN_SUPPLIER),
sc AS (SELECT 'SCM' MODULE, NODE_ID LOCAL_ID, NAME LOCAL_NAME, ROW_NUMBER() OVER (ORDER BY NODE_ID) r
         FROM SAP_SUPPLY_CHAIN.ONTOLOGY.KG_NODE WHERE NODE_TYPE = 'Supplier'),
-- Finance AP and Working Capital share the V00nn vendor key space.
wcp AS (SELECT 'WCP' MODULE, SUPPLIER_ID LOCAL_ID, SUPPLIER_NAME LOCAL_NAME,
               TRY_TO_NUMBER(REGEXP_SUBSTR(SUPPLIER_ID, '\\d+')) r FROM SAP_WORKING_CAPITAL_360.ANALYTICS.DIM_SUPPLIER),
fin AS (SELECT DISTINCT 'FIN' MODULE, VENDOR LOCAL_ID, VENDOR LOCAL_NAME,
               TRY_TO_NUMBER(REGEXP_SUBSTR(VENDOR, '\\d+')) r FROM SAP_FINANCE_360.ANALYTICS.DT_AP_AGING),
-- Spend: 245 suppliers, ranked by annual spend so the largest land on distinct golden records.
spd AS (SELECT 'SPD' MODULE, SUPPLIER LOCAL_ID, SUPPLIER_NAME LOCAL_NAME,
               ROW_NUMBER() OVER (ORDER BY ANNUAL_SPEND DESC, SUPPLIER) r FROM SAP_SPEND_360.ANALYTICS.DT_SUPPLIER_RISK)
SELECT u.MODULE, u.LOCAL_ID, u.LOCAL_NAME,
       'GS-' || LPAD(MOD(u.r - 1, g.k) + 1, 3, '0') AS GOLDEN_ID,
       CASE WHEN u.MODULE = 'SCM' THEN 'seed record'
            WHEN u.MODULE IN ('WCP', 'FIN') AND u.r BETWEEN 7 AND 25 THEN 'seed record'
            WHEN u.MODULE IN ('WCP', 'FIN') THEN 'shared vendor key, folded (demo)'
            ELSE 'rank-based demo crosswalk' END AS MATCH_METHOD
FROM (SELECT * FROM sc UNION ALL SELECT * FROM wcp UNION ALL SELECT * FROM fin UNION ALL SELECT * FROM spd) u, g;

-- ---------------------------------------------------------------- departments
CREATE OR REPLACE TABLE XWALK.GOLDEN_DEPARTMENT (GOLDEN_ID VARCHAR, NAME VARCHAR, FIN_CODE VARCHAR, MATCH_METHOD VARCHAR);
INSERT INTO XWALK.GOLDEN_DEPARTMENT
SELECT 'GD-' || LOWER(REPLACE(REPLACE(column1, ' ', '-'), '&', 'and')), column1, column2,
       IFF(column2 IS NULL, 'People only', 'name to cost-center code') FROM VALUES
  ('Operations', 'PROD'), ('Legal', 'LEGAL'), ('Sales', 'SALES'), ('Customer Service', 'SVC'),
  ('Supply Chain', 'SCM'), ('Finance', 'FIN'), ('R&D', 'RND'), ('Marketing', 'MKT'),
  ('Engineering', 'QA'), ('Human Resources', 'HR'), ('IT', 'IT'), ('Procurement', NULL);

-- One view over every member table: the full crosswalk with provenance.
CREATE OR REPLACE VIEW XWALK.V_CROSSWALK AS
SELECT 'Customer' ENTITY, MODULE, LOCAL_ID, LOCAL_NAME, GOLDEN_ID, MATCH_METHOD FROM XWALK.CUSTOMER_MEMBER
UNION ALL SELECT 'Supplier', MODULE, LOCAL_ID, LOCAL_NAME, GOLDEN_ID, MATCH_METHOD FROM XWALK.SUPPLIER_MEMBER
UNION ALL SELECT 'LegalEntity', MODULE, LOCAL_ID, LOCAL_ID, GOLDEN_ID, MATCH_METHOD FROM XWALK.COMPANY_MEMBER;

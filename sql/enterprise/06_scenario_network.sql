-- =====================================================================
-- 06 — Scenario network for impact maps, risk and mitigation
--
-- Geography, plant capacity, inventory buffers and plant capability, keyed
-- to the golden records so the enterprise scenario engine can draw the
-- ripple on a map and size the mitigations.
--
-- Reads Supply Chain 360's own tables only (MANUFACTURING_CODES, PLANT,
-- ANALYTICS). Nothing here depends on the Supply Chain Ontology app.
--
-- HRS_PER_UNIT is derived — used hours / units shipped, blended across every
-- work center and product at the plant. Planning-grade: good for "can this
-- plant absorb N more units", not a routing-level capacity check.
-- =====================================================================
USE DATABASE SAP_ENTERPRISE_ONTOLOGY;
CREATE SCHEMA IF NOT EXISTS SCENARIO COMMENT = 'Geography, capacity, buffers and capability for scenario impact, risk and mitigation';

-- Physical nodes with their golden record. Legal entities have no address in
-- the 360 apps, so each is placed at its first plant through the SCM company
-- crosswalk (US -> San Jose, EU -> Dresden, Japan -> Singapore). That siting is
-- an assumption and is flagged LOCATION_ASSUMED.
CREATE OR REPLACE VIEW SCENARIO.V_GEO AS
SELECT n.NODE_ID, n.NODE_TYPE, n.NODE_NAME, n.CITY, n.COUNTRY, n.LATITUDE, n.LONGITUDE, n.PLANT,
       COALESCE(gc.GOLDEN_ID, gs.GOLDEN_ID, IFF(n.NODE_TYPE = 'Plant', 'PLT:' || n.PLANT, NULL)) AS GOLDEN_ID,
       FALSE AS LOCATION_ASSUMED
FROM SAP_SUPPLY_CHAIN.MANUFACTURING_CODES.A_SUPPLY_CHAIN_NODES n
LEFT JOIN XWALK.GOLDEN_CUSTOMER gc ON n.NODE_TYPE = 'Customer' AND gc.NAME = n.NODE_NAME
LEFT JOIN XWALK.GOLDEN_SUPPLIER gs ON n.NODE_TYPE = 'Supplier' AND gs.NAME = n.NODE_NAME
UNION ALL
SELECT 'CO-' || c.GOLDEN_ID, 'LegalEntity', c.NAME, p.CITY, p.COUNTRY, p.LATITUDE, p.LONGITUDE, NULL,
       'CO:' || c.GOLDEN_ID, TRUE
FROM XWALK.GOLDEN_COMPANY c
JOIN (
  SELECT m.GOLDEN_ID, n.CITY, n.COUNTRY, n.LATITUDE, n.LONGITUDE
  FROM SAP_SUPPLY_CHAIN.PLANT.A_PLANT a
  JOIN XWALK.COMPANY_MEMBER m ON m.MODULE = 'SCM' AND m.LOCAL_ID = a.COMPANY_CODE
  JOIN SAP_SUPPLY_CHAIN.MANUFACTURING_CODES.A_SUPPLY_CHAIN_NODES n ON n.NODE_TYPE = 'Plant' AND n.PLANT = a.PLANT
  QUALIFY ROW_NUMBER() OVER (PARTITION BY m.GOLDEN_ID ORDER BY a.PLANT) = 1
) p ON p.GOLDEN_ID = c.GOLDEN_ID;

-- Material flows between physical nodes, by category, with golden ids on both ends.
CREATE OR REPLACE VIEW SCENARIO.V_FLOW AS
SELECT f.FLOW_ID, f.FLOW_TYPE, f.MATERIAL_CATEGORY, f.MONTHLY_VOLUME, f.MONTHLY_VALUE,
       s.GOLDEN_ID AS SOURCE_ID, s.NODE_TYPE AS SOURCE_TYPE, s.PLANT AS SOURCE_PLANT,
       t.GOLDEN_ID AS TARGET_ID, t.NODE_TYPE AS TARGET_TYPE, t.PLANT AS TARGET_PLANT
FROM SAP_SUPPLY_CHAIN.MANUFACTURING_CODES.A_SUPPLY_CHAIN_FLOWS f
JOIN SCENARIO.V_GEO s ON s.NODE_ID = f.SOURCE_NODE
JOIN SCENARIO.V_GEO t ON t.NODE_ID = f.TARGET_NODE;

-- Capacity at the latest period: a scenario is judged against where the plant stands now.
CREATE OR REPLACE VIEW SCENARIO.V_PLANT_CAPACITY AS
WITH latest AS (SELECT MAX(PERIOD_DATE) p FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_WORK_CENTER_UTILIZATION),
cap AS (
  SELECT u.PLANT, u.PLANT_NAME, COUNT(DISTINCT u.WORK_CENTER) WORK_CENTERS,
         SUM(u.AVAILABLE_CAPACITY_HRS) AVAILABLE_HRS, SUM(u.USED_CAPACITY_HRS) USED_HRS
  FROM SAP_SUPPLY_CHAIN.ANALYTICS.DT_WORK_CENTER_UTILIZATION u, latest WHERE u.PERIOD_DATE = latest.p GROUP BY 1, 2),
shipped AS (
  SELECT SOURCE_PLANT PLANT, SUM(MONTHLY_VOLUME) UNITS_SHIPPED FROM SCENARIO.V_FLOW
  WHERE FLOW_TYPE IN ('Outbound', 'Inter-plant') GROUP BY 1)
SELECT c.PLANT, c.PLANT_NAME, c.WORK_CENTERS, c.AVAILABLE_HRS, c.USED_HRS,
       c.AVAILABLE_HRS - c.USED_HRS FREE_HRS,
       ROUND(100 * c.USED_HRS / NULLIF(c.AVAILABLE_HRS, 0), 1) UTILIZATION_PCT,
       ROUND(100 * (c.AVAILABLE_HRS - c.USED_HRS) / NULLIF(c.AVAILABLE_HRS, 0), 1) HEADROOM_PCT,
       s.UNITS_SHIPPED,
       ROUND(c.USED_HRS / NULLIF(s.UNITS_SHIPPED, 0), 2) HRS_PER_UNIT
FROM cap c LEFT JOIN shipped s ON s.PLANT = c.PLANT;

-- Inventory buffer: a plant is starved no faster than its thinnest component stock.
CREATE OR REPLACE VIEW SCENARIO.V_PLANT_BUFFER AS
SELECT s.PLANT, COUNT(*) MATERIALS, MIN(s.DAYS_OF_INVENTORY) MIN_DAYS_OF_INVENTORY,
       ROUND(AVG(s.DAYS_OF_INVENTORY), 1) AVG_DAYS_OF_INVENTORY, SUM(s.STOCK_VALUE) STOCK_VALUE
FROM SAP_SUPPLY_CHAIN.MANUFACTURING_CODES.A_MATERIAL_STOCK s GROUP BY 1;

-- Which plants make each category, from what they actually ship. One capable
-- plant means rerouting cannot help: that is a finding, not a gap.
CREATE OR REPLACE VIEW SCENARIO.V_SUBSTITUTION AS
SELECT MATERIAL_CATEGORY, SOURCE_PLANT PLANT, SUM(MONTHLY_VOLUME) VOLUME, SUM(MONTHLY_VALUE) VALUE,
       COUNT(*) OVER (PARTITION BY MATERIAL_CATEGORY) CAPABLE_PLANTS
FROM SCENARIO.V_FLOW WHERE FLOW_TYPE IN ('Outbound', 'Inter-plant')
GROUP BY 1, 2;

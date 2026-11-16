-- Class views for the Enterprise concepts in Snowflake Business Ontology.
--
-- Each governed Enterprise concept with instances in the knowledge graph gets a
-- VW_ONT_<CONCEPT> view (concept name, no spaces, upper case), the same pattern as
-- the Supply Chain domain. The views are linked to their concepts as representations,
-- and the app finds its inputs by walking the ontology to them, not by table name.
-- Org Unit reuses the existing VW_ONT_ORGUNIT; Party and Facility are Supply Chain
-- concepts and keep their own views there.
USE DATABASE SAP_ENTERPRISE_ONTOLOGY;

CREATE OR REPLACE VIEW CORE.VW_ONT_LEGALENTITY AS
  SELECT NODE_ID, NODE_TYPE, NAME, MODULE, PROPS FROM CORE.KG_NODE WHERE NODE_TYPE = 'LegalEntity';
CREATE OR REPLACE VIEW CORE.VW_ONT_DEPARTMENT AS
  SELECT NODE_ID, NODE_TYPE, NAME, MODULE, PROPS FROM CORE.KG_NODE WHERE NODE_TYPE = 'Department';
CREATE OR REPLACE VIEW CORE.VW_ONT_LOCALCUSTOMER AS
  SELECT NODE_ID, NODE_TYPE, NAME, MODULE, PROPS FROM CORE.KG_NODE WHERE NODE_TYPE = 'LocalCustomer';
CREATE OR REPLACE VIEW CORE.VW_ONT_LOCALSUPPLIER AS
  SELECT NODE_ID, NODE_TYPE, NAME, MODULE, PROPS FROM CORE.KG_NODE WHERE NODE_TYPE = 'LocalSupplier';
CREATE OR REPLACE VIEW CORE.VW_ONT_COSTCENTER AS
  SELECT NODE_ID, NODE_TYPE, NAME, MODULE, PROPS FROM CORE.KG_NODE WHERE NODE_TYPE = 'CostCenter';
CREATE OR REPLACE VIEW CORE.VW_ONT_EMPLOYEE AS
  SELECT NODE_ID, NODE_TYPE, NAME, MODULE, PROPS FROM CORE.KG_NODE WHERE NODE_TYPE = 'Employee';
CREATE OR REPLACE VIEW CORE.VW_ONT_SPENDCATEGORY AS
  SELECT NODE_ID, NODE_TYPE, NAME, MODULE, PROPS FROM CORE.KG_NODE WHERE NODE_TYPE = 'SpendCategory';

-- =====================================================================
-- SAP Enterprise Ontology — 01: database, schemas, upper ontology, modules
--
-- A master ontology over the six SAP BDC 360 applications, built on the
-- Supply Chain ontology as its baseline (same ONT_* / KG_* layout, same
-- abstract-class pattern). Each 360 app is a MODULE that imports the shared
-- upper classes; golden records in XWALK conform identities across modules.
--
--   CORE        ONT_* metadata, KG_NODE / KG_EDGE, abstract VW_ONT_* views
--   XWALK       golden records + member crosswalk (sameAs)
--   ANALYTICS   cross-domain 360 facts per golden entity
--   SEMANTIC    semantic view          AGENTS   Cortex Agent
--
-- Modules: FIN (Finance 360), SAL (Sales 360), PPL (People 360),
--          SPD (Spend 360), WCP (Working Capital 360), SCM (Supply Chain 360)
-- =====================================================================
CREATE DATABASE IF NOT EXISTS SAP_ENTERPRISE_ONTOLOGY
  COMMENT = 'Master ontology spanning Finance, Sales, People, Spend, Working Capital and Supply Chain 360';
USE DATABASE SAP_ENTERPRISE_ONTOLOGY;
CREATE SCHEMA IF NOT EXISTS CORE      COMMENT = 'Ontology metadata (ONT_*), knowledge graph (KG_*), abstract views';
CREATE SCHEMA IF NOT EXISTS XWALK     COMMENT = 'Golden records and member crosswalk across the six 360 apps (demo crosswalk)';
CREATE SCHEMA IF NOT EXISTS ANALYTICS COMMENT = 'Cross-domain 360 facts per golden company, customer and supplier';
CREATE SCHEMA IF NOT EXISTS SEMANTIC;
CREATE SCHEMA IF NOT EXISTS AGENTS;

-- Same table shapes as the Supply Chain ontology, so its tooling and app code carry over.
CREATE OR REPLACE TABLE CORE.ONT_ONTOLOGY     LIKE SAP_SUPPLY_CHAIN.ONTOLOGY.ONT_ONTOLOGY;
CREATE OR REPLACE TABLE CORE.ONT_CLASS        LIKE SAP_SUPPLY_CHAIN.ONTOLOGY.ONT_CLASS;
CREATE OR REPLACE TABLE CORE.ONT_PROPERTY     LIKE SAP_SUPPLY_CHAIN.ONTOLOGY.ONT_PROPERTY;
CREATE OR REPLACE TABLE CORE.ONT_RELATION_DEF LIKE SAP_SUPPLY_CHAIN.ONTOLOGY.ONT_RELATION_DEF;
CREATE OR REPLACE TABLE CORE.ONT_CLASS_MAP    LIKE SAP_SUPPLY_CHAIN.ONTOLOGY.ONT_CLASS_MAP;
CREATE OR REPLACE TABLE CORE.ONT_REL_MAP      LIKE SAP_SUPPLY_CHAIN.ONTOLOGY.ONT_REL_MAP;
CREATE OR REPLACE TABLE CORE.KG_NODE          LIKE SAP_SUPPLY_CHAIN.ONTOLOGY.KG_NODE;
CREATE OR REPLACE TABLE CORE.KG_EDGE          LIKE SAP_SUPPLY_CHAIN.ONTOLOGY.KG_EDGE;
ALTER TABLE CORE.ONT_CLASS        ADD COLUMN MODULE VARCHAR;   -- CORE | FIN | SAL | PPL | SPD | WCP | SCM
ALTER TABLE CORE.ONT_RELATION_DEF ADD COLUMN MODULE VARCHAR;
ALTER TABLE CORE.KG_NODE          ADD COLUMN MODULE VARCHAR;
ALTER TABLE CORE.KG_EDGE          ADD COLUMN MODULE VARCHAR;

CREATE OR REPLACE TABLE CORE.ONT_MODULE (
  MODULE VARCHAR, NAME VARCHAR, SOURCE_DATABASE VARCHAR, APP VARCHAR, COLOR VARCHAR, DESCRIPTION VARCHAR);
INSERT INTO CORE.ONT_MODULE VALUES
  ('CORE','Enterprise core',          'SAP_ENTERPRISE_ONTOLOGY', 'Enterprise Ontology', '#0f172a','Upper classes and golden records shared by every module.'),
  ('FIN', 'Finance 360',              'SAP_FINANCE_360',         'SAP BDC Finance 360', '#0ea5e9','General ledger, P&L, cost and profit centers, AR and AP aging.'),
  ('SAL', 'Sales 360',                'SAP_SALES_360',           'SAP Sales 360',       '#22c55e','Customers, sales orders, products and CRM opportunities.'),
  ('PPL', 'People 360',               'SAP_PEOPLE_360',          'SAP BDC People 360',  '#a855f7','Workforce, departments, compensation, attrition.'),
  ('SPD', 'Spend 360',                'SAP_SPEND_360',           'SAP BDC Spend 360',   '#f59e0b','Purchase orders, categories, supplier risk, contract compliance.'),
  ('WCP', 'Working Capital 360',      'SAP_WORKING_CAPITAL_360', 'SAP BDC Working Capital 360','#14b8a6','AR and AP items, DSO / DPO / DIO, cash and early-pay.'),
  ('SCM', 'Supply Chain 360',         'SAP_SUPPLY_CHAIN',        'Supply Chain 360 + Ontology','#ef4444','Plants, flows, production, equipment, component lots, OTIF.');


-- ---------------------------------------------------------------- classes
-- Upper ontology (CORE) generalises the Supply Chain baseline: Party, Facility,
-- Transaction, Item, Asset stay; LegalEntity, OrgUnit, Product, Measure are added.
INSERT INTO CORE.ONT_CLASS (CLASS_NAME, PARENT_CLASS_NAME, IS_ABSTRACT, DESCRIPTION, ONTOLOGY_NAME, TYPE_CLASS, CREATED_AT, MODULE)
SELECT column1, column2, column3, column4, 'ENTERPRISE', 'OBJECT', CURRENT_TIMESTAMP(), column5 FROM VALUES
  -- upper (abstract) — the shared vocabulary
  ('Entity',        NULL,          TRUE,  'Anything the enterprise ontology can talk about.', 'CORE'),
  ('Party',         'Entity',      TRUE,  'An organisation or person the business deals with.', 'CORE'),
  ('OrgUnit',       'Entity',      TRUE,  'An internal organisational unit that owns cost, revenue or people.', 'CORE'),
  ('Facility',      'Entity',      TRUE,  'A physical site with capacity.', 'CORE'),
  ('Transaction',   'Entity',      TRUE,  'A business document that commits money, goods or capacity.', 'CORE'),
  ('Item',          'Entity',      TRUE,  'A traceable physical unit.', 'CORE'),
  ('Asset',         'Entity',      TRUE,  'A physical production asset with a health state.', 'CORE'),
  ('Product',       'Entity',      TRUE,  'Something the business makes, sells or buys.', 'CORE'),
  -- golden (concrete, CORE) — one record per real-world thing, members per module
  ('LegalEntity',   'OrgUnit',     FALSE, 'Company code: the golden legal entity (US, EU, APJ Operations).', 'CORE'),
  ('Customer',      'Party',       FALSE, 'Golden customer, conformed across Finance, Sales, Working Capital and Supply Chain.', 'CORE'),
  ('Supplier',      'Party',       FALSE, 'Golden supplier, conformed across Finance, Spend, Working Capital and Supply Chain.', 'CORE'),
  ('Department',    'OrgUnit',     FALSE, 'Conformed department, joining People departments to Finance cost centers.', 'CORE'),
  -- module (concrete) — local representations and module-only concepts
  ('CostCenter',      'OrgUnit',     FALSE, 'Finance cost center.', 'FIN'),
  ('ProfitCenter',    'OrgUnit',     FALSE, 'Finance profit center.', 'FIN'),
  ('GLAccount',       'Entity',      FALSE, 'General ledger account.', 'FIN'),
  ('JournalEntry',    'Transaction', FALSE, 'Posted accounting document (reached via view, not materialised).', 'FIN'),
  ('SalesOrg',        'OrgUnit',     FALSE, 'Sales organisation.', 'SAL'),
  ('SalesOrder',      'Transaction', FALSE, 'Customer sales order (Sales 360 and Supply Chain 360).', 'SAL'),
  ('Opportunity',     'Transaction', FALSE, 'CRM opportunity in the pipeline.', 'SAL'),
  ('SellableProduct', 'Product',     FALSE, 'SAP product master record.', 'SAL'),
  ('Employee',        'Party',       FALSE, 'Worker in the People 360 workforce.', 'PPL'),
  ('SpendCategory',   'Entity',      FALSE, 'Procurement category.', 'SPD'),
  ('PurchaseOrder',   'Transaction', FALSE, 'Purchase order line (reached via view).', 'SPD'),
  ('ARInvoice',       'Transaction', FALSE, 'Receivable item (reached via view).', 'WCP'),
  ('APInvoice',       'Transaction', FALSE, 'Payable item (reached via view).', 'WCP'),
  ('Plant',           'Facility',    FALSE, 'Manufacturing plant.', 'SCM'),
  ('Material',        'Product',     FALSE, 'Manufactured system or BOM component.', 'SCM'),
  ('Equipment',       'Asset',       FALSE, 'Production tool at a work center.', 'SCM'),
  ('SystemSerial',    'Item',        FALSE, 'One built inspection system.', 'SCM'),
  ('ComponentLot',    'Item',        FALSE, 'Received supplier lot of a BOM component.', 'SCM'),
  -- local member records (sameAs a golden record)
  ('LocalCustomer',   'Party',       FALSE, 'A customer as one 360 app knows it; sameAs a golden Customer.', 'CORE'),
  ('LocalSupplier',   'Party',       FALSE, 'A supplier as one 360 app knows it; sameAs a golden Supplier.', 'CORE');

-- ---------------------------------------------------------------- relations
INSERT INTO CORE.ONT_RELATION_DEF (REL_NAME, DOMAIN_CLASS, RANGE_CLASS, CARDINALITY, IS_HIERARCHICAL, IS_TRANSITIVE,
                                   INVERSE_REL_NAME, DESCRIPTION, ONTOLOGY_NAME, MODULE)
SELECT column1, column2, column3, column4, column5, FALSE, column6, column7, 'ENTERPRISE', column8 FROM VALUES
  ('subClassOf',       'Entity',        'Entity',      'N:1', TRUE,  'superClassOf', 'Class hierarchy.', 'CORE'),
  ('sameAs',           'LocalCustomer', 'Customer',    'N:1', FALSE, 'hasMember',    'Local record resolves to the golden record (crosswalk).', 'CORE'),
  ('sameAsSupplier',   'LocalSupplier', 'Supplier',    'N:1', FALSE, 'hasMember',    'Local supplier resolves to the golden supplier.', 'CORE'),
  ('memberOf',         'LocalCustomer', 'LegalEntity', 'N:N', FALSE, 'hasLocal',     'Local record is held in this company code.', 'CORE'),
  ('ownedBy',          'Plant',         'LegalEntity', 'N:1', FALSE, 'owns',         'Plant belongs to the legal entity.', 'SCM'),
  ('employs',          'LegalEntity',   'Employee',    '1:N', FALSE, 'worksFor',     'Company employs the worker.', 'PPL'),
  ('inDepartment',     'Employee',      'Department',  'N:1', FALSE, 'hasEmployee',  'Worker sits in the department.', 'PPL'),
  ('fundedBy',         'Department',    'CostCenter',  'N:N', FALSE, 'funds',        'Department expenses post to the cost center.', 'FIN'),
  ('buysFrom',         'LegalEntity',   'Supplier',    'N:N', FALSE, 'sellsTo',      'Company spends with the supplier (weight = spend USD).', 'SPD'),
  ('owesTo',           'LegalEntity',   'Supplier',    'N:N', FALSE, 'isOwedBy',     'Open payables to the supplier (weight = AP open USD).', 'WCP'),
  ('sellsToCustomer',  'LegalEntity',   'Customer',    'N:N', FALSE, 'buysFromCo',   'Company invoices the customer (weight = AR USD).', 'WCP'),
  ('placedBy',         'SalesOrder',    'Customer',    'N:1', FALSE, 'placed',       'Order placed by the golden customer.', 'SAL'),
  ('suppliesComponent','Supplier',      'Material',    'N:N', FALSE, 'suppliedBy',   'Supplier ships this BOM component.', 'SCM'),
  ('supplies',         'Supplier',      'Plant',       'N:N', FALSE, 'suppliedFrom', 'Supplier ships into the plant.', 'SCM'),
  ('shipsTo',          'Plant',         'Customer',    'N:N', FALSE, 'receivesFrom', 'Plant ships systems to the customer.', 'SCM'),
  ('installedAt',      'Equipment',     'Plant',       'N:1', FALSE, 'hasEquipment', 'Tool installed at plant.', 'SCM'),
  ('inCategory',       'Supplier',      'SpendCategory','N:N',FALSE, 'categoryOf',   'Supplier''s primary procurement category.', 'SPD');

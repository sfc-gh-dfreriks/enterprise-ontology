-- =====================================================================
-- SAP Enterprise Ontology — 05: semantic view and Cortex Agent
-- =====================================================================
USE DATABASE SAP_ENTERPRISE_ONTOLOGY;

CREATE OR REPLACE SEMANTIC VIEW SEMANTIC.SAP_ENTERPRISE_360
  TABLES (
    COMPANY AS ANALYTICS.DT_COMPANY_360 PRIMARY KEY (COMPANY_CODE)
      COMMENT = 'Golden legal entity (US, EU, Japan Operations) with Finance P&L, Working Capital, People, Spend and Supply Chain KPIs in USD.',
    CUSTOMER AS ANALYTICS.DT_CUSTOMER_360 PRIMARY KEY (CUSTOMER_ID)
      COMMENT = 'Golden customer conformed across Finance, Sales, Working Capital and Supply Chain. Sales order value is USD orders only.',
    SUPPLIER AS ANALYTICS.DT_SUPPLIER_360 PRIMARY KEY (SUPPLIER_ID)
      COMMENT = 'Golden supplier conformed across Spend, Working Capital, Finance and Supply Chain.',
    QUALITY_EXPOSURE AS CORE.VW_SUPPLIER_QUALITY_EXPOSURE PRIMARY KEY (SUPPLIER_ID, CUSTOMER_ID)
      COMMENT = 'Customer order value containing deviating component lots from each supplier (traversed: supplier -> lot -> system -> order -> customer).',
    CROSSWALK AS XWALK.V_CROSSWALK
      COMMENT = 'How each app''s local customer, supplier and company records resolve to golden records, with match method.'
  )
  RELATIONSHIPS (
    QE_SUPPLIER AS QUALITY_EXPOSURE (SUPPLIER_ID) REFERENCES SUPPLIER,
    QE_CUSTOMER AS QUALITY_EXPOSURE (CUSTOMER_ID) REFERENCES CUSTOMER
  )
  FACTS (
    COMPANY.REVENUE_USD AS REVENUE_USD COMMENT = 'Finance revenue in USD.',
    COMPANY.NET_INCOME_USD AS NET_INCOME_USD COMMENT = 'Finance net income in USD.',
    COMPANY.SPEND_USD AS SPEND_USD COMMENT = 'Spend 360 purchase spend in USD.',
    COMPANY.HEADCOUNT AS HEADCOUNT COMMENT = 'People 360 headcount.',
    COMPANY.SALARY_COST_USD AS SALARY_COST_USD COMMENT = 'Annual salary cost of active employees, USD.',
    COMPANY.AR_OVERDUE_USD AS AR_OVERDUE_USD COMMENT = 'Working Capital overdue receivables, latest month, USD.',
    COMPANY.LATE_COST_USD AS LATE_COST_USD COMMENT = 'Supply Chain late-delivery cost at the company''s plants.',
    CUSTOMER.ORDER_VALUE_USD AS ORDER_VALUE_USD COMMENT = 'Sales (USD orders) plus Supply Chain order value.',
    CUSTOMER.OPEN_PIPELINE_USD AS OPEN_PIPELINE_USD COMMENT = 'Open CRM pipeline, USD.',
    CUSTOMER.AR_USD AS AR_USD COMMENT = 'Finance open AR plus Working Capital AR, USD.',
    CUSTOMER.AR_OVERDUE_USD AS AR_OVERDUE_USD COMMENT = 'Overdue receivables, USD.',
    CUSTOMER.LATE_COST_USD AS LATE_COST_USD COMMENT = 'Supply Chain late cost on this customer''s orders.',
    SUPPLIER.SPEND_USD AS SPEND_USD COMMENT = 'Spend with the supplier, USD.',
    SUPPLIER.AP_OPEN_USD AS AP_OPEN_USD COMMENT = 'Open payables (Working Capital + Finance), USD.',
    SUPPLIER.DISCOUNT_LOST_USD AS DISCOUNT_LOST_USD COMMENT = 'Early-payment discounts lost, USD.',
    SUPPLIER.DEVIATING_LOTS AS DEVIATING_LOTS COMMENT = 'Supply Chain component lots that failed or deviated at inspection.',
    QUALITY_EXPOSURE.ORDER_VALUE_USD AS ORDER_VALUE_USD COMMENT = 'Order value containing the supplier''s deviating lots.'
  )
  DIMENSIONS (
    COMPANY.COMPANY AS COMPANY COMMENT = 'US Operations, EU Operations or Japan Operations.',
    COMPANY.REGION AS REGION,
    COMPANY.DSO AS DSO COMMENT = 'Days sales outstanding, latest month.',
    COMPANY.DPO AS DPO, COMPANY.CCC AS CCC COMMENT = 'Cash conversion cycle, days.',
    COMPANY.NET_MARGIN_PCT AS NET_MARGIN_PCT, COMPANY.OTIF_PCT AS OTIF_PCT,
    COMPANY.OPERATING_RATE_PCT AS OPERATING_RATE_PCT, COMPANY.ON_CONTRACT_PCT AS ON_CONTRACT_PCT,
    CUSTOMER.CUSTOMER AS CUSTOMER COMMENT = 'Golden customer name.',
    CUSTOMER.MODULE_LIST AS MODULE_LIST COMMENT = 'Apps the customer appears in (FIN, SAL, SCM, WCP).',
    CUSTOMER.CREDIT_RISK AS CREDIT_RISK, CUSTOMER.OTIF_PCT AS OTIF_PCT, CUSTOMER.WIN_RATE_PCT AS WIN_RATE_PCT,
    SUPPLIER.SUPPLIER AS SUPPLIER COMMENT = 'Golden supplier name.',
    SUPPLIER.MODULE_LIST AS MODULE_LIST COMMENT = 'Apps the supplier appears in (FIN, SCM, SPD, WCP).',
    SUPPLIER.MAX_RISK_SCORE AS MAX_RISK_SCORE, SUPPLIER.SINGLE_SOURCE AS SINGLE_SOURCE, SUPPLIER.PRIMARY_CATEGORY AS PRIMARY_CATEGORY,
    QUALITY_EXPOSURE.SUPPLIER AS SUPPLIER, QUALITY_EXPOSURE.CUSTOMER AS CUSTOMER,
    CROSSWALK.ENTITY AS ENTITY, CROSSWALK.MODULE AS MODULE, CROSSWALK.LOCAL_ID AS LOCAL_ID,
    CROSSWALK.LOCAL_NAME AS LOCAL_NAME, CROSSWALK.GOLDEN_ID AS GOLDEN_ID, CROSSWALK.MATCH_METHOD AS MATCH_METHOD
  )
  COMMENT = 'Master enterprise view across Finance, Sales, People, Spend, Working Capital and Supply Chain 360, conformed by golden records.'
  AI_SQL_GENERATION 'Use COMPANY for legal-entity questions (P&L, working capital, headcount, spend, OTIF, operating rate). Use CUSTOMER and SUPPLIER for cross-app 360 questions about one counterparty. Use QUALITY_EXPOSURE to connect supplier quality to customer order value. Use CROSSWALK to explain how app records map to golden records. All money is USD at company planning rates. Customer and supplier identities come from a demo crosswalk; say so when it matters.';

CREATE OR REPLACE AGENT AGENTS.SAP_ENTERPRISE_ANALYST
WITH PROFILE = '{"display_name":"SAP Enterprise 360 Analyst","color":"purple"}'
COMMENT = 'Cross-domain analyst over the enterprise master ontology (six SAP BDC 360 apps).'
FROM SPECIFICATION $$
{
  "models": {"orchestration": "auto"},
  "orchestration": {"budget": {"seconds": 60, "tokens": 32000}},
  "instructions": {
    "response": "You are an enterprise analyst. Answers combine Finance, Sales, People, Spend, Working Capital and Supply Chain through golden customers, suppliers and legal entities. Lead with the answer, cite the apps each figure comes from, and note that customer/supplier identity uses a demo crosswalk when the answer depends on it.",
    "orchestration": "Use the Analyst tool for every quantitative question.",
    "sample_questions": [
      {"question": "Which company has the best revenue per employee and how does its cash conversion cycle compare?"},
      {"question": "Which suppliers have the most spend and also put customer orders at risk through deviating lots?"},
      {"question": "Which customers have overdue receivables and late deliveries at the same time?"},
      {"question": "How do Sales records map to golden customers?"}
    ]
  },
  "tools": [{"tool_spec": {"type": "cortex_analyst_text_to_sql", "name": "Enterprise360",
            "description": "SQL over the SAP enterprise 360 semantic view: companies, customers, suppliers, quality exposure and crosswalk."}}],
  "tool_resources": {"Enterprise360": {"semantic_view": "SAP_ENTERPRISE_ONTOLOGY.SEMANTIC.SAP_ENTERPRISE_360"}}
}
$$;

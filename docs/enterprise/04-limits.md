# 4. Limits and caveats

**Demo crosswalk.** The six apps came from different SAP BDC demo tenants and share no customer or supplier keys. Golden records come from a deterministic, rank-based crosswalk; every record carries its match method. In production this is SAP MDG or a match-merge output.

**Currency.** Money is USD at the Working Capital planning rates (EUR 1.08, JPY 0.0067, USD 1). Sales order value counts USD orders only.

**Scale between apps.** Sales 360 order values come from the BDC demo tenant and are far larger than the Supply Chain demo orders. Compare within an app, not across.

**Company mapping.** Supply Chain plants carry company codes 1000/2000/3000; they are mapped to US, EU and Japan Operations by region. On the maps each legal entity sits at its first plant.

**Mitigation.** Reroutes, stock cover and capacity come from Supply Chain 360 data and are planning grade. Second source, hedging, insurance and re-sale are labelled assumptions you set.

**Mitigation is planning grade.** Hours per unit are blended across a plant's work centers; reroutes do not model freight or
qualification cost. Levers marked *your assumption* are inputs, not findings.

**Ask Cortex** answers from the facts of the view on screen; it does not run new SQL. For open questions use
*Ask the Enterprise* (Cortex Analyst over `SAP_ENTERPRISE_ONTOLOGY.SEMANTIC.SAP_ENTERPRISE_360`). The public build has no Snowflake connection: it shows
the baked default analysis only.

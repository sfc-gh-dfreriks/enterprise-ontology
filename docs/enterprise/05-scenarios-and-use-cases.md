# 5. Scenario modelling and use cases

## How the engine works

`client/src/lib/entScenario.ts` is pure and deterministic. The page runs it in the browser (so the public build works
without Snowflake); the server imports the same file to give Ask Cortex the identical result.

| Scenario | Path through the ontology | Inputs |
|---|---|---|
| Supplier failure | Supplier → supplies → Plant → shipsTo → Customer; Plant → ownedBy → LegalEntity; LegalEntity → buysFrom / owesTo → Supplier | weeks out, share covered by an alternate source |
| Plant outage | Plant → shipsTo → Customer; Plant → ownedBy → LegalEntity; Supplier → supplies → Plant | weeks down |
| Customer default | LegalEntity → sellsToCustomer → Customer ← shipsTo Plant | recovery % |
| FX shock | LegalEntity reports in currency | currency, % vs USD |
| Payment terms | LegalEntity → owesTo → Supplier → supplies → Plant | days later to pay, days sooner to collect |
| Workforce | LegalEntity → employs → Employee; LegalEntity ← ownedBy Plant | company, % headcount |

**Shares, not summed dollars.** Supply Chain plant value and margin are weekly rates over the measured order period (2025-01-11 to 2025-09-29, 262 days);
Finance and Working Capital use their own monthly revenue; Sales uses each customer's CRM pipeline. A lost share of plant
output becomes the same share of the owning company's revenue and of each affected customer's pipeline.

**Cash conversion cycle** under an output shock is measured against a year of turnover: lost sales of x of the year,
with receivables and inventory already held, stretch DSO and DIO by x / (1 − x).

## Presets

| Preset | Question | Headline |
|---|---|---|
| Top-spend supplier fails (8 weeks) | Our largest supplier by spend stops shipping — who feels it? | Output value lost $15.89M · Revenue at risk $746K · Pipeline at risk $5.52M · Customers hit 8 |
| Festo fails, 50% dual-sourced | How much does a second source buy us? | Output value lost $17.50M · Revenue at risk $889K · Pipeline at risk $6.10M · Customers hit 8 |
| San Jose HQ down 4 weeks | What does a four-week outage at our biggest plant cost the enterprise? | Output value lost $15.35M · Revenue at risk $374K · Pipeline at risk $10.54M · Customers hit 8 |
| SK Hynix defaults (40% recovery) | If our most overdue customer defaults, where does it land? | Write-off $3.69M · Pipeline lost $4.12M · Order book freed $44.33M · Entities exposed 3 |
| EUR −10% vs USD | What does a weaker euro do to reported results? | Reported revenue $-1.45M · Reported net income $-332K · Spend in USD $-152K · Payroll in USD $-5.54M |
| Pay 10 days later, collect 5 sooner | How much cash do terms release, and who pays for it? | Cash released $2.00M · CCC change (days) -15 days · At-risk suppliers squeezed 4 · Payables affected $27.33M |
| US Operations −5% headcount | What does a 5% reduction at US Operations save — and risk? | Payroll change $-2.60M · Headcount change -22 · Revenue / employee $35K · Plant OTIF today 64.8% |

## Use cases

| Role | Question |
|---|---|
| CEO / CFO | Which legal entity is weakest across finance, cash, people and delivery? |
| CPO | Which supplier is cheap to buy from but expensive to depend on? |
| COO | If our top supplier stops shipping for eight weeks, who feels it and how much? |
| CPO / COO | What is a second source worth before we pay for it? |
| COO / CFO | What does a four-week outage at our largest plant cost the enterprise? |
| CRO / Credit | Which customers are both late to pay and badly served? |
| CFO / Credit | If our most overdue customer defaults, where does the loss land? |
| Treasurer | How much cash do longer payment terms release, and which critical suppliers pay for it? |
| CFO | What does a weaker euro do to reported results, spend and payroll? |
| CHRO / COO | Where is a headcount reduction safe — and where would it compound a delivery problem? |

Each card on the *Management Use Cases* page shows the live answer, the ontology path and a button that opens the page or
runs the scenario, plus its own Ask Cortex.

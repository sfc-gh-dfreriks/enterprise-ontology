# 1. Concepts

**Why a master ontology.** Each 360 app answers its own domain well and nothing across domains: Spend knows a
supplier's spend, Working Capital its payables, Supply Chain its lots — but none knows they are the same supplier.
The master ontology adds one shared vocabulary and one identity per real-world party.

**Upper ontology.** 8 abstract classes — Entity, Party, OrgUnit, Facility, Transaction, Item, Asset,
Product — are the shared vocabulary. Every module class hangs off one of them.

**Golden records.** LegalEntity (3), Customer (20), Supplier
(25) and Department (12) live in the core. Each app's local record is a
`LocalCustomer` / `LocalSupplier` linked by `sameAs`, carrying its match method.

**Modules.** One per app; each adds only what it alone owns:

| Module | Name | Source database | Classes |
|---|---|---|---|
| CORE | Enterprise core | `SAP_ENTERPRISE_ONTOLOGY` | 14 |
| FIN | Finance 360 | `SAP_FINANCE_360` | 4 |
| PPL | People 360 | `SAP_PEOPLE_360` | 1 |
| SAL | Sales 360 | `SAP_SALES_360` | 4 |
| SCM | Supply Chain 360 | `SAP_SUPPLY_CHAIN` | 5 |
| SPD | Spend 360 | `SAP_SPEND_360` | 2 |
| WCP | Working Capital 360 | `SAP_WORKING_CAPITAL_360` | 2 |

**Cross-module relations.** `buysFrom` (Spend) and `owesTo` (Working Capital) and `supplies` (Supply Chain) all land on
the same golden Supplier; `sellsToCustomer` (Working Capital) and `shipsTo` (Supply Chain) on the same Customer;
`employs` (People) and `ownedBy` (Supply Chain) on the same LegalEntity.

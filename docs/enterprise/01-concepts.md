# 1. Concepts

**Why a master ontology.** Each 360 app answers its own domain well and nothing across domains: Spend knows a
supplier's spend, Working Capital its payables, Supply Chain its lots — but none knows they are the same supplier.
The master ontology adds one shared vocabulary and one identity per real-world party.

**Governed, not app-owned.** The vocabulary is the Snowflake Business Ontology on `MSB89522`: domain
**Enterprise** with subdomains Enterprise.Finance, Enterprise.People, Enterprise.Sales, Enterprise.Spend, Enterprise.Working Capital. 19 concepts are governed there; 8
are reused from the governed **Supply Chain** domain and not redefined: Component Lot, Customer, Material Flow, Party, Plant, Sales Order, Supplier, Transaction.

| Governed domain | Concepts | Names |
|---|---|---|
| Enterprise | 7 | Department, Legal Entity, Local Customer, Local Supplier, Material, Org Unit, Product |
| Enterprise.Finance | 4 | Cost Center, GL Account, Journal Entry, Profit Center |
| Enterprise.People | 1 | Employee |
| Enterprise.Sales | 3 | Opportunity, Sales Org, Sellable Product |
| Enterprise.Spend | 2 | Purchase Order, Spend Category |
| Enterprise.Working Capital | 2 | AP Invoice, AR Invoice |
| Supply Chain | 8 | Component Lot, Customer, Material Flow, Party, Plant, Sales Order, Supplier, Transaction |

**Relationships.** 28 Enterprise relationships: 15 IS_A, 13 CUSTOM. Custom verbs:
buys from, employs, funded by, in category, in department, member of, owed by, owned by, payable to, same as, sells to, supplies component. Business Ontology allows one custom relationship per concept pair, so money owed to a
supplier is modelled on the invoice — *AP Invoice payable to Supplier*, *AR Invoice owed by Customer*.

**Golden records.** Legal Entity (3), Customer (20), Supplier
(25) and Department (12). Each app's local record is a *Local Customer* /
*Local Supplier* linked by *same as*, carrying its match method.

**Representations.** 52 links from concepts to the Snowflake objects that implement them (golden and
member tables, 360 dynamic tables, class views). Material, Product, Sales Org, Transaction have none: abstract, or no source object.

**Instances.** Concepts are governed; their instances and links stay in `CORE.KG_NODE` / `KG_EDGE`
(1,928 nodes, 3,790 edges), each edge type tied to the governed relationship it instantiates.

*History:* the first version modelled 32 classes and 17 relations in seven modules in app-owned `ONT_*` tables
(`owesTo` was a relation then). Those tables remain in Snowflake but are no longer the model.

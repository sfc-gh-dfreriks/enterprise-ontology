"""The governed Enterprise ontology, read once from Snowflake Business Ontology.

Every exporter finds its inputs through this module: it walks the governed
relationships and resolves objects only through the representations a steward
linked to each concept, so no exporter names a table.

The Enterprise domain (with its Finance, Sales, People, Spend and Working Capital
subdomains) reuses the governed Supply Chain concepts (Party, Supplier, Customer,
Plant, Sales Order, ...) rather than redefining them. Its scope is therefore the
Enterprise domain tree plus every Supply Chain concept an Enterprise relationship
or Enterprise representation touches.
"""
import json
from collections import defaultdict

ROOT_DOMAIN = "Enterprise"
REUSED_DOMAIN = "Supply Chain"


def lit(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


class Ontology:
    def __init__(self, cur):
        cur.execute("SELECT SYSTEM$GET_GLOSSARY_GRAPH(" + lit(json.dumps(
            {"includeAssociations": True, "limit": 1000})) + ")")
        g = json.loads(cur.fetchone()[0])
        if g.get("truncated"):
            raise SystemExit("Business Ontology graph is truncated; raise the limit")
        self.terms = {t["termId"]: t for t in g["terms"]}
        self.name = {i: t["name"] for i, t in self.terms.items()}
        self.domain_of = {t["name"]: t["fqn"].rsplit(".", 1)[0] for t in g["terms"]}

        def enterprise(i):
            return self.terms[i]["fqn"].split(".")[0] == ROOT_DOMAIN

        enterprise_rels = [r for r in g["relationships"]
                           if enterprise(r["sourceTermId"]) or enterprise(r["targetTermId"])]
        # Every relationship is walkable: Enterprise inputs also follow Supply Chain ones
        # between reused concepts (Plant ships to Customer). The snapshot keeps those
        # whose two ends are both in scope.
        self.raw_relationships = g["relationships"]
        self.rels = [(self.name[r["sourceTermId"]], (r.get("label") or r["relationshipType"]).lower(),
                      self.name[r["targetTermId"]]) for r in g["relationships"]]
        self.reps = defaultdict(list)
        self.associations = g["associations"]
        for a in self.associations:
            self.reps[self.name[a["termId"]]].append(a["fqn"])
        # In scope: the Enterprise tree, every concept an Enterprise relationship touches,
        # and every Supply Chain concept carrying an object the Enterprise export reads.
        scope = {i for i in self.terms if enterprise(i)}
        scope |= {r["sourceTermId"] for r in enterprise_rels} | {r["targetTermId"] for r in enterprise_rels}
        scope |= {a["termId"] for a in self.associations
                  if not a["fqn"].startswith("SAP_SUPPLY_CHAIN.")
                  or a["fqn"] in ENTERPRISE_READS_FROM_SUPPLY_CHAIN}
        self.scope = scope

    # ---------------------------------------------------------------- walking
    def related(self, label: str):
        return [(s, t) for s, rel, t in self.rels if rel == label]

    def children(self, parent: str):
        return sorted(s for s, rel, t in self.rels if rel == "is_a" and t == parent)

    # ---------------------------------------------------------- representations
    def rep(self, concept: str, obj: str) -> str:
        """The representation of `concept` named `obj`; fails if the steward has not linked it."""
        hit = [f for f in self.reps.get(concept, []) if f.split(".")[-1] == obj]
        if not hit:
            raise SystemExit(f"Business Ontology: {concept} has no representation {obj}; "
                             f"it has {[f.split('.')[-1] for f in self.reps.get(concept, [])]}")
        return hit[0]

    def class_view(self, concept: str) -> str:
        """VW_ONT_<concept>, e.g. VW_ONT_LEGALENTITY for Legal Entity."""
        return self.rep(concept, "VW_ONT_" + concept.replace(" ", "").upper())

    def instance_graph(self, concept: str) -> tuple[str, str]:
        """KG_NODE and KG_EDGE beside a concept's class view.

        Business Ontology governs concepts, not instance links (which employee is in
        which department). Those stay in the knowledge graph that backs the class views,
        found from the class view rather than named.
        """
        schema = self.class_view(concept).rsplit(".", 1)[0]
        return f"{schema}.KG_NODE", f"{schema}.KG_EDGE"


# Supply Chain objects the Enterprise export reads; they are linked to Supply Chain
# concepts, so the Enterprise snapshot includes those concepts.
ENTERPRISE_READS_FROM_SUPPLY_CHAIN = {
    "SAP_SUPPLY_CHAIN.ANALYTICS.DT_ORDER_FULFILLMENT",
    "SAP_SUPPLY_CHAIN.PLANT.A_PLANT",
    "SAP_SUPPLY_CHAIN.ANALYTICS.DT_SERIAL_GENEALOGY",
}

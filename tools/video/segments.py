"""Script for the Enterprise Ontology narrated walkthrough.

One entry per beat. Each carries the narration (which sets the segment's length),
the popup card copy, and the actions that put the app in the right state. Figures
are spelled out so they read correctly aloud, and match the engine the pages run
(San Jose HQ down 4 weeks preset, US demo account, 16 Nov 2026).

Actions run at the start of a segment; the page then holds for whatever narration
time remains. Navigation happens in-app so the active scenario survives.
"""

# Page routes, by sidebar label.
NAV = {
    "ontology": "Ontology",
    "overview": "Executive Dashboard",
    "snowflake": "Snowflake Ontology Details",
    "ask": "Ask Cortex",
    "scenario": "Scenario Studio",
    "impact": "Impact Map",
    "mitigation": "Mitigation & Recovery",
    "crosswalk": "Golden-Record Crosswalk",
}

SEGMENTS = [
    # ------------------------------------------------------------ the governed model
    dict(
        id="00_ontology", page="ontology", actions=[("wait", 1500)],
        narration=(
            "Six S A P 360 apps, [[slnc 200]] Finance, Sales, People, Spend, Working Capital and "
            "Supply Chain, [[slnc 250]] and each one has its own copy of the same customers and "
            "suppliers. [[slnc 400]] This app joins them through one model, governed in "
            "Snowflake's Business Ontology. [[slnc 300]] Twenty-seven concepts. Nineteen are "
            "governed in the Enterprise domain, and eight are reused from the Supply Chain domain, "
            "not redefined."
        ),
        popup=dict(title="One governed model over six apps", figure="19 owned · 8 reused",
                   body="The Enterprise domain, with a subdomain per app. Supplier, Customer and "
                        "Plant are the governed Supply Chain concepts, reused."),
    ),
    dict(
        id="01_legal_entity", page="ontology", actions=[("tap_node", "Legal Entity"), ("wait", 1200)],
        narration=(
            "Legal Entity is the hub. [[slnc 300]] A legal entity employs people, buys from "
            "suppliers, sells to customers, and owns plants. [[slnc 400]] Every one of those is a "
            "governed relationship, and the concept points at the exact Snowflake objects that "
            "hold its data."
        ),
        popup=dict(title="Legal Entity: where the apps meet", figure="employs · buys from · sells to",
                   body="Approved definition, business relationships across subdomains, and the "
                        "tables and views that represent it."),
    ),
    dict(
        id="02_lineage", page="ontology",
        actions=[("scroll_to_text", "What the app reads"), ("wait", 900)],
        narration=(
            "And that's what the app reads. [[slnc 300]] No page names a table. [[slnc 250]] Every "
            "input is found by walking the governed domain, then reading the object the steward "
            "linked to each concept. [[slnc 350]] We switched the whole app over only after the "
            "new export matched the old one exactly."
        ),
        popup=dict(title="No hard-coded tables", figure="walk → read",
                   body="Companies, golden records, departments and the scenario network, each found "
                        "through a governed concept. Parity checked: identical."),
    ),
    dict(
        id="03_snowsight", page="snowflake", actions=[("wait", 1200)],
        narration=(
            "This is the same model inside Snowsight. [[slnc 300]] Each app is its own subdomain, so "
            "access can be granted per domain, [[slnc 250]] every change is recorded, [[slnc 250]] and "
            "Cortex reads these same definitions."
        ),
        popup=dict(title="Governed where it lives", figure="Snowsight · Horizon Catalog",
                   body="Finance, Sales, People, Spend and Working Capital as subdomains, linked into "
                        "the Supply Chain domain."),
    ),
    dict(
        id="03b_agent", page="snowflake",
        actions=[("scroll_to_text", "The agent looks up the governed meaning"), ("wait", 1500)],
        narration=(
            "The enterprise analyst agent now searches this ontology too. [[slnc 350]] Before, asked "
            "whether an enterprise supplier is the same as a supply chain supplier, it guessed they were "
            "different. [[slnc 300]] Now it finds the governed answer: Enterprise reuses the supply "
            "chain supplier, and maps each app's local record onto it. [[slnc 300]] And when a figure "
            "isn't a governed metric, like supplier spend, it says so."
        ),
        popup=dict(title="The agent searches the ontology", figure="before: guessed · after: governed",
                   body="Definitions from Business Ontology, numbers from the Enterprise 360 "
                        "semantic view, each labelled by source."),
    ),

    # ------------------------------------------------------------ one picture
    dict(
        id="10_overview", page="overview", actions=[("wait", 1200)],
        narration=(
            "With one model, one table can show three companies across all six apps. [[slnc 350]] "
            "Forty-four million dollars of revenue, thirteen hundred people, [[slnc 250]] and one clear "
            "outlier: US Operations ships on time less than sixty-five percent of the time."
        ),
        popup=dict(title="Three companies, six apps, one table", figure="US OTIF 64.8%",
                   body="Revenue, margin, cash cycle, headcount, spend and delivery, joined through "
                        "Legal Entity."),
    ),
    dict(
        id="11_crosswalk", page="crosswalk", actions=[("wait", 1200)],
        narration=(
            "That only works because every app's local records are tied to a golden one. [[slnc 300]] "
            "Four hundred and fifty-nine local customer and supplier records resolve to forty-five "
            "golden ones. [[slnc 350]] In the ontology, that's simply: local supplier, same as, "
            "supplier."
        ),
        popup=dict(title="459 app records, 45 golden parties", figure="same as",
                   body="Local Customer and Local Supplier are governed concepts. The crosswalk is "
                        "their representation, with the match method kept on every row."),
    ),

    # ------------------------------------------------------------ a shock
    dict(
        id="20_scenario", page="scenario",
        actions=[("click_text", "San Jose HQ down 4 weeks"), ("wait", 3000)],
        narration=(
            "Now let's break something. [[slnc 300]] San Jose H Q goes down for four weeks. "
            "[[slnc 350]] Fifteen point three million dollars of output lost, [[slnc 250]] ten and a "
            "half million of sales pipeline at risk, [[slnc 250]] and eight customers who will miss "
            "deliveries."
        ),
        popup=dict(title="San Jose HQ down for 4 weeks", figure="$15.35M output lost",
                   body="One plant, four apps: Supply Chain output, Sales pipeline, Finance revenue and "
                        "the Working Capital cash cycle."),
    ),
    dict(
        id="21_impact_start", page="impact", actions=[("click_chip", "start")],
        narration=(
            "The Impact Map follows it hop by hop, [[slnc 250]] along the same governed relationships. "
            "[[slnc 300]] It starts at the plant."
        ),
        popup=dict(title="Hop 0 — the plant goes down", figure="San Jose HQ",
                   body="The shock enters the model at Plant, a concept reused from the Supply Chain "
                        "domain."),
    ),
    dict(
        id="22_customers", page="impact", actions=[("click_chip", "8 customers miss")],
        narration=(
            "Hop one. [[slnc 250]] Plant ships to customer, so eight customers miss deliveries."
        ),
        popup=dict(title="Hop 1 — Plant ships to Customer", figure="8 customers",
                   body="The governed Supply Chain relationship carries the shock to every customer the "
                        "plant serves."),
    ),
    dict(
        id="23_entity", page="impact", actions=[("click_chip", "1 legal entity")],
        narration=(
            "Hop two. [[slnc 250]] Plant owned by legal entity, so US Operations carries the loss."
        ),
        popup=dict(title="Hop 2 — Plant owned by Legal Entity", figure="US Operations",
                   body="The cross-domain relationship from Supply Chain into the Enterprise domain."),
    ),
    dict(
        id="24_apps", page="impact", actions=[("click_chip", "4 apps record")],
        narration=(
            "And hop three: four apps record it. [[slnc 300]] Sales sees the pipeline, Finance the "
            "revenue, Working Capital the cash cycle stretch by six days. [[slnc 300]] One event, "
            "visible everywhere it lands."
        ),
        popup=dict(title="Hop 3 — four apps record it", figure="CCC +6 days",
                   body="Supply Chain, Sales, Finance and Working Capital each see their own part of the "
                        "same event."),
    ),

    # ------------------------------------------------------------ recovery
    dict(
        id="30_before", page="mitigation", actions=[("click_chip_exact", "before")],
        narration=(
            "So what can we save? [[slnc 300]] The plan only moves work to plants that make the same "
            "category and have spare hours."
        ),
        popup=dict(title="The recovery, decision by decision", figure="$15.35M at risk",
                   body="Reroutes come from capability and free hours in the data, not assumptions."),
    ),
    dict(
        id="31_fix1", page="mitigation", actions=[("click_chip_exact", "fix 1")],
        narration=(
            "First move. [[slnc 250]] Inspection systems go to Austin. [[slnc 300]] The old lanes from "
            "San Jose turn red, the new one is drawn in green. [[slnc 250]] Five million protected."
        ),
        popup=dict(title="Fix 1 — San Jose to Austin", figure="+$4.99M",
                   body="Red is the lane being replaced, dashed green the reroute."),
    ),
    dict(
        id="32_fix2", page="mitigation", actions=[("click_chip_exact", "fix 2")],
        narration=(
            "Second move. [[slnc 250]] More inspection systems go to Dresden. [[slnc 250]] Another one "
            "point seven million."
        ),
        popup=dict(title="Fix 2 — San Jose to Dresden", figure="+$1.71M",
                   body="Dresden had the least headroom to give."),
    ),
    dict(
        id="33_result", page="mitigation", actions=[("click_chip_exact", "result")],
        narration=(
            "And here's the honest answer. [[slnc 300]] Forty-four percent protected. [[slnc 300]] "
            "Austin and Dresden are now full, [[slnc 250]] so eight point six five million can't be "
            "moved at any price. [[slnc 350]] The risk stays critical. [[slnc 300]] That's a capacity "
            "decision, not a scheduling one."
        ),
        popup=dict(title="What the plan cannot fix", figure="43.6% · $8.65M exposed",
                   body="Capable plants are out of free hours. Austin and Dresden end with zero "
                        "headroom; risk stays Critical."),
    ),

    # ------------------------------------------------------------ ask
    dict(
        id="40_ask", page="ask", actions=[("wait", 1200)],
        narration=(
            "Ask Cortex works across all of it. [[slnc 300]] It's grounded in the governed definitions "
            "and each app's facts, [[slnc 250]] and it names the relationships it used, so every answer "
            "can be traced back to the model."
        ),
        popup=dict(title="Ask Cortex across six apps", figure="grounded · traceable",
                   body="AI_COMPLETE with the governed concepts and relationships, plus the facts each "
                        "concept represents."),
    ),
    dict(
        id="41_close", page="ask", actions=[],
        narration=(
            "Six apps, [[slnc 200]] one governed model, [[slnc 250]] and one event traced from a plant to "
            "every ledger it touches. [[slnc 400]] All in Snowflake, over data already there."
        ),
        popup=dict(title="One governed model, end to end", figure="no shadow copy",
                   body="Snowflake Business Ontology over six SAP BDC 360 apps. Explore it at the link "
                        "below."),
    ),
]

"""Script for the narrated walkthrough video.

One entry per beat. Each carries the narration (which sets the segment's length),
the popup card copy, and the actions that put the app in the right state.

Narration is written to be spoken, not read. Contractions, short sentences, and
`[[slnc n]]` pauses where a person would draw breath. Figures are spelled out —
"sixteen million" reads correctly aloud where "$16,051,035" does not. macOS `say`
is the only synthesiser available offline, so the phrasing does the work the voice
cannot.

Actions run at the start of a segment; the page then holds for whatever narration
time remains. Beats are stepped manually rather than left to autoplay, because a
click is deterministic and autoplay would drift out of sync over three minutes.
"""

# Page routes, by sidebar label — navigation happens in-app so scenario state
# survives (a full reload would drop it).
NAV = {
    "scenario": "Scenario Studio",
    "ripple": "Ripple Map",
    "mitigation": "Mitigation",
    "optimize": "Optimization Map",
}

SEGMENTS = [
    # ------------------------------------------------------------ opening
    dict(
        id="00_open", page="scenario", actions=[],
        narration=(
            "Let's walk through what happens when a hurricane takes one of our "
            "plants offline. [[slnc 450]] This is a real supply chain network, read "
            "from S A P data in Snowflake. Five plants, six suppliers, eight "
            "customers, and about fifty-seven million dollars of material flowing "
            "through it every month."
        ),
        popup=dict(title="The network", figure="$56.7M / month",
                   body="19 nodes and 27 material flows, read live from SAP data "
                        "in Snowflake. Nothing here is hand-built."),
    ),
    dict(
        id="01_preset", page="scenario",
        actions=[("click_text", "Hurricane — Austin Fab offline"), ("wait", 3500)],
        narration=(
            "So. [[slnc 250]] A hurricane closes Austin for sixty days. "
            "[[slnc 400]] One click, and the answer comes back in under a second. "
            "Sixteen million dollars at risk. That's twenty-eight percent of the "
            "entire network, from a single site going dark."
        ),
        popup=dict(title="Austin goes offline", figure="$16.05M at risk",
                   body="60 days, 100% throughput lost. 28.3% of monthly network "
                        "value — computed in under a second."),
    ),
    dict(
        id="02_columns", page="scenario", actions=[],
        narration=(
            "And notice how the results are grouped. [[slnc 300]] Not by size — by "
            "what each one actually needs from you. Watch it, act on it, or pick up "
            "the phone. [[slnc 350]] That distinction matters more than the total."
        ),
        popup=dict(title="Sorted by response, not by size",
                   figure="watch · act · escalate",
                   body="A ranked list of dollar amounts tells you nothing about "
                        "what to do next. This tells you who needs to move."),
    ),

    # ------------------------------------------------------------ ripple
    dict(
        id="10_ripple_intro", page="ripple",
        actions=[("set_pace", "5"), ("click_chip", "start")],
        narration=(
            "Now let's watch it spread. [[slnc 400]] The Ripple Map plays the "
            "cascade one lane at a time, and the camera follows each step. "
            "[[slnc 350]] Right now nothing downstream has failed. Austin holds "
            "forty-two days of stock, so for the first six weeks, nobody else "
            "even notices."
        ),
        popup=dict(title="Before anything spreads", figure="42-day buffer",
                   body="Inventory defers impact. Austin's own stock shields "
                        "everyone downstream for 42 of the 60 days."),
    ),
    dict(
        id="11_hop1a", page="ripple", actions=[("click_chip", "1a")],
        narration=(
            "First hop. [[slnc 250]] Austin can't ship to GlobalFoundries. "
            "Eight point four million dollars, gone. [[slnc 350]] That one's no "
            "surprise — GlobalFoundries is Austin's own customer."
        ),
        popup=dict(title="Hop 1a — Austin to GlobalFoundries",
                   figure="$8.40M at risk",
                   body="100% of the lane is lost. A direct customer loss, and the "
                        "single largest number in the whole scenario."),
    ),
    dict(
        id="12_hop1b", page="ripple", actions=[("click_chip", "1b")],
        narration=(
            "Same story for Micron. [[slnc 250]] Another five point four million. "
            "[[slnc 400]] Still no surprises. But watch the next one carefully, "
            "because this is where it gets interesting."
        ),
        popup=dict(title="Hop 1b — Austin to Micron", figure="$5.40M at risk",
                   body="Running total now $13.8M. Both hop-1 losses are Austin's "
                        "own customers — expected, and easy to reason about."),
    ),
    dict(
        id="13_hop1c", page="ripple", actions=[("click_chip", "1c"), ("wait", 1200)],
        narration=(
            "Here it is. [[slnc 500]] Austin also ships test fixtures to Penang "
            "Assembly. [[slnc 350]] And look what the map just did — it pulled all "
            "the way back to show you both. [[slnc 400]] Penang is in Malaysia. The "
            "hurricane is in Texas. Under a million dollars on that lane, but it's "
            "the one that carries the problem overseas."
        ),
        popup=dict(title="Hop 1c — the lane that travels",
                   figure="Texas → Malaysia · $960K",
                   body="A $480K/mo lane, small next to the others — but it is the "
                        "bridge to hop 2. The camera opens to full world view "
                        "because that is the point."),
    ),
    dict(
        id="14_explain", page="ripple",
        actions=[("click_text", "Explain this step"), ("wait", 900)],
        narration=(
            "And if anyone asks where a number came from, [[slnc 250]] it's right "
            "here. [[slnc 350]] That lane carries four hundred and eighty thousand "
            "dollars a month. Lose all of it for sixty days, and you get nine "
            "hundred and sixty thousand. [[slnc 400]] Penang's eleven percent is "
            "that lane's share of everything Penang takes in. [[slnc 300]] "
            "No black box."
        ),
        popup=dict(title="Every number is inspectable",
                   figure="100% × $480K/mo × 60d = $960K",
                   body="The mechanism, the arithmetic and the dependency share, on "
                        "demand, for any step in the cascade."),
    ),
    dict(
        id="15_hop2", page="ripple",
        actions=[("close_popover",), ("click_chip", "2a"), ("wait", 800),
                 ("click_chip", "2b")],
        narration=(
            "So Penang starves. [[slnc 350]] It holds twelve days of stock, runs "
            "fine until day thirteen, and then it takes T S M C and Texas "
            "Instruments down with it. [[slnc 450]] Two customers with no "
            "connection to Texas at all. [[slnc 300]] That is the effect a "
            "spreadsheet will never catch."
        ),
        popup=dict(title="Hop 2 — two customers, no Texas link",
                   figure="11% impaired, 48 days exposed",
                   body="TSMC and Texas Instruments lose $1.29M between them. "
                        "Neither has any direct relationship with Austin."),
    ),
    dict(
        id="16_ripple_sum", page="ripple", actions=[("click_chip", "all")],
        narration=(
            "Pull back, and there's the whole shape. [[slnc 400]] Sixteen million "
            "dollars across five lanes and two hops, from one event at one site. "
            "[[slnc 350]] Now — what can we actually do about it?"
        ),
        popup=dict(title="The full picture", figure="$16.05M · 5 flows · 2 hops",
                   body="28.3% of the network, propagated only by dependency share "
                        "and deferred by real inventory."),
    ),

    # ------------------------------------------------------------ mitigation
    dict(
        id="20_mitigation", page="mitigation", actions=[("wait", 1500)],
        narration=(
            "The optimiser works through the exposure, largest first, and it only "
            "proposes moves that fit inside capacity we already own. [[slnc 450]] "
            "Two reroutes recover thirteen point eight million. That's ninety-one "
            "percent of the customer revenue at risk."
        ),
        popup=dict(title="Two reroutes, inside real capacity",
                   figure="91.4% protected",
                   body="$13.8M of $15.09M customer revenue defended, using plants "
                        "already in the network. No new capital."),
    ),
    dict(
        id="21_blocked", page="mitigation", actions=[("scroll", 500)],
        narration=(
            "But one point two nine million can't be moved at any price. "
            "[[slnc 400]] Penang is the only plant in the network that does die "
            "sorting. [[slnc 350]] That's not an operations problem you can solve "
            "on a Tuesday. That's an investment decision."
        ),
        popup=dict(title="What money cannot fix this week",
                   figure="$1.29M unrecoverable",
                   body="Sole-source dependency, not a capacity shortfall. Buying "
                        "hours somewhere else would not help."),
    ),

    # ------------------------------------------------------------ optimization
    dict(
        id="30_opt_intro", page="optimize",
        actions=[("set_pace", "5"), ("click_chip_exact", "before")],
        narration=(
            "A recovery percentage is easy to say and hard to trust. [[slnc 400]] "
            "So this last screen plays the plan out, one decision at a time, and "
            "shows you what each one costs."
        ),
        popup=dict(title="The recovery, decision by decision",
                   figure="before mitigation",
                   body="$15.09M exposed, nothing done yet. Watch what the fix "
                        "actually consumes."),
    ),
    dict(
        id="31_fix1", page="optimize", actions=[("click_chip_exact", "fix 1")],
        narration=(
            "First move. [[slnc 250]] GlobalFoundries shifts from Austin to San "
            "Jose. [[slnc 350]] Eight point four million protected. And on the "
            "right, San Jose's spare hours drop from two hundred and eighty-two "
            "down to a hundred and eighty-four. [[slnc 300]] Still comfortable."
        ),
        popup=dict(title="Fix 1 — Austin → San Jose",
                   figure="+$8.40M · 282h → 183.7h",
                   body="The old lane is struck through, the new one drawn in. "
                        "Headroom at San Jose: 7.1%."),
    ),
    dict(
        id="32_fix2", page="optimize", actions=[("click_chip_exact", "fix 2")],
        narration=(
            "Second move, and this is the one to watch. [[slnc 400]] Micron also "
            "goes to San Jose. Another five point four million saved. [[slnc 350]] "
            "But the spare hours fall again — a hundred and eighty-four, down to "
            "thirty-six. [[slnc 300]] You can literally watch the buffer being "
            "spent."
        ),
        popup=dict(title="Fix 2 — the buffer runs down",
                   figure="+$5.40M · 183.7h → 36.2h",
                   body="Headroom now 1.4%. Each decision genuinely consumes what "
                        "the next one could have used."),
    ),
    dict(
        id="33_result", page="optimize", actions=[("click_chip_exact", "result")],
        narration=(
            "And here's the part worth taking into a planning meeting. [[slnc 450]] "
            "The plan works — ninety-one percent protected. [[slnc 350]] But San "
            "Jose is now at ninety-eight point six percent utilisation with zero "
            "spare units. [[slnc 400]] We didn't remove our single point of "
            "failure. We moved it. [[slnc 350]] And the tool says so itself, "
            "rather than leaving you to notice."
        ),
        popup=dict(title="The fix relocates the risk",
                   figure="San Jose 89.1% → 98.6%",
                   body="Zero spare units left, flagged NEW WEAK POINT. A second "
                        "disruption in this window would have no answer."),
    ),
    dict(
        id="34_close", page="optimize", actions=[],
        narration=(
            "One event, sixteen million dollars, ninety-one percent defensible, "
            "[[slnc 300]] and a clear-eyed view of what it costs to defend it. "
            "[[slnc 450]] All of it from data that was already in Snowflake."
        ),
        popup=dict(title="From one click to a decision",
                   figure="no pipeline · no copies",
                   body="Scenario, ripple, plan and cost — over data already in "
                        "place. Explore it at the link below."),
    ),
]

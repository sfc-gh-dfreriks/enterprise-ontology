#!/usr/bin/env python3
"""Build the two Enterprise Ontology decks on the Snowflake template.

  00_Presales_Overview.pptx          ten slides: problem, model, proof, demo, regions
  SAP_Enterprise_Ontology_Demo.pptx  one slide per app page, from live screenshots

Figures come from /tmp/enterprise_facts.json, screenshots from /tmp/enterprise_shots.
Layout helpers are copied from the People 360 deck builder so the kits read as a set.

    python3 tools/enterprise_facts.py && python3 tools/build_enterprise_decks.py
"""
import json
import pathlib
import sys

from PIL import Image
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_AUTO_SIZE, PP_ALIGN
from pptx.util import Inches, Pt

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from pptx_kit import (  # noqa: E402
    BODY_GREY, DK1, DK2, LIGHT_BG, SF_BLUE, TEAL, VIOLET, WHITE,
    add_shape_text, new_presentation, set_ph, verify_deck, verify_slide,
)

FACTS = json.loads(pathlib.Path("/tmp/enterprise_facts.json").read_text())["facts"]
SC = {s["id"]: s for s in json.loads(pathlib.Path("/tmp/enterprise_scenarios.json").read_text())}
SHOTS = {s["id"]: s for s in json.loads(pathlib.Path("/tmp/enterprise_shots/manifest.json").read_text())}
KIT = pathlib.Path.home() / "Documents" / "SAP" / "Enterprise_Ontology_Presales_Kit"
TOP, BOTTOM, LEFT, RIGHT = 1.32, 5.08, 0.40, 9.50
FULLW = RIGHT - LEFT
def content(prs, title, subtitle):
    s = prs.slides.add_slide(prs.slide_layouts[0])
    set_ph(s, 0, title)
    set_ph(s, 1, subtitle)
    return s


def box(slide, x, y, w, h, fill=LIGHT_BG, accent=None):
    add_shape_text(slide, MSO_SHAPE.RECTANGLE, x, y, w, h, "", fill, DK1)
    if accent is not None:
        add_shape_text(slide, MSO_SHAPE.RECTANGLE, x, y, 0.05, h, "", accent, DK1)


def stack(slide, x, y, w, h, runs, align=PP_ALIGN.LEFT, spacing=1.06):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, item in enumerate(runs):
        body, size, bold, colour = item[:4]
        after = item[4] if len(item) > 4 else 5
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        p.space_after = Pt(after)
        r = p.add_run()
        r.text = body
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = colour
        r.font.name = "Arial"
    return tb


def card(slide, x, y, w, h, kicker, runs, accent=DK2, fill=LIGHT_BG):
    box(slide, x, y, w, h, fill, accent)
    head = [(kicker.upper(), 8.5, True, DK2, 7)] if kicker else []
    stack(slide, x + 0.24, y + 0.16, w - 0.42, h - 0.30, head + list(runs))


def banner(slide, y, runs, fill=DK2, h=0.62, x=LEFT, w=FULLW):
    add_shape_text(slide, MSO_SHAPE.RECTANGLE, x, y, w, h, "", fill, WHITE)
    stack(slide, x + 0.30, y + 0.11, w - 0.60, h - 0.22, runs, align=PP_ALIGN.LEFT)


def stat(slide, x, y, w, h, value, label, detail=None, fill=LIGHT_BG, accent=DK2):
    box(slide, x, y, w, h, fill, accent)
    runs = [(value, 28, True, DK2, 3), (label.upper(), 8.5, True, BODY_GREY, 4)]
    if detail:
        runs.append((detail, 10, False, DK1, 0))
    stack(slide, x + 0.26, y + 0.16, w - 0.46, h - 0.30, runs)


def note(slide, text, y=4.88):
    stack(slide, LEFT, y, FULLW, 0.19, [(text, 8, False, BODY_GREY, 0)])


def picture(slide, path, x, y, w, h):
    im = Image.open(path)
    ar = im.width / im.height
    if ar > w / h:
        pw, ph = w, w / ar
    else:
        ph, pw = h, h * ar
    slide.shapes.add_picture(
        str(path), Inches(x + (w - pw) / 2), Inches(y + (h - ph) / 2),
        Inches(pw), Inches(ph))


def caption(slide, x, y, w, text):
    stack(slide, x, y, w, 0.20, [(text.upper(), 8.5, True, DK2, 0)])


# ----------------------------------------------------------------- figures
F = FACTS


def money(v):
    v = float(v)
    return f"${v / 1e6:.1f}M" if abs(v) >= 1e6 else f"${v / 1e3:.0f}K"


def num(v):
    return f"{float(v):,.0f}"


def shot(sid):
    return SHOTS[sid]["file"]


# ----------------------------------------------------------------- overview deck
def s01_title(prs):
    s = prs.slides.add_slide(prs.slide_layouts[0])
    set_ph(s, 0, "SAP Enterprise Ontology")
    set_ph(s, 1, "One ontology across all six SAP BDC 360 apps")
    banner(s, 3.2, [("Six SAP BDC 360 apps. One identity per customer, supplier and company.", 16, True, WHITE, 4),
                    ("Built on the Supply Chain ontology, deployed in US, EU and APAC.", 11, False, WHITE, 0)], h=0.95)
    return s


def s02_problem(prs):
    s = content(prs, "Each 360 app knows its own copy of the supplier", "None of them can say it is the same supplier")
    top = F["top_suppliers"][0]
    cards = [("Spend 360", f"{money(top['spend_usd'])} spend, risk score {num(top['max_risk_score'])}", SF_BLUE),
             ("Working Capital 360", f"{money(top['ap_open_usd'])} open payables", TEAL),
             ("Supply Chain 360", f"{num(top['deviating_lots'])} deviating component lot(s)", VIOLET)]
    w = (FULLW - 0.4) / 3
    for i, (k, v, c) in enumerate(cards):
        card(s, LEFT + i * (w + 0.2), TOP + 0.15, w, 1.55, k, [(top["supplier"], 13, True, DK1, 4), (v, 11, False, DK1, 0)], accent=c)
    banner(s, TOP + 2.05, [("The master ontology resolves all three to one golden supplier — and Cortex reasons across them.", 13, True, WHITE, 0)])
    note(s, "Figures from SAP_ENTERPRISE_ONTOLOGY.ANALYTICS.DT_SUPPLIER_360 (US account).")
    return s


def s03_model(prs):
    s = content(prs, f"{F['classes']} classes, {F['relations']} relations, seven modules",
                "Supply Chain upper classes; each app adds what it owns")
    stat(s, LEFT, TOP + 0.1, 2.0, 1.25, str(F["abstract_classes"]), "abstract upper classes", "Party, OrgUnit, Facility, Transaction…")
    stat(s, LEFT, TOP + 1.5, 2.0, 1.25, num(F["kg_nodes"]), "graph nodes", f"{num(F['kg_edges'])} edges, {F['dangling_edges']} dangling")
    picture(s, shot("model"), LEFT + 2.25, TOP + 0.05, FULLW - 2.25, 3.55)
    return s


def s04_golden(prs):
    s = content(prs, f"{num(F['crosswalk_records'])} app records, {F['golden_customers'] + F['golden_suppliers']} golden parties",
                "Every link keeps its match method — nothing is hidden")
    stat(s, LEFT, TOP + 0.1, 2.0, 1.1, str(F["golden_customers"]), "golden customers", f"{F['four_app_customers']} seen by four apps")
    stat(s, LEFT, TOP + 1.35, 2.0, 1.1, str(F["golden_suppliers"]), "golden suppliers", f"{F['four_app_suppliers']} seen by four apps")
    stat(s, LEFT, TOP + 2.6, 2.0, 1.0, str(F["golden_companies"]), "legal entities", "US, EU, Japan Operations")
    picture(s, shot("crosswalk"), LEFT + 2.25, TOP + 0.05, FULLW - 2.25, 3.55)
    return s


def s05_app(prs):
    s = content(prs, "Three companies, six apps, one table", "Enterprise Overview — live from the master ontology")
    picture(s, shot("overview"), LEFT, TOP + 0.02, FULLW, 3.6)
    return s


def s06_cortex(prs):
    s = content(prs, "Ask Cortex reasons across the apps", "Grounded in Spend, Working Capital and Supply Chain facts")
    picture(s, shot("ask_cortex"), LEFT, TOP + 0.02, 6.1, 3.6)
    exp = F["quality_exposure"]
    card(s, LEFT + 6.3, TOP + 0.05, FULLW - 6.3, 3.55, "Quality exposure",
         [(f"{e['supplier']}: {money(e['order_value_usd'])}", 10.5, False, DK1, 4) for e in exp[:5]] +
         [("Customer order value containing each supplier's deviating lots.", 9, False, BODY_GREY, 0)], accent=VIOLET)
    return s


def s06b_scenarios(prs):
    s = content(prs, "One shock, propagated into six apps", "Enterprise Scenario Studio — seven presets, or build your own")
    picture(s, shot("scenario"), LEFT, TOP + 0.02, 6.1, 3.6)
    rows = []
    for sid in ("sup-teledyne", "sup-festo-dual", "plant-sanjose", "cust-skhynix", "terms"):
        x = SC[sid]; h = x["headline"][0]
        rows.append((f"{x['label']}: {money(h['value'])} {h['label'].lower()}", 9.5, False, DK1, 4))
    card(s, LEFT + 6.3, TOP + 0.05, FULLW - 6.3, 3.55, "Presets", rows +
         [("Shocks travel as shares; each app keeps its own baseline.", 8.5, False, BODY_GREY, 0)], accent=SF_BLUE)
    return s


def s06c_usecases(prs):
    s = content(prs, "Ten questions no single app can answer", "Management Use Cases — each with a live answer and a scenario")
    picture(s, shot("usecases"), LEFT, TOP + 0.02, FULLW, 3.6)
    return s


def s07_proof(prs):
    s = content(prs, "The totals reconcile with every source app", "Each source is aggregated to the golden id before joining")
    w = (FULLW - 0.4) / 3
    for i, r in enumerate(F["reconciliation"]):
        val = num(r["enterprise"]) if "Headcount" in r["metric"] else money(r["enterprise"])
        stat(s, LEFT + i * (w + 0.2), TOP + 0.2, w, 1.6, val, r["metric"], f"{r['app']}: {num(r['source'])} — match")
    banner(s, TOP + 2.2, [("Same numbers in the app, the semantic view, the agent and all three regions.", 13, True, WHITE, 0)])
    return s


def s08_regions(prs):
    s = content(prs, "Deployed in three regions, gated on parity", "tools/deploy_region.py fails unless totals match US")
    w = (FULLW - 0.4) / 3
    for i, r in enumerate(F["regions"]):
        card(s, LEFT + i * (w + 0.2), TOP + 0.2, w, 2.2, r["region"],
             [("Parity with US" if r.get("parity") else "PARITY FAILED", 14, True, DK1, 6),
              (f"{num(r.get('kg_nodes', 0))} graph nodes", 10.5, False, DK1, 3),
              (f"{num(r.get('crosswalk', 0))} crosswalk records", 10.5, False, DK1, 3),
              ("Agent deployed" if r.get("agent") else "No agent", 10.5, False, DK1, 0)], accent=SF_BLUE)
    return s


def s09_caveats(prs):
    s = content(prs, "Say these before the customer asks", "The kit states them on every relevant page")
    items = [("Demo crosswalk", "The six apps share no keys; golden records are rank-based and labelled. Production uses MDG."),
             ("Currency", "USD at Working Capital planning rates; Sales counts USD orders only."),
             ("Scale", "Sales demo orders dwarf Supply Chain orders — compare within an app."),
             ("Company mapping", "Supply Chain company codes 1000/2000/3000 mapped to US/EU/Japan by region.")]
    w = (FULLW - 0.2) / 2
    for i, (k, v) in enumerate(items):
        card(s, LEFT + (i % 2) * (w + 0.2), TOP + 0.1 + (i // 2) * 1.8, w, 1.6, k, [(v, 11, False, DK1, 0)], accent=VIOLET)
    return s


def s10_next(prs):
    s = content(prs, "Try it", "Public build needs no login")
    card(s, LEFT, TOP + 0.1, FULLW, 1.4, "Public site", [(F["site"], 13, True, DK1, 4),
         ("Every page with baked data and baked Ask Cortex answers.", 10.5, False, DK1, 0)], accent=SF_BLUE)
    card(s, LEFT, TOP + 1.7, FULLW, 1.4, "Repository", [(F["repo"], 13, True, DK1, 4),
         ("SQL, deploy script, app, docs and this kit's generators.", 10.5, False, DK1, 0)], accent=TEAL)
    return s


# ----------------------------------------------------------------- demo deck
DEMO = [("overview", "Enterprise Overview", "The three legal entities across all six apps"),
        ("usecases", "Management Use Cases", "Ten questions that need two or more apps"),
        ("scenario", "Enterprise Scenario Studio", "One shock, six apps — path, effects, rankings"),
        ("scenario_cortex", "Ask Cortex on a scenario", "The same engine result, explained and decided"),
        ("model", "Master Ontology Model", "Upper classes, golden classes, one module per app"),
        ("customers", "Customer 360", "Golden customers across Finance, Sales, WC and Supply Chain"),
        ("suppliers", "Supplier 360", "Golden suppliers across Spend, WC, Finance and Supply Chain"),
        ("ask_cortex", "Ask Cortex", "A recommendation that cites each app's evidence"),
        ("crosswalk", "Golden-Record Crosswalk", "Every local record and how it was matched"),
        ("graph", "Enterprise Graph", "Edges coloured by the app that asserts them"),
        ("ask", "Ask the Enterprise", "Cortex Analyst over the enterprise semantic view")]


def build(name, slides_fn):
    prs = new_presentation()
    slides = slides_fn(prs)
    issues = 0
    for i, s in enumerate(slides, 1):
        for msg in verify_slide(s, prs, i):
            print(f"  {name} slide {i}: {msg}")
            issues += 1
    for msg in verify_deck(prs):
        print(f"  {name}: {msg}")
        issues += 1
    KIT.mkdir(parents=True, exist_ok=True)
    prs.save(KIT / name)
    print(f"wrote {name} ({len(prs.slides)} slides, {issues} verifier issue(s))")
    return issues


def overview(prs):
    return [fn(prs) for fn in (s01_title, s02_problem, s03_model, s04_golden, s05_app, s06_cortex,
                               s06b_scenarios, s06c_usecases, s07_proof, s08_regions, s09_caveats, s10_next)]


def demo(prs):
    out = []
    for sid, title, sub in DEMO:
        s = content(prs, title, sub)
        picture(s, shot(sid), LEFT, TOP + 0.02, FULLW, 3.62)
        out.append(s)
    return out


if __name__ == "__main__":
    bad = build("00_Presales_Overview.pptx", overview) + build("SAP_Enterprise_Ontology_Demo.pptx", demo)
    raise SystemExit(1 if bad else 0)

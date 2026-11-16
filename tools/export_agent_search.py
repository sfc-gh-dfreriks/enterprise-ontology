"""Before/after comparison of the Cortex agent once it was given Business Ontology search.

Reads the saved agent runs (one JSON per question, from ask.py in the retrofit folder) and
writes client/src/data/agent_search.json for the Snowflake Ontology Details page and the docs.
"""
import json, pathlib, re, shutil, sys
AGENT = "SAP_ENTERPRISE_ONTOLOGY.AGENTS.SAP_ENTERPRISE_ANALYST"
DOMAINS = "Enterprise (primary), Supply Chain (secondary)"
RUN_DATE = "2026-11-16"
NOTE = ("Before: the original spec with one Cortex Analyst tool. Called through the SQL API it failed every question "
        "(391920, no execution environment), so it was run as a temporary copy with a warehouse. "
        "After runs were taken once the ontology search index had caught up with the Enterprise terms (about 6 hours after approval).")
VERDICTS = [
 ("definition", "Governed definition of Enterprise.Legal Entity and its IS_A link to Org Unit, instead of a description assembled from the semantic view."),
 ("reuse", "Correct: Enterprise reuses Supply Chain.Supplier and adds Local Supplier (same as one golden Supplier). Before, it said they were different concepts."),
 ("hierarchy", "Reads the governed IS_A Party links, with Party itself defined in the Supply Chain domain, instead of listing data tables."),
 ("number", "Same figures (Japan Operations, about $36.9K per employee), now labelled Derived because no governed metric exists."),
 ("governed_number", "Same ranking, and it says plainly that supplier spend is not yet a governed concept: a gap to fill."),
 ("relations", "Governed links from the ontology: AP Invoice is a kind of Transaction and is payable to a Supplier. Before, it said the model had no AP Invoice."),
 ("unknown", "Searches the ontology first, then declines without substituting an industry definition."),
]
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "client/src/data/agent_search.json"
SNAP = ROOT / "data/agent_search"

def first(text, n=2):
    text = text.split("\n|")[0]  # stop at a markdown table
    text = re.sub(r"\*\*|`|#+ ", "", text).replace("\n", " ")
    # the agent sometimes emits its planning note glued to the answer ("...synonym.A Legal Entity ...")
    glued = [m.end() for m in re.finditer(r"[a-z\"]\.(?<!Enterprise\.)(?<!Chain\.)(?<!Capital\.)(?=[A-Z])", text[:200])]
    if glued:
        text = text[glued[-1]:]
    text = re.sub(r"(?<=[:.])\s*\d+\.\s+", " ", text)  # inline numbered lists
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    out = " ".join(parts[:n])[:360].rstrip()
    return out[:-1] + "." if out.endswith(":") else out

def main():
    if len(sys.argv) > 1:  # refresh the snapshot from a retrofit folder: <before dir> <after dir>
        for tag, src in (("before", sys.argv[1]), ("after", sys.argv[2])):
            (SNAP / tag).mkdir(parents=True, exist_ok=True)
            for f in pathlib.Path(src).glob("*.json"):
                shutil.copy(f, SNAP / tag / f.name)
    rows = []
    for key, verdict in VERDICTS:
        b = json.loads((SNAP / "before" / f"{key}.json").read_text())
        a = json.loads((SNAP / "after" / f"{key}.json").read_text())
        rows.append({"check": key, "question": a["question"],
                     "before_tools": list(dict.fromkeys(b["tools"])), "after_tools": list(dict.fromkeys(a["tools"])),
                     "before": first(b["answer"]), "after": first(a["answer"]), "verdict": verdict})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"agent": AGENT, "domains": DOMAINS, "run_date": RUN_DATE, "note": NOTE, "rows": rows}, indent=1))
    print(f"wrote {OUT} ({len(rows)} checks)")

if __name__ == "__main__":
    main()

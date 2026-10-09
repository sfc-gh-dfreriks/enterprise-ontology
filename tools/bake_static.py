#!/usr/bin/env python3
"""Snapshot the live API into client/public/data for the public static build.

The GitHub Pages build has no server and no Snowflake credentials, so every view
it can show has to be baked ahead of time. This walks the endpoints the client
calls and writes one JSON file per call, using the same filename rule the client
applies in static mode:

    /ent/summary             -> ent_summary.json
    /ent/customer/GC-001     -> ent_customer_GC-001.json

Anything not baked here will surface in the UI as "not in this snapshot" rather
than a blank page, so the set below is the contract for what the public build
can do.

Run the app first (npm run dev), then:  python3 tools/bake_static.py
"""
import json
import pathlib
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# Overridable so the baker can point at a dev server on another port without
# editing this file: BAKE_HOST=http://localhost:3011 python3 tools/bake_static.py
HOST = os.environ.get("BAKE_HOST", "http://localhost:3011")
OUT = pathlib.Path(__file__).resolve().parent.parent / "client" / "public" / "data"



def fetch(path: str):
    with urllib.request.urlopen(HOST + "/api" + path, timeout=60) as r:
        return json.load(r)




def name(path: str) -> str:
    """Filename for a snapshot. Must stay identical to snapshotName() in
    client/src/lib/api.ts.

    Percent-escapes are folded to "-" because a literal "%3A" in a filename is
    decoded back to ":" by the web server serving the build, so the browser's
    request would never match the file written here."""
    p, _, q = path.partition("?")
    stem = p.lstrip("/").replace("/", "_")
    if not q:
        return f"{stem}.json"
    safe = re.sub(r"[^A-Za-z0-9=&._-]", "-", q)
    return f"{stem}__{safe}.json"


def bake(path: str, data=None) -> int:
    if data is None:
        data = fetch(path)
    f = OUT / name(path)
    f.write_text(json.dumps(data))
    return f.stat().st_size


def main() -> None:
    try:
        fetch("/health")
    except Exception as e:
        sys.exit(f"server not reachable at {HOST} — start it with `npm run dev`\n  {e}")
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()

    total = bake_enterprise()
    for p in ["/ask/examples", "/ask/views"]:
        total += bake(p)
    # The public build has no Snowflake connection: Ask the Enterprise says so instead of failing.
    (OUT / "ask_status.json").write_text(json.dumps(
        {"ok": False, "missing": ["public build has no Snowflake connection"], "semantic_view": ""}))

    files = sorted(OUT.glob("*.json"))
    print(f"\n  {len(files)} files, {sum(f.stat().st_size for f in files) / 1048576:.2f} MB total")
    for f in sorted(files, key=lambda f: -f.stat().st_size)[:5]:
        print(f"     {f.name:44} {f.stat().st_size / 1024:8.1f} KB")


def ask_key(topic: str, args: dict) -> str:
    """Must stay identical to askKey() in client/src/lib/api.ts."""
    a = "&".join(f"{k}={args[k]}" for k in sorted(args))
    return f"{topic}?{a}" if a else topic


def bake_enterprise() -> int:
    """Enterprise master ontology: every endpoint, every golden record, and the
    default Ask Cortex analysis for the aggregate views and the top records.
    Ask Cortex answers are real AI_COMPLETE output captured at bake time."""
    total = 0
    for p in ["/ent/summary", "/ent/model", "/ent/graph", "/ent/customers", "/ent/suppliers", "/ent/crosswalk",
              "/ent/scenario-data", "/ent/lineage"]:
        total += bake(p)
    customers, suppliers = fetch("/ent/customers"), fetch("/ent/suppliers")
    for c in customers:
        total += bake(f"/ent/customer/{c['customer_id']}")
    for s in suppliers:
        total += bake(f"/ent/supplier/{s['supplier_id']}")
    print(f"  baked enterprise endpoints + {len(customers)} customers + {len(suppliers)} suppliers")

    asks = [(t, {}) for t in ("ent-overview", "ent-companies", "ent-customers", "ent-suppliers",
                              "ent-model", "ent-crosswalk", "ent-lineage")]
    asks += [("ent-customer", {"id": c["customer_id"]}) for c in customers[:8]]
    asks += [("ent-supplier", {"id": s["supplier_id"]}) for s in suppliers[:8]]
    # Scenario presets and use cases: ids are read from the client source so the bake
    # cannot drift from what the pages offer.
    client = pathlib.Path(__file__).resolve().parent.parent / "client" / "src"
    presets = re.findall(r'\{ id: "([a-z0-9-]+)", label:', (client / "lib" / "entScenario.ts").read_text())
    cases = re.findall(r'\{ id: "(uc-[a-z-]+)", role: "[^"]+", question: "([^"]+)"', (client / "pages" / "ent" / "EntUseCases.tsx").read_text())
    asks += [(t, {"preset": p}) for p in presets for t in ("ent-scenario", "ent-impact", "ent-risk", "ent-mitigation")]
    asks += [("ent-usecase", {"id": i, "question": q}) for i, q in cases]
    baked = {}
    for topic, args in asks:
        req = urllib.request.Request(HOST + "/api/ask-cortex", headers={"Content-Type": "application/json"},
                                     data=json.dumps({"topic": topic, "args": args, "question": ""}).encode())
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                baked[ask_key(topic, args)] = json.load(r)["text"]
        except Exception as e:
            print(f"  SKIP  ask-cortex {ask_key(topic, args)} -> {e}")
    f = OUT / "ask_cortex.json"
    f.write_text(json.dumps(baked))
    print(f"  baked {len(baked)}/{len(asks)} Ask Cortex analyses")
    return total + f.stat().st_size


if __name__ == "__main__":
    main()

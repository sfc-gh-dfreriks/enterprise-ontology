#!/usr/bin/env python3
"""Snapshot the live API into client/public/data for the public static build.

The GitHub Pages build has no server and no Snowflake credentials, so every view
it can show has to be baked ahead of time. This walks the endpoints the client
calls and writes one JSON file per call, using the same filename rule the client
applies in static mode:

    /products                -> products.json
    /graph?processes=D2O     -> graph__processes=D2O.json

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

# Traversal is baked per seed, so the public build offers expansion from the
# most-connected entities only. Shortest path is not baked: it is O(n^2) pairs
# and the client disables the control in static mode.
HUB_COUNT = 24
TRAVERSE_DEPTHS = (1, 2, 3)


def fetch(path: str):
    with urllib.request.urlopen(HOST + "/api" + path, timeout=60) as r:
        return json.load(r)


def sim_name(d: dict) -> str:
    """Filename for a baked simulate result.

    Must stay identical to simName() in client/src/lib/api.ts. Built from the
    disruption's own fields rather than a hash so a mismatch is debuggable by
    reading the filename.
    """
    t = "-".join(sorted(d["targets"]))
    key = (f"scenario_sim__{d['kind']}__{t}__"
           f"{int(round(float(d['severity']) * 100))}__{int(d['durationDays'])}")
    return re.sub(r"[^A-Za-z0-9=&._-]", "-", key)


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

    total = 0
    paths = ["/meta", "/products", "/processes", "/coverage", "/scorecard",
             "/correlation", "/insight-apps", "/semantic-roles", "/lenses",
             "/demo", "/topology", "/ask/status", "/ask/examples",
             f"/hubs?limit={HUB_COUNT}", "/hubs?limit=30",
             "/entities?q=&limit=400", "/entities?q=&limit=300", "/graph",
             # the scenario pages need the network and the preset list
             "/scenario/network", "/scenario/presets", "/scenario/reasoning/status",
             # the ontology model page: schema plus one graph per toggle position
             "/ontology/schema",
             "/ontology/class-graph?mode=both",
             "/ontology/class-graph?mode=abstract",
             "/ontology/class-graph?mode=concrete"]

    # one snapshot per ontology class, for the detail panel. Driven off the
    # schema rather than a hardcoded list so a new class is picked up
    # automatically on the next bake.
    try:
        classes = [c["name"] for c in fetch("/ontology/schema")["classes"]]
        paths += [f"/ontology/class/{urllib.parse.quote(n)}" for n in classes]
    except urllib.error.HTTPError as e:
        print(f"  SKIP  ontology class snapshots -> HTTP {e.code}")

    # one graph per process, matching the sidebar's single-process filters
    procs = [p["code"] for p in fetch("/processes")]
    paths += [f"/graph?processes={c}" for c in procs]

    for p in paths:
        try:
            total += bake(p)
            print(f"  baked {name(p)}")
        except urllib.error.HTTPError as e:
            print(f"  SKIP  {name(p)} -> HTTP {e.code}")

    # traversal snapshots from the hub set
    hubs = fetch(f"/hubs?limit={HUB_COUNT}")
    n = 0
    for h in hubs:
        for d in TRAVERSE_DEPTHS:
            q = urllib.parse.urlencode({"seed": h["id"], "depth": d, "limit": 60})
            try:
                total += bake(f"/traverse?{q}")
                n += 1
            except urllib.error.HTTPError as e:
                print(f"  SKIP  traverse {h['label']} d{d} -> HTTP {e.code}")
    print(f"  baked {n} traversal snapshots from {len(hubs)} hubs")

    # Scenario results come from POST /scenario/simulate, which a static site cannot
    # call. Bake one result per preset instead, keyed by a signature of the
    # disruption so the client can look the same key up. Custom slider combinations
    # are therefore unavailable in the public build, and the UI says so rather than
    # failing with a confusing error.
    presets = fetch("/scenario/presets")
    n_sim = 0
    for pr in presets:
        body = {k: pr[k] for k in ("kind", "targets", "severity", "durationDays")}
        body["label"] = pr.get("label", pr["id"])
        req = urllib.request.Request(
            HOST + "/api/scenario/simulate",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            print(f"  SKIP  simulate {pr['id']} -> HTTP {e.code}")
            continue
        f = OUT / f"{sim_name(body)}.json"
        f.write_text(json.dumps(data))
        total += f.stat().st_size
        n_sim += 1
    print(f"  baked {n_sim} scenario result(s) for {len(presets)} preset(s)")

    # The scenario AI needs Snowflake, so report it unavailable rather than
    # advertising a model nobody can reach.
    (OUT / "scenario_reasoning_status.json").write_text(json.dumps(
        {"ok": False, "missing": ["public build has no Snowflake connection"]}))
    print("  overrode scenario_reasoning_status.json")

    # ask/status is rewritten so the public build reports Ask as unavailable
    # rather than advertising a semantic view nobody can reach
    (OUT / "ask_status.json").write_text(json.dumps(
        {"ok": False, "missing": ["public build has no Snowflake connection"],
         "semantic_view": ""}))
    print("  overrode ask_status.json for the public build")

    # demo.json carries the semantic view FQN for the on-screen scope note. In a
    # public build Ask is disabled, so naming the object is useless to the reader
    # and publishes an internal database path for no benefit.
    demo = json.loads((OUT / "demo.json").read_text())
    demo["semanticView"] = ""
    (OUT / "demo.json").write_text(json.dumps(demo))
    print("  stripped semanticView from demo.json")

    total += bake_enterprise()

    files = sorted(OUT.glob("*.json"))
    print(f"\n  {len(files)} files, {total / 1048576:.2f} MB total")
    big = sorted(files, key=lambda f: -f.stat().st_size)[:5]
    print("  largest:")
    for f in big:
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
              "/ent/scenario-data"]:
        total += bake(p)
    customers, suppliers = fetch("/ent/customers"), fetch("/ent/suppliers")
    for c in customers:
        total += bake(f"/ent/customer/{c['customer_id']}")
    for s in suppliers:
        total += bake(f"/ent/supplier/{s['supplier_id']}")
    print(f"  baked enterprise endpoints + {len(customers)} customers + {len(suppliers)} suppliers")

    asks = [(t, {}) for t in ("ent-overview", "ent-companies", "ent-customers", "ent-suppliers",
                              "ent-model", "ent-crosswalk")]
    asks += [("ent-customer", {"id": c["customer_id"]}) for c in customers[:8]]
    asks += [("ent-supplier", {"id": s["supplier_id"]}) for s in suppliers[:8]]
    # Scenario presets and use cases: ids are read from the client source so the bake
    # cannot drift from what the pages offer.
    client = pathlib.Path(__file__).resolve().parent.parent / "client" / "src"
    presets = re.findall(r'\{ id: "([a-z0-9-]+)", label:', (client / "lib" / "entScenario.ts").read_text())
    cases = re.findall(r'\{ id: "(uc-[a-z-]+)", role: "[^"]+", question: "([^"]+)"', (client / "pages" / "ent" / "EntUseCases.tsx").read_text())
    asks += [("ent-scenario", {"preset": p}) for p in presets]
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

#!/usr/bin/env python3
"""One command for the whole Enterprise Ontology refresh cycle.

The app is served from two exported JSON artifacts and a set of baked snapshots,
and the docs and presales kit are generated from live facts. Refreshing them by
hand means running eight scripts in the right order with a server running in the
middle — easy to half-do, and a half-done refresh publishes wrong numbers
silently rather than failing.

  1. export_enterprise.py     Snowflake -> data/enterprise_ontology.json
  2. export_lineage.py        Snowflake -> data/enterprise_lineage.json
  3. verify_ent_mitigation.ts engine invariants on every scenario preset
  4. server build + start     on a free port
  5. bake_static.py           server    -> client/public/data/*.json  (public site)
  6. enterprise_facts.py, capture_enterprise.py, build_enterprise_kit.py,
     build_enterprise_decks.py            -> README, docs/enterprise, presales kit
  7. reconcile                exported and baked JSON vs Snowflake, and fail loudly

Step 7 is the point of the script: everything before it can succeed while leaving
the served numbers stale.

Run:  python3 tools/refresh_all.py
      python3 tools/refresh_all.py --check      reconcile only, change nothing
      python3 tools/refresh_all.py --skip-kit   skip docs, screenshots and decks
"""
import argparse
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import tomllib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "enterprise_ontology.json"
LINEAGE = ROOT / "data" / "enterprise_lineage.json"
BAKED = ROOT / "client" / "public" / "data"
DB = "SAP_ENTERPRISE_ONTOLOGY"


def say(msg: str, indent: int = 2) -> None:
    print(" " * indent + msg, flush=True)


def run(cmd: list[str], env: dict | None = None) -> None:
    """Run a step, failing loudly with its last lines of output."""
    r = subprocess.run(cmd, cwd=ROOT, env={**os.environ, **(env or {})}, capture_output=True, text=True)
    if r.returncode != 0:
        say(f"FAILED: {' '.join(cmd)}")
        for line in (r.stdout + r.stderr).strip().splitlines()[-14:]:
            say(line, 6)
        sys.exit(1)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url: str, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.6)
    return False


def snowflake_truth() -> dict:
    import snowflake.connector
    cfg = tomllib.load(open(os.path.expanduser("~/.snowflake/connections.toml"), "rb"))["dfreriksdemo"]
    kw = {k: v for k, v in cfg.items() if k in ("account", "user", "role", "warehouse", "authenticator")}
    if cfg.get("private_key_path"):
        kw["private_key_file"] = cfg["private_key_path"]
    cur = snowflake.connector.connect(**kw, database=DB).cursor()
    one = lambda sql: int(cur.execute(sql).fetchone()[0])
    return {
        "kg_nodes": one("SELECT COUNT(*) FROM CORE.KG_NODE"),
        "kg_edges": one("SELECT COUNT(*) FROM CORE.KG_EDGE"),
        "crosswalk": one("SELECT COUNT(*) FROM XWALK.V_CROSSWALK"),
        "customers": one("SELECT COUNT(*) FROM XWALK.GOLDEN_CUSTOMER"),
        "suppliers": one("SELECT COUNT(*) FROM XWALK.GOLDEN_SUPPLIER"),
        "geo_nodes": one("SELECT COUNT(*) FROM SCENARIO.V_GEO"),
        "flows": one("SELECT COUNT(*) FROM SCENARIO.V_FLOW"),
    }


def reconcile() -> int:
    """Compare what is served against what Snowflake holds. Non-zero on drift."""
    for f in (DATA, LINEAGE):
        if not f.exists():
            say(f"DRIFT {f.name} absent — run without --check first")
            return 1
    d = json.loads(DATA.read_text())
    got = {"kg_nodes": d["stats"]["nodes"], "kg_edges": d["stats"]["edges"], "crosswalk": d["stats"]["crosswalk_records"],
           "customers": len(d["customers"]), "suppliers": len(d["suppliers"]),
           "geo_nodes": len(d["scenario"]["geo"]), "flows": len(d["scenario"]["flows"])}
    truth = got if os.environ.get("NO_SNOWFLAKE") else snowflake_truth()
    bad = 0
    say("reconciling exported JSON against Snowflake:")
    for k in got:
        ok = truth[k] == got[k]
        bad += 0 if ok else 1
        say(f"{'ok  ' if ok else 'DRIFT'} {k:10} exported={got[k]:<7} snowflake={truth[k]}", 4)

    # the baked snapshots are what the public site serves, so check them too
    for name, key, want in [("ent_summary.json", ("stats", "nodes"), got["kg_nodes"]),
                            ("ent_scenario-data.json", ("scenario", "geo"), got["geo_nodes"])]:
        f = BAKED / name
        if not f.exists():
            bad += 1
            say(f"DRIFT baked {name} absent — bake has not run", 4)
            continue
        v = json.loads(f.read_text())[key[0]][key[1]]
        v = len(v) if isinstance(v, list) else v
        ok = v == want
        bad += 0 if ok else 1
        say(f"{'ok  ' if ok else 'DRIFT'} baked {name:24} {v} vs {want}", 4)
    ask = BAKED / "ask_cortex.json"
    n = len(json.loads(ask.read_text())) if ask.exists() else 0
    bad += 0 if n else 1
    say(f"{'ok  ' if n else 'DRIFT'} baked Ask Cortex analyses: {n}", 4)
    return bad


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="reconcile only, change nothing")
    ap.add_argument("--skip-kit", action="store_true", help="skip docs, screenshots and decks")
    args = ap.parse_args()
    if args.check:
        bad = reconcile()
        say("in sync" if bad == 0 else f"{bad} discrepancy(ies) — run without --check")
        return 0 if bad == 0 else 1

    say("1/7  exporting the enterprise ontology"); run([sys.executable, "tools/export_enterprise.py"])
    say("2/7  exporting SAP BDC lineage"); run([sys.executable, "tools/export_lineage.py"])
    say("3/7  verifying the scenario engine"); run(["npx", "tsx", "tools/verify_ent_mitigation.ts"])
    say("4/7  building server"); run(["npm", "run", "build", "-w", "server"])
    port = free_port()
    srv = subprocess.Popen(["node", "dist/index.js"], cwd=ROOT / "server", env={**os.environ, "PORT": str(port)},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not wait_for(f"http://localhost:{port}/api/health"):
            say("server did not come up — aborting before baking stale data")
            return 1
        say(f"5/7  baking static snapshots (server :{port})")
        run([sys.executable, "tools/bake_static.py"], env={"BAKE_HOST": f"http://localhost:{port}"})
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=10)
        except subprocess.TimeoutExpired:
            srv.kill()
    if args.skip_kit:
        say("6/7  skipping docs and kit (--skip-kit)")
    else:
        say("6/7  docs and presales kit (needs the app on :5186 for screenshots)")
        for t in ("enterprise_facts.py", "capture_enterprise.py", "build_enterprise_kit.py", "build_enterprise_decks.py"):
            run([sys.executable, f"tools/{t}"])
    say("7/7  reconciling")
    bad = reconcile()
    say("refresh complete, served data matches Snowflake" if bad == 0 else f"{bad} discrepancy(ies) — do not publish")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

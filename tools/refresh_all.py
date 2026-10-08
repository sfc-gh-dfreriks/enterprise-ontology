#!/usr/bin/env python3
"""One command for the whole refresh cycle.

The ontology layer is served from three exported JSON artifacts, and each has a
different source. Refreshing them by hand means running four scripts in the right
order with a server running in between — easy to half-do, and a half-done refresh
publishes wrong numbers silently rather than failing.

Order matters and is enforced here:

  1. export_ontology_schema.py   Snowflake  -> data/sc_ontology_schema.json
  2. export_scenario_network.py  Snowflake  -> data/sc_network.json
  3. npm run build -w server                   the baker talks to a built server
  4. server up on a free port
  5. bake_static.py              server     -> client/public/data/*.json
  6. build_docs_docx.py          markdown   -> ~/Documents/SAP/...
  7. build_demo_scripts.py       markdown   -> ~/Documents/SAP/...
  8. reconcile                   exported JSON vs Snowflake, and fail loudly

Step 8 is the point of the script. Everything before it can succeed while leaving
the served numbers stale — an exporter that wrote nothing, a bake against the
wrong port, a server holding an old cache.

Run:  python3 tools/refresh_all.py
      python3 tools/refresh_all.py --check     reconcile only, change nothing
      python3 tools/refresh_all.py --skip-docs skip the Word documents
"""
import argparse
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA_JSON = ROOT / "data" / "sc_ontology_schema.json"
BAKED = ROOT / "client" / "public" / "data"
DB, SC = "SAP_SUPPLY_CHAIN", "ONTOLOGY"


def say(msg: str, indent: int = 2) -> None:
    print(" " * indent + msg, flush=True)


def run(cmd: list[str], cwd: pathlib.Path = ROOT, env: dict | None = None) -> None:
    """Run a step, streaming nothing but failing loudly with captured output."""
    r = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})},
                       capture_output=True, text=True)
    if r.returncode != 0:
        say(f"FAILED: {' '.join(cmd)}", 2)
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
    """Counts straight from Snowflake, for reconciliation against the export."""
    import snowflake.connector
    from cryptography.hazmat.primitives import serialization
    try:
        import tomllib
    except ModuleNotFoundError:
        import tomli as tomllib

    cfg = tomllib.loads((pathlib.Path.home() / ".snowflake" / "connections.toml").read_text())
    c = cfg.get("connections", cfg)["dfreriksdemo"]
    key = serialization.load_pem_private_key(
        pathlib.Path(c["private_key_path"]).expanduser().read_bytes(), password=None)
    pkb = key.private_bytes(serialization.Encoding.DER,
                            serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption())
    cn = snowflake.connector.connect(
        account=c["account"], user=c["user"], private_key=pkb,
        role=c.get("role", "ACCOUNTADMIN"), warehouse=c.get("warehouse", "COMPUTE_WH"),
        database=DB, schema=SC)
    cur = cn.cursor()

    def one(sql: str):
        cur.execute(sql)
        return cur.fetchone()[0]

    truth = {
        "classes":   one("SELECT COUNT(*) FROM ONT_CLASS"),
        "abstract":  one("SELECT COUNT(*) FROM ONT_CLASS WHERE IS_ABSTRACT"),
        "relations": one("SELECT COUNT(*) FROM ONT_RELATION_DEF"),
        "inferred":  one("SELECT COUNT(*) FROM REL_EDGE_INFERRED"),
        "instances": one("SELECT COUNT(*) FROM KG_NODE WHERE NODE_TYPE <> 'OntologyClass'"),
        "kg_nodes":  one("SELECT COUNT(*) FROM KG_NODE"),
        "kg_edges":  one("SELECT COUNT(*) FROM KG_EDGE"),
    }
    cn.close()
    return {k: int(v) for k, v in truth.items()}


def exported_counts() -> dict:
    d = json.loads(SCHEMA_JSON.read_text())
    c = d["counts"]
    inferred = sum(r["rule"]["edges"] for r in d["relations"] if r.get("rule"))
    return {
        "classes": c["classes"], "abstract": c["abstract"],
        "relations": c["relations"], "inferred": inferred,
        "instances": c["instances"],
    }


def reconcile() -> int:
    """Compare what is served against what Snowflake holds. Non-zero on drift."""
    if not SCHEMA_JSON.exists():
        say("no exported schema — run without --check first")
        return 1
    truth, got = snowflake_truth(), exported_counts()
    bad = 0
    say("reconciling exported JSON against Snowflake:")
    for k in ("classes", "abstract", "relations", "inferred", "instances"):
        ok = truth[k] == got[k]
        bad += 0 if ok else 1
        mark = "ok  " if ok else "DRIFT"
        say(f"{mark} {k:11} exported={got[k]:<7} snowflake={truth[k]}", 4)

    # the baked snapshots are what the static site serves, so check them too
    both = BAKED / "ontology_class-graph__mode=both.json"
    if both.exists():
        nodes = [e for e in json.loads(both.read_text())["elements"]
                 if e["data"].get("kind") == "class"]
        ok = len(nodes) == truth["classes"]
        bad += 0 if ok else 1
        say(f"{'ok  ' if ok else 'DRIFT'} baked graph  nodes={len(nodes):<7} "
            f"snowflake={truth['classes']}", 4)
        missing = [e for e in nodes if "position" not in e or "w" not in e["data"]]
        if missing:
            bad += 1
            say(f"DRIFT baked graph missing position/geometry on {len(missing)} node(s)", 4)
    else:
        bad += 1
        say("DRIFT baked graph absent — bake has not run", 4)
    return bad


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="reconcile only, change nothing")
    ap.add_argument("--skip-docs", action="store_true", help="skip Word generation")
    args = ap.parse_args()

    if args.check:
        bad = reconcile()
        print()
        say("in sync" if bad == 0 else f"{bad} discrepancy(ies) — run without --check")
        return 0 if bad == 0 else 1

    say("1/8  exporting ontology schema from Snowflake")
    run([sys.executable, "tools/export_ontology_schema.py"])
    say("2/8  exporting scenario network")
    run([sys.executable, "tools/export_scenario_network.py"])

    say("3/8  building server")
    run(["npm", "run", "build", "-w", "server"])

    port = free_port()
    say(f"4/8  starting server on :{port}")
    srv = subprocess.Popen(["node", "dist/index.js"], cwd=ROOT / "server",
                           env={**os.environ, "PORT": str(port)},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not wait_for(f"http://localhost:{port}/api/ontology/schema"):
            say("server did not come up — aborting before baking stale data")
            return 1
        say(f"5/8  baking static snapshots")
        run([sys.executable, "tools/bake_static.py"],
            env={"BAKE_HOST": f"http://localhost:{port}"})
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=10)
        except subprocess.TimeoutExpired:
            srv.kill()

    if args.skip_docs:
        say("6/8  skipping Word documents (--skip-docs)")
        say("7/8  skipping demo script (--skip-docs)")
    else:
        say("6/8  regenerating Word documents")
        run([sys.executable, "tools/build_docs_docx.py"])
        say("7/8  regenerating demo script")
        run([sys.executable, "tools/build_demo_scripts.py"])

    say("8/8  reconciling")
    bad = reconcile()
    print()
    if bad:
        say(f"refresh completed but {bad} discrepancy(ies) remain — do not publish")
        return 1
    say("refresh complete and reconciled")
    say("next: git add -A && git commit && git push", 4)
    return 0


if __name__ == "__main__":
    sys.exit(main())

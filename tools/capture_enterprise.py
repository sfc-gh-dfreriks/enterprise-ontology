#!/usr/bin/env python3
"""Capture what the presales kit shows: scenario results and page screenshots.

  /tmp/enterprise_scenarios.json        every preset, run through the app's own engine
                                        (client/src/lib/entScenario.ts + entImpact.ts)
  /tmp/enterprise_shots/<id>.png        one screenshot per kit slide
  /tmp/enterprise_shots/manifest.json   id -> file, for build_enterprise_decks.py

Needs the app running on :5186 (npm run dev). Ask Cortex and Ask the Enterprise
shots wait for a real answer, so allow a few minutes.

    python3 tools/capture_enterprise.py
"""
import json
import pathlib
import subprocess
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = "http://localhost:5186/"
SHOTS = pathlib.Path("/tmp/enterprise_shots")
SCEN = pathlib.Path("/tmp/enterprise_scenarios.json")

# The engine is TypeScript; run it with tsx rather than re-implementing it here.
ENGINE = r"""
import fs from "node:fs";
import { PRESETS, runScenario } from "./server/src/lib/entScenario.ts";
import { analyse } from "./server/src/lib/entImpact.ts";
const d = JSON.parse(fs.readFileSync("data/enterprise_ontology.json", "utf-8"));
const out = PRESETS.map((p) => {
  const a = analyse(d, p.scenario);
  return { id: p.id, label: p.label, question: p.question, summary: a.result.summary, headline: a.result.headline,
    apps: [...new Set(a.result.effects.map((e) => e.module))],
    mitigation: { at_risk: a.mitigation.atRiskUsd, protected: a.mitigation.protectedUsd, residual: a.mitigation.residualUsd,
      cash: a.mitigation.cashUsd, actions: a.mitigation.actions.length, unmitigable: a.mitigation.unmitigable.length,
      top_action: a.mitigation.actions[0]?.title ?? null, exposure: a.mitigation.exposureLabel },
    risk: { inherent: a.riskBefore.overall, residual: a.riskAfter.overall, spofs: a.riskBefore.spofs.map((s) => s.name),
      first_felt: a.riskBefore.timeline.find((t) => t.day > 0)?.day ?? 0 },
    hops: a.impact.steps.length };
});
process.stdout.write(JSON.stringify(out));
"""

# (id, hash, preset button to click or None, action)
PLAN = [
    ("overview", "ent-overview", None, None),
    ("usecases", "ent-usecases", None, None),
    ("scenario", "ent-scenario", "Top-spend supplier fails (8 weeks)", None),
    ("scenario_cortex", "ent-scenario", "Top-spend supplier fails (8 weeks)", "cortex"),
    ("impact", "ent-impact", "Top-spend supplier fails (8 weeks)", "steps:3"),
    ("risk", "ent-risk", "Top-spend supplier fails (8 weeks)", None),
    ("mitigation", "ent-mitigation", "San Jose HQ down 4 weeks", "steps:3"),
    ("model", "ent-model", None, None),
    ("customers", "ent-customers", None, None),
    ("suppliers", "ent-suppliers", None, None),
    ("ask_cortex", "ent-suppliers", None, "cortex"),
    ("crosswalk", "ent-crosswalk", None, None),
    ("graph", "ent-graph", None, "wait:3500"),
    ("lineage", "ent-lineage", None, None),
    ("ask", "ask", None, "ask"),
]


def main():
    r = subprocess.run(["npx", "tsx", "-e", ENGINE], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"engine run failed:\n{r.stderr[-1500:]}")
    SCEN.write_text(r.stdout)
    print(f"wrote {SCEN} ({len(json.loads(r.stdout))} presets)")

    SHOTS.mkdir(parents=True, exist_ok=True)
    manifest = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=2)
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        for sid, h, preset, action in PLAN:
            pg.goto(f"{APP}#{h}")
            pg.wait_for_timeout(2500)
            if preset:
                pg.get_by_role("button", name=preset, exact=False).first.click()
                pg.wait_for_timeout(1500)
            if action == "cortex":
                pg.get_by_role("button", name="Ask Cortex", exact=False).first.click()
                pg.locator(".cortex-md").first.wait_for(timeout=180000)
                pg.wait_for_timeout(800)
            elif action and action.startswith("steps:"):
                for _ in range(int(action.split(":")[1])):
                    nb = pg.get_by_role("button", name="Next").first
                    if nb.is_enabled():
                        nb.click()
                        pg.wait_for_timeout(1300)
            elif action and action.startswith("wait:"):
                pg.wait_for_timeout(int(action.split(":")[1]))
            elif action == "ask":
                pg.get_by_role("button", name="Which suppliers have the highest open payables", exact=False).first.click()
                pg.get_by_text("show SQL").first.wait_for(timeout=180000)
                pg.evaluate("document.querySelector('main').scrollTo(0, 0)")   # the question and answer, not the row tail
                pg.wait_for_timeout(800)
            f = SHOTS / f"{sid}.png"
            pg.screenshot(path=str(f))
            manifest.append({"id": sid, "file": str(f), "page": h})
            print(f"  shot {sid}")
        b.close()
    if errors:
        sys.exit(f"page errors during capture: {errors[:3]}")
    (SHOTS / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(manifest)} screenshots to {SHOTS}")


if __name__ == "__main__":
    main()

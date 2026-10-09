/**
 * Verification harness for the enterprise impact / risk / mitigation engine.
 *
 * Runs every preset and checks the invariants a reader would rely on:
 *   - the ripple's headline numbers reconcile to the Scenario Studio
 *   - protected + residual = at risk, and nothing protects more than is at risk
 *   - reroutes never exceed a plant's free hours, and only go to plants that have
 *     shipped the category before
 *   - mitigation never makes risk worse
 *
 *   npx tsx tools/verify_ent_mitigation.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PRESETS } from "../server/src/lib/entScenario.js";
import { analyse, defaultLevers } from "../server/src/lib/entImpact.js";

const d = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../data/enterprise_ontology.json"), "utf-8"));
const money = (n: number) => "$" + Math.round(n).toLocaleString();
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`    ${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-6);

for (const p of PRESETS) {
  const a = analyse(d, p.scenario);
  const m = a.mitigation;
  console.log(`\n${p.label}  (${p.scenario.kind})`);
  console.log(`  at risk ${money(m.atRiskUsd)} · protected ${money(m.protectedUsd)} · residual ${money(m.residualUsd)} · ` +
    `cash ${money(m.cashUsd)} · ${m.actions.length} actions, ${m.unmitigable.length} blocked · risk ${a.riskBefore.overall} → ${a.riskAfter.overall}`);

  check("protected + residual = at risk", close(m.protectedUsd + m.residualUsd, m.atRiskUsd));
  check("protected ≤ at risk", m.protectedUsd <= m.atRiskUsd + 1);
  check("ripple has an event step and an app step", a.impact.steps[0].hop === 0 && a.impact.steps.some((s) => s.id.endsWith("apps")));

  if (p.scenario.kind === "supplier" || p.scenario.kind === "plant") {
    const lost = -a.result.effects[0].delta;
    check("at risk = Scenario Studio output lost", close(m.atRiskUsd, lost), `${money(m.atRiskUsd)} vs ${money(lost)}`);
    const custSum = a.result.customers.reduce((s, c) => s + c.valueAtRiskUsd, 0);
    const linkSum = Object.entries(a.impact.linkHits).filter(([k]) => k.startsWith("ship:")).reduce((s, [, h]) => s + h.valueUsd, 0);
    check("shipsTo links carry the customers' value at risk", close(linkSum, custSum), `${money(linkSum)} vs ${money(custSum)}`);

    const cap = new Map<string, any>(d.scenario.capacity.map((c: any) => [c.plant, c]));
    const used: Record<string, number> = {};
    for (const r of m.actions.filter((x) => x.lever === "reroute")) {
      const to = r.to!.slice(4), cat = r.title.match(/^Move (.+) from /)![1];
      const hrs = Number(r.detail.match(/· ([\d.]+) of its free hours/)![1]);
      used[to] = (used[to] ?? 0) + hrs;
      check(`${cat} → ${to} is a capable plant`, d.scenario.substitution.some((x: any) => x.plant === to && x.category === cat));
    }
    for (const [pl, hrs] of Object.entries(used)) check(`plant ${pl} stays within free hours`, hrs <= Number(cap.get(pl).free_hrs) + 0.5, `${hrs.toFixed(0)} of ${cap.get(pl).free_hrs}`);
    for (const c of m.capacityAfter) check(`plant ${c.plant} headroom not negative`, c.headroomAfter >= -0.05, `${c.headroomAfter}%`);
  }

  const order = ["Low", "Moderate", "High", "Critical"];
  check("mitigation never raises the risk band", order.indexOf(a.riskAfter.overall) <= order.indexOf(a.riskBefore.overall));
  const none = analyse(d, p.scenario, Object.fromEntries(Object.keys(defaultLevers(p.scenario)).map((k) => [k, 0])));
  check("with every lever off, nothing is protected", none.mitigation.protectedUsd === 0);
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : "all checks passed"}`);
process.exit(failures ? 1 : 0);

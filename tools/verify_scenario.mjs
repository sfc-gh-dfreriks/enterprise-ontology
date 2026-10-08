/**
 * Verification harness for the scenario engine.
 *
 * Checks the five disruption kinds plus the cases most likely to be wrong:
 * a short event that inventory absorbs entirely, a supplier feeding two plants
 * at once, and a demand spike that exceeds headroom.
 *
 * Run after any change to scenario.ts or mitigate.ts:
 *   npm run build -w server && node tools/verify_scenario.mjs
 */
import { simulate, loadNetwork } from "../server/dist/services/scenario.js";
import { mitigate } from "../server/dist/services/mitigate.js";

const net = loadNetwork();
const money = (n) => "$" + Math.round(n).toLocaleString();
let failures = 0;

function check(label, actual, expected, cmp = (a, b) => a === b) {
  const ok = cmp(actual, expected);
  if (!ok) failures++;
  console.log(`    ${ok ? "OK  " : "FAIL"} ${label}: ${actual}${ok ? "" : `  expected ${expected}`}`);
}

function run(title, disruption, expectations) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
  const res = simulate(disruption);
  const plan = mitigate(res);
  const t = res.totals;

  console.log(`  hops: ${res.hops.map((h) => `${h.hop}:${h.flows}f/${h.nodes}n`).join("  ")}`);
  console.log(`  value at risk ${money(t.valueAtRisk)} (${t.pctOfNetwork}% of network)` +
              `   revenue ${money(t.revenueAtRisk)}`);
  console.log(`  customers ${t.customersAffected}  plants impaired ${t.plantsImpaired}  max hop ${t.maxHop}`);

  if (res.impaired.length) {
    console.log("  downstream:");
    for (const n of res.impaired)
      console.log(`     hop ${n.hop} ${n.node_name.padEnd(18)} ` +
                  `${(n.impairment * 100).toFixed(1)}% impaired, buffer ${n.bufferDays}d, ` +
                  `exposed ${n.daysExposed}d`);
  }
  if (plan.reroutes.length) {
    console.log("  reroutes:");
    for (const r of plan.reroutes)
      console.log(`     ${r.material_category} -> ${r.toPlant}  ${r.unitsMoved}u/mo  ` +
                  `${r.hrsRequired}hrs  ${money(r.valueProtected)}` +
                  (r.distanceDeltaKm != null ? `  ${r.distanceDeltaKm >= 0 ? "+" : ""}${r.distanceDeltaKm}km` : ""));
  }
  if (plan.unmitigable.length) {
    console.log("  blocked:");
    for (const u of plan.unmitigable)
      console.log(`     ${u.material_category} (${u.customer}) ${money(u.valueAtRisk)} — ${u.reason}`);
  }
  if (plan.totals.revenueAtRisk > 0)
    console.log(`  protected ${money(plan.totals.valueProtected)} of ` +
                `${money(plan.totals.revenueAtRisk)} = ${plan.totals.protectedPct}%`);
  if (plan.capacityAfter.length) {
    console.log("  capacity after:");
    for (const c of plan.capacityAfter)
      console.log(`     ${c.plantName.padEnd(18)} ${c.utilizationBefore}% -> ${c.utilizationAfter}%` +
                  `  +${c.unitsAdded}u  spare left ${c.spareUnitsLeft}`);
  }
  if (expectations) { console.log("  checks:"); expectations(res, plan); }
  return { res, plan };
}

console.log(`network: ${net.nodes.length} nodes, ${net.flows.length} flows, ` +
            `${money(net.totals.monthly_value)}/mo`);

// 1 — the headline case
run("1. WEATHER — Hurricane, Austin Fab offline 60 days",
  { kind: "weather", targets: ["PLT-2000"], severity: 1, durationDays: 60 },
  (res, plan) => {
    check("Austin outbound flows hit", res.flows.filter((f) => f.hop === 1).length, 3);
    check("Penang impaired at hop 1",
      res.impaired.some((n) => n.node_name === "Penang Assembly" && n.hop === 1), true);
    check("ripple reaches hop 2", res.totals.maxHop, 2);
    check("Die Sorting unmitigable",
      plan.unmitigable.filter((u) => u.material_category === "Die Sorting").length, 2);
    check("both reroutes land on San Jose",
      plan.reroutes.every((r) => r.toPlant === "San Jose HQ") && plan.reroutes.length === 2, true);
    check("San Jose exhausted", plan.capacityAfter[0].spareUnitsLeft, 0);
    check("protected pct > 90", plan.totals.protectedPct, 90, (a, b) => a > b);
  });

// 2 — inventory should absorb a short event downstream
run("2. WEATHER — same plant, only 10 days (Penang buffer is 12)",
  { kind: "weather", targets: ["PLT-2000"], severity: 1, durationDays: 10 },
  (res) => {
    check("Penang NOT impaired — buffer covers it",
      res.impaired.some((n) => n.node_name === "Penang Assembly"), false);
    check("no hop 2", res.totals.maxHop, 1);
  });

// 3 — one supplier, two plants
run("3. SUPPLIER — Hamamatsu Photonics fails 45 days (feeds San Jose and Austin)",
  { kind: "supplier", targets: ["SUP-001"], severity: 1, durationDays: 45 },
  (res) => {
    const hit = new Set(res.flows.filter((f) => f.hop === 1).map((f) => f.target_name));
    check("both plants receive the hit", hit.has("San Jose HQ") && hit.has("Austin Fab"), true);
  });

// 4 — partial capacity loss, not a full outage
run("4. CAPACITY — Dresden Fab loses 40% for 30 days",
  { kind: "capacity", targets: ["PLT-3000"], severity: 0.4, durationDays: 30 },
  (res) => {
    check("impact is partial, not total",
      res.flows.filter((f) => f.hop === 1).every((f) => f.impactFactor < 1), true);
  });

// 5 — a lane closes while both endpoints keep running
run("5. LANE — San Jose to Penang sub-assembly lane closed 40 days",
  { kind: "lane", targets: ["FL-025"], severity: 1, durationDays: 40 },
  (res) => {
    check("the closed lane is the affected flow",
      res.flows.some((f) => f.flow_id === "FL-025"), true);
    check("San Jose itself is not impaired",
      res.impaired.some((n) => n.node_name === "San Jose HQ"), false);
    check("Penang is impaired", res.impaired.some((n) => n.node_name === "Penang Assembly"), true);
    // the whole point of a lane closure: it must reach Penang's customers
    check("ripple reaches Penang customers", res.totals.customersAffected > 0, true);
    check("revenue at risk is non-zero", res.totals.revenueAtRisk > 0, true);
  });

// 6 — demand the other way
run("6. DEMAND — TSMC orders +60% for 30 days",
  { kind: "demand", targets: ["CUS-001"], severity: 0.6, durationDays: 30 },
  (res, plan) => {
    check("no reroutes proposed for a demand spike", plan.reroutes.length, 0);
    check("capacity verdicts produced", plan.capacityAfter.length > 0, true);
    check("actions explain the headroom", plan.actions.length > 0, true);
  });

console.log(`\n${"=".repeat(72)}`);
console.log(failures === 0
  ? "  all checks passed"
  : `  ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

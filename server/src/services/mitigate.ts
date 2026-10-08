/**
 * Mitigation: find feasible reroutes for a simulated disruption, inside real
 * capacity limits, and say plainly what cannot be saved.
 *
 * ---------------------------------------------------------------------------
 * How allocation works, and why
 * ---------------------------------------------------------------------------
 * Greedy by value at risk: sort the lost customer-facing flows most-valuable
 * first, and give each the cheapest feasible alternative plant that still has
 * spare units. With 27 flows an exact optimum is computable, but greedy is
 * chosen deliberately — every decision it makes can be read off the table in
 * one line, which matters more here than the last few percent of optimality.
 * Where greedy is provably not optimal the plan says so.
 *
 * Capacity is expressed in spare UNITS, derived from a plant's free hours
 * divided by its blended hours per unit. That blend is an approximation across
 * work centers and products, so the plan reports the hours it consumes and the
 * headroom it leaves rather than presenting a unit count as exact.
 *
 * Two kinds of "cannot be saved" are distinguished, because they call for
 * completely different responses:
 *   - NO ALTERNATIVE: no other plant makes this category at all. Rerouting is
 *     impossible; the answer is qualification, tooling, or a customer conversation.
 *   - NO CAPACITY: an alternative exists but has no room left. The answer is
 *     overtime, a shift pattern change, or displacing lower-value work.
 */
import { loadNetwork, type Capacity, type ScenarioResult } from "./scenario.js";

export interface Reroute {
  flow_id: string;
  material_category: string;
  customer: string;
  fromPlant: string;
  toPlant: string;
  toPlantId: string;
  /** Units per month moved — the figure capacity is tested against. */
  unitsMoved: number;
  /** Units over the full event duration, for the business summary. */
  unitsTotal: number;
  /** Hours per month required at the receiving plant. */
  hrsRequired: number;
  hrsAvailableBefore: number;
  headroomPctAfter: number;
  valueProtected: number;
  /** Great-circle km added or removed by shipping from the alternative instead. */
  distanceDeltaKm: number | null;
  note?: string;
}

export interface Unmitigable {
  flow_id: string;
  material_category: string;
  customer: string;
  fromPlant: string;
  valueAtRisk: number;
  reason:
    | "no alternative plant makes this category"
    | "the only alternative is also disrupted"
    | "alternatives have no spare capacity";
  /** Present for the capacity case: who was tried and what stopped them. */
  candidatesTried?: { plant: string; spareUnits: number; shortfallUnits: number }[];
}

export interface MitigationPlan {
  reroutes: Reroute[];
  unmitigable: Unmitigable[];
  totals: {
    revenueAtRisk: number;
    valueProtected: number;
    valueUnprotected: number;
    protectedPct: number;
    unitsRerouted: number;
    plantsUsed: number;
  };
  capacityAfter: {
    plant: string; plantName: string;
    unitsAdded: number; hrsAdded: number;
    utilizationBefore: number; utilizationAfter: number;
    spareUnitsLeft: number;
  }[];
  /** Ordered, plain-language actions for the UI and for the agent to reason over. */
  actions: string[];
  caveats: string[];
}

const R_EARTH_KM = 6371;

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h));
}

export function mitigate(res: ScenarioResult): MitigationPlan {
  const net = loadNetwork();

  // Demand scenarios are a capacity question, not a rerouting one — there is no
  // lost flow to move, so an empty plan with an explanation is the honest output.
  if (res.disruption.kind === "demand") {
    return demandPlan(res);
  }

  const disruptedPlants = new Set(
    [...res.origin, ...res.impaired]
      .filter((n) => n.plant && n.impairment > 0.05)
      .map((n) => n.plant as string));

  // Mutable capacity ledger, so each allocation sees what the previous one used.
  const spare = new Map<string, { cap: Capacity; unitsLeft: number; hrsUsed: number }>();
  for (const c of net.capacity) {
    spare.set(c.plant, { cap: c, unitsLeft: c.spare_units ?? 0, hrsUsed: 0 });
  }

  const nodeByPlant = new Map(
    net.nodes.filter((n) => n.plant).map((n) => [n.plant as string, n]));

  // Only customer-facing losses are candidates: an inter-plant shortfall is
  // handled by fixing the downstream customer flow it feeds, and double-counting
  // both would overstate what mitigation achieves.
  const lost = res.flows
    .filter((f) => f.target_type === "Customer" && f.valueAtRisk > 0)
    .sort((a, b) => b.valueAtRisk - a.valueAtRisk);

  const reroutes: Reroute[] = [];
  const unmitigable: Unmitigable[] = [];

  for (const f of lost) {
    const fromPlant = net.flows.find((x) => x.flow_id === f.flow_id)?.source_plant ?? null;

    // Separate "nobody else makes this" from "the alternative is also down".
    // Both block the reroute, but the first needs a qualification programme and
    // the second needs a different scenario response entirely, so reporting them
    // under one label would misdirect the reader.
    const capable = net.substitution
      .filter((s) => s.material_category === f.material_category)
      .filter((s) => s.source_plant !== fromPlant);
    const candidates = capable.filter((s) => !disruptedPlants.has(s.source_plant));

    if (!candidates.length) {
      unmitigable.push({
        flow_id: f.flow_id, material_category: f.material_category,
        customer: f.target_name, fromPlant: f.source_name,
        valueAtRisk: f.valueAtRisk,
        reason: capable.length
          ? "the only alternative is also disrupted"
          : "no alternative plant makes this category",
        candidatesTried: capable.length
          ? capable.map((c) => ({ plant: c.plant_name, spareUnits: 0, shortfallUnits: 0 }))
          : undefined,
      });
      continue;
    }

    // Capacity is a MONTHLY rate (free hours per month / hours per unit), so the
    // requirement must be a monthly rate too. Using f.unitsAtRisk here would
    // compare a 60-day requirement against one month of spare capacity and
    // wrongly reject feasible reroutes.
    const unitsNeeded = Math.ceil(f.unitsPerMonthAtRisk);
    const unitsTotal = Math.ceil(f.unitsAtRisk);
    // Prefer the plant with the most room, so the scarcest capacity is kept free
    // for flows that have fewer options.
    const ranked = candidates
      .map((c) => ({ c, s: spare.get(c.source_plant) }))
      .filter((x) => x.s)
      .sort((a, b) => (b.s!.unitsLeft) - (a.s!.unitsLeft));

    const pick = ranked.find((x) => x.s!.unitsLeft >= unitsNeeded) ?? null;

    if (!pick) {
      unmitigable.push({
        flow_id: f.flow_id, material_category: f.material_category,
        customer: f.target_name, fromPlant: f.source_name,
        valueAtRisk: f.valueAtRisk,
        reason: "alternatives have no spare capacity",
        candidatesTried: ranked.map((x) => ({
          plant: x.c.plant_name,
          spareUnits: x.s!.unitsLeft,
          shortfallUnits: unitsNeeded - x.s!.unitsLeft,
        })),
      });
      continue;
    }

    const led = pick.s!;
    const hrs = round(unitsNeeded * (led.cap.hrs_per_unit ?? 0), 1);
    const hrsBefore = round(led.cap.free_hrs - led.hrsUsed, 1);
    led.unitsLeft -= unitsNeeded;
    led.hrsUsed += hrs;

    const src = nodeByPlant.get(pick.c.source_plant);
    const origSrc = net.nodes.find((n) => n.node_id === f.source_id);
    const cust = net.nodes.find((n) => n.node_id === f.target_id);
    const distanceDeltaKm = src && cust && origSrc
      ? round(haversineKm(src.latitude, src.longitude, cust.latitude, cust.longitude) -
              haversineKm(origSrc.latitude, origSrc.longitude, cust.latitude, cust.longitude))
      : null;

    const utilAfter = round(
      100 * (led.cap.used_hrs + led.hrsUsed) / Math.max(led.cap.available_hrs, 1), 1);

    reroutes.push({
      flow_id: f.flow_id, material_category: f.material_category,
      customer: f.target_name, fromPlant: f.source_name,
      toPlant: pick.c.plant_name, toPlantId: pick.c.source_plant,
      unitsMoved: unitsNeeded,
      unitsTotal,
      hrsRequired: hrs,
      hrsAvailableBefore: hrsBefore,
      headroomPctAfter: round(100 - utilAfter, 1),
      valueProtected: f.valueAtRisk,
      distanceDeltaKm,
      note: led.unitsLeft === 0 ? "consumes the last spare unit at this plant" : undefined,
    });
  }

  const valueProtected = reroutes.reduce((s, r) => s + r.valueProtected, 0);
  const valueUnprotected = unmitigable.reduce((s, u) => s + u.valueAtRisk, 0);
  const revenueAtRisk = valueProtected + valueUnprotected;

  const capacityAfter = [...spare.values()]
    .filter((s) => s.hrsUsed > 0)
    .map((s) => ({
      plant: s.cap.plant, plantName: s.cap.plant_name,
      unitsAdded: (s.cap.spare_units ?? 0) - s.unitsLeft,
      hrsAdded: round(s.hrsUsed, 1),
      utilizationBefore: s.cap.utilization_pct,
      utilizationAfter: round(
        100 * (s.cap.used_hrs + s.hrsUsed) / Math.max(s.cap.available_hrs, 1), 1),
      spareUnitsLeft: s.unitsLeft,
    }));

  return {
    reroutes, unmitigable,
    totals: {
      revenueAtRisk: round(revenueAtRisk),
      valueProtected: round(valueProtected),
      valueUnprotected: round(valueUnprotected),
      protectedPct: round(100 * valueProtected / Math.max(revenueAtRisk, 1), 1),
      unitsRerouted: reroutes.reduce((s, r) => s + r.unitsMoved, 0),
      plantsUsed: capacityAfter.length,
    },
    capacityAfter,
    actions: buildActions(reroutes, unmitigable, capacityAfter),
    caveats: [
      "Allocation is greedy by value at risk, not a proven optimum.",
      "Spare units come from free hours divided by a plant's blended hours per " +
      "unit, so treat unit counts as planning-grade.",
      "Qualification, tooling and customer approval for a plant change are not " +
      "modelled; a feasible reroute here may still take weeks to authorise.",
      "Inbound component availability at the receiving plant is not re-checked.",
    ],
  };
}

function buildActions(
  reroutes: Reroute[], unmitigable: Unmitigable[],
  capacityAfter: MitigationPlan["capacityAfter"],
): string[] {
  const a: string[] = [];
  for (const r of reroutes) {
    a.push(
      `Move ${r.unitsMoved} unit${r.unitsMoved === 1 ? "" : "s"}/month of ` +
      `${r.material_category} for ${r.customer} from ${r.fromPlant} to ${r.toPlant} ` +
      `(${r.unitsTotal} over the event) ` +
      `— needs ${r.hrsRequired} hrs of ${r.hrsAvailableBefore} free, leaving ` +
      `${r.headroomPctAfter}% headroom` +
      (r.distanceDeltaKm != null
        ? `, ${r.distanceDeltaKm >= 0 ? "+" : ""}${r.distanceDeltaKm.toLocaleString()} km to ship`
        : "") +
      (r.note ? ` (${r.note})` : "") + ".");
  }
  for (const u of unmitigable) {
    if (u.reason === "the only alternative is also disrupted") {
      a.push(
        `${u.material_category} for ${u.customer} cannot be rerouted — the plants that ` +
        `could take it (${(u.candidatesTried ?? []).map((c) => c.plant).join(", ")}) are ` +
        `caught in the same disruption. ` +
        `$${Math.round(u.valueAtRisk).toLocaleString()} is exposed.`);
    } else if (u.reason === "no alternative plant makes this category") {
      a.push(
        `${u.material_category} for ${u.customer} cannot be rerouted — ${u.fromPlant} ` +
        `is the only plant that makes it. $${Math.round(u.valueAtRisk).toLocaleString()} ` +
        `is exposed; qualify a second source or agree a revised date with the customer.`);
    } else {
      const worst = (u.candidatesTried ?? [])[0];
      a.push(
        `${u.material_category} for ${u.customer} has alternatives but no room` +
        (worst ? ` — ${worst.plant} is ${worst.shortfallUnits} unit(s) short` : "") +
        `. $${Math.round(u.valueAtRisk).toLocaleString()} is exposed; consider overtime ` +
        `or displacing lower-value work.`);
    }
  }
  for (const c of capacityAfter) {
    if (c.utilizationAfter >= 95) {
      a.push(
        `${c.plantName} runs at ${c.utilizationAfter}% after these moves — above 95% ` +
        `there is no recovery room if anything else slips.`);
    }
  }
  return a;
}

/** Demand uplift: report where headroom runs out rather than inventing reroutes. */
function demandPlan(res: ScenarioResult): MitigationPlan {
  const net = loadNetwork();
  const uplift = res.disruption.severity;
  const capacityAfter: MitigationPlan["capacityAfter"] = [];
  const actions: string[] = [];

  const byPlant = new Map<string, number>();
  for (const f of res.flows) {
    const src = net.flows.find((x) => x.flow_id === f.flow_id)?.source_plant;
    if (src) byPlant.set(src, (byPlant.get(src) ?? 0) + f.monthly_volume * uplift);
  }

  for (const [plant, extraUnits] of byPlant) {
    const c = net.capacity.find((x) => x.plant === plant);
    if (!c) continue;
    const units = Math.ceil(extraUnits);
    const hrs = round(units * (c.hrs_per_unit ?? 0), 1);
    const utilAfter = round(100 * (c.used_hrs + hrs) / Math.max(c.available_hrs, 1), 1);
    capacityAfter.push({
      plant, plantName: c.plant_name, unitsAdded: units, hrsAdded: hrs,
      utilizationBefore: c.utilization_pct, utilizationAfter: utilAfter,
      spareUnitsLeft: Math.max(0, (c.spare_units ?? 0) - units),
    });
    actions.push(
      utilAfter > 100
        ? `${c.plant_name} cannot absorb +${units} units: it needs ${hrs} hrs but has ` +
          `${c.free_hrs} free, reaching ${utilAfter}% of capacity. ` +
          `Add ${round(hrs - c.free_hrs, 1)} hrs or move volume elsewhere.`
        : `${c.plant_name} can absorb +${units} units using ${hrs} of ${c.free_hrs} ` +
          `free hrs, reaching ${utilAfter}%.`);
  }

  return {
    reroutes: [], unmitigable: [],
    totals: {
      revenueAtRisk: 0, valueProtected: 0, valueUnprotected: 0,
      protectedPct: 0, unitsRerouted: 0, plantsUsed: capacityAfter.length,
    },
    capacityAfter,
    actions,
    caveats: [
      "A demand spike is a capacity question, not a rerouting one, so no reroutes " +
      "are proposed.",
      "Extra volume is assumed to fall on the plants that already serve the " +
      "customer, in their current proportions.",
    ],
  };
}

function round(v: number, dp = 0): number {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

import type { Kpi } from "./substeps";
import type {
  AffectedFlow, MitigationPlan, Reroute, ScenarioResult, Unmitigable,
} from "./api";

/**
 * Decompose a mitigation plan into narrated beats — the recovery movie.
 *
 * The ripple answers "what breaks". This answers "what do we do about it", and it
 * needs a different spine: the optimiser's output is a list of decisions, so each
 * decision becomes one beat showing the lane that died, the lane that replaces it,
 * and what that costs the plant picking up the work.
 *
 * Two things are deliberate.
 *
 * Reroutes are narrated in the optimiser's own order, because it is greedy: it
 * spends the biggest exposure first, and the spare capacity each step consumes is
 * genuinely unavailable to later steps. Re-sorting the beats would misrepresent
 * why a later reroute failed.
 *
 * `hrsAvailableBefore` and `headroomPctAfter` are per-decision values computed
 * inside that loop, so they are safe to show as a step delta. `capacityAfter` is
 * the aggregate end state for a plant, so it is only used on the summary beat —
 * showing it on step 1 would credit step 1 with every later step's consumption.
 */

export interface MitChange {
  /** The lane that no longer works. */
  from: string;
  /** What replaces it. */
  to: string;
}

export interface MitStep {
  /** "base", "r0", "r1", "x0", "sum" */
  id: string;
  kind: "baseline" | "reroute" | "blocked" | "summary";
  /** Human step number for the rail: 1-based within reroutes/blocked. */
  ordinal?: number;
  title: string;
  subtitle: string;
  what: string;
  why?: string;
  kpis: Kpi[];
  detail: string[];
  change?: MitChange;
  /** Flow ids to draw as broken/at-risk on the map for this beat. */
  brokenFlowIds: string[];
  /** Reroutes revealed up to and including this beat — the green lanes. */
  reroutesUpto: Reroute[];
  focusNodes: string[];
  /** Cumulative value protected after this beat. */
  protectedCum: number;
  /** Exposure still unaddressed after this beat. */
  residual: number;
}

const money = (n: number) => {
  const v = Math.abs(n);
  if (v >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
};
const exact = (n: number) => `$${Math.round(n).toLocaleString()}`;
const units = (n: number) => Math.round(n).toLocaleString();

/** Why a blocked item is blocked, in plain language. */
function blockedWhy(u: Unmitigable): string {
  switch (u.reason) {
    case "no alternative plant makes this category":
      return `No other plant in the network is qualified to produce ${u.material_category}. `
           + `This is a genuine sole-source dependency, not a capacity problem — buying `
           + `more capacity somewhere else would not help.`;
    case "the only alternative is also disrupted":
      return `A qualified alternative plant exists, but it is inside the blast radius of `
           + `this same disruption. The substitution is real on paper and useless here, `
           + `which is exactly the failure mode a network view is meant to catch.`;
    case "alternatives have no spare capacity":
      return `Qualified alternatives exist and are healthy, but they have no spare hours `
           + `left — earlier reroutes in this plan consumed them. This is the one blocked `
           + `reason that a capacity investment would actually fix.`;
    default:
      return u.reason;
  }
}

export function buildMitSteps(
  res: ScenarioResult | null, plan: MitigationPlan | null,
): MitStep[] {
  if (!res || !plan) return [];

  const flowById = new Map<string, AffectedFlow>(res.flows.map((f) => [f.flow_id, f]));
  const nodeIdFor = (flowId: string, end: "source" | "target"): string | undefined => {
    const f = flowById.get(flowId);
    return end === "source" ? f?.source_id : f?.target_id;
  };

  const steps: MitStep[] = [];
  const atRisk = plan.totals.revenueAtRisk;

  // ---- baseline: the damage, before anyone intervenes -----------------------
  steps.push({
    id: "base", kind: "baseline",
    title: "Before mitigation",
    subtitle: `${money(atRisk)} of customer revenue is exposed. Nothing has been done yet.`,
    what: `The ripple leaves ${money(atRisk)} of customer-facing revenue at risk across `
        + `${res.flows.filter((f) => f.target_type === "Customer").length} lanes. `
        + `The optimiser now works through that exposure, largest first.`,
    why: `Only customer-facing revenue counts as protectable here. Inter-plant flows are `
       + `the mechanism of the damage, not the loss itself — protecting a customer lane `
       + `is what actually preserves revenue, so that is what the optimiser scores.`,
    kpis: [
      { label: "Revenue at risk", value: money(atRisk), tone: "bad", hint: exact(atRisk) },
      { label: "Protected so far", value: "$0", tone: "neutral" },
      { label: "Reroutes planned", value: String(plan.reroutes.length), tone: "good" },
      { label: "Cannot be saved", value: String(plan.unmitigable.length), tone: "warn" },
    ],
    detail: [
      `Customer revenue at risk: ${exact(atRisk)}`,
      `Reroutes the optimiser found: ${plan.reroutes.length}`,
      `Exposures with no available answer: ${plan.unmitigable.length}`,
      "Order is greedy — biggest exposure first, and spare capacity is consumed as it goes.",
    ],
    brokenFlowIds: res.flows.filter((f) => f.target_type === "Customer").map((f) => f.flow_id),
    reroutesUpto: [],
    focusNodes: [],
    protectedCum: 0,
    residual: atRisk,
  });

  // ---- one beat per reroute ------------------------------------------------
  let protectedCum = 0;
  plan.reroutes.forEach((r, i) => {
    const before = protectedCum;
    protectedCum += r.valueProtected;

    // Subtracting the float hours lands on values like 36.19999999999999.
    const hrsFreeAfter = Math.round(Math.max(0, r.hrsAvailableBefore - r.hrsRequired) * 10) / 10;
    const oldPlantNode = nodeIdFor(r.flow_id, "source");
    const customerNode = nodeIdFor(r.flow_id, "target");

    steps.push({
      id: `r${i}`, kind: "reroute", ordinal: i + 1,
      title: `${r.customer}: ${r.fromPlant} → ${r.toPlant}`,
      subtitle: `${r.material_category} for ${r.customer} moves to ${r.toPlant}. `
              + `${money(r.valueProtected)} saved.`,
      what: `${r.fromPlant} cannot supply ${r.customer} with ${r.material_category.toLowerCase()}. `
          + `${r.toPlant} is qualified for that category and has spare hours, so the work `
          + `moves there — ${units(r.unitsMoved)} units a month, protecting `
          + `${money(r.valueProtected)}.`,
      why: `${r.toPlant} had ${r.hrsAvailableBefore} spare hours before this move and the `
         + `work needs ${r.hrsRequired}, so it fits with ${hrsFreeAfter} hours left and `
         + `${r.headroomPctAfter}% headroom. Capacity is a monthly rate, so the requirement `
         + `is compared as a monthly rate too — ${units(r.unitsMoved)} units per month, not `
         + `the ${units(r.unitsTotal)} units the whole event represents.`
        + (r.distanceDeltaKm != null
            ? ` The route is ${r.distanceDeltaKm > 0 ? "" : ""}${Math.round(r.distanceDeltaKm)} km `
              + `${r.distanceDeltaKm >= 0 ? "longer" : "shorter"} than the original.`
            : "")
        + (r.note ? ` ${r.note}` : ""),
      kpis: [
        { label: "Value protected", value: money(r.valueProtected), tone: "good",
          hint: exact(r.valueProtected) },
        { label: "Total protected",
          before: money(before), after: money(protectedCum),
          delta: `+${money(r.valueProtected)}`, tone: "good",
          hint: "Cumulative across reroutes so far" },
        { label: "Units moved / mo", value: units(r.unitsMoved), tone: "neutral",
          hint: `${units(r.unitsTotal)} units over the full event` },
        { label: `${r.toPlant} free hours`,
          before: `${r.hrsAvailableBefore}h`, after: `${hrsFreeAfter}h`,
          delta: `−${r.hrsRequired}h`,
          tone: r.headroomPctAfter < 5 ? "bad" : r.headroomPctAfter < 15 ? "warn" : "good",
          hint: "Spare capacity consumed by this decision" },
        { label: "Headroom left", value: `${r.headroomPctAfter}%`,
          tone: r.headroomPctAfter < 5 ? "bad" : r.headroomPctAfter < 15 ? "warn" : "good",
          hint: r.headroomPctAfter < 5
            ? "Effectively full — this plant is now fragile"
            : "Remaining spare capacity at the receiving plant" },
        { label: "Still exposed",
          before: money(atRisk - before), after: money(atRisk - protectedCum),
          delta: `−${money(r.valueProtected)}`, tone: "warn" },
        ...(r.distanceDeltaKm != null ? [{
          label: "Route change",
          value: `${r.distanceDeltaKm >= 0 ? "+" : ""}${Math.round(r.distanceDeltaKm)} km`,
          tone: (r.distanceDeltaKm > 2000 ? "warn" : "neutral") as Kpi["tone"],
          hint: "Difference in shipping distance versus the original lane",
        }] : []),
      ],
      detail: [
        `Lane replaced: ${r.fromPlant} → ${r.customer}  becomes  ${r.toPlant} → ${r.customer}`,
        `Category: ${r.material_category}`,
        `Units moved: ${units(r.unitsMoved)}/month (${units(r.unitsTotal)} over the event)`,
        `Hours required: ${r.hrsRequired} of ${r.hrsAvailableBefore} free`,
        `Free hours after: ${r.hrsAvailableBefore} − ${r.hrsRequired} = ${hrsFreeAfter}`,
        `Headroom at ${r.toPlant} after this move: ${r.headroomPctAfter}%`,
        `Value protected: ${exact(r.valueProtected)}`,
        `Cumulative protected: ${exact(protectedCum)} of ${exact(atRisk)}`,
        ...(r.distanceDeltaKm != null
          ? [`Distance change: ${Math.round(r.distanceDeltaKm)} km`] : []),
        ...(r.note ? [`Note: ${r.note}`] : []),
      ],
      change: {
        from: `${r.fromPlant} → ${r.customer}`,
        to: `${r.toPlant} → ${r.customer}`,
      },
      brokenFlowIds: [r.flow_id],
      reroutesUpto: plan.reroutes.slice(0, i + 1),
      focusNodes: [r.toPlantId, customerNode, oldPlantNode].filter(Boolean) as string[],
      protectedCum,
      residual: atRisk - protectedCum,
    });
  });

  // ---- one beat per exposure that cannot be answered ------------------------
  plan.unmitigable.forEach((u, i) => {
    const customerNode = nodeIdFor(u.flow_id, "target");
    const oldPlantNode = nodeIdFor(u.flow_id, "source");

    steps.push({
      id: `x${i}`, kind: "blocked", ordinal: i + 1,
      title: `${u.customer}: ${u.material_category} cannot be rerouted`,
      subtitle: `${money(u.valueAtRisk)} for ${u.customer} has nowhere to go — `
              + `${u.reason}.`,
      what: `${u.fromPlant} was the source of ${u.material_category.toLowerCase()} for `
          + `${u.customer}, worth ${money(u.valueAtRisk)}. The optimiser could not place `
          + `it: ${u.reason}.`,
      why: blockedWhy(u),
      kpis: [
        { label: "Stranded value", value: money(u.valueAtRisk), tone: "bad",
          hint: exact(u.valueAtRisk) },
        { label: "Category", value: u.material_category, tone: "neutral" },
        { label: "Alternatives tried",
          value: String(u.candidatesTried?.length ?? 0),
          tone: (u.candidatesTried?.length ? "warn" : "bad") as Kpi["tone"],
          hint: u.candidatesTried?.length
            ? u.candidatesTried.map((c) => c.plant).join(", ")
            : "No qualified plant exists for this category" },
        { label: "Still exposed", value: money(atRisk - protectedCum), tone: "warn" },
      ],
      detail: [
        `Customer: ${u.customer}`,
        `Category: ${u.material_category}`,
        `Original source: ${u.fromPlant}`,
        `Value stranded: ${exact(u.valueAtRisk)}`,
        `Reason: ${u.reason}`,
        ...(u.candidatesTried?.length
          ? u.candidatesTried.map((c) =>
              `Tried ${c.plant}: ${c.spareUnits} spare units, short by ${c.shortfallUnits}`)
          : ["No qualified alternative plant exists in the network."]),
      ],
      brokenFlowIds: [u.flow_id],
      reroutesUpto: plan.reroutes,
      focusNodes: [customerNode, oldPlantNode].filter(Boolean) as string[],
      protectedCum,
      residual: atRisk - protectedCum,
    });
  });

  // ---- summary: including the problem the fix creates -----------------------
  // The tightest receiving plant after every reroute is the network's new weak
  // point. Surfacing it is the honest ending: the plan works, and it leaves the
  // network more brittle than it found it.
  const tightest = [...plan.capacityAfter]
    .sort((a, b) => b.utilizationAfter - a.utilizationAfter)[0];

  steps.push({
    id: "sum", kind: "summary",
    title: "The plan, and what it costs",
    subtitle: `${plan.totals.protectedPct}% of exposed revenue protected by `
            + `${plan.reroutes.length} reroute${plan.reroutes.length === 1 ? "" : "s"}. `
            + (tightest
                ? `${tightest.plantName} is now ${tightest.utilizationAfter}% utilised.`
                : ""),
    what: `${plan.reroutes.length} reroute${plan.reroutes.length === 1 ? "" : "s"} across `
        + `${plan.totals.plantsUsed} plant${plan.totals.plantsUsed === 1 ? "" : "s"} protect `
        + `${money(plan.totals.valueProtected)} of ${money(atRisk)} — `
        + `${plan.totals.protectedPct}%. ${money(plan.totals.valueUnprotected)} cannot be `
        + `recovered at all.`,
    why: tightest && tightest.spareUnitsLeft <= 1
      ? `Worth reading twice: ${tightest.plantName} absorbed the work and is now at `
        + `${tightest.utilizationAfter}% utilisation with ${tightest.spareUnitsLeft} spare `
        + `unit${tightest.spareUnitsLeft === 1 ? "" : "s"} left. The plan is sound and it `
        + `has moved the network's single point of failure rather than removed it. A second `
        + `disruption at ${tightest.plantName} during this window would have no answer.`
      : `The plan spends real spare capacity. Everything it could not place is a `
        + `structural gap in the network, not an execution failure — which is the part `
        + `worth taking to a planning conversation.`,
    kpis: [
      { label: "Protected", value: money(plan.totals.valueProtected), tone: "good",
        hint: exact(plan.totals.valueProtected) },
      { label: "Protected share", value: `${plan.totals.protectedPct}%`, tone: "good" },
      { label: "Unrecoverable", value: money(plan.totals.valueUnprotected), tone: "bad",
        hint: exact(plan.totals.valueUnprotected) },
      { label: "Units rerouted / mo", value: units(plan.totals.unitsRerouted), tone: "neutral" },
      { label: "Plants absorbing", value: String(plan.totals.plantsUsed), tone: "neutral" },
      ...(tightest ? [
        { label: `${tightest.plantName} utilisation`,
          before: `${tightest.utilizationBefore}%`, after: `${tightest.utilizationAfter}%`,
          delta: `+${(tightest.utilizationAfter - tightest.utilizationBefore).toFixed(1)}pp`,
          tone: (tightest.spareUnitsLeft <= 1 ? "bad" : "warn") as Kpi["tone"],
          hint: "The receiving plant that ends up tightest" },
        { label: "Its spare left", value: `${tightest.spareUnitsLeft} units`,
          tone: (tightest.spareUnitsLeft <= 1 ? "bad" : "warn") as Kpi["tone"],
          hint: tightest.spareUnitsLeft <= 1
            ? "This plant is the network's new single point of failure"
            : "Remaining buffer at the tightest plant" },
      ] : []),
    ],
    detail: [
      `Revenue at risk: ${exact(atRisk)}`,
      `Protected: ${exact(plan.totals.valueProtected)} (${plan.totals.protectedPct}%)`,
      `Unrecoverable: ${exact(plan.totals.valueUnprotected)}`,
      `Units rerouted: ${units(plan.totals.unitsRerouted)} per month`,
      `Plants absorbing work: ${plan.totals.plantsUsed}`,
      ...plan.capacityAfter.map((c) =>
        `${c.plantName}: ${c.utilizationBefore}% → ${c.utilizationAfter}% utilised, `
        + `${c.spareUnitsLeft} spare units left`),
      ...plan.caveats.map((c) => `Caveat: ${c}`),
    ],
    brokenFlowIds: plan.unmitigable.map((u) => u.flow_id),
    reroutesUpto: plan.reroutes,
    focusNodes: [],
    protectedCum,
    residual: plan.totals.valueUnprotected,
  });

  return steps;
}

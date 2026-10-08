import type { AffectedFlow, ImpairedNode, ScenarioResult } from "./api";

/**
 * Decompose a scenario into individually narrated beats.
 *
 * A hop reveals every flow at that distance simultaneously, which is faithful to
 * the model but hard to follow: three arcs light up at once and the viewer cannot
 * tell which one causes the next hop. Splitting each hop into lettered sub-steps
 * (1a, 1b, 1c) makes the chain legible, and lets the camera frame one lane at a
 * time.
 *
 * Ordering inside a hop is deliberate. Customer-facing flows come first, biggest
 * first, because those are the immediate revenue losses. Inter-plant flows come
 * LAST, because they are the bridge to the next hop — ending a hop on the flow
 * that causes the next one makes the cascade tell itself.
 */

/**
 * One number on a popout card.
 *
 * Either a standalone `value`, or a `before` -> `after` pair when the point of the
 * card is what CHANGED at this beat. Tone drives the colour, so a reader can scan
 * the row without reading the labels.
 */
export interface Kpi {
  label: string;
  value?: string;
  before?: string;
  after?: string;
  delta?: string;
  tone: "neutral" | "bad" | "warn" | "good";
  /** Shown on hover — where the number comes from. */
  hint?: string;
}

export interface SubStep {
  /** "0", "1a", "1b", "2a" … */
  id: string;
  hop: number;
  /** undefined on the origin step. */
  letter?: string;
  kind: "origin" | "customer" | "interplant" | "supplier" | "summary";
  title: string;
  /** What is happening, in one sentence. */
  what: string;
  /** What this causes, when it causes something. */
  consequence?: string;
  /** One short line, burned across the bottom of the map like a film subtitle. */
  subtitle: string;
  /** The mechanism — why the model produces this number, not just what it is. */
  why?: string;
  /** Popout cards for this beat. */
  kpis: Kpi[];
  /** The arithmetic, line by line, for the "explain this step" popover. */
  detail: string[];
  flowIds: string[];
  /** Node ids the camera should frame for this beat. */
  focusNodes: string[];
  valueAtRisk: number;
  /** Cumulative value revealed up to and including this beat. */
  cumulative: number;
  /** The node this beat impairs, if any. */
  impairs?: ImpairedNode;
}

const money = (n: number) => {
  const v = Math.abs(n);
  if (v >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
};

const exact = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function buildSubSteps(res: ScenarioResult | null): SubStep[] {
  if (!res) return [];

  const impairedById = new Map(
    [...res.origin, ...res.impaired].map((n) => [n.node_id, n]));
  const steps: SubStep[] = [];
  let cumulative = 0;

  // ---- the origin -----------------------------------------------------------
  const originNodes = res.origin.map((o) => o.node_id);
  if (res.origin.length) {
    const o = res.origin[0];
    const d = res.disruption;
    steps.push({
      id: "0", hop: 0, kind: "origin",
      title: `${o.node_name} is disrupted`,
      what: d.kind === "demand"
        ? `${o.node_name} increases demand by ${Math.round(d.severity * 100)}% for ${d.durationDays} days.`
        : `${o.node_name} loses ${Math.round(d.severity * 100)}% of throughput for ${d.durationDays} days.`,
      consequence: o.bufferDays != null
        ? `It holds ${o.bufferDays} days of stock, so downstream sites are shielded for a while.`
        : undefined,
      subtitle: d.kind === "demand"
        ? `Demand at ${o.node_name} spikes ${pct(d.severity)} for ${d.durationDays} days.`
        : `${o.node_name} goes down. ${pct(d.severity)} of throughput, ${d.durationDays} days.`,
      why: o.bufferDays != null
        ? `Nothing has failed downstream yet. ${o.node_name} holds ${o.bufferDays} days of `
          + `finished stock, and the disruption lasts ${d.durationDays} days — so only the `
          + `${Math.max(0, d.durationDays - o.bufferDays)} days beyond the buffer actually `
          + `reach anyone.`
        : `The shock starts here. Everything that follows is this site's outbound flows `
          + `failing in sequence.`,
      kpis: [
        { label: d.kind === "demand" ? "Demand increase" : "Throughput lost",
          value: pct(d.severity), tone: "bad",
          hint: "Severity you set on the scenario" },
        { label: "Duration", value: `${d.durationDays} days`, tone: "neutral" },
        ...(o.bufferDays != null ? [
          { label: "On-site buffer", value: `${o.bufferDays} days`, tone: "good" as const,
            hint: "Minimum days of inventory held at this site" },
          { label: "Days exposed", value: `${o.daysExposed} days`, tone: "warn" as const,
            hint: "Duration minus buffer — when downstream actually feels it" },
        ] : []),
      ],
      detail: [
        `Disruption kind: ${d.kind}`,
        `Severity ${pct(d.severity)} applied for ${d.durationDays} days`,
        ...(o.bufferDays != null
          ? [`Buffer at ${o.node_name}: ${o.bufferDays} days`,
             `Exposed window: ${d.durationDays} − ${o.bufferDays} = ${o.daysExposed} days`]
          : ["No inventory buffer recorded for this node"]),
        "No value is at risk yet — the first losses appear at hop 1.",
      ],
      flowIds: [], focusNodes: originNodes, valueAtRisk: 0, cumulative: 0,
      impairs: o,
    });
  } else {
    // Lane closures have no origin node — the cut lane is the first beat instead.
    const first = res.flows.filter((f) => f.hop === 1);
    if (first.length) {
      const f = first[0];
      steps.push({
        id: "0", hop: 0, kind: "origin",
        title: `The ${f.material_category} lane closes`,
        what: `${f.source_name} to ${f.target_name} stops. Both sites keep operating; only the lane between them is cut.`,
        subtitle: `The ${f.material_category.toLowerCase()} lane from `
                + `${f.source_name} to ${f.target_name} is cut.`,
        why: `A lane closure is different from a plant failure: both sites keep producing. `
           + `What is lost is the ability to move material between them, so the impact `
           + `starts at the receiving end rather than at a source node.`,
        kpis: [
          { label: "Lane value", value: `${money(f.monthly_value)}/mo`, tone: "neutral" },
          { label: "Category", value: f.material_category, tone: "neutral" },
          { label: "Both sites", value: "still running", tone: "good",
            hint: "Only the link between them is affected" },
        ],
        detail: [
          `Lane ${f.source_name} → ${f.target_name} carries ${exact(f.monthly_value)} per month`,
          `Material category: ${f.material_category}`,
          "Neither endpoint loses throughput — only the connection is severed.",
        ],
        flowIds: [f.flow_id], focusNodes: [f.source_id, f.target_id],
        valueAtRisk: 0, cumulative: 0,
      });
    }
  }

  // ---- one beat per flow, hop by hop ---------------------------------------
  const hops = [...new Set(res.flows.map((f) => f.hop))].sort((a, b) => a - b);
  const LETTERS = "abcdefghijklmnopqrstuvwxyz";

  for (const hop of hops) {
    const inHop = res.flows.filter((f) => f.hop === hop);

    const customers = inHop
      .filter((f) => f.target_type === "Customer")
      .sort((a, b) => b.valueAtRisk - a.valueAtRisk);
    // bridges last: they set up the next hop
    const bridges = inHop
      .filter((f) => f.target_type !== "Customer")
      .sort((a, b) => b.valueAtRisk - a.valueAtRisk);

    const ordered = [...customers, ...bridges];
    ordered.forEach((f, i) => {
      cumulative += f.valueAtRisk;
      const isBridge = f.target_type !== "Customer";
      const downstream = isBridge ? impairedById.get(f.target_id) : undefined;

      steps.push({
        id: `${hop}${LETTERS[i]}`,
        hop,
        letter: LETTERS[i],
        kind: isBridge ? "interplant" : "customer",
        title: `${f.source_name} → ${f.target_name}`,
        what: isBridge
          ? `${f.source_name} can no longer ship ${f.material_category.toLowerCase()} to ${f.target_name}. `
            + `${Math.round(f.impactFactor * 100)}% of that lane is lost — ${money(f.valueAtRisk)}.`
          : `${f.target_name} stops receiving ${f.material_category.toLowerCase()}. `
            + `${Math.round(f.impactFactor * 100)}% of the lane is lost, putting ${money(f.valueAtRisk)} of revenue at risk.`,
        consequence: downstream
          ? `${downstream.node_name} now depends on that flow for `
            + `${Math.round(downstream.impairment * 100)}% of its inbound volume. `
            + (downstream.bufferDays != null
                ? `Its ${downstream.bufferDays}-day buffer absorbs the first ${downstream.bufferDays} days, `
                  + `so it runs normally until day ${downstream.bufferDays + 1} and is then exposed for `
                  + `${downstream.daysExposed} days.`
                : "")
          : isBridge ? undefined
          : "This is a direct customer loss — no further sites are affected by this lane.",
        subtitle: isBridge
          ? `${f.source_name} cannot supply ${f.target_name}. `
            + `${money(f.valueAtRisk)} — and this is what triggers the next hop.`
          : `${f.target_name} stops receiving ${f.material_category.toLowerCase()}. `
            + `${money(f.valueAtRisk)} of revenue exposed.`,
        why: `This lane normally carries ${exact(f.monthly_value)} a month. `
           + `The model impairs it by ${pct(f.impactFactor)} — a flow inherits its `
           + `source's impairment, scaled by how much of the receiver's inbound volume `
           + `it represents. ${pct(f.impactFactor)} of ${money(f.monthly_value)} is `
           + `${money(f.valueAtRisk)}.`
          + (downstream
              ? ` ${f.target_name} depends on this lane for ${pct(downstream.impairment)} `
                + `of its inbound volume, which is why it becomes `
                + `${pct(downstream.impairment)} impaired rather than fully down.`
              : ""),
        kpis: [
          { label: "Lane value", value: `${money(f.monthly_value)}/mo`, tone: "neutral",
            hint: "Normal monthly value carried on this lane" },
          { label: "Share lost", value: pct(f.impactFactor), tone: "bad",
            hint: "Impairment inherited from the source" },
          { label: "At risk here", value: money(f.valueAtRisk), tone: "bad",
            hint: `${exact(f.valueAtRisk)} over ${f.daysAtRisk} days` },
          { label: "Running total",
            before: money(cumulative - f.valueAtRisk), after: money(cumulative),
            delta: `+${money(f.valueAtRisk)}`, tone: "warn",
            hint: "Cumulative value at risk revealed so far" },
          ...(downstream ? [
            { label: `${downstream.node_name} impaired`,
              before: "0%", after: pct(downstream.impairment),
              delta: `+${pct(downstream.impairment)}`, tone: "bad" as const,
              hint: "This lane's share of the receiver's inbound volume" },
            ...(downstream.bufferDays != null ? [
              { label: "Its buffer", value: `${downstream.bufferDays} days`,
                tone: "good" as const,
                hint: "Runs normally this long before anything is felt" },
              { label: "Then exposed", value: `${downstream.daysExposed} days`,
                tone: "warn" as const },
            ] : []),
          ] : [
            { label: "Downstream", value: "none", tone: "neutral" as const,
              hint: "A customer is the end of the chain — nothing propagates past it" },
          ]),
        ],
        detail: [
          `Lane: ${f.source_name} → ${f.target_name} (${f.material_category})`,
          `Normal monthly value: ${exact(f.monthly_value)}`,
          `Impairment applied: ${pct(f.impactFactor)}`,
          `Value at risk: ${pct(f.impactFactor)} × ${exact(f.monthly_value)} = ${exact(f.valueAtRisk)}`,
          `Units at risk: ${Math.round(f.unitsPerMonthAtRisk).toLocaleString()} per month `
            + `(${Math.round(f.unitsAtRisk).toLocaleString()} over ${f.daysAtRisk} days)`,
          `Cumulative after this beat: ${exact(cumulative)}`,
          ...(downstream
            ? [`${f.target_name} inbound dependency on this lane: ${pct(downstream.impairment)}`,
               downstream.bufferDays != null
                 ? `Buffer ${downstream.bufferDays} days, exposed ${downstream.daysExposed} days`
                 : "No buffer recorded at the receiver"]
            : ["Target is a customer — the cascade stops here."]),
        ],
        flowIds: [f.flow_id],
        focusNodes: [f.source_id, f.target_id],
        valueAtRisk: f.valueAtRisk,
        cumulative,
        impairs: downstream,
      });
    });
  }

  // ---- pull back out ------------------------------------------------------
  if (steps.length > 1) {
    steps.push({
      id: "sum", hop: res.totals.maxHop, kind: "summary",
      title: "The full picture",
      what: `${res.flows.length} flows affected across ${res.totals.maxHop} `
          + `hop${res.totals.maxHop === 1 ? "" : "s"}, `
          + `${money(res.totals.valueAtRisk)} at risk — `
          + `${res.totals.pctOfNetwork}% of monthly network value.`,
      consequence: res.totals.customersAffected > 0
        ? `${res.totals.customersAffected} customers are affected, `
          + `${res.impaired.filter((n) => n.node_type === "Plant").length} plants impaired.`
        : undefined,
      subtitle: `${money(res.totals.valueAtRisk)} at risk across `
              + `${res.flows.length} flows and ${res.totals.maxHop} hops — `
              + `${res.totals.pctOfNetwork}% of the network.`,
      why: `The camera pulls back so the whole shape is visible at once. Everything `
         + `revealed so far came from one event at a single site, propagated only by `
         + `dependency share and deferred by inventory. Nothing here is a guess about `
         + `second-order behaviour — it is the network's own structure.`,
      kpis: [
        { label: "Total at risk", value: money(res.totals.valueAtRisk), tone: "bad",
          hint: exact(res.totals.valueAtRisk) },
        { label: "Share of network", value: `${res.totals.pctOfNetwork}%`, tone: "bad",
          hint: `Against ${exact(res.totals.monthlyNetworkValue)} monthly network value` },
        { label: "Customers hit", value: String(res.totals.customersAffected), tone: "warn" },
        { label: "Plants impaired", value: String(res.totals.plantsImpaired), tone: "warn" },
        { label: "Hops reached", value: String(res.totals.maxHop), tone: "neutral",
          hint: "How far the shock travelled from the origin" },
      ],
      detail: [
        `Flows affected: ${res.flows.length}`,
        `Value at risk: ${exact(res.totals.valueAtRisk)}`,
        `Monthly network value: ${exact(res.totals.monthlyNetworkValue)}`,
        `Share of network: ${res.totals.pctOfNetwork}%`,
        `Customers affected: ${res.totals.customersAffected}`,
        `Plants impaired: ${res.totals.plantsImpaired}`,
        `Maximum hop reached: ${res.totals.maxHop}`,
        "Next: Mitigation lists what can be rerouted; the Optimization Map plays "
          + "that recovery out on the map, decision by decision.",
      ],
      flowIds: res.flows.map((f) => f.flow_id),
      focusNodes: [],                        // zoom back to the whole world
      valueAtRisk: 0,
      cumulative,
    });
  }

  return steps;
}

/** Group beats by hop, for the stepper rail. */
export function groupByHop(steps: SubStep[]): { hop: number; steps: SubStep[] }[] {
  const m = new Map<number, SubStep[]>();
  for (const s of steps) {
    if (s.kind === "summary") continue;
    (m.get(s.hop) ?? m.set(s.hop, []).get(s.hop)!).push(s);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([hop, ss]) => ({ hop, steps: ss }));
}

/** Every flow revealed up to and including a beat index — what the map should show. */
export function revealedFlows(steps: SubStep[], upto: number): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i <= Math.min(upto, steps.length - 1); i++) {
    for (const f of steps[i].flowIds) s.add(f);
  }
  return s;
}

/** Highest hop revealed so far, so nodes appear in step with their flows. */
export function revealedHop(steps: SubStep[], upto: number): number {
  let h = 0;
  for (let i = 0; i <= Math.min(upto, steps.length - 1); i++) {
    h = Math.max(h, steps[i].hop);
  }
  return h;
}

export type { AffectedFlow };

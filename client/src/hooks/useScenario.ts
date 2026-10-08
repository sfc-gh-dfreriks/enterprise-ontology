import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api, type Disruption, type MitigationPlan, type Preset,
  type ScNetwork, type ScenarioResult,
} from "../lib/api";

/**
 * Shared scenario state for the Studio, Ripple and Mitigation pages.
 *
 * Held in a module-level store rather than React context so a scenario survives
 * navigation between the three pages. Running a disruption in the Studio and then
 * losing it on the way to the Ripple view would make the section unusable, and
 * threading context through the existing switch-based router would mean rewriting
 * the app shell for one feature.
 */

interface Store {
  disruption: Disruption | null;
  result: ScenarioResult | null;
  plan: MitigationPlan | null;
  error: string | null;
  running: boolean;
}

let store: Store = {
  disruption: null, result: null, plan: null, error: null, running: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
}

export const DEFAULT_DISRUPTION: Disruption = {
  kind: "weather", targets: ["PLT-2000"], severity: 1, durationDays: 60,
  label: "Hurricane — Austin Fab offline",
};

export function useScenario() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const run = useCallback(async (d: Disruption) => {
    set({ running: true, error: null, disruption: d });
    try {
      const { result, plan } = await api.scSimulate(d);
      set({ result, plan, running: false });
    } catch (e: any) {
      set({ error: String(e?.message || e), running: false, result: null, plan: null });
    }
  }, []);

  const reset = useCallback(() => {
    set({ disruption: null, result: null, plan: null, error: null });
  }, []);

  return { ...store, run, reset };
}

/** Network, presets and derived lookups. Fetched once and cached module-wide. */
let netCache: ScNetwork | null = null;
let presetCache: Preset[] | null = null;

export function useNetwork() {
  const [net, setNet] = useState<ScNetwork | null>(netCache);
  const [presets, setPresets] = useState<Preset[] | null>(presetCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    if (!netCache) {
      api.scNetwork()
        .then((n) => { netCache = n; if (!dead) setNet(n); })
        .catch((e) => { if (!dead) setError(String(e.message || e)); });
    }
    if (!presetCache) {
      api.scPresets()
        .then((p) => { presetCache = p; if (!dead) setPresets(p); })
        .catch(() => { /* presets are a convenience, not required */ });
    }
    return () => { dead = true; };
  }, []);

  /**
   * Single points of failure: a plant whose inbound for some material category
   * arrives from exactly one source, or a category made at exactly one plant.
   * These are the nodes where a disruption has no structural alternative, which is
   * a property of the network rather than of any one scenario.
   */
  const spof = useMemo(() => {
    const s = new Set<string>();
    if (!net) return s;
    const single = new Set(net.totals.single_source_categories);
    for (const f of net.flows) {
      if (f.flow_type === "Outbound" && single.has(f.material_category) && f.source_id) {
        s.add(f.source_id);
      }
    }
    // a plant fed by exactly one supplier for a category it cannot source elsewhere
    const byTargetCat = new Map<string, Set<string>>();
    for (const f of net.flows) {
      if (f.flow_type === "Inbound") {
        const k = `${f.target_id}|${f.material_category}`;
        (byTargetCat.get(k) ?? byTargetCat.set(k, new Set()).get(k)!).add(f.source_id);
      }
    }
    for (const [k, srcs] of byTargetCat) if (srcs.size === 1) s.add(k.split("|")[0]);
    return s;
  }, [net]);

  return { net, presets, error, spof };
}

/** Lookups the map and graph both need, keyed for O(1) styling. */
export function useScenarioMaps(result: ScenarioResult | null) {
  return useMemo(() => {
    const affected = new Map(result?.flows.map((f) => [f.flow_id, f]) ?? []);
    const impaired = new Map(
      [...(result?.origin ?? []), ...(result?.impaired ?? [])].map((n) => [n.node_id, n]));
    return { affected, impaired };
  }, [result]);
}

export const KIND_LABEL: Record<string, string> = {
  weather: "Weather event",
  supplier: "Supplier outage",
  capacity: "Partial capacity loss",
  lane: "Lane / port closure",
  demand: "Demand spike",
};

export const KIND_HINT: Record<string, string> = {
  weather: "A hurricane, typhoon or flood takes a site offline. Pick the site, how much " +
           "of it stops, and for how long.",
  supplier: "A supplier fails or is sanctioned. Every plant it feeds is starved at once, " +
            "which is why these ripples are wide but often shallow.",
  capacity: "A site keeps running but loses part of its output — a line down, staff " +
            "shortage, equipment failure.",
  lane: "A route closes: port, canal, airspace. Both ends keep operating and only the " +
        "lane between them stops.",
  demand: "A customer orders more. Nothing is at risk; the question is whether the " +
          "plants serving them have the headroom.",
};

import { useEffect, useState } from "react";
import { PRESETS, type Scenario } from "../lib/entScenario";
import { defaultLevers, type Levers } from "../lib/entImpact";

/**
 * The scenario every scenario page shows: Scenario Studio, Impact Map, Risk Outcome
 * and Mitigation. Kept in sessionStorage so switching pages keeps it, and broadcast
 * so a change on one page reaches the others without a reload.
 */
export interface ActiveScenario { presetId: string | null; spec: Scenario; levers: Levers }

const KEY = "ent.active";
const EVT = "ent-active-scenario";

export function readActive(): ActiveScenario {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (v?.spec?.kind) return { levers: defaultLevers(v.spec), ...v };
  } catch { /* fall through to the first preset */ }
  const p = PRESETS[0];
  return { presetId: p.id, spec: p.scenario, levers: defaultLevers(p.scenario) };
}

export function writeActive(a: ActiveScenario) {
  sessionStorage.setItem(KEY, JSON.stringify(a));
  window.dispatchEvent(new CustomEvent(EVT));
}

/** Choose a scenario: a new shock always starts from that shock's default levers. */
export function pickScenario(presetId: string | null, spec: Scenario) {
  writeActive({ presetId, spec, levers: defaultLevers(spec) });
}

export function useActiveScenario(): [ActiveScenario, (a: ActiveScenario) => void] {
  const [a, setA] = useState<ActiveScenario>(readActive);
  useEffect(() => {
    const on = () => setA(readActive());
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return [a, writeActive];
}

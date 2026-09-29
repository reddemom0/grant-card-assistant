/**
 * Eval stand-in for src/database/api-cost-events.js — the per-call cost row is
 * not written. The runner totals cost itself from runAgent's onCostCalculated.
 */

export async function recordCostEvent() {
  return null;
}

/**
 * Eval stand-in for src/database/api-cost-events.js — the per-call cost row is
 * not written. The runner totals cost itself from runAgent's onCostCalculated.
 * The model of each agent-loop call is noted for the run (runAgent's reply
 * doesn't carry it), so results say which model answered.
 */

export async function recordCostEvent({ source, model } = {}) {
  if (source === 'agent-loop' && model) globalThis.__oracleEval?.models?.push(model);
  return null;
}

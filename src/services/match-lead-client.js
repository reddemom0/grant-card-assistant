/**
 * Thin client for gg3-ai-service POST /api/v1/ai/internal/match-lead: grants
 * for a lead described by partial info (province + industry required; goals,
 * size, revenue, business type, description optional). Deterministic and free
 * on the service side — no LLM, nothing persisted (see gg3-ai-service
 * docs/reference/matching-engine.md §6.7).
 *
 * Same service-token pattern as matchGrants in briefing-gather.js:
 * GG3_AI_SERVICE_URL + GG3_REVIEW_FEED_TOKEN. Unset → { ok: false } with a
 * reason, never a throw.
 *
 * No callers in Stage 1. Intended for the Steph morning brief and lead triage.
 */

export const MATCH_LEAD_TIMEOUT_MS = 15_000;

export const defaultMatchLeadDeps = {
  fetch: (...args) => fetch(...args),
  env: process.env
};

/**
 * @param {object} lead - { province, industry, business_goals?, employee_count?,
 *   annual_revenue?, business_type?, description? }, passed through as is; the
 *   service normalises and reports what it dropped.
 * @returns {Promise<
 *   {ok: true, status: 'ok', grants: Array, inputs_used: object, dropped: Array} |
 *   {ok: true, status: 'insufficient_profile', grants: [], missing: string[], inputs_used: object, dropped: Array} |
 *   {ok: false, reason: string}
 * >}
 */
export async function matchLead(lead, deps = defaultMatchLeadDeps) {
  const base = String(deps.env.GG3_AI_SERVICE_URL || '').replace(/\/+$/, '');
  const token = deps.env.GG3_REVIEW_FEED_TOKEN;
  if (!base || !token) return { ok: false, reason: 'the matching service is not configured here' };

  try {
    const res = await deps.fetch(`${base}/api/v1/ai/internal/match-lead`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(lead || {}),
      signal: AbortSignal.timeout(MATCH_LEAD_TIMEOUT_MS)
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      console.warn(`⚠️  match-lead failed — status: ${res.status}`);
      return { ok: false, reason: `the matching service answered ${res.status}` };
    }
    if (body.status === 'insufficient_profile') {
      return { ok: true, status: 'insufficient_profile', grants: [], missing: body.missing || [],
        inputs_used: body.inputs_used || {}, dropped: body.dropped || [] };
    }
    return { ok: true, status: 'ok', grants: Array.isArray(body.grants) ? body.grants : [],
      inputs_used: body.inputs_used || {}, dropped: body.dropped || [] };
  } catch (err) {
    console.warn(`⚠️  match-lead failed — code: ${err?.name || err?.code || 'unknown'}`);
    return { ok: false, reason: 'the matching service did not answer' };
  }
}

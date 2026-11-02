/**
 * Lead-gen funding estimate from gg3 (LEAD_GEN_MATCHER=gg3).
 *
 * In gg3 mode a lead's estimate is gg3-ai-service's match-lead `estimate`
 * block, fetched once at intake (runIntakeCategorization in
 * src/api/lead-gen-init.js) and stored on prospect_data.gg3_estimate. Chat
 * (<lead_info>), the summary email and HubSpot all read that stored value,
 * formatted by formatEstimateRange, so they cannot disagree. The model never
 * computes a figure. See docs/lead-gen.md ("Matcher switch").
 *
 * The mode is decided once per session, at /init, and stored as
 * prospect_data.lead_gen_matcher. Everything after reads the session's value
 * (isGg3Session), so flipping the env mid-session can't mix the two modes.
 * Absent → legacy, which covers every session created before the switch.
 */

import { matchLead as defaultMatchLead } from './match-lead-client.js';

/** /init blocks on the call, so lead-gen waits less than the client default. */
export const LEAD_GEN_MATCH_LEAD_TIMEOUT_MS = 8_000;

/** The env switch. Anything but "gg3" is legacy. */
export function currentLeadGenMatcher(env = process.env) {
  return String(env.LEAD_GEN_MATCHER || '').trim().toLowerCase() === 'gg3' ? 'gg3' : 'legacy';
}

/** Did this session start in gg3 mode? Reads prospect_data, never the env. */
export function isGg3Session(prospectData) {
  return prospectData?.lead_gen_matcher === 'gg3';
}

// ── Widget → match-lead input ───────────────────────────────────────────────

/** A budget dropdown value that means "something is planned". Widget
 *  BUDGET_OPTIONS: "None planned", "Under $10K" … "$100K+". */
function hasBudget(value) {
  const v = String(value || '').trim().toLowerCase();
  return v !== '' && v !== 'none planned';
}

/**
 * The widget's plan fields → match-lead `business_goals`.
 *   - Training Budget set            → "Hire or Train People"
 *   - Market Expansion budget set    → "International Growth"
 *   - Planned activities (free text) → passed as-is; gg3's mapBusinessGoals
 *     maps it with its own cue table and reports what it couldn't use.
 * Hiring Plans is never read: "Not hiring right now" must not become a goal.
 */
export function mapWidgetToGoals(prospectData) {
  const pd = prospectData || {};
  const goals = [];
  if (hasBudget(pd.training_budget)) goals.push('Hire or Train People');
  if (hasBudget(pd.expansion_budget)) goals.push('International Growth');
  const text = typeof pd.planned_activities === 'string' ? pd.planned_activities.trim() : '';
  if (text) goals.push(text);
  return goals;
}

/** The widget joins provinces with ", " (getgranted-widget.js). */
function splitProvinces(province) {
  if (Array.isArray(province)) return province.filter(Boolean);
  return String(province || '').split(',').map((p) => p.trim()).filter(Boolean);
}

/** Widget employee bucket → something gg3's normaliseEmployeeCount reads.
 *  "Just me" is the one bucket it can't. */
function employeesForMatchLead(bucket) {
  if (!bucket) return undefined;
  return String(bucket).trim().toLowerCase() === 'just me' ? 1 : bucket;
}

export function buildMatchLeadInput(prospectData) {
  const pd = prospectData || {};
  const input = {
    province: splitProvinces(pd.province),
    industry: pd.industry || undefined,
    business_goals: mapWidgetToGoals(pd),
    employee_count: employeesForMatchLead(pd.employee_count),
    annual_revenue: pd.revenue_range || undefined
  };
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
  return input;
}

// ── Formatting: the one way every surface writes a figure ──────────────────

export function formatDollars(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** {low, high} → "$14,500–$150,000" (or "$50,000" when equal); null when
 *  either is missing. Full dollars, so parseFundingEstimate reads the exact
 *  low and the $15,000 Starter threshold isn't crossed by rounding. */
export function formatEstimateRange(range) {
  if (!range || range.low == null || range.high == null) return null;
  if (range.low === range.high) return formatDollars(range.low);
  return `${formatDollars(range.low)}–${formatDollars(range.high)}`;
}

/** The stored estimate's total, formatted, or null when it has no figure. */
export function estimatedFundingFromGg3(est) {
  return est?.status === 'ok' ? formatEstimateRange(est) : null;
}

// ── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Call match-lead and reduce the answer to what the session stores. Never
 * throws: failure or timeout → status "unavailable" with the reason.
 *
 * @returns {Promise<{status: 'ok'|'confirm_needed'|'insufficient_profile'|'unavailable',
 *   low: number|null, high: number|null, per_goal: Array, matches_used: number|null,
 *   revenue_band_used: string|null, notes: string[], inputs_used: object|null,
 *   dropped: Array, cards: Array<{name, provider}>, missing?: string[], reason?: string,
 *   request: object, fetched_at: string}>}
 */
export async function fetchLeadGenEstimate(prospectData, { matchLead = defaultMatchLead, env = process.env, fetch } = {}) {
  const request = buildMatchLeadInput(prospectData);
  const base = {
    low: null, high: null, per_goal: [], matches_used: null, revenue_band_used: null,
    notes: [], inputs_used: null, dropped: [], cards: [], request, fetched_at: new Date().toISOString()
  };
  let r;
  try {
    r = await matchLead(request, {
      env,
      fetch: fetch || ((...a) => globalThis.fetch(...a)),
      timeoutMs: LEAD_GEN_MATCH_LEAD_TIMEOUT_MS
    });
  } catch (err) {
    r = { ok: false, reason: err?.message || 'match-lead threw' };
  }

  if (!r?.ok) {
    return { ...base, status: 'unavailable', reason: r?.reason || 'unknown' };
  }
  if (r.status === 'insufficient_profile') {
    return { ...base, status: 'insufficient_profile', missing: r.missing || [], inputs_used: r.inputs_used || null, dropped: r.dropped || [] };
  }
  const est = r.estimate;
  if (!est || (est.status !== 'ok' && est.status !== 'confirm_needed')) {
    // A gg3 deploy without the estimate block answers ok with no estimate.
    return { ...base, status: 'unavailable', reason: 'match-lead returned no estimate block', inputs_used: r.inputs_used || null, dropped: r.dropped || [] };
  }
  return {
    ...base,
    status: est.status,
    low: est.status === 'ok' ? est.low : null,
    high: est.status === 'ok' ? est.high : null,
    per_goal: Array.isArray(est.per_goal) ? est.per_goal.map((g) => ({ goal: g.goal, low: g.low, high: g.high, match_count: g.match_count })) : [],
    matches_used: est.matches_used ?? null,
    revenue_band_used: est.revenue_band_used ?? null,
    notes: Array.isArray(est.notes) ? est.notes : [],
    inputs_used: r.inputs_used || null,
    dropped: r.dropped || [],
    // Internal only (HubSpot note). Never shown to the prospect.
    cards: (r.grants || []).map((g) => ({ name: g.name, provider: g.provider }))
  };
}

// ── What the model sees ─────────────────────────────────────────────────────

/** The <lead_info> block for a gg3 session. */
export function describeGg3Estimate(est) {
  const lines = [];
  if (est?.status === 'ok') {
    lines.push('Funding estimate (computed by the system; use these exact figures, never calculate, round, re-range or adjust them; this overrides any estimation method elsewhere in your instructions):');
    lines.push(`Total, next 12 months: ${formatEstimateRange(est)}`);
    const goals = (est.per_goal || []).filter((g) => formatEstimateRange(g));
    if (goals.length > 0) {
      lines.push('By goal:');
      for (const g of goals) lines.push(`- ${g.goal}: ${formatEstimateRange(g)}`);
    }
  } else if (est?.status === 'confirm_needed') {
    lines.push('Funding estimate: no dollar figure. There are programs that match their profile; say so, and say the amounts get confirmed when we review them. Give no dollar figure and do not invent one.');
  } else {
    lines.push("Funding estimate: not available. Give no dollar figure and don't claim specific matches; say we'll confirm what's available for them. Do not invent a figure.");
  }
  lines.push('The estimate is already computed: search_getgranted is not available. Never name programs.');
  return lines.join('\n');
}

// ── Holding text to the stored figures ──────────────────────────────────────

const SUFFIX = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6 };
// "$50K", "$1.2M", "$150,000", "$17–49K", "$50,000 to $150,000"
const MONEY = /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(thousand|million|mm|k|m)?(?![a-z])(?:\s*(?:[-–—]|to)\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(thousand|million|mm|k|m)?(?![a-z]))?/gi;

/** Every dollar amount in `text`, in whole dollars. A bare low end borrows the
 *  high end's suffix ("$17–49K" → 17,000 and 49,000). */
export function extractDollarFigures(text) {
  const out = [];
  for (const m of String(text || '').matchAll(MONEY)) {
    const [, lo, loSuf, hi, hiSuf] = m;
    const loN = parseFloat(lo.replace(/,/g, ''));
    let loMul = loSuf ? SUFFIX[loSuf.toLowerCase()] : 1;
    if (hi) {
      const hiN = parseFloat(hi.replace(/,/g, ''));
      const hiMul = hiSuf ? SUFFIX[hiSuf.toLowerCase()] : 1;
      if (!loSuf && hiSuf && loN <= hiN) loMul = hiMul;
      out.push(Math.round(hiN * hiMul));
    }
    out.push(Math.round(loN * loMul));
  }
  return out;
}

/** The figures a gg3 session may show: the estimate's total and per-goal
 *  bounds, plus the form's own bucket bounds (revenue, budgets), which a
 *  summary may restate. */
export function estimateAllowedFigures(est, prospectData) {
  const allowed = new Set();
  if (est?.status === 'ok') {
    for (const v of [est.low, est.high]) if (v != null) allowed.add(Math.round(v));
    for (const g of est.per_goal || []) for (const v of [g.low, g.high]) if (v != null) allowed.add(Math.round(v));
  }
  const pd = prospectData || {};
  for (const field of [pd.revenue_range, pd.training_budget, pd.expansion_budget]) {
    for (const v of extractDollarFigures(field)) allowed.add(v);
  }
  return allowed;
}

/** Dollar figures in `text` that aren't the session's stored ones. Empty →
 *  the text agrees with the estimate. */
export function findForeignFigures(text, est, prospectData) {
  const allowed = estimateAllowedFigures(est, prospectData);
  return [...new Set(extractDollarFigures(text))].filter((n) => !allowed.has(n));
}

/**
 * Pin a session's funding fields to the stored estimate. In gg3 mode the
 * estimated_funding column, memory_store rows and save_lead_data input can
 * all carry model text; this replaces them in place on `target` (an enriched
 * session or a save_lead_data input) and returns what it changed.
 */
export function pinFundingToGg3(target, est) {
  const changed = [];
  const pinned = estimatedFundingFromGg3(est);
  if ((target.estimated_funding ?? null) !== pinned) {
    changed.push({ field: 'estimated_funding', from: target.estimated_funding ?? null, to: pinned });
    target.estimated_funding = pinned;
  }
  for (const f of ['available_now_funding', 'programs_matched_count']) {
    if (target[f] != null) {
      changed.push({ field: f, from: target[f], to: null });
      target[f] = null;
    }
  }
  return changed;
}

/**
 * Steph morning brief — what to do first. PURE.
 *
 * Ranks card items by consequence, not arrival (inbox-manager triage rule):
 *   tier 0  "Verify by phone first" (payment / credential / lookalike) — always first
 *   tier 1  a security alert (have IT check it today), alongside the deadlines below
 *   tier 1  a deadline: a promise or bill due date (soonest first, overdue
 *           first), or the email needs an answer today (urgency 3)
 *   tier 2  money or work blocked on Steph: finance, an unhappy client
 *   tier 3  follow-ups: nudge level, then how long they've waited
 *   tier 4  everything else, in group order, oldest first
 * Each ranked item carries a short reason saying what happens if it waits.
 * Used for "Start here" (top 2) and the length cap (top 10). No model call.
 */

import { GROUP_ORDER, ordinal } from './steph-brief-triage.js';

const DAY_MS = 24 * 3600 * 1000;

/** YYYY-MM-DD from a Date (its own Y/M/D — pg's DATE comes back as local midnight) or a string. */
export function ymd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const daysBetween = (fromYmd, toYmd) => Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / DAY_MS);

export function shortDate(ymdStr) {
  if (!ymdStr) return '';
  return new Date(`${ymdStr}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const waitedDays = (item, now) => {
  const at = item.first_inbound_at ? new Date(item.first_inbound_at).getTime() : null;
  return at ? Math.max(0, Math.floor((now - at) / DAY_MS)) : 0;
};

function promiseWhat(item) {
  const m = String(item.badge || '').match(/^You promised (?:to )?(.+?) · due /);
  return m ? m[1] : 'do this';
}

/**
 * @returns {{ tier: number, due: string|null, reason: string }}
 */
export function urgencyOf(item, { today, now = Date.now() }) {
  const due = ymd(item.due_on);
  if (item.item_type === 'safety') {
    return { tier: 0, due, reason: "a payment or login request. Verify it by phone before anything moves; if it's fraud, the money is gone" };
  }
  if (item.item_type === 'security') {
    return { tier: 1, due: today, reason: 'a security alert — have IT check it today' };
  }
  // cc'd for someone else: theirs to act on, never Steph's first job.
  if (item.item_type === 'cc') return { tier: 4, due: null, reason: null };
  if (item.item_type === 'promise' && due) {
    const late = daysBetween(due, today);
    return { tier: 1, due, reason: late > 0
      ? `you said you'd ${promiseWhat(item)} by ${shortDate(due)}; it's ${late} ${late === 1 ? 'day' : 'days'} late`
      : `you said you'd ${promiseWhat(item)} today` };
  }
  if (item.item_type === 'bill' && due) {
    const left = daysBetween(today, due);
    const amount = (String(item.badge || '').match(/^Bill · ([^ ]+)/) || [])[1];
    return { tier: 1, due, reason: left < 0
      ? `${amount ? `${amount} was` : 'it was'} due ${shortDate(due)}; it's overdue`
      : `${amount ? `${amount} is` : 'it is'} due ${left === 0 ? 'today' : shortDate(due)}; late after that` };
  }
  if (item.urgency === 3) return { tier: 1, due: today, reason: 'they need an answer today' };
  if (item.item_type === 'unhappy') return { tier: 2, due: null, reason: 'an unhappy client; a call today stops it escalating' };
  if (item.item_type === 'sensitive') return { tier: 2, due: null, reason: 'a legal or contract matter; write the reply yourself before it escalates' };
  if (item.finance || item.item_type === 'bill') return { tier: 2, due: null, reason: 'money is waiting on your answer' };
  if ((item.nudge || 0) >= 2) {
    const d = waitedDays(item, now);
    return { tier: 3, due: null, reason: `${ordinal(item.nudge)} follow-up in ${d} ${d === 1 ? 'day' : 'days'}; another day risks losing them` };
  }
  return { tier: 4, due: null, reason: null };
}

/**
 * Items in consequence order, each { item, tier, reason }.
 * @param {Array} items - card rows (open and done); done items rank last
 * @param {{ today: string, now?: number }} opts
 */
export function rankItems(items, { today, now = Date.now() }) {
  const g = (i) => { const k = GROUP_ORDER.indexOf(i.category); return k < 0 ? GROUP_ORDER.length : k; };
  return items
    .map(item => ({ item, ...urgencyOf(item, { today, now }) }))
    .sort((a, b) =>
      Number(a.item.state !== 'open') - Number(b.item.state !== 'open')
      || a.tier - b.tier
      || (a.tier === 1 ? String(a.due).localeCompare(String(b.due)) : 0)
      || (a.tier === 3 ? (b.item.nudge || 0) - (a.item.nudge || 0) || waitedDays(b.item, now) - waitedDays(a.item, now) : 0)
      || g(a.item) - g(b.item)
      || (new Date(a.item.first_inbound_at || 0).getTime() - new Date(b.item.first_inbound_at || 0).getTime())
      || String(a.item.id).localeCompare(String(b.item.id)));
}

/** The 1–2 items for "Start here": open, and with a reason to act now. */
export function startHere(items, opts) {
  return rankItems(items, opts).filter(r => r.item.state === 'open' && r.tier < 4).slice(0, 2);
}

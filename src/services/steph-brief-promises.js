/**
 * Steph morning brief — promises she made (the "buried promise").
 *
 * Her sent messages from the last READ_DAYS are scanned for commitments with a
 * date or timeframe ("I'll send the budget Wednesday", "back to you by end of
 * week"). A regex prefilter keeps only messages with both a commitment and a
 * time word, then ONE Haiku call per run extracts { what, due_date,
 * confirmable } and resolves the due date against the message's own date.
 *
 * A promise becomes an item when it's due today or overdue (Vancouver) and she
 * hasn't written on that thread since. A follow-up is drafted only when
 * `confirmable` (everything needed is in the thread); otherwise no draft.
 *
 * Her own text is still wrapped in <email> and covered by the untrusted-data
 * rule: the quoted parts of a thread are other people's words.
 */

import { UNTRUSTED_EMAIL_RULE } from './steph-brief-classify.js';
import { displayName, ownText, READ_DAYS } from './steph-brief-triage.js';
import { addressOf } from '../tools/gmail.js';
import { calculateRequestCost } from '../config/cost-settings.js';

export const PROMISE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_CANDIDATES = 60;
const TEXT_CHARS = 600;
const DAY_MS = 24 * 3600 * 1000;

export const COMMIT_RE = /\b(i'?ll|i will|i'?m going to|i am going to|we'?ll|we will|will (send|get|have|follow|circle|confirm|share|update|review|call)|let me (send|get|follow|check|confirm)|you'?ll (have|get|hear)|expect (it|this|them|to hear))\b/i;
export const DEADLINE_RE = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|end of (the )?(day|week|month)|eod|eow|cob|next week|this week|later this week|early next week|first thing|by (the )?\d{1,2}(st|nd|rd|th)?|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|in (a|one|two|three|\d+) (days?|weeks?)|within (a|one|two|\d+) (days?|weeks?))\b/i;

/**
 * Her sent messages in the window that look like a dated commitment.
 * @param {Array} threads - getThread() results
 * @param {{ since: Date }} opts
 */
export function promiseCandidates(threads, { since }) {
  const sinceMs = new Date(since).getTime();
  const out = [];
  for (const t of threads) {
    for (const m of t.messages || []) {
      if (!m.from_user || m.is_draft || m.internal_date < sinceMs) continue;
      const text = ownText(m.body);
      if (!COMMIT_RE.test(text) || !DEADLINE_RE.test(text)) continue;
      out.push({ thread_id: t.id, message_id: m.id, sent_at: m.internal_date, to: m.to, subject: m.subject || t.subject || '', text: text.slice(0, TEXT_CHARS) });
    }
  }
  return out.sort((a, b) => b.sent_at - a.sent_at).slice(0, MAX_CANDIDATES);
}

const SYSTEM = `You find commitments Stephanie Sang (Steph) made in emails she SENT. For each numbered email, list any promise she made to do something by a date or timeframe ("I'll send the budget Wednesday", "back to you by end of week"). Ignore vague intentions with no timeframe, and anything the OTHER person promised.
For each promise return: {"i": <email number>, "what": "<the thing, 3-8 words, no names or amounts>", "due_date": "YYYY-MM-DD" (resolve weekdays and "end of week" against that email's sent date, America/Vancouver; "end of week" = that Friday), "confirmable": true only if everything needed to keep the promise is already in the email text (e.g. a time she said she'd confirm and it's stated), else false}.
Return ONLY a JSON array (empty if none).

${UNTRUSTED_EMAIL_RULE}`;

/**
 * One Haiku call over all candidates.
 * @returns {Promise<{ promises: Array<{candidate, what, due_date, confirmable}>, costUsd: number }>}
 */
export async function extractPromises(candidates, deps) {
  if (!candidates.length) return { promises: [], costUsd: 0 };
  const lines = candidates.map((c, i) => `${i}. sent ${new Date(c.sent_at).toISOString().slice(0, 10)}\n<email from="STEPH" to="${String(c.to || '').replace(/"/g, "'")}">\nSubject: ${c.subject}\n${c.text}\n</email>`).join('\n\n');
  let msg;
  try {
    msg = await deps.createMessage({ model: PROMISE_MODEL, max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: lines }] });
  } catch (err) {
    console.warn(`⚠️  Steph brief promise extraction failed — code: ${err?.code || err?.name || 'unknown'}`);
    return { promises: [], costUsd: 0 };
  }
  const costUsd = msg?.usage ? calculateRequestCost(msg.usage, PROMISE_MODEL) : 0;
  if (msg?.usage) deps.logCost?.({ usage: msg.usage, model: PROMISE_MODEL, source: 'steph-brief', metadata: { ...(deps.costTags || {}), step: 'promises' } });
  const text = (msg?.content || []).map(b => b.text || '').join('');
  let arr = [];
  try { arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch { arr = []; }
  const promises = (Array.isArray(arr) ? arr : [])
    .filter(p => p && Number.isInteger(p.i) && candidates[p.i] && /^\d{4}-\d{2}-\d{2}$/.test(String(p.due_date || '')) && typeof p.what === 'string' && p.what.trim())
    .map(p => ({ candidate: candidates[p.i], what: p.what.trim().slice(0, 80), due_date: p.due_date, confirmable: p.confirmable === true }));
  return { promises, costUsd };
}

function whenLabel(dueDate, today) {
  if (dueDate === today) return 'today';
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dueDate}T12:00:00Z`)) / DAY_MS);
  const d = new Date(`${dueDate}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${d} (${days} ${days === 1 ? 'day' : 'days'} ago)`;
}

/**
 * Promises due today or overdue, with no later message from her on the
 * thread, as card items (one per thread: the most overdue).
 * @param {Array} promises - extractPromises().promises
 * @param {Map<string, object>} threadsById
 * @param {{ today: string }} opts - YYYY-MM-DD in Vancouver
 */
export function duePromiseItems(promises, threadsById, { today }) {
  const byThread = new Map();
  for (const p of promises) {
    if (p.due_date > today) continue;
    const t = threadsById.get(p.candidate.thread_id);
    if (!t) continue;
    const followedUp = (t.messages || []).some(m => m.from_user && !m.is_draft && m.internal_date > p.candidate.sent_at);
    if (followedUp) continue;
    const prev = byThread.get(t.id);
    if (!prev || p.due_date < prev.due_date) byThread.set(t.id, { ...p, thread: t });
  }
  return [...byThread.values()].map((p) => {
    const toAddress = addressOf(String(p.candidate.to || '').split(',')[0]);
    const to = displayName(String(p.candidate.to || '').split(',')[0]) || toAddress;
    const made = new Date(p.candidate.sent_at).toISOString().slice(0, 10);
    return {
      item_key: `promise:${p.thread.id}`,
      category: 'promise',
      item_type: 'promise',
      // "what" is a verb phrase ("send the budget"): "You promised to send the budget".
      badge: `You promised ${/^to /i.test(p.what) ? '' : 'to '}${p.what} · due ${whenLabel(p.due_date, today)}`,
      draft: p.confirmable ? 'promise' : 'none',
      sender: to,
      sender_address: toAddress,
      subject: p.candidate.subject,
      threads: [p.thread],
      thread_ids: [p.thread.id],
      assessment: `You told ${to} on ${made} you'd ${p.what}, due ${p.due_date}. No follow-up on the thread since.`,
      promise: { what: p.what, due_date: p.due_date, made_on: made, quote: p.candidate.text.slice(0, 300) },
      first_inbound_at: p.candidate.sent_at,
      last_inbound_at: p.candidate.sent_at,
      nudge: 0
    };
  });
}

export const PROMISE_WINDOW_DAYS = READ_DAYS;

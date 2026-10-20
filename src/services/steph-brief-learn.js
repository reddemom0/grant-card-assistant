/**
 * Steph morning brief — learning from her edits.
 *
 * When an item's thread shows Steph replied after we saved a draft there, her
 * sent reply is compared with the draft we wrote (kept in
 * steph_brief_items.draft_text only until this comparison). Code first:
 *   token overlap ≥ SAME   → she sent it (nearly) as drafted — nothing to learn
 *   token overlap ≤ UNRELATED → she wrote something else entirely — skip
 * Everything in between goes to ONE batched Haiku call per run, which returns
 * a short, general rule ("gives a specific day, not 'this week'") — no names,
 * no amounts. Rules land in steph_voice_corrections; the latest ~15 are added
 * to every drafting prompt after her voice guide (correctionsBlock).
 *
 * Real runs only: a dry run reads corrections but never writes them.
 */

import { UNTRUSTED_EMAIL_RULE } from './steph-brief-classify.js';
import { ownText } from './steph-brief-triage.js';
import { calculateRequestCost } from '../config/cost-settings.js';

export const LEARN_MODEL = 'claude-haiku-4-5-20251001';
export const SAME = 0.9;
export const UNRELATED = 0.15;
export const MAX_CORRECTIONS_IN_PROMPT = 15;
const TEXT_CHARS = 1200;

const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(w => w.length > 1));

/** Jaccard overlap of the two texts' word sets, 0–1. */
export function similarity(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Her first reply on the thread after the draft was saved, in her own words.
 * @returns {string|null}
 */
export function replyAfterDraft(thread, draftAt) {
  const at = draftAt ? new Date(draftAt).getTime() : 0;
  const m = (thread?.messages || []).filter(x => x.from_user && !x.is_draft && x.internal_date > at)
    .sort((a, b) => a.internal_date - b.internal_date)[0];
  return m ? ownText(m.body) : null;
}

/**
 * Which stored drafts can be compared now, and what the code alone decides.
 * @param {Array} items - stored rows with draft_text, draft_text_at, thread_ids, id
 * @param {Map<string, object>} threadsById
 * @returns {{ toCompare: Array<{item, draft, reply, thread_id}>, settled: Array<{item, reason}> }}
 *   settled — compared in code (same / unrelated); both lists get their draft_text cleared
 */
export function comparable(items, threadsById) {
  const toCompare = [];
  const settled = [];
  for (const item of items) {
    if (!item.draft_text) continue;
    for (const id of item.thread_ids || []) {
      const reply = replyAfterDraft(threadsById.get(id), item.draft_text_at);
      if (!reply) continue;
      const sim = similarity(item.draft_text, reply);
      if (sim >= SAME) settled.push({ item, reason: 'same' });
      else if (sim <= UNRELATED) settled.push({ item, reason: 'unrelated' });
      else toCompare.push({ item, draft: item.draft_text.slice(0, TEXT_CHARS), reply: reply.slice(0, TEXT_CHARS), thread_id: id });
      break;
    }
  }
  return { toCompare, settled };
}

const SYSTEM = `Steph (a grant consultant) was given a DRAFT email reply and sent her own version. For each numbered pair, decide whether her version is a reply to the same email as the draft (related) and whether she meaningfully changed it (changed — not just a typo or a signature). If both, write ONE short general drafting rule that captures the change, as an instruction for future drafts (e.g. "Drop the opening pleasantry.", "Give a specific day, not 'this week'."), and a short before→after example. NEVER include names, company names, amounts or dates in the rule or example.
Return ONLY a JSON array: [{"i": <pair number>, "related": true|false, "changed": true|false, "rule": "...", "example": "..."}].

${UNTRUSTED_EMAIL_RULE}`;

/**
 * One Haiku call over all pairs.
 * @returns {Promise<{ corrections: Array<{item, thread_id, rule, example}>, costUsd: number }>}
 */
export async function summariseCorrections(pairs, deps) {
  if (!pairs.length) return { corrections: [], costUsd: 0 };
  const content = pairs.map((p, i) => `${i}.\n<email kind="draft">\n${p.draft}\n</email>\n<email kind="steph_sent">\n${p.reply}\n</email>`).join('\n\n');
  let msg;
  try {
    msg = await deps.createMessage({ model: LEARN_MODEL, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content }] });
  } catch (err) {
    console.warn(`⚠️  Steph brief learning call failed — code: ${err?.code || err?.name || 'unknown'}`);
    return { corrections: [], costUsd: 0 };
  }
  const costUsd = msg?.usage ? calculateRequestCost(msg.usage, LEARN_MODEL) : 0;
  if (msg?.usage) deps.logCost?.({ usage: msg.usage, model: LEARN_MODEL, source: 'steph-brief', metadata: { ...(deps.costTags || {}), step: 'learn' } });
  const text = (msg?.content || []).map(b => b.text || '').join('');
  let arr = [];
  try { arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch { arr = []; }
  const corrections = (Array.isArray(arr) ? arr : [])
    .filter(c => c && Number.isInteger(c.i) && pairs[c.i] && c.related === true && c.changed === true && typeof c.rule === 'string' && c.rule.trim())
    .map(c => ({
      item: pairs[c.i].item,
      thread_id: pairs[c.i].thread_id,
      rule: c.rule.trim().slice(0, 200),
      example: typeof c.example === 'string' && c.example.trim() ? c.example.trim().slice(0, 200) : null
    }));
  return { corrections, costUsd };
}

export const INSERT_CORRECTION_SQL = `
INSERT INTO steph_voice_corrections (owner_email, is_test, rule, example, source_thread_id, item_id)
VALUES ($1, $2, $3, $4, $5, $6)`;

export const RECENT_CORRECTIONS_SQL = `
SELECT rule FROM steph_voice_corrections
 WHERE owner_email = $1 AND is_test = false
 ORDER BY created_at DESC LIMIT ${MAX_CORRECTIONS_IN_PROMPT}`;

export const CLEAR_DRAFT_TEXT_SQL = `UPDATE steph_brief_items SET draft_text = NULL WHERE id = ANY($1::uuid[])`;
export const SWEEP_DRAFT_TEXT_SQL = `UPDATE steph_brief_items SET draft_text = NULL WHERE draft_text IS NOT NULL AND draft_text_at < NOW() - INTERVAL '14 days'`;

/** The latest rules for the persona; [] when the table isn't there yet (052 unapplied). */
export async function loadCorrections(ownerEmail, query) {
  try {
    return (await query(RECENT_CORRECTIONS_SQL, [ownerEmail])).rows.map(r => r.rule);
  } catch (err) {
    if (err?.code !== '42P01') console.warn(`⚠️  Steph brief corrections unavailable — code: ${err?.code || err?.name || 'unknown'}`);
    return [];
  }
}

/**
 * Control Centre — the AI knowledge queue (migration 057).
 *
 * A consulting-question chat card (chat-daily.js, owner consulting) carries the
 * client's question, the AI's reply and the consultant's answer. When Chris
 * approves it ("Approve for AI", review-queue.js approveForAi) the question and
 * the approved answer land here as one row, pending. "Export" hands every
 * pending row over as one markdown file for gg3-ai-service's knowledge, and
 * marks the rows exported under one batch id; a batch can be downloaded again.
 *
 *   listKnowledge({status})     the rows, newest approval first, company names on
 *   exportPending(actor)        mark pending → exported in one batch; the markdown
 *   batchMarkdown(batch)        the markdown of a past batch (re-download)
 *   knowledgeMarkdown(rows)     pure: rows → the file
 *
 * The file carries the daily pass's anonymised rewrite of the question when
 * there is one, the client's words only as a fallback, and no company names —
 * it is going to a model. The queue view shows the company.
 *
 * Hub DB only. INSERT_KNOWLEDGE_SQL is run by review-queue.js inside the
 * approve transaction; nothing here writes the app or ops DBs. Routes:
 * knowledge-routes.js. Docs: docs/control-centre.md.
 */

import { randomUUID } from 'node:crypto';
import { query as hubQueryDefault, transaction as hubTransactionDefault } from '../database/connection.js';
import { withCompanyNames } from './identity.js';

export const KNOWLEDGE_STATUSES = Object.freeze(['pending', 'exported']);
export const KNOWLEDGE_LIMIT = 500;

export class KnowledgeError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'KnowledgeError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// SQL (Hub DB)
// ---------------------------------------------------------------------------

// Run by review-queue.js approveForAi, in the same transaction as the close.
export const INSERT_KNOWLEDGE_SQL = `
  INSERT INTO cc_ai_knowledge (item_id, conversation_id, company_id, question, question_rewritten, ai_reply, answer, approved_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING *`;

export const LIST_KNOWLEDGE_SQL = `
  SELECT * FROM cc_ai_knowledge
   WHERE ($1::text IS NULL OR status = $1)
   ORDER BY approved_at DESC, id DESC
   LIMIT $2`;

export const COUNTS_SQL = `
  SELECT status, count(*)::int AS n FROM cc_ai_knowledge GROUP BY status`;

export const PENDING_FOR_EXPORT_SQL = `
  SELECT * FROM cc_ai_knowledge WHERE status = 'pending' ORDER BY approved_at, id FOR UPDATE`;

export const MARK_EXPORTED_SQL = `
  UPDATE cc_ai_knowledge
     SET status = 'exported', exported_at = NOW(), export_batch = $2, updated_at = NOW()
   WHERE id = ANY($1::bigint[])`;

export const BATCH_SQL = `
  SELECT * FROM cc_ai_knowledge WHERE export_batch = $1 ORDER BY approved_at, id`;

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const dayOf = (v) => (iso(v) ?? '').slice(0, 10);
const text = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();
/** A paragraph of someone else's words, kept out of the heading structure. */
const quoted = (s) => text(s).split('\n').map((l) => `> ${l}`).join('\n');

/** The export's batch id: the day plus 8 hex characters, unique enough and readable. */
export function newBatchId(now = new Date()) {
  return `${new Date(now).toISOString().slice(0, 10)}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * Pure: queue rows → one markdown file. Prefers the anonymised rewritten
 * question; the client's own words only when there is none. No company names.
 */
export function knowledgeMarkdown(rows, { batch = null, at = new Date() } = {}) {
  const list = rows || [];
  const head = [
    '# GetGranted — consultant answers approved for the AI',
    '',
    `Exported ${dayOf(at)}${batch ? ` · batch ${batch}` : ''} · ${list.length} ${list.length === 1 ? 'answer' : 'answers'}.`,
    'Each item is a question a client asked the GetGranted chat, the reply the chat gave, and the answer a Granted consultant wrote and Chris approved. The approved answer is the one to teach.',
    ''
  ];
  const items = list.map((r, i) => {
    const question = text(r.question_rewritten) || text(r.question) || '(no question recorded)';
    return [
      `## ${i + 1}. ${question.replace(/\s+/g, ' ')}`,
      '',
      '**Client asked**',
      '',
      quoted(r.question || '(not recorded)'),
      '',
      '**The assistant replied**',
      '',
      quoted(r.ai_reply || '(no reply recorded)'),
      '',
      '**Approved answer**',
      '',
      text(r.answer),
      '',
      `_Approved by ${r.approved_by || 'staff'} on ${dayOf(r.approved_at) || 'an unknown date'}${r.item_id != null ? ` · Control Centre card #${r.item_id}` : ''}._`,
      ''
    ].join('\n');
  });
  return [...head, ...items].join('\n');
}

const numbered = (r) => ({ ...r, id: Number(r.id), item_id: r.item_id == null ? null : Number(r.item_id) });

// ---------------------------------------------------------------------------
// Reads and the export
// ---------------------------------------------------------------------------

/**
 * The queue: rows newest approval first, with company names (a names failure
 * keeps the ids), and the pending / exported counts.
 */
export async function listKnowledge({ status } = {}, { hubQuery = hubQueryDefault, appQuery } = {}) {
  if (status != null && status !== '' && !KNOWLEDGE_STATUSES.includes(status)) {
    throw new KnowledgeError(400, `status must be one of ${KNOWLEDGE_STATUSES.join(', ')}`);
  }
  const [{ rows }, counts] = await Promise.all([
    hubQuery(LIST_KNOWLEDGE_SQL, [status || null, KNOWLEDGE_LIMIT]),
    hubQuery(COUNTS_SQL)
  ]);
  let items = rows.map(numbered);
  try {
    items = await withCompanyNames(items, appQuery ? { query: appQuery } : {});
  } catch {
    items = items.map((r) => ({ ...r, company_name: null, company_internal: false }));
  }
  const n = Object.fromEntries(KNOWLEDGE_STATUSES.map((s) => [s, 0]));
  for (const r of counts.rows) if (r.status in n) n[r.status] = Number(r.n) || 0;
  return { items, counts: n };
}

/**
 * Export every pending row: mark them exported under one batch id and return
 * the markdown. Nothing is written when nothing is pending.
 * @returns {Promise<{count: number, batch: string|null, markdown: string|null, exported_at: string|null}>}
 */
export async function exportPending(actor, { hubTransaction = hubTransactionDefault, now = () => new Date() } = {}) {
  return hubTransaction(async (client) => {
    const pending = (await client.query(PENDING_FOR_EXPORT_SQL)).rows;
    if (!pending.length) return { count: 0, batch: null, markdown: null, exported_at: null };
    const at = now();
    const batch = newBatchId(at);
    await client.query(MARK_EXPORTED_SQL, [pending.map((r) => r.id), batch]);
    const rows = pending.map((r) => ({ ...numbered(r), status: 'exported', export_batch: batch, exported_at: at, exported_by: actor ?? null }));
    return { count: rows.length, batch, markdown: knowledgeMarkdown(rows, { batch, at }), exported_at: iso(at) };
  }, 'cc knowledge export');
}

/** A past batch's markdown again, read-only. Null when the batch has no rows. */
export async function batchMarkdown(batch, { hubQuery = hubQueryDefault } = {}) {
  const id = String(batch ?? '').trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{8}$/.test(id)) throw new KnowledgeError(400, 'batch must look like YYYY-MM-DD-xxxxxxxx');
  const { rows } = await hubQuery(BATCH_SQL, [id]);
  if (!rows.length) return null;
  return { count: rows.length, batch: id, markdown: knowledgeMarkdown(rows.map(numbered), { batch: id, at: rows[0].exported_at ?? new Date() }) };
}

/**
 * What clients asked about — the weekly Pulse digest's themes as data
 * (migration 046).
 *
 *   saveDigestThemes(built)   called by pulse-digest.js after it claims the week,
 *                             with the digest it built. Uses the digest's own
 *                             model output: no model call here, ever.
 *   parseDigestSummary(text)  backfill: themes (name, count, takeaway) and one
 *                             example question each, from a pulse_posts.summary.
 *                             No client ids exist there.
 *   latestDigest()            the latest stored week for the Overview.
 *
 * Only rewritten (anonymised) question text is ever stored. Writes only the Hub
 * DB; a week's rows are replaced whole in one transaction. Logs carry counts
 * and codes only. Docs: docs/control-centre.md.
 */

import { query as hubQueryDefault, transaction as hubTransactionDefault } from '../database/connection.js';
import { identitiesForClerkIds, withCompanyNames } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';

export const RECENT_QUESTIONS = 8;

export const DELETE_WEEK_THEMES_SQL = 'DELETE FROM cc_digest_themes WHERE week_start = $1';
export const DELETE_WEEK_QUESTIONS_SQL = 'DELETE FROM cc_digest_questions WHERE week_start = $1';
export const INSERT_THEME_SQL = `
  INSERT INTO cc_digest_themes (week_start, position, name, question_count, takeaway, source)
  VALUES ($1, $2, $3, $4, $5, $6)`;
export const INSERT_QUESTION_SQL = `
  INSERT INTO cc_digest_questions (week_start, theme_position, question, question_order, clerk_id, company_id, source)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

/** Pure: the digest's built output → rows. `companyOf` maps Clerk id → companies.id. */
export function rowsFromDigest(built, companyOf = new Map()) {
  const week = built.monday;
  const themes = [];
  const questions = [];
  (built.themes?.themes || []).forEach((t, i) => {
    const position = i + 1;
    themes.push({ week_start: week, position, name: t.name, question_count: (t.questions || []).length, takeaway: t.takeaway ?? null, source: 'digest' });
    for (const item of t.items || []) {
      const clerk = built.askedBy?.[item.id - 1] ?? null;
      questions.push({
        week_start: week, theme_position: position, question: item.text, question_order: item.id,
        clerk_id: clerk, company_id: clerk ? companyOf.get(clerk) ?? null : null, source: 'digest'
      });
    }
  });
  return { themes, questions };
}

async function writeWeek(week, { themes, questions }, hubTransaction) {
  return hubTransaction(async (client) => {
    await client.query(DELETE_WEEK_QUESTIONS_SQL, [week]);
    await client.query(DELETE_WEEK_THEMES_SQL, [week]);
    for (const t of themes) {
      await client.query(INSERT_THEME_SQL, [t.week_start, t.position, t.name, t.question_count, t.takeaway, t.source]);
    }
    for (const q of questions) {
      await client.query(INSERT_QUESTION_SQL, [q.week_start, q.theme_position, q.question, q.question_order, q.clerk_id, q.company_id, q.source]);
    }
    return { themes: themes.length, questions: questions.length };
  }, 'cc digest themes write');
}

/**
 * Store one digest week. The company lookup is best-effort: without the app DB
 * the Clerk id is still kept and company_id is null.
 */
export async function saveDigestThemes(built, { hubTransaction = hubTransactionDefault, identities = identitiesForClerkIds } = {}) {
  const clerks = [...new Set((built.askedBy || []).filter(Boolean))];
  let companyOf = new Map();
  try {
    const ids = await identities(clerks);
    companyOf = new Map([...ids].map(([clerk, v]) => [clerk, v.company_id]));
  } catch (err) {
    console.warn(`⚠️  CC digest themes: companies not resolved — code: ${err?.code ?? err?.name ?? 'unknown'}`);
  }
  const rows = rowsFromDigest(built, companyOf);
  const n = await writeWeek(built.monday, rows, hubTransaction);
  console.log(`🗂️  CC digest themes ${built.monday}: ${n.themes} themes, ${n.questions} questions stored`);
  return n;
}

// ---------------------------------------------------------------------------
// Backfill from pulse_posts.summary
// ---------------------------------------------------------------------------

// "• Name (6) — Takeaway sentence. e.g. "Example question?""
const THEME_LINE = /^•\s+(.+?)\s+\((\d+)\)\s+—\s+(.*?)(?:\s+e\.g\.\s+"(.*)")?\s*$/;

/** Pure: a digest summary → its themes, or [] when it has none. */
export function parseDigestSummary(summary) {
  const lines = String(summary || '').split('\n');
  const start = lines.findIndex((l) => l.trim() === '**What clients asked**');
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.startsWith('**')) break;
    const m = line.match(THEME_LINE);
    if (m) out.push({ name: m[1], count: Number(m[2]), takeaway: m[3] || null, example: m[4] || null });
  }
  return out;
}

/** Pure: parsed themes → rows (one example question per theme, no client). */
export function rowsFromSummary(week, parsed) {
  const themes = parsed.map((t, i) => ({ week_start: week, position: i + 1, name: t.name, question_count: t.count, takeaway: t.takeaway, source: 'backfill_summary' }));
  const questions = parsed.flatMap((t, i) => (t.example
    ? [{ week_start: week, theme_position: i + 1, question: t.example, question_order: i + 1, clerk_id: null, company_id: null, source: 'backfill_summary' }]
    : []));
  return { themes, questions };
}

export async function saveBackfill(week, parsed, { hubTransaction = hubTransactionDefault } = {}) {
  return writeWeek(week, rowsFromSummary(week, parsed), hubTransaction);
}

// ---------------------------------------------------------------------------
// Read (Overview)
// ---------------------------------------------------------------------------

export const LATEST_WEEK_SQL = 'SELECT max(week_start)::text AS week FROM cc_digest_themes';
export const WEEK_THEMES_SQL = `
  SELECT position, name, question_count, takeaway, source
    FROM cc_digest_themes WHERE week_start = $1 ORDER BY position`;
export const WEEK_QUESTIONS_SQL = `
  SELECT theme_position, question, question_order, company_id, source
    FROM cc_digest_questions WHERE week_start = $1 ORDER BY question_order DESC`;

/**
 * The latest stored week: themes (with how many of their questions came from
 * internal accounts, where known) and its most recent questions, each with the
 * company named and tagged Internal. null when nothing is stored.
 */
export async function latestDigest({ hubQuery = hubQueryDefault, appQuery } = {}) {
  const week = (await hubQuery(LATEST_WEEK_SQL)).rows[0]?.week ?? null;
  if (!week) return null;
  const [t, q] = await Promise.all([hubQuery(WEEK_THEMES_SQL, [week]), hubQuery(WEEK_QUESTIONS_SQL, [week])]);
  const themeName = new Map(t.rows.map((r) => [r.position, r.name]));
  let questions = q.rows.map((r) => ({
    text: r.question, theme: themeName.get(r.theme_position) ?? null, order: r.question_order,
    company_id: r.company_id ?? null, linked: r.source === 'digest'
  }));
  try {
    questions = await withCompanyNames(questions, appQuery ? { query: appQuery } : {});
  } catch {
    questions = questions.map((x) => ({ ...x, company_name: null, company_internal: isInternalCompany(x.company_id) }));
  }
  const internalByTheme = new Map();
  for (const [i, x] of q.rows.entries()) {
    if (questions[i].company_internal) internalByTheme.set(x.theme_position, (internalByTheme.get(x.theme_position) ?? 0) + 1);
  }
  const end = new Date(`${week}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    week_start: week,
    week_end: end.toISOString().slice(0, 10),
    source: t.rows.every((r) => r.source === 'backfill_summary') ? 'backfill_summary' : 'digest',
    themes: t.rows.map((r) => ({
      name: r.name, count: r.question_count, takeaway: r.takeaway,
      internal_count: internalByTheme.get(r.position) ?? 0
    })),
    recent_questions: questions.slice(0, RECENT_QUESTIONS * 3) // the page filters by the toggle, then shows RECENT_QUESTIONS
  };
}

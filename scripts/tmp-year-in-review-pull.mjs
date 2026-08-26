/**
 * THROWAWAY — AI Year-in-Review live data pull (READ ONLY).
 *
 * Runs SELECT-only queries against the live Railway Postgres to recover usage
 * numbers for the FY2026 team-day slide. Delete after use.
 *
 * Safety: acquires ONE client from the pool and sets it read-only + UTC before
 * issuing anything. Any accidental write fails at the server.
 *
 * Usage: node scripts/tmp-year-in-review-pull.mjs
 */

import 'dotenv/config';
import { getPool, closePool } from '../src/database/connection.js';

const FY_START = '2025-07-01';
const FY_END = '2026-07-31'; // exclusive

const issued = []; // audit log of every statement

function tag(kind, sql) {
  issued.push({ kind, sql: sql.replace(/\s+/g, ' ').trim().slice(0, 110) });
}

let client;

async function sel(label, sql, params = []) {
  tag('SELECT', sql);
  try {
    const res = await client.query(sql, params);
    print(label, res.rows);
    return res.rows;
  } catch (err) {
    console.log(`\n### ${label}\n  !! QUERY FAILED: ${err.message}`);
    return null;
  }
}

function print(label, rows) {
  console.log(`\n### ${label}`);
  if (!rows || rows.length === 0) {
    console.log('  (0 rows)');
    return;
  }
  const cols = Object.keys(rows[0]);
  const width = {};
  for (const c of cols) {
    width[c] = Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length));
  }
  console.log('  ' + cols.map((c) => c.padEnd(width[c])).join(' | '));
  console.log('  ' + cols.map((c) => '-'.repeat(width[c])).join('-+-'));
  for (const r of rows) {
    console.log('  ' + cols.map((c) => String(r[c] ?? '').padEnd(width[c])).join(' | '));
  }
  console.log(`  (${rows.length} row${rows.length === 1 ? '' : 's'})`);
}

async function main() {
  const pool = getPool();
  client = await pool.connect();

  // --- Safety guards (the ONLY non-SELECT statements in this run) ---
  const guard1 = 'SET default_transaction_read_only = on';
  const guard2 = "SET TIME ZONE 'UTC'";
  tag('SET (guard)', guard1);
  await client.query(guard1);
  tag('SET (guard)', guard2);
  await client.query(guard2);

  console.log('='.repeat(78));
  console.log('AI YEAR-IN-REVIEW — LIVE DATA PULL (READ ONLY)');
  console.log(`Fiscal window: ${FY_START} .. 2026-07-30`);
  console.log('='.repeat(78));

  // ================= STEP 1 — connection identity =================
  console.log('\n\n========== STEP 1 — CONNECTION TARGET ==========');
  await sel(
    '1. Server identity',
    `SELECT current_database() AS database,
            current_user      AS db_user,
            COALESCE(inet_server_addr()::text,'(proxied — not exposed)') AS server_addr,
            COALESCE(inet_server_port()::text,'(n/a)') AS server_port,
            split_part(version(), ' on ', 1) AS pg_version,
            to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS server_now_utc,
            current_setting('transaction_read_only') AS read_only`
  );

  // ================= STEP 2 — conversation volume =================
  console.log('\n\n========== STEP 2 — CONVERSATION VOLUME ==========');
  await sel(
    '2a. Absolute bounds of the conversations table (all time)',
    `SELECT COUNT(*) AS total_all_time,
            to_char(MIN(created_at),'YYYY-MM-DD') AS earliest_row,
            to_char(MAX(created_at),'YYYY-MM-DD') AS latest_row
     FROM conversations`
  );

  await sel(
    '2b. Conversations per month (all agents)',
    `SELECT to_char(created_at,'YYYY-MM') AS month, COUNT(*) AS conversations
     FROM conversations
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1 ORDER BY 1`,
    [FY_START, FY_END]
  );

  await sel(
    '2c. Conversations per agent (FY total + lifespan)',
    `SELECT agent_type,
            COUNT(*) AS conversations,
            to_char(MIN(created_at),'YYYY-MM-DD') AS first_use,
            to_char(MAX(created_at),'YYYY-MM-DD') AS last_use
     FROM conversations
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1 ORDER BY 2 DESC`,
    [FY_START, FY_END]
  );

  await sel(
    '2d. Conversations by month x agent',
    `SELECT to_char(created_at,'YYYY-MM') AS month, agent_type, COUNT(*) AS conversations
     FROM conversations
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1,2 ORDER BY 1,2`,
    [FY_START, FY_END]
  );

  // ================= STEP 3 — message volume =================
  console.log('\n\n========== STEP 3 — MESSAGE VOLUME ==========');
  console.log('!! ALL MESSAGE COUNTS ARE A FLOOR, NOT A TOTAL.');
  console.log('!! deleteOldMessages() (src/database/messages.js:649) is called from');
  console.log('!! src/claude/client.js:359 past the 50k-token compaction threshold,');
  console.log('!! physically deleting message rows from long conversations.');

  await sel(
    '3a. Messages per month (all agents)',
    `SELECT to_char(m.created_at,'YYYY-MM') AS month, COUNT(*) AS messages
     FROM messages m
     WHERE m.created_at >= $1 AND m.created_at < $2
     GROUP BY 1 ORDER BY 1`,
    [FY_START, FY_END]
  );

  await sel(
    '3b. Messages per agent, split by role',
    `SELECT c.agent_type,
            COUNT(*) AS messages,
            COUNT(*) FILTER (WHERE m.role = 'user')      AS user_messages,
            COUNT(*) FILTER (WHERE m.role = 'assistant') AS assistant_messages
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= $1 AND m.created_at < $2
     GROUP BY 1 ORDER BY 2 DESC`,
    [FY_START, FY_END]
  );

  await sel(
    '3c. Messages by month x agent',
    `SELECT to_char(m.created_at,'YYYY-MM') AS month, c.agent_type, COUNT(*) AS messages
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= $1 AND m.created_at < $2
     GROUP BY 1,2 ORDER BY 1,2`,
    [FY_START, FY_END]
  );

  await sel(
    '3d. Compaction exposure (each summarized conversation shed message rows)',
    `SELECT COUNT(*) AS conversations_compacted,
            to_char(MIN(created_at),'YYYY-MM-DD') AS earliest,
            to_char(MAX(created_at),'YYYY-MM-DD') AS latest
     FROM conversation_summaries`
  );

  // ================= STEP 4 — distinct users =================
  console.log('\n\n========== STEP 4 — DISTINCT USERS ==========');
  console.log('!! migration 004_fix_user_id_type.sql (2025-10-22) ran');
  console.log('!! ALTER COLUMN user_id TYPE INTEGER USING NULL — it nulled every');
  console.log('!! pre-existing user_id. null_user_rows below measures the damage.');

  await sel(
    '4a. Distinct users per month',
    `SELECT to_char(created_at,'YYYY-MM') AS month,
            COUNT(DISTINCT user_id) AS distinct_users,
            COUNT(*) FILTER (WHERE user_id IS NULL) AS null_user_rows,
            COUNT(*) AS conversations
     FROM conversations
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1 ORDER BY 1`,
    [FY_START, FY_END]
  );

  await sel(
    '4b. Per-user conversation counts (FY)',
    `SELECT u.email,
            COUNT(c.id) AS conversations,
            COUNT(DISTINCT c.agent_type) AS agents_used,
            to_char(MIN(c.created_at),'YYYY-MM-DD') AS first_use,
            to_char(MAX(c.created_at),'YYYY-MM-DD') AS last_use
     FROM conversations c
     JOIN users u ON u.id = c.user_id
     WHERE c.created_at >= $1 AND c.created_at < $2
     GROUP BY 1 ORDER BY 2 DESC`,
    [FY_START, FY_END]
  );

  await sel(
    '4c. Registered users',
    `SELECT COUNT(*) AS registered_users,
            to_char(MIN(created_at),'YYYY-MM-DD') AS first_signup,
            to_char(MAX(created_at),'YYYY-MM-DD') AS latest_signup
     FROM users`
  );

  await sel(
    '4d. Signups per month',
    `SELECT to_char(created_at,'YYYY-MM') AS month, COUNT(*) AS new_users
     FROM users GROUP BY 1 ORDER BY 1`
  );

  // ================= STEP 5 — lead-gen =================
  console.log('\n\n========== STEP 5 — LEAD-GEN (DATA_FLOOR IGNORED) ==========');

  await sel(
    '5a. Lead-gen totals, from the true earliest row',
    `SELECT COUNT(*) AS total_sessions,
            COUNT(*) FILTER (WHERE contact_email IS NOT NULL) AS sessions_with_email,
            COUNT(*) FILTER (WHERE finalized) AS finalized_sessions,
            to_char(MIN(created_at),'YYYY-MM-DD') AS earliest_row,
            to_char(MAX(created_at),'YYYY-MM-DD') AS latest_row
     FROM lead_gen_conversations`
  );

  await sel(
    '5b. Lead-gen per month',
    `SELECT to_char(created_at,'YYYY-MM') AS month,
            COUNT(*) AS sessions,
            COUNT(*) FILTER (WHERE contact_email IS NOT NULL) AS leads_captured,
            COUNT(*) FILTER (WHERE finalized) AS finalized,
            COUNT(*) FILTER (WHERE message_count >= 2) AS engaged_sessions,
            COUNT(*) FILTER (WHERE contact_email ILIKE '%@granted.ca') AS internal_emails,
            ROUND(AVG(message_count), 1) AS avg_messages
     FROM lead_gen_conversations
     GROUP BY 1 ORDER BY 1`
  );

  await sel(
    '5c. Lead score breakdown (all time)',
    `SELECT COALESCE(prospect_data->>'lead_score','(unscored)') AS lead_score,
            COUNT(*) AS sessions,
            COUNT(*) FILTER (WHERE contact_email IS NOT NULL) AS with_email
     FROM lead_gen_conversations
     GROUP BY 1 ORDER BY 2 DESC`
  );

  await sel(
    '5d. Lead score breakdown, post-DATA_FLOOR (what the admin UI shows)',
    `SELECT COALESCE(prospect_data->>'lead_score','(unscored)') AS lead_score,
            COUNT(*) AS sessions,
            COUNT(*) FILTER (WHERE contact_email IS NOT NULL) AS with_email
     FROM lead_gen_conversations
     WHERE created_at >= '2026-04-01'
     GROUP BY 1 ORDER BY 2 DESC`
  );

  await sel(
    '5e. CTA selection split',
    `SELECT COALESCE(cta_selected,'(none)') AS cta, COUNT(*) AS sessions
     FROM lead_gen_conversations GROUP BY 1 ORDER BY 2 DESC`
  );

  await sel(
    '5f. Province split (top 15, sessions with a province)',
    `SELECT prospect_data->>'province' AS province, COUNT(*) AS sessions
     FROM lead_gen_conversations
     WHERE prospect_data->>'province' IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC LIMIT 15`
  );

  await sel(
    '5g. Funnel events (lead_gen_analytics)',
    `SELECT event_type, COUNT(*) AS events,
            to_char(MIN(created_at),'YYYY-MM-DD') AS first_seen,
            to_char(MAX(created_at),'YYYY-MM-DD') AS last_seen
     FROM lead_gen_analytics GROUP BY 1 ORDER BY 2 DESC`
  );

  await sel(
    '5h. Widget events by month (lead_gen_events)',
    `SELECT to_char(created_at,'YYYY-MM') AS month, event_type, COUNT(*) AS events
     FROM lead_gen_events GROUP BY 1,2 ORDER BY 1,2`
  );

  // ================= STEP 6 — every other table =================
  console.log('\n\n========== STEP 6 — ALL OTHER TABLES WITH created_at ==========');

  const tblSql = `SELECT c.table_name
                  FROM information_schema.columns c
                  JOIN information_schema.tables t
                    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
                  WHERE c.table_schema = 'public'
                    AND c.column_name = 'created_at'
                    AND t.table_type = 'BASE TABLE'
                  ORDER BY 1`;
  tag('SELECT', tblSql);
  const tables = (await client.query(tblSql)).rows.map((r) => r.table_name);
  console.log(`\n  Discovered ${tables.length} base tables with a created_at column.`);

  const sweep = [];
  for (const t of tables) {
    const sql = `SELECT COUNT(*)::int AS row_count,
                        to_char(MIN(created_at),'YYYY-MM-DD') AS earliest,
                        to_char(MAX(created_at),'YYYY-MM-DD') AS latest
                 FROM "${t}"`;
    tag('SELECT', `[sweep] ${sql}`);
    try {
      const r = (await client.query(sql)).rows[0];
      sweep.push({ table: t, rows: r.row_count, earliest: r.earliest, latest: r.latest });
    } catch (err) {
      sweep.push({ table: t, rows: 'ERR', earliest: err.message.slice(0, 40), latest: '' });
    }
  }
  sweep.sort((a, b) => (Number(b.rows) || 0) - (Number(a.rows) || 0));
  print('6a. Row counts and date coverage, every table', sweep);

  await sel(
    '6b. Do the "telemetry" tables actually exist in production?',
    `SELECT t.name AS expected_table,
            (to_regclass('public.' || t.name) IS NOT NULL) AS exists_in_prod
     FROM (VALUES ('conversation_stats'),('agent_evaluations'),('agent_metrics_daily')) AS t(name)`
  );

  await sel(
    '6c. agent_metrics_daily — columns (static review said this table was never written)',
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agent_metrics_daily'
     ORDER BY ordinal_position`
  );

  await sel(
    '6d. agent_metrics_daily — full contents',
    `SELECT * FROM agent_metrics_daily ORDER BY 1 LIMIT 100`
  );

  await sel(
    '6e. Feedback ratings breakdown',
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='conversation_feedback'
     ORDER BY ordinal_position`
  );

  await sel(
    '6f. Lead-gen TRUE message volume (stored in JSONB, not the messages table)',
    `SELECT to_char(created_at,'YYYY-MM') AS month,
            SUM(jsonb_array_length(messages))::int AS jsonb_messages,
            SUM(message_count)::int AS message_count_col
     FROM lead_gen_conversations GROUP BY 1 ORDER BY 1`
  );

  await sel(
    '6g. Data-quality check: malformed cta_selected values',
    `SELECT COUNT(*) FILTER (WHERE length(cta_selected) > 40) AS malformed_rows,
            COUNT(*) FILTER (WHERE cta_selected IN ('book_call','email_summary','getgranted','none')) AS clean_rows,
            COUNT(*) FILTER (WHERE cta_selected IS NULL) AS null_rows
     FROM lead_gen_conversations`
  );

  await sel(
    '6h. CTA split, malformed values collapsed',
    `SELECT CASE
              WHEN cta_selected IS NULL THEN '(null)'
              WHEN length(cta_selected) > 40 THEN '(malformed - truncated blob)'
              ELSE cta_selected
            END AS cta,
            COUNT(*) AS sessions
     FROM lead_gen_conversations GROUP BY 1 ORDER BY 2 DESC`
  );

  await sel(
    '6i. Feedback volume by month',
    `SELECT to_char(created_at,'YYYY-MM') AS month, COUNT(*) AS feedback_rows
     FROM conversation_feedback GROUP BY 1 ORDER BY 1`
  );

  await sel(
    '6j. Feedback rating split (all time)',
    `SELECT COALESCE(rating,'(null)') AS rating, COUNT(*) AS rows,
            ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
     FROM conversation_feedback GROUP BY 1 ORDER BY 2 DESC`
  );

  await sel(
    '6k. Feedback rating split per agent',
    `SELECT c.agent_type,
            COUNT(*) AS feedback_rows,
            COUNT(*) FILTER (WHERE f.rating = 'positive') AS positive,
            COUNT(*) FILTER (WHERE f.rating = 'negative') AS negative
     FROM conversation_feedback f
     JOIN conversations c ON c.id = f.conversation_id
     GROUP BY 1 ORDER BY 2 DESC`
  );

  // ================= AUDIT =================
  console.log('\n\n========== VERIFICATION — STATEMENT AUDIT ==========');
  const nonSelect = issued.filter((s) => s.kind !== 'SELECT');
  console.log(`\n  Total statements issued: ${issued.length}`);
  console.log(`  SELECT: ${issued.length - nonSelect.length}`);
  console.log(`  non-SELECT: ${nonSelect.length}`);
  for (const s of nonSelect) console.log(`    [${s.kind}] ${s.sql}`);
  console.log('\n  Full statement log:');
  issued.forEach((s, i) => console.log(`   ${String(i + 1).padStart(3)}. [${s.kind}] ${s.sql}`));
}

main()
  .catch((err) => {
    console.error('\nFATAL:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (client) client.release();
    await closePool();
  });

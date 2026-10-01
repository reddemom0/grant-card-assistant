#!/usr/bin/env node
/**
 * Dev-only check of Oracle's read-only access to the gg3-ai-service ops DB.
 *
 *   GG3_OPS_DB_READONLY_URL='postgresql://oracle_readonly:…' \
 *   GG3_INTERNAL_USER_IDS='user_a,user_b' \
 *   node scripts/gg3-ops-db-check.mjs
 *
 * Prints counts and PASS/FAIL only — never message text or user ids.
 *   (a) chat_turns by outcome, last 7 days, internal users excluded
 *   (b) conversations created in the last 7 days
 *   (c1) INSERT in a default session        → must be refused as read-only (25006)
 *   (c2) INSERT after SET TRANSACTION READ WRITE → must be refused by grants (42501)
 * Each probe runs inside BEGIN … ROLLBACK, so nothing persists even if one
 * wrongly succeeds. Exit code 1 on any FAIL or when not configured.
 *
 * Runbook: docs/runbooks/gg3-readonly-access.md
 */

import {
  gg3OpsQuery,
  getGg3OpsPool,
  excludeInternalUsers,
  getInternalUserIds,
  isGg3OpsConfigured
} from '../src/services/gg3-ops-db.js';

const PROBE_SQL = "INSERT INTO conversations (user_id, messages) VALUES ('pulse-readonly-probe', '[]'::jsonb)";

let failed = false;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { failed = true; console.log(`  FAIL  ${msg}`); };

async function probeInsert(client, { readWrite }) {
  await client.query('BEGIN');
  try {
    if (readWrite) await client.query('SET TRANSACTION READ WRITE');
    await client.query(PROBE_SQL);
    return { refused: false };
  } catch (err) {
    return { refused: true, code: err.code || err.name || 'unknown' };
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
  }
}

async function main() {
  if (!isGg3OpsConfigured()) {
    getGg3OpsPool(); // logs the one "not configured" warning
    console.log('GG3 ops DB: not configured. Set GG3_OPS_DB_READONLY_URL and re-run.');
    process.exit(1);
  }

  const internalCount = getInternalUserIds().length;
  console.log(`GG3 ops DB check (internal users excluded: ${internalCount})\n`);

  // (a)
  const ex = excludeInternalUsers('user_id', 1);
  const outcomes = await gg3OpsQuery(
    `SELECT outcome, count(*)::int AS n
       FROM chat_turns
      WHERE occurred_at > now() - interval '7 days' AND ${ex.clause}
      GROUP BY outcome
      ORDER BY n DESC`,
    ex.params
  );
  console.log('(a) chat_turns by outcome, last 7 days');
  if (outcomes.rows.length === 0) console.log('      (none)');
  for (const r of outcomes.rows) console.log(`      ${String(r.outcome).padEnd(14)} ${r.n}`);

  // (b)
  const convs = await gg3OpsQuery(
    "SELECT count(*)::int AS n FROM conversations WHERE created_at > now() - interval '7 days'"
  );
  console.log(`\n(b) conversations created, last 7 days: ${convs.rows[0].n}\n`);

  // (c)
  console.log('(c) write refusal');
  const client = await getGg3OpsPool().connect();
  try {
    const c1 = await probeInsert(client, { readWrite: false });
    if (c1.refused && c1.code === '25006') pass('default session is read-only (25006)');
    else if (c1.refused) fail(`default session refused the INSERT, but with ${c1.code}, not read-only 25006 — check the pool options`);
    else fail('default session ACCEPTED an INSERT (rolled back) — role is not read-only');

    const c2 = await probeInsert(client, { readWrite: true });
    if (c2.refused && c2.code === '42501') pass('read-write session still refused by grants (42501)');
    else if (c2.refused) fail(`read-write session refused with ${c2.code}, expected permission denied 42501`);
    else fail('read-write session ACCEPTED an INSERT (rolled back) — role has write grants');
  } finally {
    client.release();
  }

  console.log(failed ? '\nResult: FAIL' : '\nResult: PASS');
  await getGg3OpsPool().end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`Check aborted (code: ${err.code || err.name || 'unknown'})`);
  try { await getGg3OpsPool()?.end(); } catch { /* ignore */ }
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Backfill "what clients asked" (migration 046) from digests already sent.
 *
 *   node scripts/cc-backfill-digest-themes.mjs           dry run: what it would store
 *   node scripts/cc-backfill-digest-themes.mjs --write   store it (Hub DB)
 *
 * Reads pulse_posts (kind 'digest', not test) and parses each week's summary:
 * theme name, question count, takeaway, and the one example question per
 * theme the summary carries. No model call. No client ids exist in a summary,
 * so backfilled questions are unlinked (clerk_id / company_id null). A week the
 * live digest already stored (source 'digest') is never overwritten.
 *
 * Loads .env. Local DATABASE_URL is the PRODUCTION Hub DB — point it at a
 * scratch DB before --write to test. Docs: docs/control-centre.md.
 */

import 'dotenv/config';
import { query, closePool } from '../src/database/connection.js';
import { parseDigestSummary, saveBackfill } from '../src/control-centre/digest-themes.js';
import { vancouverDay } from '../src/control-centre/rollup.js';

const write = process.argv.includes('--write');

async function main() {
  console.log(`CC digest themes backfill (${write ? 'WRITE' : 'dry run, nothing written'})\n`);
  const posts = (await query(`
    SELECT DISTINCT ON (period_start) period_start, summary
      FROM pulse_posts
     WHERE kind = 'digest' AND NOT is_test
     ORDER BY period_start, created_at DESC`)).rows;
  const live = new Set((await query(
    "SELECT DISTINCT week_start::text AS w FROM cc_digest_themes WHERE source = 'digest'")).rows.map((r) => r.w));

  for (const p of posts) {
    const week = vancouverDay(p.period_start);
    const parsed = parseDigestSummary(p.summary);
    if (live.has(week)) { console.log(`${week}: already stored by the digest — skipped`); continue; }
    if (!parsed.length) { console.log(`${week}: no themes in the summary — skipped`); continue; }
    console.log(`${week}: ${parsed.length} themes, ${parsed.filter((t) => t.example).length} example questions (no client ids)`);
    for (const t of parsed) console.log(`   ${t.name} (${t.count})`);
    if (write) {
      const n = await saveBackfill(week, parsed);
      console.log(`   stored: ${n.themes} themes, ${n.questions} questions`);
    }
  }
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(`cc-backfill-digest-themes: ${err.code ? `code ${err.code}` : err.message}`);
} finally {
  await closePool();
}
process.exit(code);

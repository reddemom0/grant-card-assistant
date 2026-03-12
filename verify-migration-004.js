/**
 * Verify Migration 004 Results
 * Run after sync completes to check currently_accepting heuristic accuracy
 */

import pg from 'pg';
import { config } from 'dotenv';
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verifyMigration() {
  const client = await pool.connect();

  try {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  MIGRATION 004 VERIFICATION - currently_accepting Heuristic');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Query 1: Overall counts
    console.log('📊 QUERY 1: Overall Acceptance Status Counts\n');
    const q1 = await client.query(`
      SELECT
        currently_accepting,
        COUNT(*) as count
      FROM grants
      GROUP BY currently_accepting
      ORDER BY currently_accepting
    `);
    console.table(q1.rows);

    // Query 2: False positives (is_active=true but currently_accepting=false)
    console.log('\n⚠️  QUERY 2: False Positives Caught by Heuristic');
    console.log('(Grants marked active by GetGranted but flagged as closed by heuristic)\n');
    const q2 = await client.query(`
      SELECT
        grant_name,
        currently_accepting,
        is_active,
        LEFT(recently_changed, 100) as recently_changed_preview
      FROM grants
      WHERE is_active = true AND currently_accepting = false
      LIMIT 10
    `);
    console.table(q2.rows);

    const q2count = await client.query(`
      SELECT COUNT(*) as false_positives_caught
      FROM grants
      WHERE is_active = true AND currently_accepting = false
    `);
    console.log(`\nTotal false positives caught: ${q2count.rows[0].false_positives_caught}`);

    // Query 3: Exclusion reason breakdown
    console.log('\n📋 QUERY 3: Exclusion Reason Breakdown\n');
    const q3 = await client.query(`
      SELECT
        LEFT(exclusion_reason, 60) as exclusion_reason_preview,
        COUNT(*) as count
      FROM grants
      WHERE currently_accepting = false
      GROUP BY exclusion_reason
      ORDER BY count DESC
      LIMIT 10
    `);
    console.table(q3.rows);

    // Query 4: Recently updated grants that are accepting
    console.log('\n✅ QUERY 4: Recently Updated Active Grants (Top 10)\n');
    const q4 = await client.query(`
      SELECT
        grant_name,
        last_updated,
        currently_accepting,
        LEFT(recently_changed, 80) as recently_changed_preview
      FROM grants
      WHERE currently_accepting = true
      ORDER BY last_updated DESC NULLS LAST
      LIMIT 10
    `);
    console.table(q4.rows);

    // Query 5: Data freshness check
    console.log('\n📅 QUERY 5: Data Freshness\n');
    const q5 = await client.query(`
      SELECT
        MAX(extracted_at) as latest_extraction,
        MIN(extracted_at) as earliest_extraction,
        COUNT(*) as total_grants
      FROM grants
    `);
    console.table(q5.rows);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Verification Complete');
    console.log('═══════════════════════════════════════════════════════════\n');

  } finally {
    client.release();
    await pool.end();
  }
}

verifyMigration().catch(console.error);

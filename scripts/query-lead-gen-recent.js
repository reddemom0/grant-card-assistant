/**
 * Query recent lead-gen conversations with contact info
 * Usage: node scripts/query-lead-gen-recent.js
 */

import 'dotenv/config';
import { query } from '../src/database/connection.js';

async function queryRecentLeads() {
  try {
    const result = await query(`
      SELECT
        session_id,
        contact_name,
        contact_email,
        prospect_data,
        matched_programs,
        estimated_funding,
        cta_selected,
        created_at,
        message_count
      FROM lead_gen_conversations
      WHERE contact_email IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log('\n=== Recent Lead-Gen Conversations (with contact info) ===\n');

    if (result.rows.length === 0) {
      console.log('No conversations with contact info found.');
      return;
    }

    result.rows.forEach((row, idx) => {
      console.log(`${idx + 1}. ${row.contact_name} (${row.contact_email})`);
      console.log(`   Company: ${row.prospect_data?.company_name || 'N/A'}`);
      console.log(`   Province: ${row.prospect_data?.province || 'N/A'}`);
      console.log(`   Revenue: ${row.prospect_data?.revenue || 'N/A'}`);
      console.log(`   Employees: ${row.prospect_data?.employee_count || 'N/A'}`);
      console.log(`   Funding Estimate: ${row.estimated_funding || 'N/A'}`);
      console.log(`   Lead Score: ${row.prospect_data?.lead_score || 'N/A'}`);
      console.log(`   CTA Selected: ${row.cta_selected || 'N/A'}`);
      console.log(`   Programs Matched: ${row.matched_programs?.length || 0}`);
      if (row.matched_programs?.length > 0) {
        console.log(`     → ${row.matched_programs.join(', ')}`);
      }
      console.log(`   Message Count: ${row.message_count}`);
      console.log(`   Session ID: ${row.session_id}`);
      console.log(`   Created: ${row.created_at}`);
      console.log('');
    });

    console.log(`Total conversations with contact info: ${result.rows.length}\n`);
  } catch (err) {
    console.error('Query error:', err.message);
  } finally {
    process.exit(0);
  }
}

queryRecentLeads();

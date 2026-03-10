/**
 * Test eligibility tagging on 3 programs before batch tagging all 598
 */

import { Client } from 'pg';
import { config } from 'dotenv';
import { tagGrant } from './src/services/grant-tagger.js';

config();

async function testEligibilityTagger() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔌 Connecting to Railway database...\n');
    await client.connect();
    console.log('✅ Connected\n');

    // Test programs:
    // 1. CanExport SMEs - should require incorporation + revenue
    // 2. A student SWPP program - should require employer status
    // 3. A minimal-requirements program

    const testCases = [
      { name: 'CanExport SME', pattern: '%CanExport%SME%' },
      { name: 'Student SWPP', pattern: '%Student Work Placement%' },
      { name: 'Minimal Requirements', pattern: '%Mitacs Accelerate%' }
    ];

    for (const testCase of testCases) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📋 Testing: ${testCase.name}`);
      console.log(`${'='.repeat(80)}\n`);

      const result = await client.query(
        `SELECT grant_id, grant_name, grant_type, grant_amount, grant_criteria, program_provider, regions, industries
         FROM grants
         WHERE grant_name ILIKE $1
         LIMIT 1`,
        [testCase.pattern]
      );

      if (result.rows.length === 0) {
        console.log(`❌ No program found matching "${testCase.pattern}"\n`);
        continue;
      }

      const program = result.rows[0];
      console.log(`Grant: ${program.grant_name}`);
      console.log(`Type: ${program.grant_type}`);
      console.log(`Amount: ${program.grant_amount}`);
      console.log(`Provider: ${program.program_provider}\n`);

      console.log('🤖 Running tagger...\n');
      const tags = await tagGrant(program);

      if (!tags) {
        console.log('❌ Tagging failed\n');
        continue;
      }

      console.log('✅ Tags generated:\n');
      console.log(JSON.stringify(tags, null, 2));
      console.log('\n');

      // Validate eligibility structure
      if (tags.eligibility) {
        console.log('✅ Eligibility object present');
        console.log('   - requires_incorporation:', tags.eligibility.requires_incorporation);
        console.log('   - requires_revenue:', tags.eligibility.requires_revenue);
        console.log('   - requires_employer_status:', tags.eligibility.requires_employer_status);
        console.log('   - min_employees:', tags.eligibility.min_employees);
        console.log('   - requires_matching_funds:', tags.eligibility.requires_matching_funds);
      } else {
        console.log('❌ Missing eligibility object');
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('🎉 Eligibility tagger test complete');
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
    console.log('✅ Connection closed\n');
  }
}

testEligibilityTagger();

/**
 * Test smart tagging on a single grant program
 */

import { Client } from 'pg';
import { tagGrant } from './src/services/grant-tagger.js';
import { config } from 'dotenv';

// Load environment variables
config();

async function testSingleTag() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('🧪 Testing smart tagging on a single program\n');

    await client.connect();
    console.log('✅ Connected to database\n');

    // Get a single program (CanExport - SMEs)
    const result = await client.query(`
      SELECT
        id,
        grant_id,
        grant_name,
        grant_type,
        grant_amount,
        grant_criteria,
        program_provider,
        regions,
        industries
      FROM grants
      WHERE grant_name ILIKE '%CanExport%SME%'
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('❌ No programs found');
      return;
    }

    const program = result.rows[0];
    console.log('📋 Testing on program:', program.grant_name);
    console.log('   Amount:', program.grant_amount);
    console.log('   Type:', program.grant_type);
    console.log('');

    console.log('🤖 Calling Claude Haiku to generate tags...\n');
    const tags = await tagGrant(program);

    if (tags) {
      console.log('✅ Tags generated successfully:\n');
      console.log(JSON.stringify(tags, null, 2));
      console.log('');

      // Update database
      await client.query(
        `UPDATE grants SET smart_tags = $1 WHERE id = $2`,
        [JSON.stringify(tags), program.id]
      );

      console.log('✅ Tags saved to database');
    } else {
      console.log('❌ Failed to generate tags');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
    console.log('\n✅ Database connection closed');
  }
}

testSingleTag();

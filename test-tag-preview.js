/**
 * Preview smart tagging on a single grant program (no database write)
 */

import { Client } from 'pg';
import { tagGrant } from './src/services/grant-tagger.js';
import { config } from 'dotenv';

// Load environment variables
config();

async function previewTag() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('🧪 Previewing smart tags (no database writes)\n');

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
    console.log('📋 Program: ' + program.grant_name);
    console.log('   Amount: ' + program.grant_amount);
    console.log('   Type: ' + program.grant_type);
    console.log('   Provider: ' + program.program_provider);
    console.log('');

    console.log('🤖 Calling Claude Haiku to generate tags...\n');
    const startTime = Date.now();
    const tags = await tagGrant(program);
    const duration = Date.now() - startTime;

    if (tags) {
      console.log('✅ Tags generated successfully in ' + duration + 'ms:\n');
      console.log('━'.repeat(60));
      console.log(JSON.stringify(tags, null, 2));
      console.log('━'.repeat(60));
      console.log('');
      console.log('📊 Summary:');
      console.log('   Primary Intents: ' + tags.primary_intents.join(', '));
      console.log('   Genres: ' + tags.genres.join(', '));
      console.log('   Max Funding: $' + tags.max_funding_numeric.toLocaleString());
      console.log('   Specificity: ' + tags.specificity);
      console.log('   Complexity: ' + tags.complexity);
      console.log('   Target Populations: ' + tags.target_populations.join(', '));
      console.log('   Funding Model: ' + tags.funding_model);
      console.log('');
      console.log('💡 Not saving to database (preview only)');
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

previewTag();

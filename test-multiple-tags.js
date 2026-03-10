/**
 * Preview smart tagging on multiple grant programs (no database writes)
 */

import { Client } from 'pg';
import { tagGrant } from './src/services/grant-tagger.js';
import { config } from 'dotenv';

// Load environment variables
config();

async function previewMultipleTags() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('🧪 Previewing smart tags on multiple programs (no database writes)\n');

    await client.connect();
    console.log('✅ Connected to database\n');

    // Programs to test
    const programQueries = [
      {
        name: 'AgriTalent SWPP',
        query: `SELECT * FROM grants WHERE grant_name ILIKE '%AgriTalent%Student%' OR grant_name ILIKE '%SWPP%' LIMIT 1`
      },
      {
        name: 'Canada Alberta Productivity Grant (CAPG)',
        query: `SELECT * FROM grants WHERE grant_name ILIKE '%Canada Alberta%' OR grant_name ILIKE '%CAPG%' LIMIT 1`
      },
      {
        name: 'Employer Training Grant (ETG)',
        query: `SELECT * FROM grants WHERE grant_name ILIKE '%Employer Training Grant%' OR grant_name ILIKE '%ETG%' LIMIT 1`
      }
    ];

    for (const { name, query } of programQueries) {
      console.log('━'.repeat(80));
      console.log(`\n📋 Testing: ${name}\n`);

      const result = await client.query(query);

      if (result.rows.length === 0) {
        console.log(`❌ Program not found in database\n`);
        continue;
      }

      const program = result.rows[0];
      console.log(`   Program: ${program.grant_name}`);
      console.log(`   Amount: ${program.grant_amount}`);
      console.log(`   Type: ${program.grant_type}`);
      console.log(`   Provider: ${program.program_provider}`);
      console.log('');

      console.log('🤖 Calling Claude Haiku to generate tags...\n');
      const startTime = Date.now();
      const tags = await tagGrant(program);
      const duration = Date.now() - startTime;

      if (tags) {
        console.log(`✅ Tags generated in ${duration}ms:\n`);
        console.log(JSON.stringify(tags, null, 2));
        console.log('');
        console.log('📊 Summary:');
        console.log(`   Primary Intents: ${tags.primary_intents.join(', ')}`);
        console.log(`   Genres: ${tags.genres.join(', ')}`);
        console.log(`   Max Funding: $${tags.max_funding_numeric.toLocaleString()}`);
        console.log(`   Specificity: ${tags.specificity}`);
        console.log(`   Complexity: ${tags.complexity}`);
        console.log(`   Target Populations: ${tags.target_populations.join(', ') || '(none)'}`);
        console.log(`   Funding Model: ${tags.funding_model}`);
        console.log('');
      } else {
        console.log('❌ Failed to generate tags\n');
      }

      // Add delay between API calls
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('━'.repeat(80));
    console.log('\n💡 Not saving to database (preview only)');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
    console.log('\n✅ Database connection closed');
  }
}

previewMultipleTags();

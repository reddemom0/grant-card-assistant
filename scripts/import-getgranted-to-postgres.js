/**
 * Import GetGranted Data to Postgres
 *
 * Reads JSON export, generates embeddings, and imports to database
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import fetch from 'node-fetch';

config();

const { Pool } = pg;

// OpenAI API for embeddings (required)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

if (!OPENAI_API_KEY) {
  console.error('❌ Error: OPENAI_API_KEY environment variable not set');
  console.error('\nTo generate embeddings, you need an OpenAI API key.');
  console.error('Add to .env file: OPENAI_API_KEY=sk-...');
  console.error('\nGet one at: https://platform.openai.com/api-keys');
  process.exit(1);
}

async function generateEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000) // Limit to 8K characters
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function importGrants() {
  console.log('📥 Importing GetGranted data to Postgres...\n');

  // Read export file
  console.log('1️⃣ Reading export file...');
  const exportPath = path.join(process.cwd(), 'data', 'getgranted-full-details.json');
  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  console.log(`   Found ${exportData.total_grants} grants\n`);

  // Connect to database
  console.log('2️⃣ Connecting to database...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const client = await pool.connect();
    console.log('   ✅ Connected\n');

    // Clear existing data (optional - comment out to preserve)
    console.log('3️⃣ Clearing existing grants...');
    await client.query('DELETE FROM grants');
    console.log('   ✅ Table cleared\n');

    // Import grants with embeddings
    console.log('4️⃣ Importing grants with embeddings...');
    let imported = 0;
    let failed = 0;

    for (let i = 0; i < exportData.grants.length; i++) {
      const grant = exportData.grants[i];
      console.log(`\n   [${i + 1}/${exportData.grants.length}] ${grant.grant_name}...`);

      try {
        // Combine text for embedding
        const textForEmbedding = [
          grant.grant_name,
          grant.grant_type || '',
          grant.regions || '',
          grant.industries || '',
          grant.grant_criteria || '',
          grant.best_practices || ''
        ].join(' ').trim();

        // Generate embedding
        console.log('      Generating embedding...');
        const embedding = await generateEmbedding(textForEmbedding);

        // Insert into database
        console.log('      Inserting into database...');
        await client.query(`
          INSERT INTO grants (
            grant_id, grant_name, grant_type, grant_amount, url,
            regions, industries, program_provider, deadline,
            max_spend, contribution_percentage, difficulty,
            grant_criteria, best_practices, full_page_text,
            embedding, last_updated, extracted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `, [
          grant.grant_id,
          grant.grant_name,
          grant.grant_type,
          grant.grant_amount,
          grant.url,
          grant.regions,
          grant.industries,
          grant.program_provider,
          grant.deadline,
          grant.max_spend,
          grant.contribution_percentage,
          grant.difficulty,
          grant.grant_criteria,
          grant.best_practices,
          grant.full_page_text,
          `[${embedding.join(',')}]`, // Format as vector
          grant.last_updated,
          grant.extracted_at
        ]);

        imported++;
        console.log('      ✅ Imported');

        // Rate limiting (OpenAI has limits)
        if (i < exportData.grants.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
        }

        // Progress indicator
        if ((i + 1) % 10 === 0) {
          console.log(`\n   📊 Progress: ${i + 1}/${exportData.grants.length} (${Math.round((i + 1) / exportData.grants.length * 100)}%)`);
        }

      } catch (error) {
        console.error(`      ❌ Failed: ${error.message}`);
        failed++;
      }
    }

    client.release();

    console.log('\n\n📊 Import Summary:');
    console.log(`   Total grants: ${exportData.grants.length}`);
    console.log(`   Imported: ${imported}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Success rate: ${Math.round(imported / exportData.grants.length * 100)}%`);

    // Verify import
    console.log('\n5️⃣ Verifying import...');
    const verifyClient = await pool.connect();
    const result = await verifyClient.query('SELECT COUNT(*) as count FROM grants');
    console.log(`   Database contains ${result.rows[0].count} grants`);

    const withEmbeddings = await verifyClient.query('SELECT COUNT(*) as count FROM grants WHERE embedding IS NOT NULL');
    console.log(`   ${withEmbeddings.rows[0].count} grants have embeddings`);

    verifyClient.release();

    console.log('\n✅ Import complete!');

  } catch (error) {
    console.error('❌ Import failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

importGrants()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

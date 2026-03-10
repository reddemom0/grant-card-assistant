/**
 * Export smart_tags from Neon database to JSON file
 * Then we can import this into Railway
 */

import { Client } from 'pg';
import { writeFileSync } from 'fs';
import { config } from 'dotenv';

config();

async function exportTags() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔍 Connecting to Neon database...\n');
    await client.connect();
    console.log('✅ Connected\n');

    console.log('📥 Fetching all smart_tags...\n');
    const result = await client.query(`
      SELECT grant_id, smart_tags
      FROM grants
      WHERE smart_tags IS NOT NULL
      ORDER BY grant_id
    `);

    console.log(`✅ Found ${result.rows.length} grants with tags\n`);

    // Write to JSON file
    const output = {
      exported_at: new Date().toISOString(),
      total_count: result.rows.length,
      tags: result.rows
    };

    writeFileSync('smart-tags-export.json', JSON.stringify(output, null, 2));

    console.log('✅ Exported to smart-tags-export.json');
    console.log(`   File size: ${(JSON.stringify(output).length / 1024).toFixed(1)} KB\n`);

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
    console.log('✅ Connection closed');
  }
}

exportTags();

/**
 * Check if smart_tags column exists in Railway production database
 */

import { Client } from 'pg';
import { config } from 'dotenv';

config();

async function checkSmartTagsColumn() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('🔍 Connecting to Railway production database...\n');
    await client.connect();
    console.log('✅ Connected\n');

    // Check if smart_tags column exists
    console.log('📊 Checking for smart_tags column in grants table...\n');
    const columnCheck = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'grants' AND column_name = 'smart_tags'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('❌ Column smart_tags does NOT exist in grants table\n');
      console.log('🔧 Running migration to add smart_tags column...\n');

      await client.query(`
        ALTER TABLE grants
        ADD COLUMN IF NOT EXISTS smart_tags JSONB DEFAULT NULL
      `);

      console.log('✅ Migration complete - smart_tags column added\n');

      // Verify it was added
      const verifyCheck = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'grants' AND column_name = 'smart_tags'
      `);

      console.log('📋 Column details:', verifyCheck.rows[0]);

    } else {
      console.log('✅ Column smart_tags EXISTS in grants table\n');
      console.log('📋 Column details:', columnCheck.rows[0]);

      // Check if any records have smart_tags populated
      const dataCheck = await client.query(`
        SELECT
          COUNT(*) as total_grants,
          COUNT(smart_tags) as grants_with_tags,
          ROUND(100.0 * COUNT(smart_tags) / COUNT(*), 2) as percentage_tagged
        FROM grants
      `);

      console.log('\n📊 Smart tags data status:');
      console.log(`   Total grants: ${dataCheck.rows[0].total_grants}`);
      console.log(`   Grants with tags: ${dataCheck.rows[0].grants_with_tags}`);
      console.log(`   Percentage tagged: ${dataCheck.rows[0].percentage_tagged}%`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.end();
    console.log('\n✅ Database connection closed');
  }
}

checkSmartTagsColumn();

/**
 * Add smart_tags column to Railway production database
 * Run this with: railway run node add-smart-tags-railway.js
 */

import { Client } from 'pg';

async function addSmartTagsColumn() {
  // Use DATABASE_URL which is what the search function uses
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔍 Connecting to database using DATABASE_URL...\n');
    await client.connect();
    console.log('✅ Connected\n');

    // Check if smart_tags column exists
    console.log('📊 Checking for smart_tags column...\n');
    const columnCheck = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'grants' AND column_name = 'smart_tags'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('❌ Column smart_tags does NOT exist\n');
      console.log('🔧 Adding smart_tags column...\n');

      await client.query(`
        ALTER TABLE grants
        ADD COLUMN smart_tags JSONB DEFAULT NULL
      `);

      console.log('✅ Column added successfully\n');

      // Create GIN index for performance
      console.log('🔧 Creating GIN index on smart_tags...\n');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_grants_smart_tags
        ON grants USING gin(smart_tags)
      `);

      console.log('✅ Index created successfully\n');

    } else {
      console.log('✅ Column smart_tags already exists\n');
      console.log('   Type:', columnCheck.rows[0].data_type);

      // Check data
      const dataCheck = await client.query(`
        SELECT
          COUNT(*) as total,
          COUNT(smart_tags) as tagged
        FROM grants
      `);

      console.log(`\n📊 Data status:`);
      console.log(`   Total grants: ${dataCheck.rows[0].total}`);
      console.log(`   Tagged: ${dataCheck.rows[0].tagged}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.end();
    console.log('\n✅ Connection closed');
  }
}

addSmartTagsColumn();

/**
 * Copy learning memory files from STAGING to PRODUCTION
 */

import pg from 'pg';
const { Pool } = pg;

// STAGING DATABASE (source)
const stagingPool = new Pool({
  connectionString: 'postgresql://postgres:tRutpbSXaKwzTsZxMBmMeOKSGdscsWIY@shinkansen.proxy.rlwy.net:19092/railway',
  ssl: { rejectUnauthorized: false }
});

// PRODUCTION DATABASE (destination)
const prodPool = new Pool({
  connectionString: 'postgresql://postgres:bDLYkwkUCxbuOHawZJMNxUQOroBzeJGN@nozomi.proxy.rlwy.net:16552/railway',
  ssl: { rejectUnauthorized: false }
});

async function copyLearningFiles() {
  const stagingClient = await stagingPool.connect();
  const prodClient = await prodPool.connect();

  try {
    console.log('📋 Copying learning files from STAGING to PRODUCTION...\n');

    // 1. Get all learning files from staging
    const stagingFiles = await stagingClient.query(`
      SELECT agent_type, file_name, content, updated_at
      FROM learning_memory_files
      ORDER BY agent_type, file_name
    `);

    console.log(`📦 Found ${stagingFiles.rows.length} files in staging\n`);

    if (stagingFiles.rows.length === 0) {
      console.log('ℹ️  No files to copy');
      return;
    }

    // 2. Copy each file to production
    let successCount = 0;
    for (const file of stagingFiles.rows) {
      try {
        await prodClient.query(
          `INSERT INTO learning_memory_files (
            agent_type,
            file_name,
            content,
            updated_at
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (agent_type, file_name)
          DO UPDATE SET
            content = EXCLUDED.content,
            updated_at = EXCLUDED.updated_at`,
          [file.agent_type, file.file_name, file.content, file.updated_at]
        );

        console.log(`✓ Copied: ${file.agent_type}/${file.file_name} (${file.content.length} bytes)`);
        successCount++;
      } catch (error) {
        console.error(`✗ Failed to copy ${file.agent_type}/${file.file_name}:`, error.message);
      }
    }

    console.log(`\n✅ Successfully copied ${successCount}/${stagingFiles.rows.length} files to production`);

    // 3. Verify production has the files
    const prodCount = await prodClient.query('SELECT COUNT(*) FROM learning_memory_files');
    console.log(`\n📊 Production database now has ${prodCount.rows[0].count} learning files`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    stagingClient.release();
    prodClient.release();
    await stagingPool.end();
    await prodPool.end();
  }
}

copyLearningFiles();

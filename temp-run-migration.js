import pg from 'pg';
import fs from 'fs';

const { Pool } = pg;

async function runMigration() {
  console.log('DATABASE_URL host:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'NOT SET');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const migrationSQL = fs.readFileSync('migrations/003_add_recently_changed.sql', 'utf-8');

    console.log('Running migration...');

    await pool.query(migrationSQL);

    console.log('Migration applied successfully');

    // Verify
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'grants' AND column_name = 'recently_changed'
    `);

    console.log('Column exists:', result.rows.length > 0);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();

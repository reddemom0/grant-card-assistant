import pg from 'pg';
import { readFileSync } from 'fs';

const { Client } = pg;

// Use POSTGRES_URL (public) instead of DATABASE_URL (internal)
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ No POSTGRES_URL or DATABASE_URL found');
  process.exit(1);
}

console.log('🔌 Connecting to database...');
const client = new Client({ connectionString });

try {
  await client.connect();
  console.log('✅ Connected');

  const sql = readFileSync('migrations/013_lead_gen_finalization.sql', 'utf-8');

  console.log('\n🔄 Running migration 013...\n');
  await client.query(sql);
  console.log('✅ Migration 013 completed successfully\n');

  // Verify columns exist
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'lead_gen_conversations'
    AND column_name IN ('last_activity_at', 'finalized', 'finalized_at', 'finalization_trigger')
    ORDER BY column_name
  `);

  console.log('✅ Verified columns exist:');
  result.rows.forEach(r => console.log(`   - ${r.column_name}`));

} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}

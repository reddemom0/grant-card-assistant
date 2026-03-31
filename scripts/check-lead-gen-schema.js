import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL or POSTGRES_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  const client = await pool.connect();

  try {
    // First, list all tables
    console.log('=== ALL TABLES IN DATABASE ===\n');
    const tablesQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    const tablesResult = await client.query(tablesQuery);
    console.log('Tables found:', tablesResult.rows.map(r => r.table_name).join(', '));
    console.log('\n');

    console.log('=== LEAD_GEN_CONVERSATIONS SCHEMA ===\n');

    // Get schema
    const schemaQuery = `
      SELECT
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'lead_gen_conversations'
      ORDER BY ordinal_position;
    `;

    const schemaResult = await client.query(schemaQuery);

    if (schemaResult.rows.length === 0) {
      console.log('⚠️  Table does not exist!\n');
      return;
    }

    console.log('Column Name                  | Data Type        | Max Length | Nullable | Default');
    console.log('---------------------------- | ---------------- | ---------- | -------- | -------');
    schemaResult.rows.forEach(row => {
      console.log(
        `${row.column_name.padEnd(28)} | ${row.data_type.padEnd(16)} | ${String(row.character_maximum_length || '-').padEnd(10)} | ${row.is_nullable.padEnd(8)} | ${row.column_default || '-'}`
      );
    });

    console.log('\n\n=== CONVERSATION STATISTICS ===\n');

    // Get statistics
    const statsQuery = `
      SELECT
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN finalized THEN 1 END) as finalized,
        COUNT(CASE WHEN message_count >= 1 THEN 1 END) as had_messages,
        ROUND(AVG(message_count), 2) as avg_messages,
        COUNT(CASE WHEN contact_email IS NOT NULL THEN 1 END) as captured_email
      FROM lead_gen_conversations;
    `;

    const statsResult = await client.query(statsQuery);
    const stats = statsResult.rows[0];
    console.log(`Total Sessions:        ${stats.total_sessions}`);
    console.log(`Finalized:             ${stats.finalized} (${((stats.finalized / stats.total_sessions) * 100).toFixed(1)}%)`);
    console.log(`Had Messages:          ${stats.had_messages}`);
    console.log(`Average Messages:      ${stats.avg_messages}`);
    console.log(`Captured Email:        ${stats.captured_email}`);

    console.log('\n\n=== FINALIZATION TRIGGER BREAKDOWN ===\n');

    // Get finalization triggers
    const triggersQuery = `
      SELECT
        COALESCE(finalization_trigger, 'NULL') as trigger,
        COUNT(*) as count
      FROM lead_gen_conversations
      WHERE finalized = true
      GROUP BY finalization_trigger
      ORDER BY count DESC;
    `;

    const triggersResult = await client.query(triggersQuery);
    console.log('Trigger              | Count');
    console.log('-------------------- | -----');
    triggersResult.rows.forEach(row => {
      console.log(`${row.trigger.padEnd(20)} | ${row.count}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSchema();

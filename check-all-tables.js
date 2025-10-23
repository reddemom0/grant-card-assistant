import { Pool } from 'pg';
import { config } from 'dotenv';

config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  // Get all tables
  const tablesResult = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  console.log('\n📊 ALL TABLES IN DATABASE');
  console.log('='.repeat(80));

  for (const table of tablesResult.rows) {
    const tableName = table.table_name;
    console.log(`\n📋 ${tableName}:`);

    // Get columns for this table
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    columnsResult.rows.forEach(row => {
      const name = String(row.column_name).padEnd(25);
      const type = String(row.data_type).padEnd(30);
      const nullable = row.is_nullable;
      console.log(`   ${name} ${type} nullable: ${nullable}`);
    });
  }

  console.log('\n' + '='.repeat(80) + '\n');

  await pool.end();
} catch (error) {
  console.error('Error:', error.message);
  await pool.end();
  process.exit(1);
}

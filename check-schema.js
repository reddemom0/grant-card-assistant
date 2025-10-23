import { Pool } from 'pg';
import { config } from 'dotenv';

config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  // Check conversations table schema
  const convResult = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'conversations'
    ORDER BY ordinal_position
  `);

  console.log('\n📊 CONVERSATIONS table:');
  console.log('='.repeat(80));
  convResult.rows.forEach(row => {
    const name = String(row.column_name).padEnd(20);
    const type = String(row.data_type).padEnd(25);
    const nullable = row.is_nullable;
    const def = row.column_default || 'none';
    console.log(`  ${name} ${type} nullable: ${nullable}  default: ${def}`);
  });
  console.log('='.repeat(80));

  // Check messages table schema
  const msgResult = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'messages'
    ORDER BY ordinal_position
  `);

  console.log('\n📊 MESSAGES table:');
  console.log('='.repeat(80));
  if (msgResult.rows.length > 0) {
    msgResult.rows.forEach(row => {
      const name = String(row.column_name).padEnd(20);
      const type = String(row.data_type).padEnd(25);
      const nullable = row.is_nullable;
      const def = row.column_default || 'none';
      console.log(`  ${name} ${type} nullable: ${nullable}  default: ${def}`);
    });
  } else {
    console.log('  (table does not exist)');
  }
  console.log('='.repeat(80) + '\n');

  await pool.end();
} catch (error) {
  console.error('Error:', error.message);
  await pool.end();
  process.exit(1);
}

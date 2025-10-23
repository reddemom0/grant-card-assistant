import { Pool } from 'pg';
import { config } from 'dotenv';

config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  // Check all constraints on conversations table
  const result = await pool.query(`
    SELECT
      con.conname AS constraint_name,
      con.contype AS constraint_type,
      CASE con.contype
        WHEN 'c' THEN 'CHECK'
        WHEN 'f' THEN 'FOREIGN KEY'
        WHEN 'p' THEN 'PRIMARY KEY'
        WHEN 'u' THEN 'UNIQUE'
        WHEN 't' THEN 'TRIGGER'
        WHEN 'x' THEN 'EXCLUSION'
      END AS constraint_type_desc,
      pg_get_constraintdef(con.oid) AS constraint_definition
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'conversations'
      AND nsp.nspname = 'public'
    ORDER BY con.contype, con.conname;
  `);

  console.log('\n📊 CONSTRAINTS on conversations table:');
  console.log('='.repeat(80));

  if (result.rows.length === 0) {
    console.log('  (no constraints found)');
  } else {
    result.rows.forEach(row => {
      console.log(`\n  ${row.constraint_name} (${row.constraint_type_desc}):`);
      console.log(`    ${row.constraint_definition}`);
    });
  }

  console.log('\n' + '='.repeat(80) + '\n');

  await pool.end();
} catch (error) {
  console.error('Error:', error.message);
  await pool.end();
  process.exit(1);
}

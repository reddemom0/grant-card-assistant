import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function getAllIndustries() {
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        trim(unnest(string_to_array(REPLACE(industries, E'Industries\\n      ', ''), ','))) as industry
      FROM grants
      WHERE industries IS NOT NULL
        AND industries != ''
        AND industries != 'null'
      ORDER BY industry
    `);

    console.log('\n=== ALL DATABASE INDUSTRIES (CLEANED) ===\n');
    console.log(`Total: ${result.rows.length} distinct values\n`);

    result.rows.forEach((row, i) => {
      console.log(`${i + 1}. "${row.industry}"`);
    });

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

getAllIndustries();

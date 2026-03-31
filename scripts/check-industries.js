import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkIndustries() {
  const client = await pool.connect();

  try {
    console.log('📊 Sample industries from grants table:\n');

    const result = await client.query(`
      SELECT grant_name, industries
      FROM grants
      WHERE industries IS NOT NULL AND industries != ''
      LIMIT 10
    `);

    result.rows.forEach((row, idx) => {
      console.log(`${idx + 1}. ${row.grant_name}`);
      console.log(`   Industries: ${row.industries}\n`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkIndustries();

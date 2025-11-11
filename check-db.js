import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkData() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, agent_type, files_loaded, pg_typeof(files_loaded) as column_type FROM learning_applications LIMIT 1'
    );
    
    if (result.rows.length > 0) {
      console.log('Raw database row:');
      console.log(JSON.stringify(result.rows[0], null, 2));
      console.log('\nfiles_loaded type:', typeof result.rows[0].files_loaded);
      console.log('files_loaded value:', result.rows[0].files_loaded);
    } else {
      console.log('No rows found');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

checkData().catch(console.error);

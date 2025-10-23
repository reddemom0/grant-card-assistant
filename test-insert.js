import { Pool } from 'pg';
import { config } from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  const testId = uuidv4();

  console.log('\n🧪 Testing direct INSERT with NULL user_id...');
  console.log('='.repeat(60));

  const result = await pool.query(
    `INSERT INTO conversations (id, user_id, agent_type, title)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [testId, null, 'test-agent', 'Test conversation']
  );

  console.log('✅ INSERT successful!');
  console.log('Result:', result.rows[0]);

  // Clean up
  await pool.query('DELETE FROM conversations WHERE id = $1', [testId]);
  console.log('✅ Test row cleaned up');
  console.log('='.repeat(60) + '\n');

  await pool.end();
} catch (error) {
  console.error('❌ INSERT failed:', error.message);
  console.error('Error code:', error.code);
  console.error('Detail:', error.detail);
  await pool.end();
  process.exit(1);
}

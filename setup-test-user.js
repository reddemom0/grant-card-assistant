import pg from 'pg';
import { config } from 'dotenv';

config();

const { Client } = pg;

async function setupTestUser() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('🔌 Connected to database\n');

    // Check if any users exist
    const userCheck = await client.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(userCheck.rows[0].count);

    console.log(`📊 Current users in database: ${userCount}`);

    if (userCount === 0) {
      console.log('\n📝 Creating test user...');

      const result = await client.query(`
        INSERT INTO users (google_id, email, name, picture, created_at, last_login)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id, email, name
      `, [
        'test-google-id-123',
        'test@grantedconsulting.com',
        'Test User',
        'https://via.placeholder.com/150'
      ]);

      console.log('✅ Test user created:', {
        id: result.rows[0].id,
        email: result.rows[0].email,
        name: result.rows[0].name
      });
    } else {
      // Show existing users
      const users = await client.query('SELECT id, email, name FROM users LIMIT 5');
      console.log('\n👥 Existing users:');
      users.rows.forEach(user => {
        console.log(`  - ID: ${user.id}, Email: ${user.email}, Name: ${user.name}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n✅ Done');
  }
}

setupTestUser();

import pg from 'pg';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

// Load environment variables
config();

const { Client } = pg;

async function applySchema() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔌 Connecting to Railway PostgreSQL...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read schema file
    const schema = readFileSync('database-schema-railway.sql', 'utf8');
    
    console.log('📋 Applying schema...');
    await client.query(schema);
    
    console.log('✅ Schema applied successfully!\n');
    
    // Verify tables were created
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('📊 Tables in database:');
    result.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('❌ Error applying schema:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n✅ Database connection closed');
  }
}

applySchema();

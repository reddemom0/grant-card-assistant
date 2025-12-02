// Migration: Add Agent Performance Metrics Schema
// Run with: node migrations/add-agent-metrics-schema.js

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🚀 Starting agent metrics schema migration...');

    // Read the schema file
    const schemaPath = path.join(__dirname, '..', 'database-schema-agent-metrics.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Execute the schema
    await client.query('BEGIN');

    console.log('📊 Creating feedback_tags table...');
    console.log('📊 Creating agent_evaluations table...');
    console.log('📊 Creating agent_metrics_daily table...');
    console.log('📊 Adding workflow tracking columns to conversations...');
    console.log('📊 Adding instruction tracking columns to messages...');
    console.log('📊 Creating views and functions...');
    console.log('📊 Setting up triggers...');

    await client.query(schemaSql);

    await client.query('COMMIT');

    console.log('✅ Agent metrics schema migration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Start tagging feedback with structured tags');
    console.log('2. Metrics will auto-calculate via triggers');
    console.log('3. Access agent_metrics_daily table for quality scores');
    console.log('4. Use agent_performance_summary view for quick overview');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runMigration };

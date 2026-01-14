/**
 * Admin API: Apply GetGranted Schema
 * Accessible only to authenticated users
 * Applies the GetGranted database schema
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🔧 Applying GetGranted schema...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5
  });

  try {
    const client = await pool.connect();

    // Read schema file
    const schemaPath = path.join(__dirname, '..', 'migrations', '002_getgranted_full_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    console.log('1. Enabling pgvector...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

    console.log('2. Applying schema...');
    await client.query(schema);

    console.log('3. Verifying...');
    const result = await client.query(`
      SELECT COUNT(*) as column_count
      FROM information_schema.columns
      WHERE table_name = 'grants';
    `);

    const columnCount = parseInt(result.rows[0].column_count);

    const indexes = await client.query(`
      SELECT COUNT(*) as index_count
      FROM pg_indexes
      WHERE tablename = 'grants';
    `);

    const indexCount = parseInt(indexes.rows[0].index_count);

    client.release();
    await pool.end();

    console.log('✅ Schema applied successfully');

    res.status(200).json({
      success: true,
      message: 'Schema applied successfully',
      details: {
        columns: columnCount,
        indexes: indexCount
      }
    });

  } catch (error) {
    console.error('❌ Schema application failed:', error);
    await pool.end();

    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  }
}

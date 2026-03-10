/**
 * Migration endpoint to add smart_tags column to Railway database
 * Deploy this, then call GET /migrate-smart-tags to execute
 */

import express from 'express';
import { Client } from 'pg';

const app = express();

app.get('/migrate-smart-tags', async (req, res) => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    // Step 1: Add column if it doesn't exist
    await client.query(`
      ALTER TABLE grants
      ADD COLUMN IF NOT EXISTS smart_tags JSONB DEFAULT NULL
    `);

    // Step 2: Create index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_grants_smart_tags
      ON grants USING gin(smart_tags)
    `);

    // Step 3: Check status
    const result = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(smart_tags) as tagged
      FROM grants
    `);

    await client.end();

    res.json({
      success: true,
      message: 'Migration complete',
      stats: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Migration endpoint running on port ${PORT}`);
});

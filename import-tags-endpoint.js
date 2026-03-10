/**
 * HTTP endpoint to import smart_tags into Railway database
 * Add this to server.js or deploy separately
 */

import express from 'express';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const app = express();

app.get('/import-smart-tags', async (req, res) => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('📥 Starting smart_tags import...\n');

    // Read exported tags
    const data = JSON.parse(readFileSync('smart-tags-export.json', 'utf8'));
    console.log(`📊 Loaded ${data.total_count} tags from export file\n`);

    await client.connect();
    console.log('✅ Connected to database\n');

    let imported = 0;
    let failed = 0;

    for (const row of data.tags) {
      try {
        const result = await client.query(
          'UPDATE grants SET smart_tags = $1 WHERE grant_id = $2',
          [row.smart_tags, row.grant_id]
        );

        if (result.rowCount > 0) {
          imported++;
        } else {
          failed++;
        }

        if (imported % 50 === 0) {
          console.log(`   Progress: ${imported}/${data.total_count}`);
        }

      } catch (error) {
        failed++;
        console.error(`❌ Error importing grant ${row.grant_id}:`, error.message);
      }
    }

    await client.end();

    const summary = {
      success: true,
      imported,
      failed,
      total: data.total_count
    };

    console.log(`\n✅ Import complete:`, summary);

    res.json(summary);

  } catch (error) {
    console.error('❌ Import failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Import endpoint ready on port ${PORT}`);
  console.log(`Trigger: GET /import-smart-tags`);
});

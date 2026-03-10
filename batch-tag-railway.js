/**
 * One-time script to batch tag all grants in Railway database
 * Deploy this, then trigger via: curl https://grant-card-assistant-production.up.railway.app/batch-tag-now
 */

import express from 'express';
import { Client } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { tagGrant } from './src/services/grant-tagger.js';

const app = express();

// Single endpoint to trigger batch tagging
app.get('/batch-tag-now', async (req, res) => {
  // Send immediate response to avoid timeout
  res.json({
    status: 'started',
    message: 'Batch tagging started in background. Check logs for progress.',
  });

  // Run batch tagging in background
  setTimeout(() => batchTagAllGrants(), 100);
});

async function batchTagAllGrants() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    console.log('🚀 Starting Railway batch tagging...\n');
    await client.connect();
    console.log('✅ Connected to Railway database\n');

    // Get all grants
    const result = await client.query('SELECT * FROM grants ORDER BY grant_id');
    const grants = result.rows;

    console.log(`📊 Found ${grants.total} grants to tag\n`);

    let tagged = 0;
    let failed = 0;
    const startTime = Date.now();

    for (const grant of grants) {
      try {
        const tags = await tagGrant(grant);

        if (tags) {
          await client.query(
            'UPDATE grants SET smart_tags = $1 WHERE grant_id = $2',
            [JSON.stringify(tags), grant.grant_id]
          );

          tagged++;

          if (tagged % 10 === 0) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const rate = (tagged / elapsed) * 60;
            const remaining = grants.length - tagged;
            const eta = Math.round(remaining / rate);

            console.log(`✅ Progress: ${tagged}/${grants.length} (${Math.round(tagged/grants.length*100)}%) - ${rate.toFixed(1)}/min - ETA ${eta}min`);
          }
        } else {
          failed++;
          console.warn(`❌ Failed to tag: ${grant.grant_name}`);
        }

        // Rate limit: 1 second between calls
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        failed++;
        console.error(`❌ Error tagging ${grant.grant_name}:`, error.message);
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000 / 60);
    console.log(`\n✅ Batch tagging complete!`);
    console.log(`   Tagged: ${tagged}/${grants.length}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Duration: ${duration} minutes`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await client.end();
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Batch tagger endpoint ready on port ${PORT}`);
  console.log(`Trigger with: GET /batch-tag-now`);
});

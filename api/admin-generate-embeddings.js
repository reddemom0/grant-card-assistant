/**
 * Admin endpoint to generate vector embeddings for GetGranted grants
 *
 * GET /api/admin-generate-embeddings?secret=<JWT_SECRET>
 */

import 'dotenv/config';
import { VoyageAIClient } from 'voyageai';
import pg from 'pg';
const { Pool } = pg;

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

export default async function handler(req, res) {
  // Require JWT secret for authentication
  const secret = req.query.secret;
  if (secret !== process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const stats = { total: 0, processed: 0, errors: [], cost: 0 };

    // Fetch all active grants
    const result = await pool.query(`
      SELECT grant_id, grant_name, grant_type, grant_amount,
             regions, industries, program_provider, deadline,
             grant_criteria, best_practices, is_active
      FROM grants
      WHERE is_active = true AND embedding IS NULL
      ORDER BY grant_id::integer
      LIMIT 100
    `);

    stats.total = result.rows.length;

    // Process each grant
    for (const grant of result.rows) {
      try {
        // Build searchable text
        const parts = [
          grant.grant_name,
          grant.grant_type ? `Type: ${grant.grant_type}` : '',
          grant.program_provider ? `Provider: ${grant.program_provider}` : '',
          grant.regions ? `Regions: ${grant.regions}` : '',
          grant.industries ? `Industries: ${grant.industries}` : '',
          grant.grant_criteria ? `Criteria: ${grant.grant_criteria.slice(0, 2000)}` : '',
          grant.best_practices ? `Best Practices: ${grant.best_practices.slice(0, 1000)}` : ''
        ].filter(Boolean);

        const text = parts.join('\n\n');

        // Generate embedding
        const response = await voyage.embed({
          input: text,
          model: 'voyage-3'
        });

        const embedding = response.data[0].embedding;
        const estimatedTokens = text.split(' ').length / 0.75;
        stats.cost += (estimatedTokens / 1000000) * 0.10;

        // Update database
        await pool.query(
          'UPDATE grants SET embedding = $1, updated_at = NOW() WHERE grant_id = $2',
          [JSON.stringify(embedding), grant.grant_id]
        );

        stats.processed++;

      } catch (error) {
        stats.errors.push({ grant_id: grant.grant_id, error: error.message });
      }
    }

    await pool.end();

    res.json({
      success: true,
      stats: {
        processed: stats.processed,
        total: stats.total,
        errors: stats.errors.length,
        cost: `$${stats.cost.toFixed(4)}`
      },
      errors: stats.errors.slice(0, 5)
    });

  } catch (error) {
    console.error('Embedding generation error:', error);
    await pool.end();
    res.status(500).json({ error: error.message });
  }
}

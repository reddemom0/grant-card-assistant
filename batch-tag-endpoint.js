/**
 * HTTP endpoint to trigger batch re-tagging of all grants
 * GET /batch-retag-grants
 */

import express from 'express';
import { Client } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const app = express();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Import the tagGrant function
async function tagGrant(program) {
  try {
    const prompt = `You are a grant categorization specialist. Analyze this grant program and return ONLY a JSON object with structured tags.

CRITICAL: You MUST select values ONLY from the provided lists below. Do not create new values. Do not rephrase. Copy exact strings from the lists below.

Grant Program:
Name: ${program.grant_name}
Type: ${program.grant_type || 'N/A'}
Amount: ${program.grant_amount || 'N/A'}
Criteria: ${program.grant_criteria || 'N/A'}
Provider: ${program.program_provider || 'N/A'}
Regions: ${program.regions || 'N/A'}
Industries: ${program.industries || 'N/A'}

Return a JSON object with these fields (including the new eligibility object):

{
  "primary_intents": [array of 1-3 strings from: "Talent", "Technology", "Capital", "Innovation", "Markets", "Markets_Domestic", "Sustainability", "Operations", "Growth", "Foundational", "Startups"],
  "genres": [array of 1-3 strings - exact matches only],
  "max_funding_numeric": number,
  "specificity": string ("broad", "targeted", or "niche"),
  "complexity": string ("simple", "moderate", or "complex"),
  "target_populations": [array - "Youth", "Students", "Indigenous", "Women", "Newcomers", "Persons with Disabilities", "Francophone", "Veterans", "Rural", "Black-owned"],
  "funding_model": string ("reimbursement", "wage_subsidy", "grant", "tax_credit", "loan", or "mixed"),
  "eligibility": {
    "requires_incorporation": boolean (true if program explicitly requires incorporated business, nonprofit, or charity structure),
    "requires_revenue": boolean (true if program requires the business to have existing revenue/sales),
    "requires_employer_status": boolean (true if program requires having employees - e.g., wage subsidy programs),
    "min_employees": number or null (minimum number of employees required, null if no minimum),
    "requires_matching_funds": boolean (true if program requires business to contribute matching funds)
  }
}

Return ONLY the JSON object. No explanation, no markdown code blocks.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text.trim();
    let jsonText = responseText;
    if (responseText.startsWith('```')) {
      jsonText = responseText.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    }

    const tags = JSON.parse(jsonText);
    return tags;
  } catch (error) {
    console.error(`Error tagging grant ${program.grant_name}:`, error.message);
    return null;
  }
}

app.get('/batch-retag-grants', async (req, res) => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🚀 Starting batch re-tagging process...\n');
    res.write('🚀 Starting batch re-tagging process...\n\n');

    await client.connect();
    console.log('✅ Connected to database\n');
    res.write('✅ Connected to database\n\n');

    // Get all grants
    const result = await client.query('SELECT * FROM grants ORDER BY grant_id');
    const grants = result.rows;

    console.log(`📊 Found ${grants.length} grants to tag\n`);
    res.write(`📊 Found ${grants.length} grants to tag\n\n`);

    let tagged = 0;
    let failed = 0;

    for (const grant of grants) {
      try {
        const tags = await tagGrant(grant);

        if (tags && tags.eligibility) {
          await client.query(
            'UPDATE grants SET smart_tags = $1 WHERE grant_id = $2',
            [tags, grant.grant_id]
          );
          tagged++;

          if (tagged % 50 === 0) {
            const progress = `   Progress: ${tagged}/${grants.length} (${((tagged / grants.length) * 100).toFixed(1)}%)\n`;
            console.log(progress);
            res.write(progress);
          }
        } else {
          failed++;
          console.warn(`⚠️  Failed to tag: ${grant.grant_name}`);
        }
      } catch (error) {
        failed++;
        console.error(`❌ Error tagging ${grant.grant_name}:`, error.message);
      }
    }

    await client.end();

    const summary = `\n✅ Batch re-tagging complete!\n   Tagged: ${tagged}\n   Failed: ${failed}\n   Total: ${grants.length}\n`;
    console.log(summary);
    res.write(summary);
    res.end();

  } catch (error) {
    console.error('❌ Batch re-tagging failed:', error);
    res.status(500).write(`❌ Error: ${error.message}\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Batch retag endpoint ready on port ${PORT}`);
  console.log(`Trigger: GET /batch-retag-grants`);
});

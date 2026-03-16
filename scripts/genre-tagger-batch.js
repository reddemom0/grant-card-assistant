/**
 * Genre Tagger - Building Bench of Talent
 *
 * Scores all currently accepting grants against "Building Bench of Talent" genres.
 * Uses Haiku for cost efficiency, outputs to JSON + XLSX + proposed genres.
 * Stores results in genre_scores JSONB column (separate from smart_tags).
 */

import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const { Pool } = pg;

// Genre definitions for "Building Bench of Talent" smart filter
const TALENT_GENRES = {
  hiring: {
    name: 'Hiring',
    definition: 'Funding supports hiring a new employee or intern',
    when_to_use: 'Use when the grant requires creating a new position or placement'
  },
  wage_subsidy: {
    name: 'Wage subsidy',
    definition: "Program reimburses part of the employee's wages during the placement",
    when_to_use: 'Use when funding is based on a percentage or fixed amount of salary'
  },
  student_coop: {
    name: 'Student/Co-op Intern',
    definition: 'Placement must be filled by a student or co-op participant enrolled in an educational program',
    when_to_use: 'Use when eligibility requires the candidate to be an active student'
  },
  training: {
    name: 'Training',
    definition: 'Funding supports skills development, courses, or workforce training',
    when_to_use: 'Use when funding covers training costs, certification, or skill development'
  },
  apprenticeship: {
    name: 'Apprenticeship',
    definition: 'Funding supports apprenticeship training or apprentice positions in a skilled trade',
    when_to_use: 'Use when the program targets registered apprentices or apprenticeship training'
  },
  youth_hire: {
    name: 'Youth Hire (<29 years old)',
    definition: "The position must be filled by a young worker below the program's age limit",
    when_to_use: 'Use when eligibility requires the candidate to be under a defined age threshold (commonly under 29 or 30)'
  },
  remote_hire: {
    name: 'Remote Hire',
    definition: 'The program explicitly allows remote or virtual placements',
    when_to_use: 'Use when the program explicitly allows remote or virtual placements'
  },
  barriered_youth: {
    name: 'Barriered youth',
    definition: 'Program targets youth who face barriers to employment',
    when_to_use: 'Use when the program prioritizes or requires youth from under-represented or disadvantaged groups'
  }
};

const SYSTEM_PROMPT = `You are a grant classification expert. Score the provided grant program against the "Building Bench of Talent" genres.

GENRES TO SCORE (0-3 scale):
${Object.entries(TALENT_GENRES).map(([key, genre]) => `
- ${genre.name}:
  Definition: ${genre.definition}
  When to use: ${genre.when_to_use}
`).join('')}

SCORING SCALE:
- 0 = No association (program doesn't involve this at all)
- 1 = Weak/indirect association (tangentially related or possible but not emphasized)
- 2 = Moderate/secondary association (clearly involves this but not the primary focus)
- 3 = Strong/primary association (this is a core component of the program)

IMPORTANT NOTES:
- A single grant may have multiple tags
- Some tags describe the activity (Hiring, Training, Apprenticeship)
- Some tags describe who it targets (Student, Youth, Barriered Youth)
- Some tags describe how funding works (Wage Subsidy, Remote Hire)
- Score based on what the program text actually says, not assumptions

NEW GENRE PROPOSALS:
If the grant covers a talent/hiring/training-related activity that doesn't fit any of the 8 genres above, propose a new genre that would belong under the "Building Bench of Talent" smart filter.

IGNORE activities related to other smart filters:
- Technology adoption
- Equipment purchase
- R&D / innovation
- Market expansion / export
- Capital investment

These will be handled separately.

Return ONLY valid JSON in this exact format:
{
  "scores": {
    "hiring": 0-3,
    "wage_subsidy": 0-3,
    "student_coop": 0-3,
    "training": 0-3,
    "apprenticeship": 0-3,
    "youth_hire": 0-3,
    "remote_hire": 0-3,
    "barriered_youth": 0-3
  },
  "proposed_genre": null OR {
    "name": "string",
    "definition": "one sentence",
    "when_to_use": "one sentence",
    "why_existing_dont_fit": "explanation"
  }
}`;

async function scoreGrantGenres(grantCriteria, grantName) {
  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20250122',
    max_tokens: 1024,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Grant Name: ${grantName}\n\nGrant Criteria:\n${grantCriteria}`
    }]
  });

  const jsonText = response.content[0].text.trim();
  const result = JSON.parse(jsonText);

  return {
    scores: result.scores,
    proposed_genre: result.proposed_genre,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens
  };
}

function calculateAssociationScore(scores) {
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const maxPossible = 24; // 8 genres × 3 max score
  return {
    total_score: total,
    association_pct: Math.round((total / maxPossible) * 100)
  };
}

async function ensureGenreScoresColumn(client) {
  console.log('📋 Ensuring genre_scores column exists...');

  try {
    await client.query(`
      ALTER TABLE grants
      ADD COLUMN IF NOT EXISTS genre_scores JSONB
    `);
    console.log('   ✅ genre_scores column ready\n');
  } catch (error) {
    console.error('   ❌ Failed to create genre_scores column:', error);
    throw error;
  }
}

async function batchScoreGenres() {
  console.log('🏷️  Genre Tagger - Building Bench of Talent\n');
  console.log(`⏰ Started at: ${new Date().toISOString()}\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Ensure column exists
    await ensureGenreScoresColumn(client);

    // Get all currently accepting grants
    const grantsResult = await client.query(`
      SELECT grant_id, grant_name, grant_criteria
      FROM grants
      WHERE currently_accepting = true
      ORDER BY grant_id
    `);

    const grants = grantsResult.rows;
    console.log(`📊 Found ${grants.length} currently accepting grants to score\n`);

    const results = [];
    const proposedGenres = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let failed = 0;

    for (let i = 0; i < grants.length; i++) {
      const grant = grants[i];

      try {
        // Score genres
        const { scores, proposed_genre, input_tokens, output_tokens } =
          await scoreGrantGenres(grant.grant_criteria, grant.grant_name);

        const association = calculateAssociationScore(scores);

        const result = {
          grant_id: grant.grant_id,
          grant_name: grant.grant_name,
          scores,
          ...association,
          scored_at: new Date().toISOString()
        };

        results.push(result);

        // Track proposed genres
        if (proposed_genre) {
          proposedGenres.push({
            ...proposed_genre,
            grant_id: grant.grant_id,
            grant_name: grant.grant_name
          });
        }

        // Update database
        await client.query(
          'UPDATE grants SET genre_scores = $1 WHERE grant_id = $2',
          [JSON.stringify(result), grant.grant_id]
        );

        totalInputTokens += input_tokens;
        totalOutputTokens += output_tokens;

        // Progress logging every 50 grants
        if ((i + 1) % 50 === 0) {
          console.log(`   ✅ Scored ${i + 1}/${grants.length} grants`);
          console.log(`      Latest: ${grant.grant_name} → ${association.association_pct}% association`);
        }

      } catch (error) {
        console.error(`   ⚠️  Failed to score grant ${grant.grant_id}: ${error.message}`);
        failed++;
      }
    }

    console.log(`\n✅ Scoring complete: ${results.length} scored, ${failed} failed\n`);

    // Calculate cost
    const inputCost = (totalInputTokens / 1_000_000) * 1.00; // $1.00 per MTok
    const outputCost = (totalOutputTokens / 1_000_000) * 5.00; // $5.00 per MTok
    const totalCost = inputCost + outputCost;

    console.log('💰 Cost Estimate:');
    console.log(`   Input tokens: ${totalInputTokens.toLocaleString()} ($${inputCost.toFixed(4)})`);
    console.log(`   Output tokens: ${totalOutputTokens.toLocaleString()} ($${outputCost.toFixed(4)})`);
    console.log(`   Total cost: $${totalCost.toFixed(4)}\n`);

    // Export to JSON
    console.log('📝 Exporting results...');
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 1. Full results JSON
    const jsonPath = path.join(dataDir, 'genre-scores-talent.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      exported_at: new Date().toISOString(),
      total_scored: results.length,
      total_cost: `$${totalCost.toFixed(4)}`,
      results: results.sort((a, b) => b.association_pct - a.association_pct)
    }, null, 2));
    console.log(`   ✅ JSON: ${jsonPath}`);

    // 2. Proposed new genres JSON (deduplicated)
    const genreProposalCounts = {};
    proposedGenres.forEach(proposal => {
      const key = proposal.name.toLowerCase();
      if (!genreProposalCounts[key]) {
        genreProposalCounts[key] = {
          ...proposal,
          count: 0,
          example_grants: []
        };
      }
      genreProposalCounts[key].count++;
      if (genreProposalCounts[key].example_grants.length < 3) {
        genreProposalCounts[key].example_grants.push({
          grant_id: proposal.grant_id,
          grant_name: proposal.grant_name
        });
      }
    });

    const proposalsPath = path.join(dataDir, 'proposed-new-genres-talent.json');
    const sortedProposals = Object.values(genreProposalCounts)
      .sort((a, b) => b.count - a.count);

    fs.writeFileSync(proposalsPath, JSON.stringify({
      exported_at: new Date().toISOString(),
      total_proposals: proposedGenres.length,
      unique_genres: sortedProposals.length,
      proposals: sortedProposals
    }, null, 2));
    console.log(`   ✅ Proposed genres: ${proposalsPath}`);

    // 3. Excel spreadsheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Genre Scores');

    // Headers
    worksheet.columns = [
      { header: 'Grant ID', key: 'grant_id', width: 10 },
      { header: 'Grant Name', key: 'grant_name', width: 50 },
      { header: 'Hiring', key: 'hiring', width: 10 },
      { header: 'Wage Subsidy', key: 'wage_subsidy', width: 12 },
      { header: 'Student/Co-op', key: 'student_coop', width: 12 },
      { header: 'Training', key: 'training', width: 10 },
      { header: 'Apprenticeship', key: 'apprenticeship', width: 14 },
      { header: 'Youth Hire', key: 'youth_hire', width: 10 },
      { header: 'Remote Hire', key: 'remote_hire', width: 12 },
      { header: 'Barriered Youth', key: 'barriered_youth', width: 14 },
      { header: 'Total Score', key: 'total_score', width: 12 },
      { header: 'Association %', key: 'association_pct', width: 14 }
    ];

    // Add rows
    results
      .sort((a, b) => b.association_pct - a.association_pct)
      .forEach(result => {
        worksheet.addRow({
          grant_id: result.grant_id,
          grant_name: result.grant_name,
          hiring: result.scores.hiring,
          wage_subsidy: result.scores.wage_subsidy,
          student_coop: result.scores.student_coop,
          training: result.scores.training,
          apprenticeship: result.scores.apprenticeship,
          youth_hire: result.scores.youth_hire,
          remote_hire: result.scores.remote_hire,
          barriered_youth: result.scores.barriered_youth,
          total_score: result.total_score,
          association_pct: result.association_pct
        });
      });

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    const xlsxPath = path.join(dataDir, 'genre-scores-talent.xlsx');
    await workbook.xlsx.writeFile(xlsxPath);
    console.log(`   ✅ Excel: ${xlsxPath}`);

    console.log('\n🎉 All done!\n');

    // Summary stats
    const highAssociation = results.filter(r => r.association_pct >= 50).length;
    const mediumAssociation = results.filter(r => r.association_pct >= 25 && r.association_pct < 50).length;
    const lowAssociation = results.filter(r => r.association_pct < 25).length;

    console.log('📈 Summary Stats:');
    console.log(`   High association (≥50%): ${highAssociation}`);
    console.log(`   Medium association (25-49%): ${mediumAssociation}`);
    console.log(`   Low association (<25%): ${lowAssociation}`);
    console.log(`   New genres proposed: ${sortedProposals.length} unique across ${proposedGenres.length} grants\n`);

  } finally {
    client.release();
    await pool.end();
  }
}

batchScoreGenres().catch(console.error);

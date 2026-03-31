/**
 * Test Genre Response - Debug what Haiku returns
 */

import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
import { config } from 'dotenv';

config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const { Pool } = pg;

const SYSTEM_PROMPT = `You are a grant classification expert. Score the provided grant program against the "Building Bench of Talent" genres.

GENRES TO SCORE (0-3 scale):
- Hiring: Funding supports hiring a new employee or intern
- Wage subsidy: Program reimburses part of the employee's wages
- Student/Co-op Intern: Must be filled by a student enrolled in education
- Training: Funding supports skills development or courses
- Apprenticeship: Supports apprenticeship training in skilled trades
- Youth Hire: Position must be filled by worker under age threshold
- Remote Hire: Program explicitly allows remote placements
- Barriered youth: Targets youth facing employment barriers

SCORING: 0=none, 1=weak, 2=moderate, 3=strong

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
  "proposed_genre": null
}`;

async function testSingleGrant() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Get grant ID 106 (one that failed in the batch run)
    const result = await client.query(
      "SELECT grant_id, grant_name, grant_criteria FROM grants WHERE grant_id = '106'"
    );

    const grant = result.rows[0];
    console.log('Testing grant:', grant.grant_name, '\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Grant Name: ${grant.grant_name}\n\nGrant Criteria:\n${grant.grant_criteria}`
      }]
    });

    const text = response.content[0].text.trim();

    console.log('=== RAW RESPONSE ===');
    console.log(text);
    console.log('\n=== RESPONSE LENGTH ===');
    console.log(text.length, 'characters');
    console.log('\n=== FIRST 300 CHARS ===');
    console.log(text.substring(0, 300));
    console.log('\n=== LAST 300 CHARS ===');
    console.log(text.substring(text.length - 300));

  } finally {
    client.release();
    await pool.end();
  }
}

testSingleGrant().catch(console.error);

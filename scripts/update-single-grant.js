/**
 * Update Single Grant in Database
 *
 * Quick fix to update one grant's data from GetGranted without full sync.
 * Usage: node scripts/update-single-grant.js <grant-id>
 * Example: node scripts/update-single-grant.js 1076
 */

import pg from 'pg';
import { config } from 'dotenv';
import puppeteer from 'puppeteer';

config();

const { Pool } = pg;

async function fetchGrantDetails(grantId) {
  console.log(`🌐 Fetching grant ${grantId} from GetGranted...`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  try {
    const url = `https://app.getgranted.ca/grants/${grantId}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    // Extract grant data from page
    const grantData = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      const getHTML = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerHTML : null;
      };

      return {
        grant_name: getText('h1') || getText('.grant-name'),
        grant_type: getText('.grant-type'),
        grant_amount: getText('.grant-amount'),
        deadline: getText('.deadline') || getText('[data-field="deadline"]'),
        max_spend: getText('.max-spend'),
        contribution_percentage: getText('.contribution-percentage'),
        regions: getText('.regions'),
        industries: getText('.industries'),
        program_provider: getText('.program-provider'),
        difficulty: getText('.difficulty'),
        grant_criteria: getHTML('.grant-criteria') || getHTML('[data-section="criteria"]'),
        best_practices: getHTML('.best-practices') || getHTML('[data-section="best-practices"]'),
        recently_changed: getHTML('.recently-changed') || getHTML('[data-section="recently-changed"]'),
        full_page_text: document.body.innerText
      };
    });

    console.log(`   ✅ Fetched: ${grantData.grant_name}`);
    console.log(`   📅 Deadline: ${grantData.deadline}`);

    await browser.close();
    return grantData;

  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function updateGrantInDatabase(grantId, grantData) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(`\n💾 Updating grant ${grantId} in database...`);

    const result = await pool.query(`
      UPDATE grants
      SET
        grant_name = $1,
        grant_type = $2,
        grant_amount = $3,
        deadline = $4,
        max_spend = $5,
        contribution_percentage = $6,
        regions = $7,
        industries = $8,
        program_provider = $9,
        difficulty = $10,
        grant_criteria = $11,
        best_practices = $12,
        recently_changed = $13,
        full_page_text = $14,
        last_updated = NOW()
      WHERE grant_id = $15
      RETURNING grant_id, grant_name, last_updated
    `, [
      grantData.grant_name,
      grantData.grant_type,
      grantData.grant_amount,
      grantData.deadline,
      grantData.max_spend,
      grantData.contribution_percentage,
      grantData.regions,
      grantData.industries,
      grantData.program_provider,
      grantData.difficulty,
      grantData.grant_criteria,
      grantData.best_practices,
      grantData.recently_changed,
      grantData.full_page_text,
      grantId
    ]);

    if (result.rowCount === 0) {
      console.log(`   ⚠️  Grant ${grantId} not found in database - needs INSERT instead of UPDATE`);
    } else {
      console.log(`   ✅ Updated: ${result.rows[0].grant_name}`);
      console.log(`   🕐 Last updated: ${result.rows[0].last_updated}`);
    }

    await pool.end();

  } catch (error) {
    await pool.end();
    throw error;
  }
}

async function main() {
  const grantId = process.argv[2];

  if (!grantId) {
    console.error('❌ Usage: node scripts/update-single-grant.js <grant-id>');
    console.error('   Example: node scripts/update-single-grant.js 1076');
    process.exit(1);
  }

  try {
    console.log(`🔄 Updating grant ${grantId} from GetGranted...\n`);

    const grantData = await fetchGrantDetails(grantId);
    await updateGrantInDatabase(grantId, grantData);

    console.log(`\n✅ Grant ${grantId} successfully updated!`);
    console.log('\n💡 Note: Redis cache will expire naturally in 1 hour,');
    console.log('   or you can clear it manually for immediate effect.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

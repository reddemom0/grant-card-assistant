/**
 * Export GetGranted Full Grant Details
 *
 * Scrapes COMPLETE grant information including:
 * - All structured fields (type, amount, regions, industries, deadline, etc.)
 * - Grant Criteria section (eligibility, expenses, projects, streams)
 * - Best Practices & Forms section
 * - Last updated date
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

async function exportFullDetails() {
  console.log('🚀 Starting full GetGranted details export...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const allGrants = [];

  try {
    const page = await browser.newPage();

    // Login
    console.log('1️⃣ Logging in...');
    await page.goto(`${GETGRANTED_URL}/users/sign_in`);
    await page.waitForLoadState('domcontentloaded');

    let emailField = page.locator('input[type="email"]').first();
    let emailFieldExists = await emailField.count() > 0;
    if (!emailFieldExists) {
      emailField = page.locator('input[name="user[email]"]').first();
      emailFieldExists = await emailField.count() > 0;
    }
    if (!emailFieldExists) {
      emailField = page.locator('input[placeholder*="Email" i]').first();
    }
    await emailField.fill(LOGIN_EMAIL);

    let passwordField = page.locator('input[type="password"]').first();
    let passwordFieldExists = await passwordField.count() > 0;
    if (!passwordFieldExists) {
      passwordField = page.locator('input[name="user[password]"]').first();
    }
    await passwordField.fill(LOGIN_PASSWORD);

    let submitButton = page.locator('button[type="submit"]').first();
    let submitExists = await submitButton.count() > 0;
    if (!submitExists) {
      submitButton = page.locator('input[type="submit"]').first();
    }
    await submitButton.click();

    await page.waitForURL(/\/(grants|dashboard|admin)/, { timeout: 15000 });
    console.log(`   ✅ Logged in successfully\n`);

    // First, get list of all grant IDs from existing export
    console.log('2️⃣ Loading grant IDs from previous export...');
    const previousExport = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'data', 'getgranted-full-export.json'), 'utf-8')
    );
    const grantIds = previousExport.grants.map(g => g.grant_id).filter(id => id);
    console.log(`   Found ${grantIds.length} grant IDs to process\n`);

    // Extract details for each grant
    console.log('3️⃣ Extracting full details for each grant...');
    for (let i = 0; i < grantIds.length; i++) {
      const grantId = grantIds[i];
      console.log(`\n   [${i + 1}/${grantIds.length}] Processing grant ${grantId}...`);

      try {
        // Navigate to grant detail page
        await page.goto(`${GETGRANTED_URL}/grants/${grantId}`, { timeout: 10000 });
        await page.waitForTimeout(1500); // Brief wait for content to load

        // Extract grant details
        const grantDetails = await extractGrantDetails(page, grantId);
        allGrants.push(grantDetails);

        console.log(`      ✓ Extracted: ${grantDetails.grant_name}`);

        // Progress indicator
        if ((i + 1) % 10 === 0) {
          console.log(`\n   📊 Progress: ${i + 1}/${grantIds.length} grants processed (${Math.round((i + 1) / grantIds.length * 100)}%)`);
        }

      } catch (error) {
        console.warn(`      ⚠️  Failed to extract grant ${grantId}: ${error.message}`);
        // Add placeholder so we don't lose track
        allGrants.push({
          grant_id: grantId,
          error: error.message,
          extracted_at: new Date().toISOString()
        });
      }
    }

    // Save to JSON
    console.log(`\n\n4️⃣ Saving ${allGrants.length} grants with full details to JSON...`);
    const outputPath = path.join(process.cwd(), 'data', 'getgranted-full-details.json');

    fs.writeFileSync(outputPath, JSON.stringify({
      exported_at: new Date().toISOString(),
      total_grants: allGrants.length,
      successful_extractions: allGrants.filter(g => !g.error).length,
      failed_extractions: allGrants.filter(g => g.error).length,
      grants: allGrants
    }, null, 2));

    console.log(`   ✓ Saved to: ${outputPath}\n`);

    // Summary
    console.log('📊 Export Summary:');
    console.log(`   Total grants: ${allGrants.length}`);
    console.log(`   Successful: ${allGrants.filter(g => !g.error).length}`);
    console.log(`   Failed: ${allGrants.filter(g => g.error).length}`);
    console.log(`   With criteria: ${allGrants.filter(g => g.grant_criteria && g.grant_criteria.length > 100).length}`);
    console.log(`   With best practices: ${allGrants.filter(g => g.best_practices && g.best_practices.length > 50).length}`);

  } catch (error) {
    console.error('❌ Export failed:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
  }

  return allGrants;
}

/**
 * Extract detailed grant information from grant detail page
 */
async function extractGrantDetails(page, grantId) {
  // Get grant name
  const grantName = await page.locator('h1, h2').first().textContent().catch(() => 'Unknown Grant');

  // Extract structured fields
  const fields = {
    grant_id: grantId,
    grant_name: grantName.trim(),
    url: `${GETGRANTED_URL}/grants/${grantId}`,
    extracted_at: new Date().toISOString()
  };

  // Try to extract all metadata fields
  try {
    // Grant Type
    const grantTypeLabel = page.locator('text=/^Grant Type$/i').first();
    if (await grantTypeLabel.count() > 0) {
      const parent = grantTypeLabel.locator('..');
      fields.grant_type = await parent.textContent().then(t => t.replace('Grant Type', '').trim());
    }

    // Grant Amount
    const grantAmountLabel = page.locator('text=/^Grant Amount$/i').first();
    if (await grantAmountLabel.count() > 0) {
      const parent = grantAmountLabel.locator('..');
      fields.grant_amount = await parent.textContent().then(t => t.replace('Grant Amount', '').trim());
    }

    // Regions
    const regionsLabel = page.locator('text=/^Regions$/i').first();
    if (await regionsLabel.count() > 0) {
      const parent = regionsLabel.locator('..');
      fields.regions = await parent.textContent().then(t => t.replace('Regions', '').trim());
    }

    // Industries
    const industriesLabel = page.locator('text=/^Industries$/i').first();
    if (await industriesLabel.count() > 0) {
      const parent = industriesLabel.locator('..');
      fields.industries = await parent.textContent().then(t => t.replace('Industries', '').trim());
    }

    // Program provided by
    const providerLabel = page.locator('text=/^Program provided by$/i').first();
    if (await providerLabel.count() > 0) {
      const parent = providerLabel.locator('..');
      fields.program_provider = await parent.textContent().then(t => t.replace('Program provided by', '').trim());
    }

    // Deadline
    const deadlineLabel = page.locator('text=/^Deadline$/i').first();
    if (await deadlineLabel.count() > 0) {
      const parent = deadlineLabel.locator('..');
      fields.deadline = await parent.textContent().then(t => t.replace('Deadline', '').trim());
    }

    // Max Spend
    const maxSpendLabel = page.locator('text=/^Max Spend$/i').first();
    if (await maxSpendLabel.count() > 0) {
      const parent = maxSpendLabel.locator('..');
      fields.max_spend = await parent.textContent().then(t => t.replace('Max Spend', '').trim());
    }

    // Program Contribution Percentage
    const contributionLabel = page.locator('text=/Program Contribution Percentage/i').first();
    if (await contributionLabel.count() > 0) {
      const parent = contributionLabel.locator('..');
      fields.contribution_percentage = await parent.textContent().then(t => t.replace(/Program Contribution Percentage/i, '').trim());
    }

    // Difficulty (visual rating - get aria-label or text)
    const difficultySection = page.locator('text=/^Difficulty$/i').first();
    if (await difficultySection.count() > 0) {
      // Try to find star rating or similar
      const difficultyContainer = difficultySection.locator('..');
      const difficultyText = await difficultyContainer.textContent();
      // Count filled stars or extract rating
      const starCount = (difficultyText.match(/★/g) || []).length;
      fields.difficulty = starCount > 0 ? `${starCount}/5` : difficultyText.replace('Difficulty', '').trim();
    }

  } catch (error) {
    console.warn(`      Warning: Failed to extract some structured fields: ${error.message}`);
  }

  // Extract Grant Criteria section
  try {
    const criteriaHeader = page.locator('text=/^Grant Criteria$/i').first();
    if (await criteriaHeader.count() > 0) {
      // Get the next sibling or parent container
      const criteriaSection = criteriaHeader.locator('xpath=following-sibling::*[1]');
      if (await criteriaSection.count() > 0) {
        fields.grant_criteria = await criteriaSection.textContent().catch(() => '');
      } else {
        // Try getting from parent
        const parent = criteriaHeader.locator('xpath=..');
        fields.grant_criteria = await parent.textContent().then(t => t.replace('Grant Criteria', '').trim()).catch(() => '');
      }
    }
  } catch (error) {
    console.warn(`      Warning: Failed to extract grant criteria: ${error.message}`);
  }

  // Extract Best Practices & Forms section
  try {
    const bestPracticesHeader = page.locator('text=/^Best Practices & Forms$/i').first();
    if (await bestPracticesHeader.count() > 0) {
      const bestPracticesSection = bestPracticesHeader.locator('xpath=following-sibling::*[1]');
      if (await bestPracticesSection.count() > 0) {
        fields.best_practices = await bestPracticesSection.textContent().catch(() => '');
      } else {
        const parent = bestPracticesHeader.locator('xpath=..');
        fields.best_practices = await parent.textContent().then(t => t.replace('Best Practices & Forms', '').trim()).catch(() => '');
      }
    }
  } catch (error) {
    console.warn(`      Warning: Failed to extract best practices: ${error.message}`);
  }

  // Extract last updated date
  try {
    const updatedText = await page.locator('text=/Updated on/i').first().textContent().catch(() => '');
    if (updatedText) {
      fields.last_updated = updatedText.replace(/Updated on/i, '').trim();
    }
  } catch (error) {
    // No updated date - that's okay
  }

  // Get full page text as fallback
  try {
    fields.full_page_text = await page.locator('body').textContent();
  } catch (error) {
    console.warn(`      Warning: Failed to extract full page text: ${error.message}`);
  }

  return fields;
}

// Run export
exportFullDetails()
  .then(grants => {
    console.log(`\n✅ Export complete! ${grants.filter(g => !g.error).length} grants exported successfully.`);
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Export failed:', error);
    process.exit(1);
  });

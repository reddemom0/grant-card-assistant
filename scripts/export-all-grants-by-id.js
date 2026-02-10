/**
 * Export ALL GetGranted Grants by ID Iteration
 *
 * Instead of using search, iterate through grant IDs 1-1000
 * and scrape each one that exists (active or inactive)
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

// Range of IDs to check (going up to 1000 to be safe)
const START_ID = 1;
const END_ID = 1000;

async function login(page) {
  console.log('🔐 Logging in...');
  await page.goto(`${GETGRANTED_URL}/users/sign_in`);
  await page.waitForLoadState('domcontentloaded');

  let emailField = page.locator('input[type="email"]').first();
  if (await emailField.count() === 0) emailField = page.locator('input[name="user[email]"]').first();
  await emailField.fill(LOGIN_EMAIL);

  let passwordField = page.locator('input[type="password"]').first();
  if (await passwordField.count() === 0) passwordField = page.locator('input[name="user[password]"]').first();
  await passwordField.fill(LOGIN_PASSWORD);

  let submitButton = page.locator('button[type="submit"]').first();
  if (await submitButton.count() === 0) submitButton = page.locator('input[type="submit"]').first();
  await submitButton.click();

  await page.waitForURL(/\/(grants|dashboard|admin)/, { timeout: 15000 });
  console.log('   ✅ Logged in\n');
}

async function extractGrantDetails(page, grantId) {
  const url = `${GETGRANTED_URL}/grants/${grantId}`;

  try {
    const response = await page.goto(url, { timeout: 10000, waitUntil: 'domcontentloaded' });

    // Check if page exists (not 404)
    if (!response || response.status() === 404) {
      return null; // Grant doesn't exist
    }

    await page.waitForTimeout(1000);

    const details = {
      grant_id: grantId.toString(),
      grant_name: await page.locator('h1, h2').first().textContent().catch(() => 'Unknown'),
      url: url,
      extracted_at: new Date().toISOString()
    };

    // Get full page text to check active/inactive status
    const pageText = await page.textContent('body').catch(() => '');

    // Check if inactive - look for various indicators
    const inactiveIndicators = [
      'this grant is currently inactive',
      'currently inactive',
      'no longer accepting',
      'program has closed',
      'expired',
      'archived'
    ];

    details.is_active = !inactiveIndicators.some(indicator =>
      pageText.toLowerCase().includes(indicator)
    );

    // Extract all standard fields
    try {
      const extractField = async (labelRegex) => {
        const labelLocator = page.locator(`text=${labelRegex}`).first();
        if (await labelLocator.count() > 0) {
          const parent = labelLocator.locator('..');
          const text = await parent.textContent().catch(() => '');
          return text.replace(labelRegex, '').trim();
        }
        return null;
      };

      details.grant_type = await extractField(/^Grant Type$/i);
      details.grant_amount = await extractField(/^Grant Amount$/i);
      details.regions = await extractField(/^Regions$/i);
      details.industries = await extractField(/^Industries$/i);
      details.program_provider = await extractField(/^Program provided by$/i);
      details.deadline = await extractField(/^Deadline$/i);
      details.max_spend = await extractField(/^Max Spend$/i);
      details.contribution_percentage = await extractField(/Program Contribution Percentage/i);

      // Grant Criteria
      const criteriaHeader = page.locator('text=/^Grant Criteria$/i').first();
      if (await criteriaHeader.count() > 0) {
        const criteriaSection = criteriaHeader.locator('xpath=following-sibling::*[1]');
        if (await criteriaSection.count() > 0) {
          details.grant_criteria = await criteriaSection.textContent().catch(() => '');
        }
      }

      // Best Practices
      const bestPracticesHeader = page.locator('text=/^Best Practices & Forms$/i').first();
      if (await bestPracticesHeader.count() > 0) {
        const bpSection = bestPracticesHeader.locator('xpath=following-sibling::*[1]');
        if (await bpSection.count() > 0) {
          details.best_practices = await bpSection.textContent().catch(() => '');
        }
      }

      // Recently Changed section (CRITICAL for deadline updates)
      const recentlyChangedHeader = page.locator('text=/^Recently Changed$/i').first();
      if (await recentlyChangedHeader.count() > 0) {
        const rcSection = recentlyChangedHeader.locator('xpath=following-sibling::*[1]');
        if (await rcSection.count() > 0) {
          details.recently_changed = await rcSection.textContent().catch(() => '');
        }
      }

      // Last updated
      const updatedText = await page.locator('text=/Updated on/i').first().textContent().catch(() => '');
      if (updatedText) {
        details.last_updated = updatedText.replace(/Updated on/i, '').trim();
      }

      details.full_page_text = await page.locator('body').textContent();
    } catch (error) {
      console.warn(`      ⚠️  Some fields failed for grant ${grantId}: ${error.message}`);
    }

    return details;

  } catch (error) {
    if (error.message.includes('404') || error.message.includes('not found')) {
      return null; // Grant doesn't exist
    }
    throw error; // Other errors should be reported
  }
}

async function exportAllGrantsByID() {
  console.log(`🚀 Exporting ALL GetGranted grants by ID (${START_ID}-${END_ID})...\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const allGrants = [];
  let foundCount = 0;
  let notFoundCount = 0;

  try {
    const page = await browser.newPage();
    await login(page);

    console.log(`📝 Checking grant IDs ${START_ID} to ${END_ID}...\n`);

    // Iterate through all possible IDs
    for (let grantId = START_ID; grantId <= END_ID; grantId++) {
      // Progress indicator every 50 IDs
      if (grantId % 50 === 0 || grantId === START_ID) {
        console.log(`   [${grantId}/${END_ID}] Checked ${foundCount} grants so far (${notFoundCount} not found)...`);
      }

      try {
        const details = await extractGrantDetails(page, grantId);

        if (details) {
          allGrants.push(details);
          foundCount++;

          // Log active/inactive status
          if (foundCount % 10 === 0) {
            const activeCount = allGrants.filter(g => g.is_active).length;
            const inactiveCount = allGrants.filter(g => !g.is_active).length;
            console.log(`   📊 Progress: ${foundCount} found (${activeCount} active, ${inactiveCount} inactive)`);
          }
        } else {
          notFoundCount++;
        }

      } catch (error) {
        console.error(`   ❌ Error checking grant ${grantId}: ${error.message}`);
        allGrants.push({
          grant_id: grantId.toString(),
          error: error.message,
          extracted_at: new Date().toISOString()
        });
      }
    }

    // Save to JSON
    console.log('\n💾 Saving to file...');
    const outputPath = path.join(process.cwd(), 'data', 'getgranted-all-grants-by-id.json');

    fs.writeFileSync(outputPath, JSON.stringify({
      exported_at: new Date().toISOString(),
      id_range: `${START_ID}-${END_ID}`,
      total_grants: allGrants.length,
      active_grants: allGrants.filter(g => g.is_active).length,
      inactive_grants: allGrants.filter(g => !g.is_active && !g.error).length,
      successful: allGrants.filter(g => !g.error).length,
      failed: allGrants.filter(g => g.error).length,
      grants: allGrants
    }, null, 2));

    console.log(`   ✅ Saved to: ${outputPath}\n`);

    console.log('📊 Export Summary:');
    console.log(`   IDs checked: ${START_ID} to ${END_ID} (${END_ID - START_ID + 1} total)`);
    console.log(`   Grants found: ${foundCount}`);
    console.log(`   IDs not found: ${notFoundCount}`);
    console.log(`   Active grants: ${allGrants.filter(g => g.is_active).length}`);
    console.log(`   Inactive grants: ${allGrants.filter(g => !g.is_active && !g.error).length}`);
    console.log(`   Successful: ${allGrants.filter(g => !g.error).length}`);
    console.log(`   Failed: ${allGrants.filter(g => g.error).length}`);

  } catch (error) {
    console.error('❌ Export failed:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
  }

  return allGrants;
}

exportAllGrantsByID()
  .then(() => {
    console.log('\n✅ Complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

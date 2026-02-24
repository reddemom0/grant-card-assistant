/**
 * Export ALL GetGranted Grants (Active + Inactive)
 *
 * Scrapes both active and inactive grants with full detail pages
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

// URLs for active and inactive grants
const GRANT_URLS = {
  active: `${GETGRANTED_URL}/grants`,
  inactive: `${GETGRANTED_URL}/admin/grants/search?grant_profile%5Badmin_search_include_active%5D=0&grant_profile%5Badmin_search_include_inactive%5D=1`
};

async function login(page) {
  console.log('🔐 Logging in...');
  await page.goto(`${GETGRANTED_URL}/users/sign_in`);
  await page.waitForLoadState('domcontentloaded');

  let emailField = page.locator('input[type="email"]').first();
  if (await emailField.count() === 0) {
    emailField = page.locator('input[name="user[email]"]').first();
  }
  await emailField.fill(LOGIN_EMAIL);

  let passwordField = page.locator('input[type="password"]').first();
  if (await passwordField.count() === 0) {
    passwordField = page.locator('input[name="user[password]"]').first();
  }
  await passwordField.fill(LOGIN_PASSWORD);

  let submitButton = page.locator('button[type="submit"]').first();
  if (await submitButton.count() === 0) {
    submitButton = page.locator('input[type="submit"]').first();
  }
  await submitButton.click();

  await page.waitForURL(/\/(grants|dashboard|admin)/, { timeout: 15000 });
  console.log('   ✅ Logged in\n');
}

async function getGrantIds(page, url, grantType) {
  console.log(`📋 Getting ${grantType} grant IDs...`);
  await page.goto(url);
  await page.waitForTimeout(3000);

  const grantIds = [];
  let pageNum = 1;
  let hasMore = true;

  while (hasMore) {
    console.log(`   Page ${pageNum}...`);

    // Extract grant IDs from links
    const links = await page.locator('a[href*="/grants/"]').all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      const match = href?.match(/\/grants\/(\d+)/);
      if (match && !grantIds.includes(match[1])) {
        grantIds.push(match[1]);
      }
    }

    // Check for next page
    const nextButton = page.locator('button:has-text("Next"), a:has-text("Next")').first();
    const nextExists = await nextButton.count() > 0;

    if (nextExists) {
      const isDisabled = await nextButton.isDisabled().catch(() => true);
      if (!isDisabled) {
        await nextButton.click();
        await page.waitForTimeout(2000);
        pageNum++;
      } else {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  console.log(`   ✅ Found ${grantIds.length} ${grantType} grants\n`);
  return grantIds;
}

async function extractGrantDetails(page, grantId) {
  // First, visit the public grant page for main details
  await page.goto(`${GETGRANTED_URL}/grants/${grantId}`, { timeout: 10000 });
  await page.waitForTimeout(1500);

  const details = {
    grant_id: grantId,
    grant_name: await page.locator('h1, h2').first().textContent().catch(() => 'Unknown'),
    url: `${GETGRANTED_URL}/grants/${grantId}`,
    extracted_at: new Date().toISOString()
  };

  // Extract all fields (same as before)
  try {
    const grantTypeLabel = page.locator('text=/^Grant Type$/i').first();
    if (await grantTypeLabel.count() > 0) {
      details.grant_type = await grantTypeLabel.locator('..').textContent().then(t => t.replace('Grant Type', '').trim());
    }

    const grantAmountLabel = page.locator('text=/^Grant Amount$/i').first();
    if (await grantAmountLabel.count() > 0) {
      details.grant_amount = await grantAmountLabel.locator('..').textContent().then(t => t.replace('Grant Amount', '').trim());
    }

    const regionsLabel = page.locator('text=/^Regions$/i').first();
    if (await regionsLabel.count() > 0) {
      details.regions = await regionsLabel.locator('..').textContent().then(t => t.replace('Regions', '').trim());
    }

    const industriesLabel = page.locator('text=/^Industries$/i').first();
    if (await industriesLabel.count() > 0) {
      details.industries = await industriesLabel.locator('..').textContent().then(t => t.replace('Industries', '').trim());
    }

    const providerLabel = page.locator('text=/^Program provided by$/i').first();
    if (await providerLabel.count() > 0) {
      details.program_provider = await providerLabel.locator('..').textContent().then(t => t.replace('Program provided by', '').trim());
    }

    const deadlineLabel = page.locator('text=/^Deadline$/i').first();
    if (await deadlineLabel.count() > 0) {
      details.deadline = await deadlineLabel.locator('..').textContent().then(t => t.replace('Deadline', '').trim());
    }

    const maxSpendLabel = page.locator('text=/^Max Spend$/i').first();
    if (await maxSpendLabel.count() > 0) {
      details.max_spend = await maxSpendLabel.locator('..').textContent().then(t => t.replace('Max Spend', '').trim());
    }

    const contributionLabel = page.locator('text=/Program Contribution Percentage/i').first();
    if (await contributionLabel.count() > 0) {
      details.contribution_percentage = await contributionLabel.locator('..').textContent().then(t => t.replace(/Program Contribution Percentage/i, '').trim());
    }

    const criteriaHeader = page.locator('text=/^Grant Criteria$/i').first();
    if (await criteriaHeader.count() > 0) {
      const criteriaSection = criteriaHeader.locator('xpath=following-sibling::*[1]');
      if (await criteriaSection.count() > 0) {
        details.grant_criteria = await criteriaSection.textContent().catch(() => '');
      }
    }

    const bestPracticesHeader = page.locator('text=/^Best Practices & Forms$/i').first();
    if (await bestPracticesHeader.count() > 0) {
      const bestPracticesSection = bestPracticesHeader.locator('xpath=following-sibling::*[1]');
      if (await bestPracticesSection.count() > 0) {
        details.best_practices = await bestPracticesSection.textContent().catch(() => '');
      }
    }

    const updatedText = await page.locator('text=/Updated on/i').first().textContent().catch(() => '');
    if (updatedText) {
      details.last_updated = updatedText.replace(/Updated on/i, '').trim();
    }

    details.full_page_text = await page.locator('body').textContent();

  } catch (error) {
    console.warn(`      Warning: Some fields failed to extract: ${error.message}`);
  }

  // Extract intake cycle from admin edit page
  // This field is only available on the admin edit page, not the public page
  try {
    await page.goto(`${GETGRANTED_URL}/admin/grants/${grantId}/edit`, { timeout: 10000 });
    await page.waitForTimeout(1500);

    // Extract intake_cycle (funding_period)
    const fundingPeriodCheckboxes = await page.locator('input[name="grant[funding_period][]"]:checked').all();
    const fundingPeriods = [];
    for (const checkbox of fundingPeriodCheckboxes) {
      const value = await checkbox.getAttribute('value');
      if (value) fundingPeriods.push(value);
    }
    details.intake_cycle = fundingPeriods.join(', ');

  } catch (error) {
    console.warn(`      Warning: Failed to extract intake cycle: ${error.message}`);
    details.intake_cycle = null;
  }

  return details;
}

async function exportAllGrants() {
  console.log('🚀 Exporting ALL GetGranted grants (active + inactive)...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const allGrants = [];

  try {
    const page = await browser.newPage();
    await login(page);

    // 1. Get active grant IDs
    const activeIds = await getGrantIds(page, GRANT_URLS.active, 'active');

    // 2. Get inactive grant IDs
    const inactiveIds = await getGrantIds(page, GRANT_URLS.inactive, 'inactive');

    console.log(`📊 Total grants to process: ${activeIds.length + inactiveIds.length}\n`);

    // 3. Extract all active grants
    console.log('🔍 Extracting active grants...');
    for (let i = 0; i < activeIds.length; i++) {
      console.log(`   [${i + 1}/${activeIds.length}] Grant ${activeIds[i]}...`);
      try {
        const details = await extractGrantDetails(page, activeIds[i]);
        details.is_active = true;
        allGrants.push(details);

        if ((i + 1) % 10 === 0) {
          console.log(`   📊 Progress: ${i + 1}/${activeIds.length}`);
        }
      } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
      }
    }

    // 4. Extract all inactive grants
    console.log('\n🔍 Extracting inactive grants...');
    for (let i = 0; i < inactiveIds.length; i++) {
      console.log(`   [${i + 1}/${inactiveIds.length}] Grant ${inactiveIds[i]}...`);
      try {
        const details = await extractGrantDetails(page, inactiveIds[i]);
        details.is_active = false;
        allGrants.push(details);

        if ((i + 1) % 10 === 0) {
          console.log(`   📊 Progress: ${i + 1}/${inactiveIds.length}`);
        }
      } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
      }
    }

    // 5. Save to JSON
    console.log('\n💾 Saving to file...');
    const outputPath = path.join(process.cwd(), 'data', 'getgranted-all-grants.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      exported_at: new Date().toISOString(),
      total_grants: allGrants.length,
      active_grants: allGrants.filter(g => g.is_active).length,
      inactive_grants: allGrants.filter(g => !g.is_active).length,
      grants: allGrants
    }, null, 2));

    console.log(`   ✅ Saved to: ${outputPath}\n`);
    console.log('📊 Export Summary:');
    console.log(`   Active grants: ${allGrants.filter(g => g.is_active).length}`);
    console.log(`   Inactive grants: ${allGrants.filter(g => !g.is_active).length}`);
    console.log(`   Total: ${allGrants.length}`);

  } catch (error) {
    console.error('❌ Export failed:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
  }

  return allGrants;
}

exportAllGrants()
  .then(() => {
    console.log('\n✅ Complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

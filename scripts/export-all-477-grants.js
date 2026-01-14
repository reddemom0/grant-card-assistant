/**
 * Export ALL 477 GetGranted Grants
 *
 * Uses admin search page to get all active (189) + inactive (288) = 477 grants
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

// Admin search URLs
const ADMIN_SEARCH_ALL = `${GETGRANTED_URL}/admin/grants/search?grant_profile%5Badmin_search_include_active%5D=1&grant_profile%5Badmin_search_include_inactive%5D=1`;

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

async function getAllGrantIds(page) {
  console.log('📋 Getting all grant IDs from admin search...');

  // Visit admin search page (base URL without params)
  await page.goto(`${GETGRANTED_URL}/admin/grants/search`);
  await page.waitForTimeout(2000);

  // Check "Show Active Grants" checkbox
  console.log('   Selecting active grants...');
  const activeCheckbox = page.locator('input[type="checkbox"]').filter({ hasText: 'Show Active Grants' }).or(
    page.locator('label:has-text("Show Active Grants") input[type="checkbox"]')
  ).first();
  if (await activeCheckbox.count() > 0) {
    await activeCheckbox.check();
  }

  // Check "Show Inactive Grants" checkbox
  console.log('   Selecting inactive grants...');
  const inactiveCheckbox = page.locator('input[type="checkbox"]').filter({ hasText: 'Show Inactive Grants' }).or(
    page.locator('label:has-text("Show Inactive Grants") input[type="checkbox"]')
  ).first();
  if (await inactiveCheckbox.count() > 0) {
    await inactiveCheckbox.check();
  }

  // Check all Purpose checkboxes (Hiring, Training, Market Expansion, etc.)
  console.log('   Selecting all grant purposes...');
  const purposeLabels = [
    'Hiring', 'Training', 'Market Expansion', 'Capital Costs',
    'Business Assessments, Planning & Coaching', 'Systems & Processes',
    'Loan', 'Contests & Prizes', 'Investment', 'Research & Development', 'Rebates'
  ];

  for (const purpose of purposeLabels) {
    const checkbox = page.locator(`label:has-text("${purpose}") input[type="checkbox"]`).first();
    if (await checkbox.count() > 0) {
      await checkbox.check();
    }
  }

  // Wait for results to load
  console.log('   Waiting for search results...');
  await page.waitForTimeout(3000);

  // Check total count
  const pageText = await page.textContent('body');
  const countMatch = pageText.match(/Showing.*of\s+(\d+)\s+grants?/i);
  const estimatedTotal = countMatch ? parseInt(countMatch[1]) : 500;
  console.log(`   Expected total: ${estimatedTotal} grants\n`);

  const allGrantIds = new Set();
  let pageNum = 1;
  let hasMore = true;

  while (hasMore && allGrantIds.size < estimatedTotal + 50) {
    console.log(`   Page ${pageNum}: ${allGrantIds.size} grants so far...`);

    // Extract grant IDs from all links
    const links = await page.locator('a[href*="/grants/"]').all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      const match = href?.match(/\/grants\/(\d+)/);
      if (match) {
        allGrantIds.add(match[1]);
      }
    }

    // Try to go to next page
    const nextButton = page.locator('a:has-text("Next"), button:has-text("Next")').last();
    const nextExists = await nextButton.count() > 0;

    if (nextExists) {
      try {
        await nextButton.click();
        await page.waitForTimeout(2000);
        pageNum++;
      } catch {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }

    // Safety: max 50 pages
    if (pageNum > 50) {
      console.log('   ⚠️  Reached page limit (50)');
      hasMore = false;
    }
  }

  console.log(`   ✅ Found ${allGrantIds.size} total grants\n`);
  return Array.from(allGrantIds);
}

async function extractGrantDetails(page, grantId) {
  await page.goto(`${GETGRANTED_URL}/grants/${grantId}`, { timeout: 10000 });
  await page.waitForTimeout(1000);

  const details = {
    grant_id: grantId,
    grant_name: await page.locator('h1, h2').first().textContent().catch(() => 'Unknown'),
    url: `${GETGRANTED_URL}/grants/${grantId}`,
    extracted_at: new Date().toISOString()
  };

  // Check if inactive (look for indicators on page)
  const pageText = await page.textContent('body').catch(() => '');
  details.is_active = !pageText.toLowerCase().includes('this grant is currently inactive') &&
                      !pageText.toLowerCase().includes('archived') &&
                      !pageText.toLowerCase().includes('no longer accepting');

  // Extract all standard fields
  try {
    const extractField = async (label, regex) => {
      const labelLocator = page.locator(`text=${regex}`).first();
      if (await labelLocator.count() > 0) {
        return await labelLocator.locator('..').textContent().then(t => t.replace(regex, '').trim());
      }
      return null;
    };

    details.grant_type = await extractField('Grant Type', /^Grant Type$/i);
    details.grant_amount = await extractField('Grant Amount', /^Grant Amount$/i);
    details.regions = await extractField('Regions', /^Regions$/i);
    details.industries = await extractField('Industries', /^Industries$/i);
    details.program_provider = await extractField('Program provided by', /^Program provided by$/i);
    details.deadline = await extractField('Deadline', /^Deadline$/i);
    details.max_spend = await extractField('Max Spend', /^Max Spend$/i);
    details.contribution_percentage = await extractField('Contribution', /Program Contribution Percentage/i);

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

    // Last updated
    const updatedText = await page.locator('text=/Updated on/i').first().textContent().catch(() => '');
    if (updatedText) {
      details.last_updated = updatedText.replace(/Updated on/i, '').trim();
    }

    details.full_page_text = await page.locator('body').textContent();
  } catch (error) {
    console.warn(`      ⚠️  Some fields failed: ${error.message}`);
  }

  return details;
}

async function exportAll477Grants() {
  console.log('🚀 Exporting ALL 477 GetGranted grants...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const allGrants = [];

  try {
    const page = await browser.newPage();
    await login(page);

    // Get all grant IDs
    const grantIds = await getAllGrantIds(page);
    console.log(`📝 Processing ${grantIds.length} grants...\n`);

    // Extract details for each
    for (let i = 0; i < grantIds.length; i++) {
      const grantId = grantIds[i];

      if (i % 10 === 0) {
        console.log(`   [${i}/${grantIds.length}] Grant ${grantId}...`);
      }

      try {
        const details = await extractGrantDetails(page, grantId);
        allGrants.push(details);

        if ((i + 1) % 50 === 0) {
          console.log(`   📊 Progress: ${i + 1}/${grantIds.length} (${Math.round((i + 1) / grantIds.length * 100)}%)`);
        }
      } catch (error) {
        console.error(`   ❌ Failed ${grantId}: ${error.message}`);
        allGrants.push({
          grant_id: grantId,
          error: error.message,
          extracted_at: new Date().toISOString()
        });
      }
    }

    // Save to JSON
    console.log('\n💾 Saving to file...');
    const outputPath = path.join(process.cwd(), 'data', 'getgranted-all-477-grants.json');

    fs.writeFileSync(outputPath, JSON.stringify({
      exported_at: new Date().toISOString(),
      total_grants: allGrants.length,
      active_grants: allGrants.filter(g => g.is_active).length,
      inactive_grants: allGrants.filter(g => !g.is_active).length,
      successful: allGrants.filter(g => !g.error).length,
      failed: allGrants.filter(g => g.error).length,
      grants: allGrants
    }, null, 2));

    console.log(`   ✅ Saved to: ${outputPath}\n`);

    console.log('📊 Export Summary:');
    console.log(`   Total grants: ${allGrants.length}`);
    console.log(`   Active: ${allGrants.filter(g => g.is_active).length}`);
    console.log(`   Inactive: ${allGrants.filter(g => !g.is_active).length}`);
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

exportAll477Grants()
  .then(() => {
    console.log('\n✅ Complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

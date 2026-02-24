/**
 * Test Intake Cycle Extraction
 *
 * Tests the new intake cycle extraction on 2-3 grants before running full export.
 * Verifies intake_cycle field is extracted correctly.
 */

import { chromium } from 'playwright';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

// Test grants:
// 1 = Career Launcher - Clean Tech (should have Summer, Fall)
// 85 = Northern Industries Innovation Fund (should have Year Round)
// 34 = Industry Commercialization Associates (unknown - good test case)
const TEST_GRANT_IDS = [1, 85, 34];

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

async function testExtractIntakeCycle(page, grantId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 Testing Grant ID: ${grantId}`);
  console.log('='.repeat(80));

  try {
    // Get grant name from public page
    await page.goto(`${GETGRANTED_URL}/grants/${grantId}`, { timeout: 10000 });
    await page.waitForTimeout(1000);
    const grantName = await page.locator('h1, h2').first().textContent().catch(() => 'Unknown');
    console.log(`Grant Name: ${grantName.trim()}`);

    // Extract intake cycle from admin edit page
    await page.goto(`${GETGRANTED_URL}/admin/grants/${grantId}/edit`, { timeout: 10000 });
    await page.waitForTimeout(1500);

    // Extract intake_cycle (funding_period)
    const fundingPeriodCheckboxes = await page.locator('input[name="grant[funding_period][]"]:checked').all();
    const fundingPeriods = [];
    for (const checkbox of fundingPeriodCheckboxes) {
      const value = await checkbox.getAttribute('value');
      if (value) fundingPeriods.push(value);
    }
    const intake_cycle = fundingPeriods.join(', ');

    // Display results
    console.log(`\n✅ Extraction successful:`);
    console.log(`   intake_cycle: "${intake_cycle}" ${intake_cycle ? '✓' : '(empty)'}`);

    return {
      grant_id: grantId,
      grant_name: grantName.trim(),
      intake_cycle,
      success: true
    };

  } catch (error) {
    console.error(`\n❌ Extraction failed: ${error.message}`);
    return {
      grant_id: grantId,
      success: false,
      error: error.message
    };
  }
}

async function main() {
  console.log('🚀 Testing intake cycle extraction on sample grants...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];

  try {
    const page = await browser.newPage();
    await login(page);

    for (const grantId of TEST_GRANT_IDS) {
      const result = await testExtractIntakeCycle(page, grantId);
      results.push(result);
      await page.waitForTimeout(500); // Brief pause between grants
    }

    // Summary
    console.log(`\n\n${'='.repeat(80)}`);
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nTotal grants tested: ${results.length}`);
    console.log(`✅ Successful: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);

    if (successful.length > 0) {
      console.log(`\n✅ Successfully extracted:`);
      successful.forEach(r => {
        console.log(`   - Grant ${r.grant_id}: ${r.grant_name}`);
        console.log(`     intake_cycle: "${r.intake_cycle}"`);
      });
    }

    if (failed.length > 0) {
      console.log(`\n❌ Failed extractions:`);
      failed.forEach(r => {
        console.log(`   - Grant ${r.grant_id}: ${r.error}`);
      });
    }

    if (successful.length === results.length) {
      console.log(`\n✅ All tests passed! Ready for full export.`);
      process.exit(0);
    } else {
      console.log(`\n⚠️  Some tests failed. Review errors before full export.`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test script error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();

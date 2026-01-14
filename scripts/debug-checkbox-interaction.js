/**
 * Debug: Find and interact with checkboxes using various strategies
 */

import { chromium } from 'playwright';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = 'writers+1@granted.ca';
const LOGIN_PASSWORD = 'Writers-2025';

async function debug() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Login
  await page.goto(`${GETGRANTED_URL}/users/sign_in`);
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
  console.log('✅ Logged in\n');

  // Visit admin search
  console.log('Visiting admin search...');
  await page.goto(`${GETGRANTED_URL}/admin/grants/search`);
  await page.waitForTimeout(3000);

  // Try to find all checkboxes
  console.log('\n🔍 Finding all checkboxes...');
  const allCheckboxes = await page.locator('input[type="checkbox"]').all();
  console.log(`Found ${allCheckboxes.length} total checkboxes\n`);

  // Get text near each checkbox
  for (let i = 0; i < Math.min(allCheckboxes.length, 20); i++) {
    const checkbox = allCheckboxes[i];
    const id = await checkbox.getAttribute('id');
    const name = await checkbox.getAttribute('name');
    const isChecked = await checkbox.isChecked();
    const label = await page.locator(`label[for="${id}"]`).textContent().catch(() => 'No label');

    console.log(`[${i}] ID: ${id}, Name: ${name}, Checked: ${isChecked}, Label: ${label.substring(0, 50)}`);
  }

  console.log('\n\n🎯 Now trying to check specific checkboxes...\n');

  // Try finding and checking "Show Active Grants"
  console.log('Looking for "Show Active Grants"...');
  const activeVariations = [
    'input[id*="active" i]',
    'input[name*="active" i]',
    'input#grant_profile_admin_search_include_active',
  ];

  for (const selector of activeVariations) {
    const checkbox = page.locator(selector).first();
    if (await checkbox.count() > 0) {
      console.log(`  ✅ Found with selector: ${selector}`);
      await checkbox.check();
      console.log(`  ✅ Checked!`);
      break;
    }
  }

  // Try finding "Show Inactive Grants"
  console.log('\nLooking for "Show Inactive Grants"...');
  const inactiveVariations = [
    'input[id*="inactive" i]',
    'input[name*="inactive" i]',
    'input#grant_profile_admin_search_include_inactive',
  ];

  for (const selector of inactiveVariations) {
    const checkbox = page.locator(selector).first();
    if (await checkbox.count() > 0) {
      console.log(`  ✅ Found with selector: ${selector}`);
      await checkbox.check();
      console.log(`  ✅ Checked!`);
      break;
    }
  }

  // Try finding purpose checkboxes
  console.log('\nLooking for purpose checkboxes...');
  const purposeVariations = [
    'input[name*="purpose" i]',
    'input[id*="purpose" i]',
  ];

  for (const selector of purposeVariations) {
    const checkboxes = await page.locator(selector).all();
    if (checkboxes.length > 0) {
      console.log(`  ✅ Found ${checkboxes.length} purpose checkboxes with: ${selector}`);

      // Check first few
      for (let i = 0; i < Math.min(checkboxes.length, 11); i++) {
        const cb = checkboxes[i];
        const id = await cb.getAttribute('id');
        const val = await cb.getAttribute('value');
        await cb.check();
        console.log(`    Checked [${i}]: ${id} = ${val}`);
      }
      break;
    }
  }

  console.log('\n⏳ Waiting for results to load...');
  await page.waitForTimeout(5000);

  // Check results
  const pageText = await page.textContent('body');
  const grantLinks = await page.locator('a[href*="/grants/"][href*="/admin/" i]').count();

  console.log(`\n📊 Results:`);
  console.log(`  Grant links: ${grantLinks}`);

  const countMatch = pageText.match(/Showing.*?(\d+).*?of\s+(\d+)\s+grants?/i);
  if (countMatch) {
    console.log(`  Count: Showing ${countMatch[1]} of ${countMatch[2]} grants`);
  }

  if (pageText.includes('No Grants found')) {
    console.log(`  ❌ Still seeing "No Grants found" error`);
  } else {
    console.log(`  ✅ No error message!`);
  }

  // Save HTML for inspection
  const html = await page.content();
  const fs = await import('fs');
  fs.default.writeFileSync('/tmp/admin-search.html', html);
  console.log('\n💾 HTML saved to /tmp/admin-search.html');

  await browser.close();
}

debug().catch(console.error);

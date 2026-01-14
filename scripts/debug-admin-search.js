/**
 * Debug: Check admin search page structure
 */

import { chromium } from 'playwright';
import fs from 'fs';

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
  await page.waitForTimeout(2000);

  // Check "Show Active Grants" checkbox
  console.log('Selecting active grants...');
  const activeCheckbox = page.locator('label:has-text("Show Active Grants") input[type="checkbox"]').first();
  if (await activeCheckbox.count() > 0) {
    await activeCheckbox.check();
    console.log('  ✅ Active grants checkbox checked');
  }

  // Check "Show Inactive Grants" checkbox
  console.log('Selecting inactive grants...');
  const inactiveCheckbox = page.locator('label:has-text("Show Inactive Grants") input[type="checkbox"]').first();
  if (await inactiveCheckbox.count() > 0) {
    await inactiveCheckbox.check();
    console.log('  ✅ Inactive grants checkbox checked');
  }

  // Check all Purpose checkboxes
  console.log('Selecting all grant purposes...');
  const purposeLabels = [
    'Hiring', 'Training', 'Market Expansion', 'Capital Costs',
    'Business Assessments, Planning & Coaching', 'Systems & Processes',
    'Loan', 'Contests & Prizes', 'Investment', 'Research & Development', 'Rebates'
  ];

  let checkedCount = 0;
  for (const purpose of purposeLabels) {
    const checkbox = page.locator(`label:has-text("${purpose}") input[type="checkbox"]`).first();
    if (await checkbox.count() > 0) {
      await checkbox.check();
      checkedCount++;
    }
  }
  console.log(`  ✅ Checked ${checkedCount} purpose checkboxes`);

  // Wait for results to load
  console.log('Waiting for search results...');
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({ path: '/tmp/admin-search.png', fullPage: true });
  console.log('Screenshot: /tmp/admin-search.png');

  // Get page text
  const text = await page.textContent('body');
  fs.writeFileSync('/tmp/admin-search.txt', text);
  console.log('Text saved: /tmp/admin-search.txt');

  // Count grant links
  const grantLinks = await page.locator('a[href*="/grants/"]').count();
  console.log(`\nGrant links found: ${grantLinks}`);

  // Find pagination/count text
  const matches = [
    text.match(/(\d+)\s+grants?/gi),
    text.match(/Showing.*?(\d+)/gi),
    text.match(/Total.*?(\d+)/gi),
    text.match(/(\d+)\s+results?/gi)
  ].filter(Boolean);

  console.log('\nPossible count indicators:');
  matches.forEach(m => console.log('  -', m));

  await browser.close();
}

debug().catch(console.error);

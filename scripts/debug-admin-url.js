/**
 * Debug: Test different URL approaches for admin search
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

  // Try URL with all purposes in the parameters
  const purposes = [
    'Hiring', 'Training', 'Market+Expansion', 'Capital+Costs',
    'Business+Assessments%2C+Planning+%26+Coaching', 'Systems+%26+Processes',
    'Loan', 'Contests+%26+Prizes', 'Investment', 'Research+%26+Development', 'Rebates'
  ];

  // Build URL with active, inactive, and all purposes
  const params = new URLSearchParams();
  params.set('grant_profile[admin_search_include_active]', '1');
  params.set('grant_profile[admin_search_include_inactive]', '1');

  // Add all purposes
  purposes.forEach(purpose => {
    params.append('grant_profile[purposes][]', purpose.replace(/\+/g, ' ').replace(/%2C/g, ',').replace(/%26/g, '&'));
  });

  const url = `${GETGRANTED_URL}/admin/grants/search?${params.toString()}`;

  console.log('Testing URL with purposes...');
  console.log(`URL: ${url.substring(0, 150)}...\n`);

  await page.goto(url);
  await page.waitForTimeout(5000);

  // Check results
  const pageText = await page.textContent('body');
  const grantLinks = await page.locator('a[href*="/grants/"]').count();

  console.log(`Grant links found: ${grantLinks}`);

  // Look for count
  const countMatch = pageText.match(/Showing.*?(\d+).*?of\s+(\d+)\s+grants?/i);
  if (countMatch) {
    console.log(`\nGrant count: Showing ${countMatch[1]} of ${countMatch[2]} grants`);
  } else {
    console.log('\nNo count found in page text');
  }

  // Check for error message
  if (pageText.includes('No Grants found')) {
    console.log('❌ Still showing "No Grants found" message');
  } else {
    console.log('✅ No error message found!');
  }

  await page.screenshot({ path: '/tmp/admin-url-test.png', fullPage: true });
  console.log('\nScreenshot: /tmp/admin-url-test.png');

  await browser.close();
}

debug().catch(console.error);

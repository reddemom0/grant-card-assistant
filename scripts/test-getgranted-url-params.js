/**
 * Test GetGranted URL Parameters
 * See if we can get more results by manipulating URL
 */

import { chromium } from 'playwright';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = 'writers+1@granted.ca';
const LOGIN_PASSWORD = 'Writers-2025';

async function testURLParams() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Login
    console.log('Logging in...');
    await page.goto(`${GETGRANTED_URL}/users/sign_in`);
    await page.fill('input[type="email"]', LOGIN_EMAIL);
    await page.fill('input[type="password"]', LOGIN_PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);
    console.log(`Logged in: ${page.url()}\n`);

    // Test different URL parameters
    const urlsToTest = [
      '/grants',
      '/grants?per_page=200',
      '/grants?limit=200',
      '/grants?page_size=200',
      '/grants?all=true',
      '/grants?show_all=true',
      '/grants.json',
      '/api/grants',
    ];

    for (const url of urlsToTest) {
      console.log(`Testing: ${url}`);
      await page.goto(`${GETGRANTED_URL}${url}`);
      await page.waitForTimeout(2000);

      const grantCount = await page.locator('.grant-card, [data-testid="grant-item"]').count();
      console.log(`  → Found ${grantCount} grants\n`);

      if (grantCount > 12) {
        console.log(`✅ SUCCESS! ${url} returns ${grantCount} grants!`);
        break;
      }
    }

  } finally {
    await browser.close();
  }
}

testURLParams();

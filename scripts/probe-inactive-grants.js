/**
 * Probe: find the correct inactive grants URL and page structure
 */
import { chromium } from 'playwright';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

// Login
await page.goto(`${GETGRANTED_URL}/users/sign_in`);
await page.locator('input[type="email"]').fill(LOGIN_EMAIL);
await page.locator('input[type="password"]').fill(LOGIN_PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/(grants|dashboard|admin)/, { timeout: 15000 });
console.log('✅ Logged in');

// Go to grants page and look for inactive toggle
await page.goto(`${GETGRANTED_URL}/grants`);
await page.waitForTimeout(3000);
console.log('Current URL:', page.url());

// Look for inactive-related links/buttons
const allLinks = await page.locator('a, button').all();
for (const el of allLinks) {
  const text = await el.textContent().catch(() => '');
  const href = await el.getAttribute('href').catch(() => '');
  if (text && (text.toLowerCase().includes('inactive') || text.toLowerCase().includes('closed') || text.toLowerCase().includes('all grants'))) {
    console.log(`Found element: text="${text.trim()}" href="${href}"`);
  }
}

// Also try common inactive URL patterns
const urlsToTry = [
  '/grants?active=false',
  '/grants?status=inactive',
  '/grants?grant_profile[include_inactive]=1',
  '/grants?show_inactive=1',
  '/grants?type=inactive',
  '/grants/inactive',
];

for (const path of urlsToTry) {
  await page.goto(`${GETGRANTED_URL}${path}`);
  await page.waitForTimeout(2000);
  const finalUrl = page.url();
  const links = await page.locator('a[href*="/grants/"]').count();
  console.log(`${path} → ${finalUrl} — grant links: ${links}`);
}

await browser.close();

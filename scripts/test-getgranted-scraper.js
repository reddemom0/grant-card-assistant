/**
 * Test GetGranted Scraper
 * Debug why only 12 grants are returned
 */

import { chromium } from 'playwright';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

async function testScraper() {
  console.log('🔍 Testing GetGranted scraper...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // 1. Login
    console.log('1️⃣ Logging in to GetGranted...');
    await page.goto(`${GETGRANTED_URL}/users/sign_in`);
    await page.fill('input[type="email"]', LOGIN_EMAIL);
    await page.fill('input[type="password"]', LOGIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000); // Wait for login to complete
    console.log(`   ✓ Logged in (current URL: ${page.url()})\n`);

    // 2. Navigate to grants page (might be /grants or /admin/grants)
    console.log('2️⃣ Navigating to grants page...');
    const currentUrl = page.url();
    if (!currentUrl.includes('/grants')) {
      await page.goto(`${GETGRANTED_URL}/grants`);
    }
    await page.waitForTimeout(3000);
    console.log(`   ✓ On grants page: ${page.url()}\n`);

    // 3. Check page structure BEFORE scrolling
    console.log('3️⃣ Checking page structure BEFORE scrolling...');

    const grantCardsBefore = await page.locator('.grant-card').count();
    console.log(`   Grant cards (.grant-card): ${grantCardsBefore}`);

    const anyDivs = await page.locator('div').count();
    console.log(`   Total divs on page: ${anyDivs}`);

    const linksToGrants = await page.locator('a[href*="/grants/"]').count();
    console.log(`   Links to /grants/: ${linksToGrants}`);

    // Take screenshot before scrolling
    await page.screenshot({ path: '/tmp/getgranted-before-scroll.png', fullPage: true });
    console.log('   📸 Screenshot: /tmp/getgranted-before-scroll.png\n');

    // 4. Scroll and observe
    console.log('4️⃣ Scrolling to trigger lazy loading...');
    for (let i = 0; i < 10; i++) {
      console.log(`   Scroll ${i + 1}/10...`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

      const currentCount = await page.locator('.grant-card').count();
      console.log(`      Current grant count: ${currentCount}`);

      if (i % 3 === 0) {
        // Check if more items loaded
        const newLinks = await page.locator('a[href*="/grants/"]').count();
        console.log(`      Links to grants: ${newLinks}`);
      }
    }
    console.log('   ✓ Scrolling complete\n');

    // 5. Scroll back to top and wait
    console.log('5️⃣ Scrolling back to top...');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2000);
    console.log('   ✓ Back at top\n');

    // 6. Check page structure AFTER scrolling
    console.log('6️⃣ Checking page structure AFTER scrolling...');

    const grantCardsAfter = await page.locator('.grant-card').count();
    console.log(`   Grant cards (.grant-card): ${grantCardsAfter}`);

    const linksAfter = await page.locator('a[href*="/grants/"]').count();
    console.log(`   Links to /grants/: ${linksAfter}`);

    // Take screenshot after scrolling
    await page.screenshot({ path: '/tmp/getgranted-after-scroll.png', fullPage: true });
    console.log('   📸 Screenshot: /tmp/getgranted-after-scroll.png\n');

    // 7. Inspect a single grant card
    console.log('7️⃣ Inspecting first grant card structure...');
    if (grantCardsAfter > 0) {
      const firstCard = page.locator('.grant-card').first();
      const cardHTML = await firstCard.innerHTML();
      console.log('   First card HTML (truncated):');
      console.log(cardHTML.substring(0, 500) + '...\n');
    }

    // 8. Check for pagination or load-more button
    console.log('8️⃣ Looking for pagination/load-more elements...');
    const loadMoreButton = await page.locator('button:has-text("Load more"), button:has-text("Show more")').count();
    console.log(`   "Load more" buttons: ${loadMoreButton}`);

    const pagination = await page.locator('[class*="pagination"], [class*="Pagination"]').count();
    console.log(`   Pagination elements: ${pagination}`);

    const nextButton = await page.locator('button:has-text("Next"), a:has-text("Next")').count();
    console.log(`   "Next" buttons: ${nextButton}\n`);

    // 9. Check if there's a grants counter/total
    console.log('9️⃣ Looking for grant count indicator...');
    const pageText = await page.textContent('body');
    const countMatches = pageText.match(/showing\s+(\d+)\s+of\s+(\d+)/i) ||
                        pageText.match(/(\d+)\s+grants?\s+found/i) ||
                        pageText.match(/total:\s*(\d+)/i);
    if (countMatches) {
      console.log(`   Found count indicator: ${countMatches[0]}`);
    } else {
      console.log('   No count indicator found');
    }

    console.log('\n✅ Test complete.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

testScraper();

/**
 * Export Full GetGranted Database
 *
 * One-time script to extract ALL grants from GetGranted and save to JSON.
 * This will be imported into Postgres for local semantic search.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

async function exportFullDatabase() {
  console.log('🚀 Starting full GetGranted database export...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const allGrants = [];

  try {
    const page = await browser.newPage();

    // Login (using proven pattern from getgranted-search.js)
    console.log('1️⃣ Logging in...');
    await page.goto(`${GETGRANTED_URL}/users/sign_in`);
    await page.waitForLoadState('domcontentloaded');

    // Try multiple selector strategies for email field
    let emailField = page.locator('input[type="email"]').first();
    let emailFieldExists = await emailField.count() > 0;

    if (!emailFieldExists) {
      emailField = page.locator('input[name="user[email]"]').first();
      emailFieldExists = await emailField.count() > 0;
    }

    if (!emailFieldExists) {
      emailField = page.locator('input[placeholder*="Email" i]').first();
      emailFieldExists = await emailField.count() > 0;
    }

    if (!emailFieldExists) {
      await page.screenshot({ path: '/tmp/getgranted-export-error.png', fullPage: true });
      throw new Error('Could not find email input field');
    }

    await emailField.fill(LOGIN_EMAIL);
    console.log('   ✓ Email filled');

    // Try multiple selector strategies for password field
    let passwordField = page.locator('input[type="password"]').first();
    let passwordFieldExists = await passwordField.count() > 0;

    if (!passwordFieldExists) {
      passwordField = page.locator('input[name="user[password]"]').first();
      passwordFieldExists = await passwordField.count() > 0;
    }

    if (!passwordFieldExists) {
      await page.screenshot({ path: '/tmp/getgranted-export-error.png', fullPage: true });
      throw new Error('Could not find password input field');
    }

    await passwordField.fill(LOGIN_PASSWORD);
    console.log('   ✓ Password filled');

    // Find and click submit button
    let submitButton = page.locator('button[type="submit"]').first();
    let submitExists = await submitButton.count() > 0;

    if (!submitExists) {
      submitButton = page.locator('input[type="submit"]').first();
      submitExists = await submitButton.count() > 0;
    }

    if (!submitExists) {
      submitButton = page.locator('button:has-text("Log in"), button:has-text("Sign in")').first();
      submitExists = await submitButton.count() > 0;
    }

    if (!submitExists) {
      await page.screenshot({ path: '/tmp/getgranted-export-error.png', fullPage: true });
      throw new Error('Could not find submit button');
    }

    await submitButton.click();
    console.log('   ✓ Submit clicked');

    // Wait for navigation
    await page.waitForURL(/\/(grants|dashboard|admin)/, { timeout: 15000 });
    console.log(`   ✅ Logged in successfully (URL: ${page.url()})\n`);

    // Navigate to grants page (remove all filters)
    console.log('2️⃣ Navigating to grants page with no filters...');
    await page.goto(`${GETGRANTED_URL}/grants`);
    await page.waitForTimeout(3000);
    console.log('   ✓ On grants page\n');

    // Get total count if visible
    console.log('3️⃣ Checking total grant count...');
    const pageText = await page.textContent('body');
    const countMatch = pageText.match(/showing\s+\d+\s+of\s+(\d+)|(\d+)\s+grants?\s+found|total:\s*(\d+)/i);
    const estimatedTotal = countMatch ? parseInt(countMatch[1] || countMatch[2] || countMatch[3]) : 200;
    console.log(`   Estimated total: ${estimatedTotal} grants\n`);

    // Strategy: Try pagination if it exists, otherwise infinite scroll
    console.log('4️⃣ Checking for pagination...');

    // Check if there's a "Next" button or page numbers
    const hasNextButton = await page.locator('button:has-text("Next"), a:has-text("Next")').count() > 0;
    const hasPagination = await page.locator('[class*="pagination"], [class*="Pagination"]').count() > 0;

    if (hasNextButton || hasPagination) {
      console.log('   ✓ Found pagination - will use page navigation\n');
      await extractWithPagination(page, allGrants, estimatedTotal);
    } else {
      console.log('   ✗ No pagination found - will try infinite scroll\n');
      await extractWithInfiniteScroll(page, allGrants, estimatedTotal);
    }

    // Save to JSON
    console.log(`\n5️⃣ Saving ${allGrants.length} grants to JSON...`);
    const outputPath = path.join(process.cwd(), 'data', 'getgranted-full-export.json');

    // Create data directory if it doesn't exist
    const dataDir = path.dirname(outputPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify({
      exported_at: new Date().toISOString(),
      total_grants: allGrants.length,
      grants: allGrants
    }, null, 2));

    console.log(`   ✓ Saved to: ${outputPath}\n`);

    // Summary
    console.log('📊 Export Summary:');
    console.log(`   Total grants exported: ${allGrants.length}`);
    console.log(`   Unique grant types: ${[...new Set(allGrants.map(g => g.grant_type))].length}`);
    console.log(`   Grants with IDs: ${allGrants.filter(g => g.grant_id && g.grant_id !== 'Unknown').length}`);
    console.log(`   Grants with regions: ${allGrants.filter(g => g.regions && g.regions !== '').length}`);

  } catch (error) {
    console.error('❌ Export failed:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
  }

  return allGrants;
}

/**
 * Extract grants using pagination (Next button or page numbers)
 */
async function extractWithPagination(page, allGrants, estimatedTotal) {
  let pageNum = 1;
  let hasMore = true;

  while (hasMore && allGrants.length < estimatedTotal + 50) {
    console.log(`📄 Extracting page ${pageNum}...`);

    // Extract grants on current page
    const pageGrants = await extractGrantsFromPage(page);
    console.log(`   Found ${pageGrants.length} grants on page ${pageNum}`);

    allGrants.push(...pageGrants);

    // Try to click Next button
    const nextButton = page.locator('button:has-text("Next"), a:has-text("Next")').first();
    const nextExists = await nextButton.count() > 0;

    if (nextExists) {
      const isDisabled = await nextButton.isDisabled().catch(() => true);
      if (!isDisabled) {
        await nextButton.click();
        await page.waitForTimeout(2000); // Wait for new page to load
        pageNum++;
      } else {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }

    console.log(`   Total so far: ${allGrants.length}\n`);
  }
}

/**
 * Extract grants using infinite scroll
 */
async function extractWithInfiniteScroll(page, allGrants, estimatedTotal) {
  let lastCount = 0;
  let stableIterations = 0;
  const maxStableIterations = 3; // Stop if count doesn't change for 3 iterations

  for (let i = 0; i < 50 && stableIterations < maxStableIterations; i++) {
    console.log(`📜 Scroll iteration ${i + 1}...`);

    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Check current count
    const currentGrants = await page.locator('.grant-card, [data-testid="grant-item"]').count();
    console.log(`   Visible grants: ${currentGrants}`);

    if (currentGrants === lastCount) {
      stableIterations++;
      console.log(`   No new grants loaded (stable: ${stableIterations}/${maxStableIterations})`);
    } else {
      stableIterations = 0;
      lastCount = currentGrants;
    }
  }

  // Extract all visible grants
  console.log(`\n📝 Extracting all visible grants...`);
  const grants = await extractGrantsFromPage(page);
  allGrants.push(...grants);
}

/**
 * Extract grants from current page view
 */
async function extractGrantsFromPage(page) {
  const grants = [];

  // Try multiple selector strategies
  let grantItems = page.locator('.grant-card');
  let count = await grantItems.count();

  if (count === 0) {
    grantItems = page.locator('[data-testid="grant-item"]');
    count = await grantItems.count();
  }

  if (count === 0) {
    grantItems = page.locator('a[href*="/grants/"]').locator('..');
    count = await grantItems.count();
  }

  console.log(`   Extracting from ${count} grant cards...`);

  for (let i = 0; i < count; i++) {
    const item = grantItems.nth(i);

    try {
      // Extract grant name
      const nameElement = item.locator('a, h2, h3').first();
      const grantName = await nameElement.textContent({ timeout: 2000 }).catch(() => 'Unknown Grant');

      // Extract grant ID from href or text
      const link = await item.locator('a[href*="/grants/"]').first().getAttribute('href').catch(() => '');
      const grantId = link.match(/\/grants\/(\d+)/)?.[1] || '';

      // Extract grant type
      const grantType = await item.locator('text=/MARKET EXPANSION|HIRING|TRAINING|CAPITAL|INVESTMENT|R&D|RESEARCH/i')
        .textContent({ timeout: 1000 })
        .catch(() => '');

      // Extract regions
      const regionsText = await item.locator('text=/CANADA|COLUMBIA|ONTARIO|ALBERTA|QUEBEC/i')
        .textContent({ timeout: 1000 })
        .catch(() => '');

      // Extract all text for full context
      const fullText = await item.textContent().catch(() => '');

      grants.push({
        grant_id: grantId,
        grant_name: grantName.trim(),
        grant_type: grantType.trim(),
        regions: regionsText.trim(),
        full_text: fullText.trim(),
        url: link ? `${GETGRANTED_URL}${link}` : '',
        extracted_at: new Date().toISOString()
      });

    } catch (error) {
      console.warn(`   ⚠️  Failed to extract grant ${i}: ${error.message}`);
    }
  }

  return grants;
}

// Run export
exportFullDatabase()
  .then(grants => {
    console.log(`\n✅ Export complete! ${grants.length} grants exported.`);
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Export failed:', error);
    process.exit(1);
  });

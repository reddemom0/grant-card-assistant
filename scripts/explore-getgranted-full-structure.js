/**
 * Explore GetGranted Full Data Structure
 *
 * Investigates what data is available on:
 * 1. Individual grant detail pages (e.g., /grants/741)
 * 2. Company/user lists (self_serve, starter_client, gcc_client)
 * 3. Grant Genie questionnaires
 */

import { chromium } from 'playwright';
import fs from 'fs';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

async function exploreStructure() {
  console.log('🔍 Exploring GetGranted data structure...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Login
    console.log('1️⃣ Logging in...');
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
    console.log(`   ✅ Logged in: ${page.url()}\n`);

    // ======= 1. EXPLORE GRANT DETAIL PAGE =======
    console.log('2️⃣ Exploring grant detail page structure...');
    await page.goto(`${GETGRANTED_URL}/grants/741`);
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: '/tmp/grant-detail-page.png', fullPage: true });
    console.log('   📸 Screenshot: /tmp/grant-detail-page.png');

    // Extract all text
    const grantDetailText = await page.textContent('body');
    fs.writeFileSync('/tmp/grant-detail-text.txt', grantDetailText);
    console.log('   📝 Text saved: /tmp/grant-detail-text.txt');

    // Look for structured data
    console.log('\n   🔎 Looking for structured data elements:');
    const headings = await page.locator('h1, h2, h3, h4').allTextContents();
    console.log(`      Found ${headings.length} headings`);
    console.log(`      Sample: ${headings.slice(0, 5).join(' | ')}`);

    const tables = await page.locator('table').count();
    console.log(`      Found ${tables} tables`);

    const definitionLists = await page.locator('dl').count();
    console.log(`      Found ${definitionLists} definition lists`);

    // Check for specific grant data fields
    const bodyHTML = await page.innerHTML('body');
    const hasDeadline = bodyHTML.includes('deadline') || bodyHTML.includes('Deadline');
    const hasBudget = bodyHTML.includes('budget') || bodyHTML.includes('Budget');
    const hasDifficulty = bodyHTML.includes('difficulty') || bodyHTML.includes('Difficulty');
    const hasEligibility = bodyHTML.includes('eligibility') || bodyHTML.includes('Eligibility');
    console.log(`      Has deadline info: ${hasDeadline}`);
    console.log(`      Has budget info: ${hasBudget}`);
    console.log(`      Has difficulty info: ${hasDifficulty}`);
    console.log(`      Has eligibility info: ${hasEligibility}`);

    // ======= 2. EXPLORE COMPANY LISTS =======
    console.log('\n3️⃣ Exploring company/user lists...');

    const companyTypes = [
      { name: 'Self-Serve Users', url: `${GETGRANTED_URL}/admin/users/company?company_type=self_serve` },
      { name: 'Starter Clients', url: `${GETGRANTED_URL}/admin/users/company?company_type=starter_client` },
      { name: 'GCC Clients', url: `${GETGRANTED_URL}/admin/users/gcc_client` }
    ];

    for (const companyType of companyTypes) {
      console.log(`\n   📊 ${companyType.name}:`);
      await page.goto(companyType.url);
      await page.waitForTimeout(2000);

      // Count companies
      const companyRows = await page.locator('tr, .company-row, [data-testid="company-row"]').count();
      console.log(`      Visible rows: ${companyRows}`);

      // Check for pagination
      const hasPagination = await page.locator('[class*="pagination"], button:has-text("Next")').count() > 0;
      console.log(`      Has pagination: ${hasPagination}`);

      // Sample first row structure
      const firstRow = page.locator('tr').nth(1);
      const firstRowText = await firstRow.textContent().catch(() => 'N/A');
      console.log(`      Sample row: ${firstRowText.substring(0, 100)}...`);

      // Take screenshot
      await page.screenshot({ path: `/tmp/companies-${companyType.name.replace(/\s+/g, '-').toLowerCase()}.png`, fullPage: true });
      console.log(`      📸 Screenshot: /tmp/companies-${companyType.name.replace(/\s+/g, '-').toLowerCase()}.png`);
    }

    // ======= 3. EXPLORE QUESTIONNAIRES =======
    console.log('\n4️⃣ Exploring Grant Genie questionnaires...');
    await page.goto(`${GETGRANTED_URL}/admin/genie/questionnaires?q%5Bs%5D=name+asc`);
    await page.waitForTimeout(2000);

    // Count questionnaires
    const questionnaireRows = await page.locator('tr, .questionnaire-row').count();
    console.log(`   Visible questionnaire rows: ${questionnaireRows}`);

    // Check for pagination
    const qPagination = await page.locator('[class*="pagination"], button:has-text("Next")').count() > 0;
    console.log(`   Has pagination: ${qPagination}`);

    // Get questionnaire names
    const qLinks = await page.locator('a[href*="/genie/questionnaires/"]').allTextContents();
    console.log(`   Found ${qLinks.length} questionnaire links`);
    console.log(`   Sample questionnaires: ${qLinks.slice(0, 10).join(', ')}`);

    // Take screenshot
    await page.screenshot({ path: '/tmp/questionnaires.png', fullPage: true });
    console.log('   📸 Screenshot: /tmp/questionnaires.png');

    // Click into first questionnaire to see detail structure
    if (qLinks.length > 0) {
      console.log('\n   🔎 Exploring questionnaire detail page...');
      const firstQLink = page.locator('a[href*="/genie/questionnaires/"]').first();
      await firstQLink.click();
      await page.waitForTimeout(2000);

      const qDetailText = await page.textContent('body');
      fs.writeFileSync('/tmp/questionnaire-detail-text.txt', qDetailText);
      console.log('      📝 Detail text saved: /tmp/questionnaire-detail-text.txt');

      await page.screenshot({ path: '/tmp/questionnaire-detail.png', fullPage: true });
      console.log('      📸 Screenshot: /tmp/questionnaire-detail.png');

      // Look for questions
      const questions = await page.locator('label, .question, [data-testid="question"]').count();
      console.log(`      Found ~${questions} question elements`);
    }

    console.log('\n✅ Exploration complete!');
    console.log('\n📁 Files created:');
    console.log('   /tmp/grant-detail-page.png');
    console.log('   /tmp/grant-detail-text.txt');
    console.log('   /tmp/companies-*.png');
    console.log('   /tmp/questionnaires.png');
    console.log('   /tmp/questionnaire-detail-*.png');
    console.log('   /tmp/questionnaire-detail-text.txt');

  } catch (error) {
    console.error('❌ Exploration failed:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

exploreStructure()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

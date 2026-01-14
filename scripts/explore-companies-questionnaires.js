/**
 * Deep exploration of company lists and questionnaires
 * Dumps HTML structure and text content for analysis
 */

import { chromium } from 'playwright';
import fs from 'fs';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

async function explore() {
  console.log('🔍 Deep exploration of companies and questionnaires...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Login (using proven pattern)
    console.log('1️⃣ Logging in...');
    await page.goto(`${GETGRANTED_URL}/users/sign_in`);
    await page.waitForLoadState('domcontentloaded');

    // Email field with fallbacks
    let emailField = page.locator('input[type="email"]').first();
    if (await emailField.count() === 0) {
      emailField = page.locator('input[name="user[email]"]').first();
    }
    if (await emailField.count() === 0) {
      emailField = page.locator('input[placeholder*="Email" i]').first();
    }
    await emailField.fill(LOGIN_EMAIL);

    // Password field with fallbacks
    let passwordField = page.locator('input[type="password"]').first();
    if (await passwordField.count() === 0) {
      passwordField = page.locator('input[name="user[password]"]').first();
    }
    await passwordField.fill(LOGIN_PASSWORD);

    // Submit button with fallbacks
    let submitButton = page.locator('button[type="submit"]').first();
    if (await submitButton.count() === 0) {
      submitButton = page.locator('input[type="submit"]').first();
    }
    await submitButton.click();

    await page.waitForURL(/\/(grants|dashboard|admin)/, { timeout: 15000 });
    console.log('   ✅ Logged in\n');

    // ========== COMPANIES ==========
    const companyUrls = [
      { name: 'self_serve', url: `${GETGRANTED_URL}/admin/users/company?company_type=self_serve` },
      { name: 'starter_client', url: `${GETGRANTED_URL}/admin/users/company?company_type=starter_client` },
      { name: 'gcc_client', url: `${GETGRANTED_URL}/admin/users/gcc_client` }
    ];

    for (const company of companyUrls) {
      console.log(`2️⃣ Exploring ${company.name}...`);
      await page.goto(company.url);
      await page.waitForTimeout(2000);

      // Save full page HTML
      const html = await page.content();
      fs.writeFileSync(`/tmp/company-${company.name}.html`, html);
      console.log(`   💾 Saved HTML: /tmp/company-${company.name}.html`);

      // Save full text
      const text = await page.textContent('body');
      fs.writeFileSync(`/tmp/company-${company.name}.txt`, text);
      console.log(`   📝 Saved text: /tmp/company-${company.name}.txt`);

      // Try to find table
      const tables = await page.locator('table').count();
      console.log(`   Tables found: ${tables}`);

      if (tables > 0) {
        const tableHTML = await page.locator('table').first().innerHTML();
        console.log(`   First table rows: ${(tableHTML.match(/<tr/g) || []).length}`);

        // Try to get table rows
        const rows = await page.locator('table tr').count();
        console.log(`   Table rows via locator: ${rows}`);

        if (rows > 1) {
          // Get first 3 data rows
          for (let i = 1; i < Math.min(4, rows); i++) {
            const rowText = await page.locator('table tr').nth(i).textContent();
            console.log(`   Row ${i}: ${rowText.substring(0, 100)}...`);
          }
        }
      }

      // Try to find cards/divs
      const cards = await page.locator('[class*="company"], [class*="client"], [class*="card"]').count();
      console.log(`   Cards/company elements: ${cards}`);

      // Check for pagination info
      const paginationText = await page.locator('[class*="pagination"]').first().textContent().catch(() => '');
      console.log(`   Pagination: ${paginationText.substring(0, 50)}`);

      console.log('');
    }

    // ========== QUESTIONNAIRES ==========
    console.log('3️⃣ Exploring questionnaires...');
    await page.goto(`${GETGRANTED_URL}/admin/genie/questionnaires?q%5Bs%5D=name+asc`);
    await page.waitForTimeout(2000);

    // Save HTML and text
    const qHTML = await page.content();
    fs.writeFileSync('/tmp/questionnaires.html', qHTML);
    console.log('   💾 Saved HTML: /tmp/questionnaires.html');

    const qText = await page.textContent('body');
    fs.writeFileSync('/tmp/questionnaires.txt', qText);
    console.log('   📝 Saved text: /tmp/questionnaires.txt');

    // Find questionnaire links
    const qLinks = await page.locator('a[href*="/genie/questionnaires/"]').all();
    console.log(`   Found ${qLinks.length} questionnaire links`);

    for (let i = 0; i < Math.min(3, qLinks.length); i++) {
      const href = await qLinks[i].getAttribute('href');
      const text = await qLinks[i].textContent();
      console.log(`   Link ${i + 1}: ${text} -> ${href}`);
    }

    // Click first questionnaire to see detail
    if (qLinks.length > 0) {
      console.log('\n4️⃣ Exploring first questionnaire detail...');
      await qLinks[0].click();
      await page.waitForTimeout(2000);

      const qDetailHTML = await page.content();
      fs.writeFileSync('/tmp/questionnaire-detail.html', qDetailHTML);
      console.log('   💾 Saved detail HTML: /tmp/questionnaire-detail.html');

      const qDetailText = await page.textContent('body');
      fs.writeFileSync('/tmp/questionnaire-detail.txt', qDetailText);
      console.log('   📝 Saved detail text: /tmp/questionnaire-detail.txt');

      // Look for questions/form fields
      const inputs = await page.locator('input, select, textarea').count();
      const labels = await page.locator('label').count();
      console.log(`   Form inputs: ${inputs}`);
      console.log(`   Labels: ${labels}`);

      // Get form structure
      const forms = await page.locator('form').count();
      console.log(`   Forms: ${forms}`);

      if (forms > 0) {
        const formHTML = await page.locator('form').first().innerHTML();
        fs.writeFileSync('/tmp/questionnaire-form.html', formHTML);
        console.log('   💾 Saved form HTML: /tmp/questionnaire-form.html');
      }
    }

    console.log('\n✅ Exploration complete!');
    console.log('\nFiles created:');
    console.log('   /tmp/company-*.html');
    console.log('   /tmp/company-*.txt');
    console.log('   /tmp/questionnaires.html');
    console.log('   /tmp/questionnaire-detail.html');

  } catch (error) {
    console.error('❌ Exploration failed:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

explore()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

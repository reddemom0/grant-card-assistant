/**
 * Debug: Inspect Intake Cycle HTML Structure
 *
 * Logs into GetGranted and dumps the HTML around the Intake Cycle field
 * for specific grant cards to understand the DOM structure.
 */

import { chromium } from 'playwright';

const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

// Grants to inspect:
// 1 = Career Launcher - Clean Tech Internship (should have Summer, Fall checked)
// We'll search for another grant with Year Round checked
const GRANT_IDS = [1, 85]; // Start with these two

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

async function inspectIntakeCycle(page, grantId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 Inspecting Grant ID: ${grantId}`);
  console.log('='.repeat(80));

  // Visit the ADMIN EDIT page instead of public view
  await page.goto(`${GETGRANTED_URL}/admin/grants/${grantId}/edit`, { timeout: 10000 });
  await page.waitForTimeout(1500);

  // Get grant name
  const grantName = await page.locator('h1, h2, input[name*="grant_name"]').first().inputValue().catch(async () => {
    return await page.locator('h1, h2').first().textContent().catch(() => 'Unknown');
  });
  console.log(`Grant Name: ${grantName.trim()}\n`);

  // Strategy 1: Look for text matching "Intake Cycle"
  console.log('📋 Strategy 1: Looking for "Intake Cycle" text...');
  const intakeCycleText = await page.locator('text=/Intake Cycle/i').all();
  console.log(`   Found ${intakeCycleText.length} elements matching "Intake Cycle"`);

  if (intakeCycleText.length > 0) {
    for (let i = 0; i < intakeCycleText.length; i++) {
      console.log(`\n   Element ${i + 1}:`);
      const element = intakeCycleText[i];

      // Get the parent container
      const parent = element.locator('..');
      const parentHtml = await parent.innerHTML().catch(() => 'Could not get HTML');
      console.log(`   Parent HTML:\n${parentHtml}\n`);
    }
  }

  // Strategy 2: Look for checkboxes near "Summer", "Fall", "Winter", "Year Round"
  console.log('\n📋 Strategy 2: Looking for seasonal checkboxes...');
  const seasonalKeywords = ['Summer', 'Fall', 'Winter', 'Year Round'];

  for (const keyword of seasonalKeywords) {
    const matches = await page.locator(`text=/^${keyword}$/i`).all();
    if (matches.length > 0) {
      console.log(`\n   Found "${keyword}" label(s):`);
      for (let i = 0; i < Math.min(matches.length, 2); i++) {
        const parent = matches[i].locator('..');
        const parentHtml = await parent.innerHTML().catch(() => 'N/A');
        console.log(`      Parent HTML: ${parentHtml.substring(0, 200)}...`);

        // Check if there's a checkbox nearby
        const checkbox = await parent.locator('input[type="checkbox"]').first();
        if (await checkbox.count() > 0) {
          const isChecked = await checkbox.isChecked();
          console.log(`      ✓ Checkbox found, checked: ${isChecked}`);
        }
      }
    }
  }

  // Strategy 3: Get all checkboxes on the page and see if any are seasonal
  console.log('\n📋 Strategy 3: Examining all checkboxes...');
  const allCheckboxes = await page.locator('input[type="checkbox"]').all();
  console.log(`   Total checkboxes on page: ${allCheckboxes.length}`);

  let seasonalCheckboxes = [];
  for (const checkbox of allCheckboxes) {
    const parent = checkbox.locator('..');
    const parentText = await parent.textContent().catch(() => '');
    const isChecked = await checkbox.isChecked().catch(() => false);

    // Check if parent text contains any seasonal keywords
    if (seasonalKeywords.some(kw => parentText.toLowerCase().includes(kw.toLowerCase()))) {
      seasonalCheckboxes.push({
        text: parentText.trim(),
        checked: isChecked,
        html: await parent.innerHTML().catch(() => '')
      });
    }
  }

  if (seasonalCheckboxes.length > 0) {
    console.log(`\n   Found ${seasonalCheckboxes.length} seasonal checkboxes:`);
    seasonalCheckboxes.forEach((cb, idx) => {
      console.log(`\n   Checkbox ${idx + 1}:`);
      console.log(`      Text: ${cb.text}`);
      console.log(`      Checked: ${cb.checked}`);
      console.log(`      HTML: ${cb.html.substring(0, 300)}...`);
    });
  }

  // Strategy 4: Look for data attributes that might indicate intake cycle
  console.log('\n📋 Strategy 4: Looking for data-* attributes...');
  const dataFieldElements = await page.locator('[data-field*="intake"], [data-field*="cycle"], [class*="intake"], [class*="cycle"]').all();
  console.log(`   Found ${dataFieldElements.length} elements with intake/cycle in attributes`);

  if (dataFieldElements.length > 0) {
    for (let i = 0; i < Math.min(dataFieldElements.length, 3); i++) {
      const html = await dataFieldElements[i].innerHTML().catch(() => 'N/A');
      console.log(`\n   Element ${i + 1}:\n${html.substring(0, 500)}...`);
    }
  }

  // Strategy 5: Dump the entire page HTML to file for manual inspection
  console.log('\n📋 Strategy 5: Saving full page HTML for manual inspection...');
  const fullHtml = await page.content();
  const fs = await import('fs');
  const path = await import('path');
  const outputPath = path.default.join(process.cwd(), 'data', `grant-${grantId}-admin-edit.html`);
  fs.default.writeFileSync(outputPath, fullHtml);
  console.log(`   ✓ Saved to: ${outputPath}`);
}

async function main() {
  console.log('🚀 Starting Intake Cycle HTML inspection...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await login(page);

    for (const grantId of GRANT_IDS) {
      await inspectIntakeCycle(page, grantId);
    }

    console.log('\n\n✅ Inspection complete!');
    console.log('📄 Check the data/ directory for full HTML files');

  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });

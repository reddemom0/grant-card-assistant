/**
 * Backfill last_edited_at for all existing grants
 *
 * Visits /admin/grants/{id}/edit_history for each grant in the DB,
 * extracts the topmost edit date, and UPDATEs the column in place.
 * Non-destructive — does not delete or re-insert any rows.
 */

import { chromium } from 'playwright';
import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;
const GETGRANTED_URL = 'https://app.getgranted.ca';
const LOGIN_EMAIL = process.env.GETGRANTED_EMAIL || 'writers+1@granted.ca';
const LOGIN_PASSWORD = process.env.GETGRANTED_PASSWORD || 'Writers-2025';

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Get all grant IDs from DB
  const { rows: grants } = await pool.query('SELECT id, grant_id, grant_name FROM grants ORDER BY grant_id::int');
  console.log(`Found ${grants.length} grants to backfill\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Login
  console.log('🔐 Logging in...');
  await page.goto(`${GETGRANTED_URL}/users/sign_in`);
  await page.waitForLoadState('domcontentloaded');
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

  let updated = 0;
  let nullCount = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < grants.length; i++) {
    const { id, grant_id, grant_name } = grants[i];

    if ((i + 1) % 50 === 0 || i === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[${i + 1}/${grants.length}] ${elapsed}s elapsed — ${updated} updated, ${nullCount} null, ${errors} errors`);
    }

    try {
      await page.goto(`${GETGRANTED_URL}/admin/grants/${grant_id}/edit_history`, { timeout: 10000, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);

      const dateText = await page.locator('.edit-history__table-row td:nth-child(3) p').first().textContent({ timeout: 3000 });

      if (dateText && dateText.trim()) {
        const raw = dateText.trim();
        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime())) {
          await pool.query('UPDATE grants SET last_edited_at = $1 WHERE id = $2', [parsed.toISOString(), id]);
          updated++;
        } else {
          console.warn(`  ⚠️  Grant ${grant_id} (${grant_name}): parse failed for "${raw}"`);
          nullCount++;
        }
      } else {
        console.warn(`  ⚠️  Grant ${grant_id} (${grant_name}): no edit history rows`);
        nullCount++;
      }
    } catch (error) {
      console.warn(`  ❌ Grant ${grant_id} (${grant_name}): ${error.message.substring(0, 100)}`);
      errors++;
    }
  }

  await browser.close();

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n✅ Backfill complete in ${totalTime}s (${Math.round(totalTime / 60)}m)`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Null (no history): ${nullCount}`);
  console.log(`   Errors: ${errors}`);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });

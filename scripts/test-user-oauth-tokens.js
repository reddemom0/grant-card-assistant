/**
 * Manual smoke test for src/database/user-oauth-tokens.js
 *
 * Exercises insert, read-back, COALESCE-on-missing-refresh-token, list, and
 * delete against a real Postgres instance and a real user_id.
 *
 * Env:
 *   DATABASE_URL  (required — same DB the app uses)
 *   TEST_USER_ID  (required — existing users.id; row is created and removed
 *                  for provider 'test-provider', so it must not collide with
 *                  a real provider value)
 *
 * Usage:
 *   TEST_USER_ID=42 npm run test:oauth-tokens
 *
 * Exit codes:
 *   0  all assertions passed
 *   1  precondition missing (env, migration not applied) or assertion failed
 *
 * NOT run as part of npm test. Manual verification only.
 */

import dotenv from 'dotenv';
import {
  getUserOAuthTokens,
  saveUserOAuthTokens,
  deleteUserOAuthTokens,
  listUserConnectedProviders
} from '../src/database/user-oauth-tokens.js';
import { query, closePool } from '../src/database/connection.js';

dotenv.config();

const PROVIDER = 'test-provider';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const TEST_USER_ID = process.env.TEST_USER_ID ? Number(process.env.TEST_USER_ID) : null;
if (!TEST_USER_ID || Number.isNaN(TEST_USER_ID)) {
  console.error('TEST_USER_ID is required (an existing users.id, integer)');
  process.exit(1);
}

function assert(cond, label, expected, actual) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    return;
  }
  console.error(`  ✗ ${label}`);
  console.error(`     expected: ${JSON.stringify(expected)}`);
  console.error(`     actual:   ${JSON.stringify(actual)}`);
  throw new Error(`assertion failed: ${label}`);
}

async function ensureMigrationApplied() {
  const result = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'user_oauth_tokens' LIMIT 1`
  );
  if (result.rows.length === 0) {
    console.error('user_oauth_tokens table missing. Apply migration 019 first:');
    console.error('  node scripts/run-migration.js migrations/019_create_user_oauth_tokens.sql');
    process.exit(1);
  }
}

async function main() {
  console.log(`🔬 user_oauth_tokens smoke test`);
  console.log(`   user_id:  ${TEST_USER_ID}`);
  console.log(`   provider: ${PROVIDER}`);
  console.log('');

  await ensureMigrationApplied();

  // Best-effort cleanup of any leftover row from a prior failed run.
  await deleteUserOAuthTokens(TEST_USER_ID, PROVIDER);

  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);

  console.log('Step 1: initial insert');
  const inserted = await saveUserOAuthTokens(TEST_USER_ID, PROVIDER, {
    access_token: 'A1',
    refresh_token: 'R1',
    token_expiry: futureExpiry,
    server_url: 'https://example.invalid/mcp',
    scope: 'read'
  });
  assert(inserted?.access_token === 'A1', 'inserted access_token', 'A1', inserted?.access_token);
  assert(inserted?.refresh_token === 'R1', 'inserted refresh_token', 'R1', inserted?.refresh_token);

  console.log('Step 2: read-back');
  const read1 = await getUserOAuthTokens(TEST_USER_ID, PROVIDER);
  assert(read1 !== null, 'row exists', 'non-null', read1);
  assert(read1.access_token === 'A1', 'access_token', 'A1', read1.access_token);
  assert(read1.refresh_token === 'R1', 'refresh_token', 'R1', read1.refresh_token);
  assert(read1.server_url === 'https://example.invalid/mcp', 'server_url', 'https://example.invalid/mcp', read1.server_url);
  assert(read1.scope === 'read', 'scope', 'read', read1.scope);

  console.log('Step 3: upsert without refresh_token (COALESCE check)');
  await saveUserOAuthTokens(TEST_USER_ID, PROVIDER, { access_token: 'A2' });
  const read2 = await getUserOAuthTokens(TEST_USER_ID, PROVIDER);
  assert(read2.access_token === 'A2', 'access_token rotated', 'A2', read2.access_token);
  assert(read2.refresh_token === 'R1', 'refresh_token preserved by COALESCE', 'R1', read2.refresh_token);

  console.log('Step 4: listUserConnectedProviders');
  const providers = await listUserConnectedProviders(TEST_USER_ID);
  assert(providers.includes(PROVIDER), `'${PROVIDER}' in provider list`, `includes ${PROVIDER}`, providers);

  console.log('Step 5: delete');
  const deleted = await deleteUserOAuthTokens(TEST_USER_ID, PROVIDER);
  assert(deleted === 1, 'deleted row count', 1, deleted);

  console.log('Step 6: read-back after delete');
  const read3 = await getUserOAuthTokens(TEST_USER_ID, PROVIDER);
  assert(read3 === null, 'row gone', null, read3);

  console.log('');
  console.log('✓ all checks passed');
}

main()
  .then(() => closePool())
  .catch(async err => {
    console.error('');
    console.error('✗ smoke test failed:', err.message);
    // Best-effort cleanup so a failed run doesn't leave a row behind.
    try { await deleteUserOAuthTokens(TEST_USER_ID, PROVIDER); } catch { /* ignore */ }
    await closePool();
    process.exit(1);
  });

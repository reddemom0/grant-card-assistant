/**
 * Granola connection-status diagnostic.
 *
 * Manual tool — reports which Granola OAuth artifacts are present for a
 * given hub user. Read-only, prints presence flags only (never token or
 * secret values).
 *
 * Env:
 *   DATABASE_URL  (required)
 *   TEST_USER_ID  (required — existing users.id, integer)
 *
 * Usage:
 *   TEST_USER_ID=42 npm run test:granola-status
 *
 * Always exits 0 — this is a status report, not a pass/fail test.
 */

import dotenv from 'dotenv';
import Redis from 'ioredis';
import { getDCRClient } from '../src/database/mcp-dcr-clients.js';
import { getUserOAuthTokens } from '../src/database/user-oauth-tokens.js';
import { closePool } from '../src/database/connection.js';

dotenv.config();

const PROVIDER = 'granola';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const TEST_USER_ID = process.env.TEST_USER_ID ? Number(process.env.TEST_USER_ID) : null;
if (!TEST_USER_ID || Number.isNaN(TEST_USER_ID)) {
  console.error('TEST_USER_ID is required (an existing users.id, integer)');
  process.exit(1);
}

function yn(v) { return v ? 'yes' : 'no'; }

async function main() {
  console.log(`🔬 Granola connection status — user_id ${TEST_USER_ID}`);
  console.log('');

  // 1. DCR client (deployment-scoped)
  const dcr = await getDCRClient(PROVIDER);
  console.log('Deployment DCR client:');
  console.log(`  registered:           ${yn(!!dcr)}`);
  if (dcr) {
    console.log(`  has client_secret:    ${yn(!!dcr.client_secret)}`);
    console.log(`  registered_at:        ${dcr.registered_at?.toISOString?.() ?? dcr.registered_at}`);
  }
  console.log('');

  // 2. Per-user tokens
  const tokens = await getUserOAuthTokens(TEST_USER_ID, PROVIDER);
  console.log('User tokens:');
  console.log(`  present:              ${yn(!!tokens)}`);
  if (tokens) {
    console.log(`  has refresh_token:    ${yn(!!tokens.refresh_token)}`);
    console.log(`  expiry:               ${tokens.token_expiry ? new Date(tokens.token_expiry).toISOString() : 'no expiry'}`);
    console.log(`  scope:                ${tokens.scope ?? '(none)'}`);
  }
  console.log('');

  // 3. Redis state/verifier
  const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');
  let stateExists = 0;
  let verifierExists = 0;
  try {
    stateExists = await redis.exists(`oauth:granola:state:${TEST_USER_ID}`);
    verifierExists = await redis.exists(`oauth:granola:verifier:${TEST_USER_ID}`);
  } catch (err) {
    console.log(`Redis check: failed (${err.message})`);
  }
  console.log('Redis (in-flight OAuth state):');
  console.log(`  state present:        ${yn(stateExists === 1)}`);
  console.log(`  verifier present:     ${yn(verifierExists === 1)}`);
  await redis.quit().catch(() => {});
}

main()
  .then(() => closePool())
  .catch(async err => {
    console.error('Status check error:', err.message);
    await closePool();
    process.exit(1);
  });

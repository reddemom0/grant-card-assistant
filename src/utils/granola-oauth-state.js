/**
 * Redis-backed OAuth state and PKCE verifier store for the Granola flow.
 *
 * Two short-lived per-user keys with a 10-minute TTL:
 *   oauth:granola:state:<userId>     — CSRF state (we generate + verify)
 *   oauth:granola:verifier:<userId>  — PKCE verifier (SDK gives us, SDK reads back)
 *
 * Both are consumed (deleted) on read. Module-load Redis instantiation matches
 * the existing pattern in src/utils/vector-search.js — falls back to localhost
 * so module load doesn't crash in Redis-less local dev.
 */

import crypto from 'crypto';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

const TTL_SECONDS = 600;
const stateKey = (userId) => `oauth:granola:state:${userId}`;
const verifierKey = (userId) => `oauth:granola:verifier:${userId}`;

/**
 * Generate a fresh CSRF state, store it, and return the value.
 * @param {number|string} userId
 * @returns {Promise<string>}
 */
export async function generateAndStoreState(userId) {
  const state = crypto.randomBytes(32).toString('hex');
  await redis.set(stateKey(userId), state, 'EX', TTL_SECONDS);
  return state;
}

/**
 * Read and delete the stored state, comparing it to what was returned in the
 * callback. Always deletes (success or mismatch) so a leaked state can't be
 * reused.
 * @param {number|string} userId
 * @param {string} providedState
 * @returns {Promise<boolean>}
 */
export async function verifyAndConsumeState(userId, providedState) {
  const key = stateKey(userId);
  const stored = await redis.get(key);
  await redis.del(key);
  if (!stored || !providedState) return false;
  return stored === providedState;
}

/**
 * Persist the SDK-generated PKCE verifier between authorize-init and callback.
 * @param {number|string} userId
 * @param {string} verifier
 */
export async function saveCodeVerifier(userId, verifier) {
  await redis.set(verifierKey(userId), verifier, 'EX', TTL_SECONDS);
}

/**
 * Read and delete the stored PKCE verifier.
 * @param {number|string} userId
 * @returns {Promise<string|null>}
 */
export async function loadAndConsumeCodeVerifier(userId) {
  const key = verifierKey(userId);
  const verifier = await redis.get(key);
  await redis.del(key);
  return verifier;
}

/**
 * Clear both state and verifier keys for a user. Best-effort cleanup.
 * @param {number|string} userId
 */
export async function clearOAuthState(userId) {
  await redis.del(stateKey(userId), verifierKey(userId));
}

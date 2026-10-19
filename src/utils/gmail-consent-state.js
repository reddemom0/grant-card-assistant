/**
 * Redis-backed OAuth state for the opt-in Gmail consent.
 *
 * Same shape as src/utils/granola-oauth-state.js — 32 random bytes, 10-minute
 * TTL, deleted on use, keyed by user id — because the person granting Gmail is
 * already signed in to the Hub. (Sign-in itself keys state by the state value;
 * see google-login-state.js.)
 *
 *   oauth:gmail-consent:state:<userId>
 */

import crypto from 'crypto';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

export const TTL_SECONDS = 600;
const stateKey = (userId) => `oauth:gmail-consent:state:${userId}`;

/**
 * Generate and record a fresh state for this user, replacing any earlier one.
 * @param {number|string} userId
 * @returns {Promise<string>}
 */
export async function issueGmailConsentState(userId) {
  const state = crypto.randomBytes(32).toString('hex');
  await redis.set(stateKey(userId), state, 'EX', TTL_SECONDS);
  return state;
}

/**
 * Check the callback's state against this user's, deleting it either way.
 * @param {number|string} userId
 * @param {string} providedState
 * @returns {Promise<boolean>}
 */
export async function consumeGmailConsentState(userId, providedState) {
  const key = stateKey(userId);
  const stored = await redis.get(key);
  await redis.del(key);
  if (!stored || typeof providedState !== 'string' || !providedState) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(providedState);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Redis-backed OAuth state for Google sign-in.
 *
 * Same shape as src/utils/granola-oauth-state.js — 32 random bytes, 10-minute
 * TTL, deleted on use — with one difference: Granola keys state by user id,
 * which only works for someone already signed in. At sign-in there is no user
 * yet, so the key is the state itself, and src/api/auth.js binds it to the
 * browser with a cookie.
 *
 *   oauth:google-login:state:<state>
 *
 * The cookie proves the callback came back to the browser that started the
 * sign-in; this record makes each state good for one callback only.
 */

import crypto from 'crypto';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

export const TTL_SECONDS = 600;
const STATE_FORMAT = /^[0-9a-f]{64}$/;
const stateKey = (state) => `oauth:google-login:state:${state}`;

/**
 * Generate a fresh state and record it.
 * @returns {Promise<string>}
 */
export async function issueLoginState() {
  const state = crypto.randomBytes(32).toString('hex');
  await redis.set(stateKey(state), '1', 'EX', TTL_SECONDS);
  return state;
}

/**
 * Delete the state's record, reporting whether it existed.
 *
 * DEL is atomic, so when two callbacks race with the same state exactly one
 * sees `true`. Expired and already-used states are indistinguishable here, by
 * design: both mean "start again".
 *
 * @param {string} state
 * @returns {Promise<boolean>}
 */
export async function consumeLoginState(state) {
  if (typeof state !== 'string' || !STATE_FORMAT.test(state)) return false;
  return (await redis.del(stateKey(state))) === 1;
}

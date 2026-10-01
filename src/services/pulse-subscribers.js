/**
 * GetGranted Pulse subscribers: who gets which Pulse update, as Oracle DMs
 *
 * One env var per update, comma-separated @granted.ca emails:
 *   PULSE_SPIKE_SUBSCRIBERS   chat spike alert (src/services/pulse-spike.js)
 *
 * Each email resolves to Oracle's DM space with that person:
 *   users.email → users.chat_user_id (migration 028) → findDmSpace
 * The Chat id is only learned once the person has messaged Oracle in Chat,
 * and Oracle can't open a DM itself — so anyone who hasn't is logged once per
 * process and skipped. A failed lookup for one person never fails the run.
 */

import { query } from '../database/connection.js';
import { findDmSpace } from '../cards/chat-api.js';

const DOMAIN = '@granted.ca';

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** The emails listed in one Pulse env var: trimmed, lowercased, de-duplicated, @granted.ca only. */
export function parseSubscriberEmails(envVar, env = process.env) {
  const emails = [...new Set(
    (env[envVar] || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )];
  return emails.filter((email) => {
    if (email.endsWith(DOMAIN) && email.length > DOMAIN.length) return true;
    warnOnce(`domain:${envVar}:${email}`, `⚠️  Pulse: ${envVar} lists a non-${DOMAIN} address — ignored.`);
    return false;
  });
}

/**
 * Subscribers for one Pulse update who can be reached by DM.
 * @param {string} envVar - e.g. 'PULSE_SPIKE_SUBSCRIBERS'
 * @returns {Promise<Array<{email: string, dmSpace: string}>>}
 */
export async function getPulseSubscribers(envVar, env = process.env) {
  const out = [];
  for (const email of parseSubscriberEmails(envVar, env)) {
    try {
      const r = await query(
        `SELECT chat_user_id FROM users
          WHERE LOWER(email) = LOWER($1) AND is_active = true
          LIMIT 1`,
        [email]
      );
      const chatUserId = r.rows[0]?.chat_user_id || null;
      const dmSpace = chatUserId ? await findDmSpace(chatUserId) : null;
      if (!dmSpace) {
        warnOnce(`nodm:${email}`, `⚠️  Pulse: ${email} has no DM with Oracle yet (they need to message Oracle in Chat once) — skipped.`);
        continue;
      }
      out.push({ email, dmSpace });
    } catch (err) {
      console.warn(`⚠️  Pulse: subscriber lookup failed for ${email} — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  }
  return out;
}

/** Test-only: forget which warnings were already logged. */
export function _resetPulseSubscribersForTests() {
  warned.clear();
}

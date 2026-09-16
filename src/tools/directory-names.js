/**
 * Turn Chat sender ids into names people recognise
 *
 * A Chat message identifies its sender as `users/123456789`, and `displayName`
 * is not always populated. "Unknown asked you about the RTRI budget" is close to
 * useless — the name is what makes an action point actionable.
 *
 * Cheapest source first, and it never blocks a result: if every lookup fails,
 * callers still get a label that is true, just less specific.
 */

import { google } from 'googleapis';
import { query } from '../database/connection.js';

const GRANTED_DOMAIN = 'granted.ca';
const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';

/** Names change rarely; this exists so 30 threads from 5 people cost 5 calls. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map();   // users/NNN -> { label, expires }

export const FALLBACKS = {
  external: 'someone outside Granted',
  internalUnresolved: 'a Granted colleague (name unavailable)'
};

/** Exposed for tests; nothing else should need it. */
export function _clearCache() {
  cache.clear();
}

function cacheGet(id) {
  const hit = cache.get(id);
  if (!hit) return null;
  if (hit.expires <= Date.now()) { cache.delete(id); return null; }
  return hit.label;
}

function cacheSet(id, label) {
  cache.set(id, { label, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Is this sender one of ours?
 *
 * Chat gives `domainId` — an opaque id, not a domain name — so it cannot be
 * compared to "granted.ca" directly. What it CAN do is tell two senders apart:
 * everyone in our Workspace shares one domainId. We learn ours from the first
 * sender the directory confirms as internal, and treat "no domainId" as
 * external, which is what Chat reports for users outside the Workspace.
 */
let knownInternalDomainId = null;

function looksInternal(sender) {
  if (!sender?.domainId) return false;
  if (knownInternalDomainId) return sender.domainId === knownInternalDomainId;
  return true;   // unknown yet — assume internal rather than accuse someone of being an outsider
}

/**
 * The service account, impersonating the system account, reading public
 * directory profiles. Same GoogleAuth + clientOptions.subject shape as
 * createDriveClient in google-drive.js.
 */
function directoryClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const subject = process.env.HUBSPOT_WEBHOOK_USER_EMAIL?.trim() || process.env.GOOGLE_IMPERSONATE?.trim();
  if (!raw || !subject) return null;

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: [DIRECTORY_SCOPE],
    clientOptions: { subject }
  });
  return google.admin({ version: 'directory_v1', auth });
}

/**
 * Resolve display names for a batch of senders.
 *
 * @param {Array<{name: string, displayName?: string, domainId?: string}>} senders
 * @returns {Promise<Map<string, string>>} users/NNN -> label
 */
export async function resolveSenderNames(senders = []) {
  const resolved = new Map();
  const unresolved = new Map();   // users/NNN -> the sender object, deduplicated

  for (const sender of senders) {
    const id = sender?.name;
    if (!id) continue;
    if (resolved.has(id) || unresolved.has(id)) continue;

    // 1. Chat told us already. No call, no cost.
    if (sender.displayName) { resolved.set(id, sender.displayName); continue; }

    // 2. Someone who has messaged Oracle in Chat — we stored their name at sign-in.
    const cached = cacheGet(id);
    if (cached) { resolved.set(id, cached); continue; }

    unresolved.set(id, sender);
  }

  if (unresolved.size === 0) return resolved;

  // 3. Our own users table: no Google call, no scope.
  try {
    const ids = [...unresolved.keys()];
    const rows = await query(
      'SELECT chat_user_id, name, email FROM users WHERE chat_user_id = ANY($1::text[])',
      [ids]
    );
    for (const row of rows.rows) {
      const label = row.name || row.email;
      if (!label) continue;
      resolved.set(row.chat_user_id, label);
      cacheSet(row.chat_user_id, label);
      unresolved.delete(row.chat_user_id);
    }
  } catch (err) {
    console.warn(`⚠️  Could not read names from users table: ${err.message}`);
  }

  if (unresolved.size === 0) return resolved;

  // 4. The Workspace directory, one call per remaining person.
  const admin = directoryClient();
  if (admin) {
    for (const [id, sender] of unresolved) {
      const userKey = id.split('/')[1];
      if (!userKey) continue;
      try {
        const res = await admin.users.get({ userKey, viewType: 'domain_public' });
        const label = res.data.name?.fullName
          || [res.data.name?.givenName, res.data.name?.familyName].filter(Boolean).join(' ')
          || res.data.primaryEmail;

        if (label) {
          resolved.set(id, label);
          cacheSet(id, label);
          unresolved.delete(id);
          // The directory only holds our own Workspace, so anyone it returns is
          // internal — which teaches us what an internal domainId looks like.
          if (!knownInternalDomainId && sender?.domainId) knownInternalDomainId = sender.domainId;
          if (String(res.data.primaryEmail || '').endsWith(`@${GRANTED_DOMAIN}`) && sender?.domainId) {
            knownInternalDomainId = sender.domainId;
          }
        }
      } catch (err) {
        // A 404 means "not in our directory", i.e. an external person — normal,
        // not an error. Anything else is logged once and degraded.
        const code = err?.code ?? err?.response?.status;
        if (code !== 404 && code !== '404') {
          console.warn(`⚠️  Directory lookup failed for ${id}: ${err.message}`);
        }
      }
    }
  }

  // 5. Whatever is left gets an honest label rather than "Unknown".
  for (const [id, sender] of unresolved) {
    const label = looksInternal(sender) ? FALLBACKS.internalUnresolved : FALLBACKS.external;
    resolved.set(id, label);
    // Not cached: a name that appears later should be picked up, and a failed
    // lookup is not a fact worth remembering for twelve hours.
  }

  return resolved;
}

/**
 * Convenience for a single sender, used where only one name is needed.
 * @returns {Promise<string>}
 */
export async function resolveSenderName(sender) {
  if (!sender?.name) return FALLBACKS.external;
  const map = await resolveSenderNames([sender]);
  return map.get(sender.name) || FALLBACKS.external;
}

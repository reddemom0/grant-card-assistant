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
 * The service account, impersonating THE PERSON ASKING, reading public directory
 * profiles. Same GoogleAuth + clientOptions.subject shape as createDriveClient
 * in google-drive.js.
 *
 * The subject is the requester's own email rather than a system account. Reading
 * a colleague's public profile is something any domain user may do, so this needs
 * no special account to exist — and it removes the failure mode where a variable
 * that happens to be set for the webhook is absent for the web service, skipping
 * the whole lookup in silence.
 *
 * @param {string} subjectEmail - the requesting user's email
 */
function directoryClient(subjectEmail) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const subject = subjectEmail?.trim();

  if (!raw || !subject) {
    // Booleans only — never the key, never the address. This line exists because
    // the old version returned null here with no trace at all, which is exactly
    // what made a live failure invisible.
    console.warn(`[names] directory client unavailable: key=${Boolean(raw)} subject=${Boolean(subject)}`);
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: [DIRECTORY_SCOPE],
    clientOptions: { subject }
  });
  return google.admin({ version: 'directory_v1', auth });
}

/** The requesting user's email, for impersonation. */
async function requesterEmail(userId) {
  if (!userId) return null;
  try {
    const res = await query('SELECT email FROM users WHERE id = $1', [userId]);
    return res.rows[0]?.email || null;
  } catch (err) {
    console.warn(`[names] requester lookup failed: ${err.code || 'unknown'}`);
    return null;
  }
}

/**
 * Resolve display names for a batch of senders.
 *
 * Every request logs one summary line with a count per leg, so a run where
 * nothing resolves says WHICH leg produced nothing. Counts only — no names, no
 * emails, no ids, no message content.
 *
 * @param {Array<{name: string, displayName?: string, domainId?: string}>} senders
 * @param {Object} [ctx]
 * @param {number} [ctx.userId] - the person asking; impersonated for the directory
 * @returns {Promise<Map<string, string>>} users/NNN -> label
 */
export async function resolveSenderNames(senders = [], ctx = {}) {
  const resolved = new Map();
  const unresolved = new Map();   // users/NNN -> the sender object, deduplicated
  const counts = {
    displayName: 0, cache: 0, db: 0, directory: 0,
    notFound: 0, failed: 0, fallbackInternal: 0, fallbackExternal: 0
  };

  const summarise = (uniqueCount) => {
    console.log(
      `[names] total=${senders.length} unique=${uniqueCount} ` +
      `displayName=${counts.displayName} cache=${counts.cache} db=${counts.db} ` +
      `directory=${counts.directory} notFound=${counts.notFound} failed=${counts.failed} ` +
      `fallbackInternal=${counts.fallbackInternal} fallbackExternal=${counts.fallbackExternal}`
    );
  };

  for (const sender of senders) {
    const id = sender?.name;
    if (!id) continue;
    if (resolved.has(id) || unresolved.has(id)) continue;

    // 1. Chat told us already. No call, no cost.
    if (sender.displayName) { resolved.set(id, sender.displayName); counts.displayName++; continue; }

    // 2. Someone we have already resolved in this process.
    const cached = cacheGet(id);
    if (cached) { resolved.set(id, cached); counts.cache++; continue; }

    unresolved.set(id, sender);
  }

  const uniqueCount = resolved.size + unresolved.size;
  if (unresolved.size === 0) { summarise(uniqueCount); return resolved; }

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
      counts.db++;
    }
  } catch (err) {
    console.warn(`[names] users table lookup failed: ${err.code || 'unknown'}`);
  }

  if (unresolved.size === 0) { summarise(uniqueCount); return resolved; }

  // 4. The Workspace directory, one call per remaining person, as the asker.
  const admin = directoryClient(await requesterEmail(ctx.userId));
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
          counts.directory++;
          // The directory only holds our own Workspace, so anyone it returns is
          // internal — which teaches us what an internal domainId looks like.
          if (!knownInternalDomainId && sender?.domainId) knownInternalDomainId = sender.domainId;
          if (String(res.data.primaryEmail || '').endsWith(`@${GRANTED_DOMAIN}`) && sender?.domainId) {
            knownInternalDomainId = sender.domainId;
          }
        }
      } catch (err) {
        // A 404 means "not in our directory", i.e. an external person — normal,
        // not an error, but COUNTED: "every lookup 404s" and "the lookup never
        // ran" look identical in a result and must not look identical in a log.
        const code = err?.code ?? err?.response?.status;
        if (code === 404 || code === '404') {
          counts.notFound++;
        } else {
          counts.failed++;
          // Code only. Google's error text can carry the impersonated address.
          console.warn(`[names] directory lookup failed: code=${code ?? 'unknown'}`);
        }
      }
    }
  }

  // 5. Whatever is left gets an honest label rather than "Unknown".
  for (const [id, sender] of unresolved) {
    const internal = looksInternal(sender);
    resolved.set(id, internal ? FALLBACKS.internalUnresolved : FALLBACKS.external);
    if (internal) counts.fallbackInternal++; else counts.fallbackExternal++;
    // Not cached: a name that appears later should be picked up, and a failed
    // lookup is not a fact worth remembering for twelve hours.
  }

  summarise(uniqueCount);
  return resolved;
}

/**
 * Convenience for a single sender, used where only one name is needed.
 * @returns {Promise<string>}
 */
export async function resolveSenderName(sender, ctx = {}) {
  if (!sender?.name) return FALLBACKS.external;
  const map = await resolveSenderNames([sender], ctx);
  return map.get(sender.name) || FALLBACKS.external;
}

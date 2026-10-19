/**
 * A consultant's HubSpot meeting (scheduling) links, by meeting length.
 *
 * Source: data/rates/consultant-routing.json — each consultant entry may carry
 * `email` and `meeting_links: { "<minutes>": "<url>" }`. Static on purpose:
 * Oracle's HubSpot token has no scheduler scope, so the links are kept here
 * beside the existing `booking_link` (which is unchanged and still drives
 * lead-gen routing).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROUTING_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../data/rates/consultant-routing.json');

let cached = null;
function routing() {
  if (!cached) cached = JSON.parse(readFileSync(ROUTING_PATH, 'utf8'));
  return cached;
}

function consultantFor(email, data) {
  const want = String(email || '').trim().toLowerCase();
  if (!want) return null;
  return Object.values(data.consultants || {}).find(c => String(c.email || '').toLowerCase() === want) || null;
}

/**
 * All of a user's meeting links, as { minutes: url }. Unknown user → {}.
 * @param {string} email
 * @returns {Record<number, string>}
 */
export function listMeetingLinks(email, data = routing()) {
  const links = consultantFor(email, data)?.meeting_links || {};
  return Object.fromEntries(Object.entries(links).map(([m, url]) => [Number(m), url]));
}

/**
 * The user's link for an exact meeting length, or null. No rounding: a
 * 25-minute ask has no link rather than a guessed one.
 * @param {string} email
 * @param {number|string} minutes
 * @returns {string|null}
 */
export function getMeetingLink(email, minutes, data = routing()) {
  const n = Number(minutes);
  if (!Number.isInteger(n)) return null;
  return listMeetingLinks(email, data)[n] ?? null;
}

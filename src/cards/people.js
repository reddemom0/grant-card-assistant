/**
 * Who a Chat user is, for tracked cards
 *
 * A card knows people by their Chat id (users/NNN) — that is what a mention or a
 * button press carries. Notifications and digests need more: the Hub account
 * (for calendar time zone and for confirming gated actions), and the DM space
 * Oracle can post to.
 *
 * Sources, cheapest first: what is already stored; the Hub users table (by Chat
 * id, then email); the Workspace directory (email from the Chat id).
 *
 * Time zone is the person's primary calendar time zone, read with their own Hub
 * sign-in (calendar.events is enough for events.list, which reports it). People
 * without a Hub sign-in get DEFAULT_TIMEZONE. Cached for seven days.
 */

import * as store from '../database/tracked-cards-store.js';
import { lookupChatUserEmail } from '../tools/directory-names.js';
import { getCalendarClient } from '../tools/google-calendar.js';
import { findDmSpace } from './chat-api.js';

export const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE || 'America/Vancouver';
const TZ_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NO_DM_RETRY_MS = 24 * 60 * 60 * 1000;

const isChatUserId = (id) => typeof id === 'string' && /^users\/[^/]+$/.test(id);

function codeOf(err) {
  return err?.code ?? err?.response?.status ?? err?.name ?? 'unknown';
}

/**
 * Remember someone who just messaged Oracle. The Chat event carries their verified
 * email and Hub account, so this is the most reliable link we ever get.
 */
export async function rememberSender({ chatUserId, userId = null, email = null, displayName = null }) {
  if (!isChatUserId(chatUserId)) return;
  await store.upsertPerson({ chatUserId, userId, email, displayName });
  if (userId) await store.setUserChatId(userId, chatUserId);
}

/**
 * Everything known about a person, filling gaps from the users table and the
 * directory. Never throws; unknown fields stay null.
 *
 * @param {string} chatUserId
 * @param {Object} [hints]
 * @param {string} [hints.displayName]
 * @param {string} [hints.email] - e.g. from a button click's user object
 * @param {number} [hints.userId] - this person's Hub user, ONLY when it comes from
 *   the same verified Chat event (or a card row stored from one)
 * @param {number} [hints.lookupAsUserId] - Hub user to impersonate for the directory
 */
export async function resolvePerson(chatUserId, hints = {}) {
  if (!isChatUserId(chatUserId)) return null;
  try {
    let person = await store.upsertPerson({
      chatUserId,
      userId: hints.userId || null,
      email: hints.email || null,
      displayName: hints.displayName || null
    });

    if (!person.user_id || !person.email) {
      let hub = await store.findHubUser({ chatUserId, email: person.email, userId: person.user_id });
      if (!hub && !person.email) {
        const found = await lookupChatUserEmail(chatUserId, { userId: hints.lookupAsUserId });
        if (found) {
          person = await store.upsertPerson({ chatUserId, email: found.email, displayName: person.display_name ? null : found.name });
          hub = await store.findHubUser({ email: found.email });
        }
      }
      if (hub) {
        person = await store.upsertPerson({ chatUserId, userId: hub.id, email: hub.email });
        await store.setUserChatId(hub.id, chatUserId);
      }
    }
    return person;
  } catch (err) {
    console.warn(`⚠️  Tracked cards: person lookup failed — code: ${codeOf(err)}`);
    return { chat_user_id: chatUserId, user_id: null, email: null, display_name: hints.displayName || null };
  }
}

/**
 * The Chat-copy listener (CHAT_LISTENER_USER_EMAIL) is a Workspace user, not a
 * teammate: it is never a reviewer. Read the same way as src/chat-listen/listener.js.
 */
export function isListenerEmail(email) {
  const listener = String(process.env.CHAT_LISTENER_USER_EMAIL || '').trim().toLowerCase();
  return Boolean(listener) && String(email || '').trim().toLowerCase() === listener;
}

/** The person's calendar time zone, or DEFAULT_TZ. */
export async function timeZoneFor(person, now = new Date()) {
  if (!person) return DEFAULT_TZ;
  const checked = person.time_zone_checked_at ? new Date(person.time_zone_checked_at).getTime() : 0;
  if (person.time_zone && now.getTime() - checked < TZ_TTL_MS) return person.time_zone;

  let timeZone = DEFAULT_TZ;
  if (person.user_id) {
    try {
      const calendar = await getCalendarClient(person.user_id);
      const res = await calendar.events.list({ calendarId: 'primary', maxResults: 1, fields: 'timeZone' });
      if (isValidTimeZone(res.data?.timeZone)) timeZone = res.data.timeZone;
    } catch (err) {
      console.warn(`⚠️  Tracked cards: calendar time zone unavailable — code: ${codeOf(err)}`);
    }
  }
  try {
    await store.setPersonTimeZone(person.chat_user_id, timeZone, now);
  } catch { /* the value still applies to this run */ }
  return timeZone;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Oracle's DM space with this person, or null (they have to message Oracle first). */
export async function dmSpaceFor(person, now = new Date()) {
  if (!person) return null;
  if (person.dm_space_name) return person.dm_space_name;
  const checked = person.dm_checked_at ? new Date(person.dm_checked_at).getTime() : 0;
  if (checked && now.getTime() - checked < NO_DM_RETRY_MS) return null;

  try {
    const space = await findDmSpace(person.chat_user_id);
    await store.setPersonDm(person.chat_user_id, space, now);
    return space;
  } catch (err) {
    console.warn(`⚠️  Tracked cards: DM lookup failed — code: ${codeOf(err)}`);
    return null;
  }
}

/** Local calendar date (YYYY-MM-DD) and hour in a time zone. */
export function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

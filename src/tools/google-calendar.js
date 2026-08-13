/**
 * Google Calendar tools for Oracle
 *
 * Acts AS the signed-in person using their own delegated OAuth. No domain-wide
 * delegation, no service account — Oracle can only see and do what that person
 * can see and do.
 *
 * Visibility model:
 *   - The user's own events: full detail.
 *   - Anyone else: FREE/BUSY ONLY, via freebusy.query on the user's own token.
 *     That works whether or not the colleague has ever connected to Oracle, but
 *     it depends on the Workspace admin's internal calendar sharing setting.
 *     Calendars we cannot see come back as per-calendar errors, not a failed
 *     request, so partial results are normal and are surfaced as such.
 *
 * Writes that involve other people are gated by the confirmation policy in
 * src/tools/executor.js. update_calendar_event ALSO re-checks here, because the
 * pre-dispatch gate can only inspect the tool input and cannot know that an
 * existing event already has attendees.
 *
 * Shape follows src/tools/marketing-calendar.js: getUserOAuth2Client for auth,
 * (userId, {args}) signature, always return {success:false,error} rather than
 * throwing. Schemas live in src/tools/definitions.js — no orphan schema here.
 */

import { google } from 'googleapis';
import { getUserOAuth2Client } from './google-docs.js';

const REAUTH_MESSAGE =
  'Google Calendar access not granted. Please log out and log in again at the Hub to refresh your Google permissions.';

/**
 * googleapis surfaces a missing scope as 403 with ACCESS_TOKEN_SCOPE_INSUFFICIENT
 * in the message. Ported from google-sheets.js:24-41 — code can be a number or a
 * string depending on the path, so check both plus a regex fallback.
 */
function isInsufficientScopeError(err) {
  const code = err?.code;
  const msg = String(err?.message ?? '');
  if (code === 403 || code === '403') {
    if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)) return true;
  }
  return /ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg);
}

export function classifyError(err) {
  if (isInsufficientScopeError(err)) {
    return { success: false, error: REAUTH_MESSAGE };
  }
  return { success: false, error: err?.message ?? 'Google Calendar request failed' };
}

async function getCalendarClient(userId) {
  const auth = await getUserOAuth2Client(userId);
  return google.calendar({ version: 'v3', auth });
}

/** Shared guard so every tool fails the same way when userId is absent. */
function requireUserId(userId) {
  if (!userId) {
    return {
      success: false,
      error: 'userId required — Calendar acts as the signed-in user via their own OAuth.'
    };
  }
  return null;
}

/**
 * Normalize an events.list response into something compact for the model.
 * Exported for testing.
 */
export function mapEvents(items = []) {
  return items.map(e => ({
    id: e.id,
    title: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    all_day: Boolean(e.start?.date && !e.start?.dateTime),
    location: e.location || null,
    attendees: (e.attendees || []).map(a => ({
      email: a.email,
      response: a.responseStatus || 'needsAction',
      organizer: Boolean(a.organizer)
    })),
    meet_link: e.hangoutLink || null,
    status: e.status || null,
    html_link: e.htmlLink || null
  }));
}

/**
 * Split a freebusy.query response into visible calendars and ones we could not
 * see. A calendar we lack permission for arrives with an `errors[]` array rather
 * than failing the whole request, so partial results are the normal case.
 * Exported for testing.
 */
export function mapFreeBusy(calendars = {}) {
  const availability = [];
  const unavailable = [];

  for (const [email, entry] of Object.entries(calendars)) {
    if (Array.isArray(entry?.errors) && entry.errors.length > 0) {
      unavailable.push({
        email,
        reason: entry.errors[0]?.reason || 'unknown',
        // Plain-language so the model can relay it without inventing a cause.
        explanation: entry.errors[0]?.reason === 'notFound'
          ? 'Calendar not found or not shared with you'
          : 'Calendar could not be read'
      });
      continue;
    }
    availability.push({
      email,
      busy: (entry?.busy || []).map(b => ({ start: b.start, end: b.end }))
    });
  }

  return { availability, unavailable };
}

/**
 * List the signed-in user's own events.
 *
 * Deliberately reads `primary` only. Reading a colleague's full events would
 * require them to have shared their calendar; the sanctioned cross-person path
 * is check_calendar_availability (free/busy).
 */
export async function listCalendarEvents(userId, { time_min, time_max, query, max_results } = {}) {
  const guard = requireUserId(userId);
  if (guard) return guard;

  const limit = Number.isInteger(max_results) ? Math.min(max_results, 50) : 20;

  let cal;
  try {
    cal = await getCalendarClient(userId);
  } catch (err) {
    return classifyError(err);
  }

  try {
    const resp = await cal.events.list({
      calendarId: 'primary',
      timeMin: time_min || new Date().toISOString(),
      ...(time_max ? { timeMax: time_max } : {}),
      ...(query ? { q: query } : {}),
      maxResults: limit,
      singleEvents: true,      // expand recurring events into instances
      orderBy: 'startTime'
    });

    const events = mapEvents(resp.data.items);
    return {
      success: true,
      count: events.length,
      query: { time_min: time_min || 'now', time_max: time_max || null, query: query || null },
      events
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Check free/busy across one or more people, using the asking user's own token.
 * Returns partial results: people we could not see are listed separately rather
 * than failing the call.
 */
export async function checkCalendarAvailability(userId, { emails, time_min, time_max } = {}) {
  const guard = requireUserId(userId);
  if (guard) return guard;

  if (!Array.isArray(emails) || emails.length === 0) {
    return { success: false, error: 'emails must be a non-empty array of calendar addresses.' };
  }
  if (!time_min || !time_max) {
    return { success: false, error: 'time_min and time_max are both required (RFC3339 timestamps).' };
  }
  if (emails.length > 50) {
    return { success: false, error: 'Too many calendars requested; limit is 50 per call.' };
  }

  let cal;
  try {
    cal = await getCalendarClient(userId);
  } catch (err) {
    return classifyError(err);
  }

  try {
    const resp = await cal.freebusy.query({
      requestBody: {
        timeMin: time_min,
        timeMax: time_max,
        items: emails.map(email => ({ id: email }))
      }
    });

    const { availability, unavailable } = mapFreeBusy(resp.data.calendars);

    if (unavailable.length > 0) {
      console.warn(`   ⚠️ check_calendar_availability: ${unavailable.length} calendar(s) not visible`);
    }

    return {
      success: true,
      window: { time_min, time_max },
      count_visible: availability.length,
      availability,
      // Only present when something was not visible, mirroring tabs_failed in
      // marketing-calendar.js.
      ...(unavailable.length > 0 ? { calendars_unavailable: unavailable } : {})
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Create an event on the user's own calendar.
 *
 * When `attendees` is non-empty this tool is gated by the confirmation policy in
 * executor.js and will never reach here without confirmed: true.
 */
export async function createCalendarEvent(userId, {
  title, start, end, attendees, description, location, add_meet_link, send_updates
} = {}) {
  const guard = requireUserId(userId);
  if (guard) return guard;

  if (!title) return { success: false, error: 'title is required.' };
  if (!start || !end) return { success: false, error: 'start and end are required (RFC3339 timestamps).' };

  let cal;
  try {
    cal = await getCalendarClient(userId);
  } catch (err) {
    return classifyError(err);
  }

  const hasAttendees = Array.isArray(attendees) && attendees.length > 0;

  const requestBody = {
    summary: title,
    start: { dateTime: start },
    end: { dateTime: end },
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(hasAttendees ? { attendees: attendees.map(email => ({ email })) } : {}),
    ...(add_meet_link
      ? { conferenceData: { createRequest: { requestId: `oracle-${Date.now()}` } } }
      : {})
  };

  try {
    const resp = await cal.events.insert({
      calendarId: 'primary',
      requestBody,
      // Required for conferenceData.createRequest to be honoured at all.
      ...(add_meet_link ? { conferenceDataVersion: 1 } : {}),
      // Only notify when there is somebody to notify.
      ...(hasAttendees ? { sendUpdates: send_updates || 'all' } : {})
    });

    const [event] = mapEvents([resp.data]);
    return {
      success: true,
      event,
      // Surfaced explicitly so the model can tell the user a link is (or is not)
      // present rather than guessing.
      meet_link: resp.data.hangoutLink || null,
      notified: hasAttendees ? (send_updates || 'all') : 'none'
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Modify an existing event.
 *
 * SECOND-LINE CONFIRMATION CHECK. The pre-dispatch gate in executor.js can only
 * see the tool input, so moving a meeting that already has attendees — without
 * touching the attendee list — looks like a solo edit to it. We therefore fetch
 * the event first and refuse in the same shape if it turns out to involve other
 * people and confirmation was not given.
 */
export async function updateCalendarEvent(userId, {
  event_id, title, start, end, attendees, description, location, status, send_updates, confirmed
} = {}) {
  const guard = requireUserId(userId);
  if (guard) return guard;

  if (!event_id) return { success: false, error: 'event_id is required.' };

  let cal;
  try {
    cal = await getCalendarClient(userId);
  } catch (err) {
    return classifyError(err);
  }

  let existing;
  try {
    const resp = await cal.events.get({ calendarId: 'primary', eventId: event_id });
    existing = resp.data;
  } catch (err) {
    return classifyError(err);
  }

  const existingAttendees = (existing.attendees || []).filter(a => !a.self);
  if (existingAttendees.length > 0 && confirmed !== true) {
    return {
      success: false,
      requires_confirmation: true,
      error: `Refused: "${existing.summary || 'this event'}" already has ${existingAttendees.length} other attendee(s), so changing it affects them. Show the user exactly what you intend to change and get an explicit yes, then call again with confirmed: true.`
    };
  }

  const hasAttendees = Array.isArray(attendees) && attendees.length > 0;
  const willNotify = hasAttendees || existingAttendees.length > 0;

  const requestBody = {
    ...(title ? { summary: title } : {}),
    ...(start ? { start: { dateTime: start } } : {}),
    ...(end ? { end: { dateTime: end } } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(status ? { status } : {}),
    ...(hasAttendees ? { attendees: attendees.map(email => ({ email })) } : {})
  };

  if (Object.keys(requestBody).length === 0) {
    return { success: false, error: 'Nothing to update — supply at least one field to change.' };
  }

  try {
    const resp = await cal.events.patch({
      calendarId: 'primary',
      eventId: event_id,
      requestBody,
      ...(willNotify ? { sendUpdates: send_updates || 'all' } : {})
    });

    const [event] = mapEvents([resp.data]);
    return {
      success: true,
      event,
      notified: willNotify ? (send_updates || 'all') : 'none'
    };
  } catch (err) {
    return classifyError(err);
  }
}

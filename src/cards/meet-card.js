/**
 * The /meet card — finding a time, then booking it
 *
 * Trigger: `/meet` as a reply in a thread, "@Oracle find 45 min with @A @B this
 * week", or the /track card's "Schedule call" button (which posts this card in
 * the same thread and links the two).
 *
 * What it does, with rules rather than a model: read everyone's free/busy with
 * the asker's own Calendar grant, keep the times that sit inside each person's
 * working hours (assumed — no Google API exposes them — and overridable in
 * data/cards/working-hours.json), and offer the three earliest, shown in the
 * asker's own zone with a per-person mark. Calendars it could not see are named
 * on the card rather than treated as free.
 *
 * Booking: the press IS the confirmation, because the card shows exactly what
 * will be created — the requester may book at once, anyone invited may book once
 * the card is two hours old. The event is created on the requester's calendar
 * with a Meet link, and a reschedule patches that same event as whoever created
 * it, so the event id and its Meet link survive.
 *
 * After a meeting that came from a /track card, the requester gets one DM
 * asking for the decision, with a draft from a Granola note when one matches.
 * It rides the hourly job, so it lands within the hour after the meeting.
 *
 * Logs: codes and counts only — never a topic, a name, an address or a time.
 */

import * as store from '../database/tracked-cards-store.js';
import { FOUNDATION_ACTIONS, markCardReply } from './registry.js';
import { postMessage } from './chat-api.js';
import { renderCard, rerenderCard, tellPresser } from './update.js';
import { notifyImmediate } from './notify.js';
import { resolvePerson, timeZoneFor, realPeople, DEFAULT_TZ } from './people.js';
import { trackedCard, paragraph, button, esc, clip, threadLink, mdToPlain } from './render.js';
import { readThread } from './track-thread.js';
import {
  parseDuration, parseWindow, findSlots, slotMarks, slotWords, slotButtonWords,
  MIN_LEAD_MS, DEFAULT_WINDOW_DAYS
} from './meet-slots.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TOPIC_CHARS = 100;
const DESCRIPTION_CHARS = 1800;
const DRAFT_CHARS = 3000;
/** An invitee may book once the card has been up this long. */
export const INVITEE_BOOK_AFTER_MS = 2 * HOUR;
/** The follow-up DM waits this long after the meeting ends. */
export const FOLLOWUP_AFTER_MS = 30 * MINUTE;
/** A card nobody booked is closed once its window is this far behind us. */
export const CLOSE_UNBOOKED_AFTER_DAYS = 14;

export const MEET_ACTIONS = {
  'meet.works': { personal: true, label: 'said the times work for them' },
  'meet.none': { personal: true, label: 'said none of the times work' },
  'meet.book1': { personal: false, label: 'booked the first time' },
  'meet.book2': { personal: false, label: 'booked the second time' },
  'meet.book3': { personal: false, label: 'booked the third time' },
  'meet.reschedule': { personal: false, label: 'asked to reschedule' },
  'meet.next_week': { personal: false, label: 'looked at next week' },
  'meet.ignore_hours': { personal: false, label: 'looked outside working hours' },
  'meet.refresh': { personal: false, label: 'checked the calendars again' },
  'meet.keep': { personal: false, label: 'kept the booked time' },
  'meet.decision': { personal: true, label: 'asked to record the decision' },
  'meet.cancel': { personal: false, label: 'closed this card' }
};

const LABELS = { ...FOUNDATION_ACTIONS, ...MEET_ACTIONS };
const BOOK_ACTIONS = { 'meet.book1': 0, 'meet.book2': 1, 'meet.book3': 2 };

export const TYPED_HINTS = {
  'meet.decision': 'To record the decision, reply in the tracked thread: @Oracle decision: <what was decided>'
};

const HOW_TO = 'Use /meet as a reply in a thread, and @mention whoever should be on the call — for example "@Oracle find 45 min with @Nat this week".';
const NO_PEOPLE = 'Who should be on the call? @mention them and I’ll find a time.';

const BUSY = {
  slots: 'Checking calendars…',
  booking: 'Booking it…',
  draft: 'Looking for the meeting note…'
};

const who = (p) => (p ? { chatUserId: p.chatUserId, name: p.name ?? p.displayName ?? null } : null);
const nameOf = (p) => mdToPlain(p?.name || 'someone');
const isLive = (card) => ['open', 'stale'].includes(card?.status);
const PLURALS = { person: 'people' };
const plural = (n, word) => `${n} ${n === 1 ? word : (PLURALS[word] || `${word}s`)}`;

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

/** A reply only the person sees (a plain reply in a DM). Never throws. */
async function privateReply({ spaceName, threadName, surface, chatUserId, text }) {
  if (!spaceName || !chatUserId || !text) return false;
  try {
    await postMessage({ spaceName, threadName, text, privateTo: surface === 'chat_dm' ? null : chatUserId });
    return true;
  } catch (err) {
    console.warn(`⚠️  Meet private reply failed — code: ${codeOf(err)}`);
    return false;
  }
}

function topicFrom(text, fallback = 'Call') {
  const line = String(text || '')
    .replace(/^\s*\/meet\b/i, '')
    .replace(/\bfind\s+\d{1,3}\s*(?:min(?:ute)?s?|hours?|hrs?|h)\b/i, '')
    .replace(/@\S+/g, '')
    .replace(/\b(?:with|for|about|on)\b\s*$/i, '')
    .split(/\n/)[0]
    .trim();
  return clip(mdToPlain(line) || fallback, TOPIC_CHARS);
}

// ============================================================================
// CREATING
// ============================================================================

/**
 * Post a meet card and start looking for times.
 *
 * @param {Object} p
 * @param {'command'|'mention'|'track'} p.trigger
 * @param {{chatUserId: string, name?: string, email?: string}} p.actor - who asked
 * @param {number} p.userId - their Hub user id; their Calendar grant reads the free/busy
 * @param {Array<{chatUserId: string, name?: string}>} [p.invitees]
 * @param {string} [p.trackCardId] - the /track card this call is for
 */
export async function createMeet({
  trigger, actor, userId = null, spaceName, threadName, surface = 'chat_space',
  conversationId = null, messageText = '', messageName = null, invitees = [],
  trackCardId = null, now = new Date()
}) {
  const reply = (text) => privateReply({ spaceName, threadName, surface, chatUserId: actor.chatUserId, text });
  const done = (result) => {
    if (conversationId) markCardReply(conversationId);
    console.log(`📅 Meet card ${result.code || 'posted'} — trigger: ${trigger}${result.stats || ''}`);
    return result;
  };

  if (!spaceName || !threadName) {
    await reply(HOW_TO);
    return done({ ok: false, code: 'no_thread' });
  }
  if (!userId) {
    await reply('Sign in to the Hub once, then try again — I read calendars as you, never as Oracle.');
    return done({ ok: false, code: 'not_signed_in' });
  }

  const existing = await store.findLiveCard('meet', threadName);
  if (existing) {
    await reply('This thread already has a meeting card — use Reschedule on it to look again.');
    return done({ ok: false, code: 'already_there' });
  }

  const people = await realPeople(invitees.filter(p => p.chatUserId !== actor.chatUserId), userId);
  if (!people.length) {
    await reply(NO_PEOPLE);
    return done({ ok: false, code: 'no_invitees' });
  }

  const requester = await resolvePerson(actor.chatUserId, { email: actor.email, displayName: actor.name, userId });
  const timeZone = await timeZoneFor(requester, now);
  const durationMinutes = parseDuration(messageText);
  const window = parseWindow(messageText, now, timeZone);

  const data = {
    surface,
    topic: topicFrom(messageText, trackCardId ? 'Call about a tracked ask' : 'Call'),
    durationMinutes,
    timeZone,
    window: { from: window.from.toISOString(), to: window.to.toISOString(), words: window.words },
    requester: { ...who(actor), userId, email: requester?.email || actor.email || null, timeZone },
    invitees: people.map(p => ({ chatUserId: p.chatUserId, name: p.name || null, email: p.email || null })),
    slots: [],
    unseen: [],
    noTimeZone: [],
    ignoreHours: false,
    votes: {},
    event: null,
    trackCardId,
    sourceMessage: messageName,
    followup: null,
    busy: { kind: 'slots', text: BUSY.slots, by: actor.name || null, at: now.toISOString() },
    shown: {},
    notice: null
  };

  let card = await store.insertCard({
    cardType: 'meet', status: 'open', spaceName, threadName, sourceMessageName: messageName,
    conversationId, ownerChatId: actor.chatUserId, ownerUserId: userId,
    title: data.topic, data
  });
  if (!card) {
    await reply('This thread already has a meeting card — use Reschedule on it to look again.');
    return done({ ok: false, code: 'already_there' });
  }

  await store.addParticipants(card.id, [
    { chatUserId: actor.chatUserId, role: 'owner', displayName: actor.name || null },
    ...people.map(p => ({ chatUserId: p.chatUserId, role: 'member', displayName: p.name || null, status: 'pending' }))
  ]);

  const posted = await postMessage({ spaceName, threadName, cardsV2: await renderCard(card) });
  card = await store.updateCard(card.id, { messageName: posted });

  const { runInBackground } = await import('./actions.js');
  runInBackground('meet slots', () => fillSlots(card.id));

  return done({
    ok: true,
    code: null,
    card,
    stats: `, invitees: ${people.length}, minutes: ${durationMinutes}, window: ${window.words || 'default'}`
  });
}

/** Everyone on the card, with their zone and their busy blocks. */
async function peopleFor(card, { from, to }) {
  const d = card.data || {};
  const requesterUserId = d.requester?.userId || card.owner_user_id;
  const wanted = [d.requester, ...(d.invitees || [])].filter(p => p?.chatUserId);

  const people = [];
  const noTimeZone = [];
  for (const person of wanted) {
    const row = await resolvePerson(person.chatUserId, { displayName: person.name, email: person.email });
    const email = row?.email || person.email || null;
    // No Hub account means no calendar time zone to read: DEFAULT_TIMEZONE, and
    // the card says so rather than pretending to know.
    const timeZone = row?.user_id ? await timeZoneFor(row, new Date()) : DEFAULT_TZ;
    if (!row?.user_id) noTimeZone.push(email || nameOf(person));
    people.push({
      chatUserId: person.chatUserId,
      name: person.name || row?.display_name || null,
      email,
      timeZone,
      busy: [],
      seen: true
    });
  }

  const emails = people.map(p => p.email).filter(Boolean);
  let unseen = [];
  if (emails.length && requesterUserId) {
    const { checkCalendarAvailability } = await import('../tools/google-calendar.js');
    const free = await checkCalendarAvailability(requesterUserId, {
      emails, time_min: new Date(from).toISOString(), time_max: new Date(to).toISOString()
    });
    if (!free.success) return { people, unseen: emails, noTimeZone, error: free.error };
    const busyBy = new Map((free.availability || []).map(a => [String(a.email).toLowerCase(), a.busy || []]));
    unseen = (free.calendars_unavailable || []).map(c => c.email);
    for (const person of people) {
      const key = String(person.email || '').toLowerCase();
      person.busy = busyBy.get(key) || [];
      person.seen = busyBy.has(key);
    }
  }
  return { people, unseen, noTimeZone, error: null };
}

/**
 * The slow half: read the calendars and work out the three times. Also used by
 * Refresh, Try next week and Ignore working hours.
 */
export async function fillSlots(cardId, { window = null, ignoreHours = null, now = new Date() } = {}) {
  const card = await store.getCard(cardId);
  if (!card || !isLive(card)) return { changed: false };
  const d = card.data || {};
  const searchWindow = window || d.window;
  const outside = ignoreHours === null ? Boolean(d.ignoreHours) : ignoreHours;

  try {
    const { people, unseen, noTimeZone, error } = await peopleFor(card, searchWindow);
    if (error) {
      await store.patchCardData(cardId, {
        busy: null,
        window: searchWindow,
        ignoreHours: outside,
        slots: [],
        unseen,
        noTimeZone,
        notice: { text: error, at: now.toISOString() }
      });
      console.log('📅 Meet slots — result: calendars_unreadable');
      await rerenderCard(cardId);
      return { changed: true };
    }

    const slots = findSlots({
      durationMinutes: d.durationMinutes,
      from: searchWindow.from,
      to: searchWindow.to,
      people,
      now,
      ignoreHours: outside
    });

    await store.patchCardData(cardId, {
      busy: null,
      window: searchWindow,
      ignoreHours: outside,
      slots: slots.map(slot => ({ ...slot, marks: slotMarks(slot, people) })),
      unseen,
      noTimeZone,
      // The addresses resolved here are what the invitations are sent to: a
      // @mention carries no email, so without this the event would have no
      // attendees.
      invitees: people
        .filter(p => p.chatUserId !== d.requester?.chatUserId)
        .map(p => ({ chatUserId: p.chatUserId, name: p.name || null, email: p.email || null })),
      requester: { ...(d.requester || {}), timeZone: people.find(p => p.chatUserId === d.requester?.chatUserId)?.timeZone || d.requester?.timeZone },
      notice: null
    });
    console.log(`📅 Meet slots — found: ${slots.length}, people: ${people.length}, unseen: ${unseen.length}, outside hours: ${outside}`);
  } catch (err) {
    console.warn(`⚠️  Meet slots failed — code: ${codeOf(err)}`);
    await store.patchCardData(cardId, {
      busy: null,
      notice: { text: 'couldn’t read the calendars — press Check again', at: now.toISOString() }
    });
  }
  await rerenderCard(cardId);
  return { changed: true };
}

// ============================================================================
// BOOKING
// ============================================================================

/** May this person book? The requester at once, anyone invited after 2 hours. */
export function mayBook(card, chatUserId, now = new Date()) {
  const d = card.data || {};
  if (d.requester?.chatUserId === chatUserId) return true;
  const invited = (d.invitees || []).some(p => p.chatUserId === chatUserId);
  if (!invited) return false;
  return now.getTime() - new Date(card.created_at).getTime() >= INVITEE_BOOK_AFTER_MS;
}

/**
 * A rule-based description: what the thread asked, the last points made, the
 * open question, the Doc links in the thread and a link back. No model.
 */
export async function meetingDescription(card) {
  const d = card.data || {};
  const link = threadLink(card.space_name, card.thread_name);
  const lines = [];
  try {
    const read = await readThread({
      spaceName: card.space_name,
      threadName: card.thread_name,
      userIds: [d.requester?.userId, card.owner_user_id].filter(Boolean)
    });
    if (read.ok) {
      const messages = (read.messages || []).filter(m => m.senderType !== 'BOT' && m.text);
      const first = messages[0];
      const recent = messages.slice(-3);
      if (first?.text) lines.push(`The ask: ${clip(mdToPlain(first.text).replace(/\s+/g, ' '), 300)}`);
      if (recent.length) {
        lines.push('Last points in the thread:');
        for (const m of recent) {
          lines.push(`- ${m.senderName || 'Someone'}: ${clip(mdToPlain(m.text).replace(/\s+/g, ' '), 200)}`);
        }
      }
      const question = [...messages].reverse().find(m => /\?/.test(m.text || ''));
      if (question) lines.push(`Open question: ${clip(mdToPlain(question.text).replace(/\s+/g, ' '), 200)}`);
      const docs = [...new Set((read.messages || []).flatMap(m => [...String(m.text || '').matchAll(/https:\/\/docs\.google\.com\/\S+/g)].map(x => x[0])))];
      if (docs.length) {
        lines.push('Documents mentioned in the thread (suggestions, not an agenda):');
        for (const doc of docs.slice(0, 5)) lines.push(`- ${doc}`);
      }
    }
  } catch (err) {
    console.warn(`⚠️  Meet description read failed — code: ${codeOf(err)}`);
  }
  if (link) lines.push(`Chat thread: ${link}`);
  lines.push('Set up by Oracle from the Chat thread above.');
  return clip(lines.join('\n'), DESCRIPTION_CHARS);
}

/**
 * Book (or move) the meeting. The press was the confirmation, so the values
 * come from the card, never from a model.
 */
export async function bookSlot(cardId, actor, index, now = new Date()) {
  const card = await store.getCard(cardId);
  if (!card || !isLive(card)) return;
  const d = card.data || {};
  const slot = (d.slots || [])[index];
  if (!slot) {
    await finish(cardId, null);
    await tellPresser(card, actor, 'That time is no longer on the card — press Check again.');
    return;
  }

  const person = await resolvePerson(actor.chatUserId, { email: actor.email, displayName: actor.name, lookupAsUserId: card.owner_user_id });
  const emails = (d.invitees || []).map(p => p.email).filter(Boolean);
  const calendar = await import('../tools/google-calendar.js');
  let outcome;

  try {
    if (d.event?.id) {
      // A reschedule patches the SAME event as whoever created it: an invitee's
      // own copy usually cannot be patched, and a new event would lose the Meet
      // link and everyone's replies.
      const asUserId = d.event.byUserId || d.requester?.userId || card.owner_user_id;
      const moved = await calendar.updateCalendarEvent(asUserId, {
        event_id: d.event.id, start: slot.start, end: slot.end, send_updates: 'all'
      });
      if (!moved.success) throw Object.assign(new Error(moved.error || 'patch failed'), { code: 'patch' });
      await store.patchCardData(cardId, {
        busy: null,
        event: { ...d.event, start: slot.start, end: slot.end, movedBy: who(actor), movedAt: now.toISOString() },
        rescheduling: false,
        notice: null
      });
      await store.setDue(cardId, new Date(slot.end));
      outcome = 'moved';
    } else {
      const asUserId = d.requester?.userId || card.owner_user_id;
      const made = await calendar.createCalendarEvent(asUserId, {
        title: d.topic || 'Call',
        start: slot.start,
        end: slot.end,
        attendees: emails,
        description: await meetingDescription(card),
        add_meet_link: true,
        send_updates: 'all'
      });
      if (!made.success || !made.event?.id) throw Object.assign(new Error(made.error || 'insert failed'), { code: 'insert' });
      await store.patchCardData(cardId, {
        busy: null,
        event: {
          id: made.event.id,
          start: slot.start,
          end: slot.end,
          meetLink: made.meet_link || null,
          htmlLink: made.event.html_link || null,
          invited: emails.length,
          byUserId: asUserId,
          by: who(actor),
          at: now.toISOString()
        },
        notice: null
      });
      // The due date is the end of the meeting: that is what the follow-up DM waits for.
      await store.setDue(cardId, new Date(slot.end));
      outcome = 'booked';
    }
  } catch (err) {
    console.warn(`⚠️  Meet booking failed — code: ${codeOf(err)}`);
    await store.patchCardData(cardId, {
      busy: null,
      notice: {
        text: d.event?.id ? 'couldn’t move the meeting — nothing changed' : 'couldn’t book it — nothing was created',
        at: now.toISOString()
      }
    });
    outcome = 'failed';
  }

  console.log(`📅 Meet booking — result: ${outcome}, invited: ${emails.length}`);
  await rerenderCard(cardId);
}

// ============================================================================
// BUTTONS
// ============================================================================

async function handleAction({ card, actor, action, now = new Date() }) {
  const d = card.data || {};
  if (!isLive(card)) return { changed: false, ignored: 'not_open', reply: 'This card is closed, so nothing changed.' };
  if (d.busy && action in BOOK_ACTIONS) {
    return { changed: false, ignored: 'already_running', reply: 'Hold on — the last press is still running.' };
  }

  if (action in BOOK_ACTIONS) {
    const index = BOOK_ACTIONS[action];
    if (!(d.slots || [])[index]) return { changed: false, ignored: 'no_such_slot', reply: 'That time isn’t on the card — press Check again.' };
    if (!mayBook(card, actor.chatUserId, now)) {
      const mine = (d.invitees || []).some(p => p.chatUserId === actor.chatUserId);
      return {
        changed: false,
        ignored: mine ? 'too_soon' : 'not_invited',
        reply: mine
          ? `${nameOf(d.requester)} asked for this call, so they book first — you can book it two hours after the card went up.`
          : 'Only the people on this call can book it.'
      };
    }
    await store.patchCardData(card.id, { busy: { kind: 'booking', text: BUSY.booking, by: actor.name || null, at: now.toISOString() } });
    return { changed: true, background: () => bookSlot(card.id, actor, index, now) };
  }

  switch (action) {
    case 'meet.works':
    case 'meet.none': {
      const onCard = d.requester?.chatUserId === actor.chatUserId
        || (d.invitees || []).some(p => p.chatUserId === actor.chatUserId);
      if (!onCard) return { changed: false, ignored: 'not_invited', reply: 'You’re not on this call, so there’s nothing to answer.' };
      const votes = { ...(d.votes || {}), [actor.chatUserId]: { works: action === 'meet.works', at: now.toISOString(), name: actor.name || null } };
      await store.patchCardData(card.id, { votes });
      return { changed: true };
    }

    case 'meet.refresh':
    case 'meet.reschedule': {
      if (d.busy?.kind === 'slots') return { changed: false, ignored: 'already_running', reply: 'The calendars are already being checked.' };
      await store.patchCardData(card.id, { busy: { kind: 'slots', text: BUSY.slots, by: actor.name || null, at: now.toISOString() } });
      // Reschedule looks from now on, in the same length of window as before,
      // and puts the card into "moving it" mode so the new times can be picked.
      const window = action === 'meet.reschedule'
        ? { from: new Date(now.getTime() + MIN_LEAD_MS).toISOString(), to: new Date(now.getTime() + (DEFAULT_WINDOW_DAYS + 2) * DAY).toISOString(), words: null }
        : d.window;
      if (action === 'meet.reschedule' && d.event?.id) await store.patchCardData(card.id, { rescheduling: true });
      return { changed: true, background: () => fillSlots(card.id, { window, now }) };
    }

    case 'meet.next_week': {
      const from = new Date(new Date(d.window?.to || now).getTime());
      const window = { from: from.toISOString(), to: new Date(from.getTime() + 7 * DAY).toISOString(), words: 'the following week' };
      await store.patchCardData(card.id, { busy: { kind: 'slots', text: BUSY.slots, by: actor.name || null, at: now.toISOString() } });
      return { changed: true, background: () => fillSlots(card.id, { window, now }) };
    }

    case 'meet.ignore_hours': {
      if (d.ignoreHours) return { changed: false, ignored: 'already_there', reply: 'Working hours are already being ignored on this card.' };
      await store.patchCardData(card.id, { busy: { kind: 'slots', text: BUSY.slots, by: actor.name || null, at: now.toISOString() } });
      return { changed: true, background: () => fillSlots(card.id, { ignoreHours: true, now }) };
    }

    case 'meet.keep':
      if (!d.rescheduling) return { changed: false, ignored: 'not_moving', reply: 'This meeting isn’t being moved.' };
      await store.patchCardData(card.id, { rescheduling: false });
      return { changed: true };

    case 'meet.decision':
      return { changed: false, ignored: 'typed_command_needed', reply: TYPED_HINTS['meet.decision'] };

    case 'meet.cancel':
      if (actor.chatUserId !== card.owner_chat_id) {
        return { changed: false, ignored: 'not_the_owner', reply: 'Only whoever asked for this call can close the card.' };
      }
      await store.closeCard(card.id, 'resolved', now);
      return { changed: true };

    default:
      return { changed: false, ignored: 'unknown_action', reply: 'That button doesn’t do anything on this card.' };
  }
}

async function finish(cardId, outcome = null) {
  await store.patchCardData(cardId, {
    busy: null,
    ...(outcome ? { notice: { text: outcome, at: new Date().toISOString() } } : {})
  });
}

/** Presses re-read nothing: a fresh free/busy check is its own button. */
async function refresh() {
  return { changed: false };
}

// ============================================================================
// THE FOLLOW-UP DM
// ============================================================================

/**
 * A Granola note that looks like this meeting: the same day, overlapping the
 * meeting's hour, and a title sharing a word with the topic. The MCP result
 * shape is not modelled anywhere, so every step is defensive and "no note
 * found" is a normal outcome.
 */
export async function granolaNoteFor(card, userId) {
  const d = card.data || {};
  if (!userId || !d.event?.start) return null;
  try {
    const { granolaListMeetings } = await import('../tools/granola.js');
    const day = new Date(d.event.start).toISOString().slice(0, 10);
    const res = await granolaListMeetings({ start_date: day, end_date: day, limit: 20 }, { userId });
    if (!res?.success) return null;

    const list = findMeetingList(res.data);
    if (!list.length) return null;
    const startedAt = new Date(d.event.start).getTime();
    const words = new Set(String(d.topic || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));

    let best = null;
    for (const item of list) {
      const at = Date.parse(item.start_time || item.start || item.created_at || item.date || '');
      const near = Number.isFinite(at) ? Math.abs(at - startedAt) : Infinity;
      const title = String(item.title || item.name || '').toLowerCase();
      const shares = [...words].some(w => title.includes(w));
      if (near > 4 * HOUR && !shares) continue;
      const score = (shares ? 0 : HOUR) + (Number.isFinite(near) ? near : 6 * HOUR);
      if (!best || score < best.score) {
        best = {
          score,
          title: item.title || item.name || null,
          summary: firstText(item.summary ?? item.notes ?? item.overview ?? item.content)
        };
      }
    }
    return best && (best.summary || best.title) ? { title: best.title, summary: best.summary } : null;
  } catch (err) {
    console.warn(`⚠️  Granola note lookup failed — code: ${codeOf(err)}`);
    return null;
  }
}

/** Find the array of meetings in whatever the MCP wrapped it in. */
function findMeetingList(data, depth = 0) {
  if (depth > 4 || !data) return [];
  if (Array.isArray(data)) {
    return data.every(item => item && typeof item === 'object') ? data : [];
  }
  if (typeof data === 'string') {
    try {
      return findMeetingList(JSON.parse(data), depth + 1);
    } catch {
      return [];
    }
  }
  if (typeof data === 'object') {
    for (const key of ['meetings', 'results', 'items', 'data', 'content', 'structuredContent']) {
      const found = findMeetingList(data[key], depth + 1);
      if (found.length) return found;
    }
    // MCP content blocks: [{type:'text', text:'…'}]
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        const found = findMeetingList(block?.text, depth + 1);
        if (found.length) return found;
      }
    }
  }
  return [];
}

function firstText(value) {
  if (!value) return null;
  if (typeof value === 'string') return clip(value.replace(/\s+/g, ' ').trim(), DRAFT_CHARS) || null;
  if (Array.isArray(value)) return firstText(value.find(Boolean));
  if (typeof value === 'object') return firstText(value.text ?? value.markdown ?? value.body ?? null);
  return null;
}

/**
 * Hourly: one DM to whoever asked for the call, once the meeting has been over
 * for half an hour, for calls that came from a /track card. Because it rides
 * the hourly job it lands within the hour rather than at exactly +30 minutes.
 * Also closes cards nobody booked once their window is well past.
 */
async function sendDueNotices(now = new Date()) {
  const counts = { followups: 0, meetClosed: 0 };

  for (const card of await store.dueCardsOfType('meet', now)) {
    const d = card.data || {};
    if (card.due_reminded_at || !d.event?.end) continue;
    if (now.getTime() - new Date(d.event.end).getTime() < FOLLOWUP_AFTER_MS) continue;
    // Only a call that came from a tracked ask has a decision to record.
    if (!d.trackCardId) continue;
    if (!(await store.claimDueReminder(card.id, now))) continue;

    const note = await granolaNoteFor(card, d.requester?.userId || card.owner_user_id);
    const link = threadLink(card.space_name, card.thread_name);
    const lines = [
      `Your call “${card.title || 'Call'}” is over — what was decided?`,
      note?.summary
        ? `From your Granola note${note.title ? ` (“${note.title}”)` : ''}:\n${clip(note.summary, 1200)}`
        : 'I couldn’t find a meeting note for it, so this one is from memory.',
      'Reply in the thread with: @Oracle decision: <what was decided>',
      link || null
    ].filter(Boolean);

    const sent = await notifyImmediate('meeting_followup', {
      card, chatUserId: card.owner_chat_id, text: lines.join('\n\n')
    });
    if (sent.delivered) {
      counts.followups++;
      await store.patchCardData(card.id, { followup: { at: now.toISOString(), note: Boolean(note?.summary) } });
    }
  }

  // A card nobody booked, whose window is two weeks behind us, has no purpose.
  for (const card of await store.liveCardsOfType('meet')) {
    const d = card.data || {};
    if (d.event?.id) continue;
    const to = d.window?.to ? new Date(d.window.to).getTime() : new Date(card.created_at).getTime();
    if (now.getTime() - to < CLOSE_UNBOOKED_AFTER_DAYS * DAY) continue;
    await store.closeCard(card.id, 'resolved', now);
    await rerenderCard(card.id);
    counts.meetClosed++;
  }

  if (counts.followups || counts.meetClosed) {
    console.log(`📅 Meet notices — follow-ups: ${counts.followups}, closed unbooked: ${counts.meetClosed}`);
  }
  return counts;
}

// ============================================================================
// RENDER
// ============================================================================

function peopleLine(card) {
  const d = card.data || {};
  const names = (d.invitees || []).map(p => esc(nameOf(p)));
  return `With ${names.join(', ') || 'nobody yet'} · ${plural(d.durationMinutes || 30, 'minute')}`;
}

function marksLine(slot, card) {
  const d = card.data || {};
  const marks = slot.marks || [];
  const busy = marks.filter(m => !m.free);
  const unknown = marks.filter(m => m.seen === false);
  if (!busy.length && !unknown.length) return 'everyone free';
  const bits = [];
  if (busy.length) bits.push(`busy: ${busy.map(m => esc(mdToPlain(m.name || m.email || 'someone'))).join(', ')}`);
  if (unknown.length) bits.push(`not visible: ${unknown.length}`);
  return bits.join(' · ');
}

function slotLines(card) {
  const d = card.data || {};
  const tz = d.requester?.timeZone || d.timeZone || DEFAULT_TZ;
  return (d.slots || []).map((slot, i) => `${i + 1}. ${esc(slotWords(slot, tz))} — ${marksLine(slot, card)}`);
}

function bookedLines(card) {
  const d = card.data || {};
  const tz = d.requester?.timeZone || d.timeZone || DEFAULT_TZ;
  const event = d.event;
  if (!event) return [];
  const lines = [`<b>Booked</b> · ${esc(slotWords({ start: event.start, end: event.end }, tz))}`];
  const invited = event.invited ? `Invites sent to ${plural(event.invited, 'person')}` : 'No invites sent';
  lines.push(event.meetLink
    ? `${invited} — <a href="${esc(event.meetLink)}">Meet link</a>`
    : `${invited} — no Meet link came back`);
  if (event.movedBy) lines.push(`Moved by ${esc(nameOf(event.movedBy))}`);
  return lines;
}

function votesLine(card) {
  const votes = Object.values(card.data?.votes || {});
  if (!votes.length) return null;
  const yes = votes.filter(v => v.works).map(v => esc(mdToPlain(v.name || 'someone')));
  const no = votes.filter(v => !v.works).map(v => esc(mdToPlain(v.name || 'someone')));
  return [
    yes.length ? `These work for: ${yes.join(', ')}` : null,
    no.length ? `None work for: ${no.join(', ')}` : null
  ].filter(Boolean).join('<br>');
}

function smallPrint(card) {
  const d = card.data || {};
  const bits = [];
  if (d.unseen?.length) bits.push(`Couldn’t see ${d.unseen.length === 1 ? 'one calendar' : `${d.unseen.length} calendars`} — those times may not be free.`);
  if (d.noTimeZone?.length) bits.push(`No calendar time zone for ${plural(d.noTimeZone.length, 'person')} — assumed ${DEFAULT_TZ.split('/')[1]?.replace('_', ' ') || DEFAULT_TZ}.`);
  if (d.ignoreHours) bits.push('Working hours ignored on this card.');
  else bits.push('Working hours are assumed 9–5 (data/cards/working-hours.json) — Google exposes no setting for them.');
  return bits.join(' ');
}

function outcomeFor(d, latestClick) {
  const n = d.notice;
  if (!n?.text) return null;
  if (latestClick && new Date(n.at) < new Date(latestClick.created_at)) return null;
  return n.text;
}

function render(card, participants = [], latestClick = null, now = new Date()) {
  const d = card.data || {};
  const id = card.id;
  const live = isLive(card);
  const busy = d.busy?.text ? d.busy : null;
  const tz = d.requester?.timeZone || d.timeZone || DEFAULT_TZ;
  const sections = [];

  const head = [peopleLine(card)];
  if (d.window?.words) head.push(`Looking at ${esc(d.window.words)}`);
  sections.push({ widgets: [paragraph(head.join('<br>'))] });

  const booked = bookedLines(card);
  if (booked.length) {
    sections.push({ widgets: [paragraph(booked.join('<br>'))] });
    if (d.rescheduling) {
      const moving = slotLines(card);
      sections.push({
        header: 'Move it to',
        widgets: [paragraph(moving.length ? moving.join('<br>') : (busy ? 'Checking calendars…' : 'No other time works in that window.'))]
      });
    }
  } else {
    const slots = slotLines(card);
    sections.push({
      header: slots.length ? 'Times everyone is free' : null,
      widgets: [paragraph(slots.length
        ? slots.join('<br>')
        : (busy ? 'Checking calendars…' : 'No time in that window works for everyone — try next week, or ignore working hours.'))]
    });
  }

  const votes = votesLine(card);
  if (votes && !d.event) sections.push({ widgets: [paragraph(votes)] });

  sections.push({ widgets: [paragraph(`<i>${esc(smallPrint(card))}</i>`)] });

  const buttons = [];
  if (live && !busy) {
    if (d.event?.id && d.rescheduling && (d.slots || []).length) {
      (d.slots || []).slice(0, 3).forEach((slot, i) => {
        buttons.push(button(`Move to ${slotButtonWords(slot, tz)}`, { cardId: id, action: `meet.book${i + 1}` }));
      });
      buttons.push(button('Keep the booked time', { cardId: id, action: 'meet.keep' }));
      buttons.push(button('Try next week', { cardId: id, action: 'meet.next_week' }));
    } else if (d.event?.id) {
      buttons.push(button(d.rescheduling ? 'Look again' : 'Reschedule', { cardId: id, action: 'meet.reschedule' }));
      if (d.trackCardId) buttons.push(button('Record the decision', { cardId: id, action: 'meet.decision' }));
      buttons.push(button('Close card', { cardId: id, action: 'meet.cancel' }));
    } else if ((d.slots || []).length) {
      (d.slots || []).slice(0, 3).forEach((slot, i) => {
        buttons.push(button(`Book ${slotButtonWords(slot, tz)}`, { cardId: id, action: `meet.book${i + 1}` }));
      });
      buttons.push(button('These work for me', { cardId: id, action: 'meet.works' }));
      buttons.push(button('None work', { cardId: id, action: 'meet.none' }));
      buttons.push(button('Try next week', { cardId: id, action: 'meet.next_week' }));
      if (!d.ignoreHours) buttons.push(button('Ignore working hours', { cardId: id, action: 'meet.ignore_hours' }));
    } else {
      buttons.push(button('Try next week', { cardId: id, action: 'meet.next_week' }));
      if (!d.ignoreHours) buttons.push(button('Ignore working hours', { cardId: id, action: 'meet.ignore_hours' }));
      buttons.push(button('Check again', { cardId: id, action: 'meet.refresh' }));
    }
  }

  const status = d.event?.id ? 'Booked' : ((d.slots || []).length ? 'Pick a time' : 'No time found');
  const closed = card.status === 'closed' ? 'Closed' : null;

  return trackedCard({
    card,
    title: card.title || 'Call',
    subtitle: [`Meeting · asked by ${nameOf(d.requester)}`, status, closed].filter(Boolean).join(' · '),
    sections,
    buttons,
    latestClick,
    labels: LABELS,
    busy,
    outcome: outcomeFor(d, latestClick)
  });
}

function digestLine(card) {
  const d = card.data || {};
  const tz = d.requester?.timeZone || d.timeZone || DEFAULT_TZ;
  if (d.event?.start) return `Booked ${slotWords({ start: d.event.start, end: d.event.end }, tz)}`;
  return (d.slots || []).length ? 'Waiting for someone to book a time' : 'No time found yet';
}

/** One nudge to whoever asked, if a day passes with times offered and nothing booked. */
async function digestItems(chatUserId, { now = new Date(), localDate = null } = {}) {
  const items = [];
  for (const card of await store.liveCardsOfType('meet')) {
    const d = card.data || {};
    if (d.event?.id || card.owner_chat_id !== chatUserId) continue;
    const participants = await store.getParticipants(card.id);
    if (participants.find(p => p.chat_user_id === chatUserId)?.muted) continue;
    if (now.getTime() - new Date(card.created_at).getTime() < DAY) continue;
    if (d.shown?.unbookedOn && d.shown.unbookedOn !== localDate) continue;
    items.push({
      section: 'nudge',
      card,
      nudge: 'unbookedOn',
      text: (d.slots || []).length ? 'Times are on the card and nobody has booked one' : 'No time was found for this call'
    });
  }
  return items;
}

async function markDigestShown(items, localDate) {
  for (const item of items.filter(i => i.nudge)) {
    const fresh = await store.getCard(item.card.id);
    if (!fresh) continue;
    const shown = fresh.data?.shown || {};
    if (!shown[item.nudge]) await store.patchCardData(item.card.id, { shown: { ...shown, [item.nudge]: localDate } });
  }
}

// ============================================================================
// TYPED AND COMMAND ENTRY POINTS
// ============================================================================

/**
 * "@Oracle find 45 min with @Nat this week" — handled without the model.
 * @returns {Promise<boolean>} false → answer normally
 */
export async function handleMeetMessage({ evt, user, conversationId, messageText, now = new Date() }) {
  const threadName = evt.threadIsResourceName ? evt.threadId : null;
  const spaceName = evt.spaceIsResourceName ? evt.spaceId : null;
  const actor = { chatUserId: evt.senderChatId, name: evt.senderDisplayName || user?.name || null, email: evt.senderEmail || null };
  await createMeet({
    trigger: 'mention', actor, userId: user?.id || null, spaceName, threadName,
    surface: evt.isDm ? 'chat_dm' : 'chat_space',
    conversationId, messageText, messageName: evt.messageName,
    invitees: (evt.mentions || []).map(m => ({ chatUserId: m.chatUserId, name: m.displayName || m.name || null })),
    now
  });
  return true;
}

/** The /track card's "Schedule call" button: a meet card for that ask. */
export async function meetForTrackCard(trackCard, actor, now = new Date()) {
  const d = trackCard.data || {};
  const participants = await store.getParticipants(trackCard.id);
  const invitees = participants
    .filter(p => p.chat_user_id !== actor.chatUserId)
    .map(p => ({ chatUserId: p.chat_user_id, name: p.display_name || null }));
  const person = await resolvePerson(actor.chatUserId, { email: actor.email, displayName: actor.name, lookupAsUserId: trackCard.owner_user_id });

  return createMeet({
    trigger: 'track',
    actor: { chatUserId: actor.chatUserId, name: actor.name || null, email: actor.email || null },
    userId: person?.user_id || null,
    spaceName: trackCard.space_name,
    threadName: trackCard.thread_name,
    surface: d.surface || 'chat_space',
    conversationId: trackCard.conversation_id,
    messageText: trackCard.title || '',
    messageName: trackCard.source_message_name,
    invitees,
    trackCardId: trackCard.id,
    now
  });
}

// ============================================================================

export const meetCard = {
  type: 'meet',
  actions: MEET_ACTIONS,
  // A meeting six weeks out is not neglected because nobody pressed a button;
  // this card closes itself when the meeting is over (sendDueNotices) instead.
  neverStale: true,
  render,
  handleAction,
  refresh,
  digestLine,
  digestItems,
  markDigestShown,
  sendDueNotices
};

/**
 * The /track card — who has the ball on an ask in a thread
 *
 * Trigger: "/track" or "@Oracle track this" as a reply in a thread; the card
 * tracks the thread's first message (the ask). "Keep an eye on this" gets a
 * "Want me to track this?" question first. Plain questions stay plain answers.
 * Not for reviews — the review card does those.
 *
 * Two shapes:
 * - One ball (default): who holds it now — a person, the client, a call —
 *   until it is Decided or Resolved (both freeze the card).
 * - Everyone has a ball (@all, "everyone", "team, …"): a checklist of the
 *   space's people minus the requester; each marks only themselves.
 *
 * Every ball change records who, when and the message it came from, and the
 * card links that message. Refresh re-reads the thread as a signed-in person
 * and SUGGESTS a change — nothing moves until someone confirms. Only in a
 * listened space (stored copy live) are new messages applied straight away, as
 * a labelled best guess anyone can undo.
 *
 * Dialogs (Pass to…, Someone promised…, Record decision, Submit response,
 * Remove people…) open only when TRACK_DIALOGS_ENABLED=true; otherwise, and
 * always, the same actions work typed in the thread ("@Oracle decision: …").
 *
 * Logs: codes and counts only — never the ask, names, or thread/message ids.
 */

import * as store from '../database/tracked-cards-store.js';
import { FOUNDATION_ACTIONS, markCardReply } from './registry.js';
import { postMessage, patchCard } from './chat-api.js';
import { renderCard, rerenderCard, tellPresser } from './update.js';
import { notifyImmediate } from './notify.js';
import { resolvePerson, timeZoneFor, localClock, realPeople, isListenerChatUser } from './people.js';
import { trackedCard, paragraph, button, esc, clip, threadLink, messageLink, mdToPlain, textToCardHtml } from './render.js';
import { detectShape, isFeedbackAsk, parseDueDate, pickHolder, typedCommand } from './track-parse.js';
import { suggestBall, draftDecision } from './track-suggest.js';
import { readThread, readAsk, listSpaceHumans, storedCopyLive, normalizeMessage } from './track-thread.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const QUIET_AFTER_DAYS = 3;
export const CLIENT_NUDGE_AFTER_DAYS = 5;
const TITLE_CHARS = 100;
const TEXT_CHARS = 1000;
const SUMMARY_RESPONSE_CHARS = 150;
const MAX_NAMES = 8;
const DISPLAY_TZ = process.env.DEFAULT_TIMEZONE || 'America/Vancouver';

export const dialogsEnabled = () => process.env.TRACK_DIALOGS_ENABLED === 'true';
// "Schedule call" appears once /meet exists.
const meetAvailable = () => false;

export const TRACK_ACTIONS = {
  'track.take': { personal: true, label: 'took the ball' },
  'track.pass': { personal: false, label: 'passed the ball on', dialog: true },
  'track.client': { personal: false, label: 'marked it waiting on the client' },
  'track.call': { personal: false, label: 'marked that a call is needed' },
  'track.schedule': { personal: false, label: 'asked to schedule a call' },
  'track.promise': { personal: false, label: 'recorded a promise', dialog: true },
  'track.decision': { personal: false, label: 'recorded the decision', dialog: true },
  'track.resolve': { personal: false, label: 'marked it resolved' },
  'track.refresh': { personal: false, label: 'refreshed from the thread' },
  'track.confirm': { personal: false, label: 'confirmed the suggestion' },
  'track.dismiss': { personal: false, label: 'dismissed the suggestion' },
  'track.not_right': { personal: false, label: 'undid the best guess' },
  'track.switch': { personal: false, label: 'switched the card’s shape' },
  'track.done': { personal: true, label: 'marked their part done' },
  'track.help': { personal: true, label: 'asked for help' },
  'track.respond': { personal: true, label: 'submitted a response', dialog: true },
  'track.remove': { personal: false, label: 'took people off the list', dialog: true },
  'track.start': { personal: false, label: 'started tracking' },
  'track.auto': { personal: false, label: 'updated from the thread (best guess)' }
};

const LABELS = { ...FOUNDATION_ACTIONS, ...TRACK_ACTIONS };

/** What to type when a dialog is not available. */
export const TYPED_HINTS = {
  'track.pass': 'To pass it on, reply in this thread: @Oracle pass to @Name',
  'track.promise': 'To record a promise, reply in this thread: @Oracle promised @Name by <date>',
  'track.decision': 'To record the decision, reply in this thread: @Oracle decision: <what was decided>',
  'track.respond': 'To respond, reply in this thread: @Oracle response: <your response>',
  'track.remove': 'To take people off the list, reply in this thread: @Oracle remove @Name'
};

const HOW_TO = 'Use /track (or "@Oracle track this") as a reply in the thread you want tracked.';

const BUSY = {
  refresh: 'Reading the thread…',
  checklist: 'Building the list…',
  start: 'Setting up tracking…'
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const who = (p) => (p ? { chatUserId: p.chatUserId, name: p.name ?? p.displayName ?? null } : null);
const nameOf = (p) => mdToPlain(p?.name || 'someone');
const ballOf = (card) => card?.data?.ball || { state: 'unassigned' };
const isLive = (card) => ['open', 'stale'].includes(card?.status);
const daysSince = (at, now = new Date()) => (at ? Math.max(0, Math.floor((now - new Date(at)) / DAY_MS)) : 0);

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

function shortDate(at) {
  if (!at) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_TZ, month: 'short', day: 'numeric' }).format(new Date(at));
}

function dueText(due) {
  if (!due?.at) return null;
  const opts = { timeZone: DISPLAY_TZ, weekday: 'short', month: 'short', day: 'numeric' };
  if (due.hasTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(due.at));
}

/** Our own card HTML → plain text (digest labels render no HTML). */
function htmlToPlain(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function firstLine(text) {
  const line = String(text || '').split(/\n/).map(l => l.trim()).find(Boolean) || '';
  return clip(mdToPlain(line), TITLE_CHARS) || 'Tracked ask';
}

function cleanText(text) {
  const t = String(text || '').replace(/\r/g, '').trim();
  return t.length > TEXT_CHARS ? `${t.slice(0, TEXT_CHARS - 1)}…` : t;
}

async function userIdOf(actor, lookupAsUserId = null) {
  const person = await resolvePerson(actor?.chatUserId, { displayName: actor?.name, email: actor?.email, lookupAsUserId });
  return person?.user_id || null;
}

/** A reply only the person sees (a plain reply in a DM). Never throws. */
async function privateReply({ spaceName, threadName, surface, chatUserId, text }) {
  if (!spaceName || !chatUserId || !text) return false;
  try {
    await postMessage({ spaceName, threadName, text, privateTo: surface === 'chat_dm' ? null : chatUserId });
    return true;
  } catch (err) {
    console.warn(`⚠️  Track private reply failed — code: ${codeOf(err)}`);
    return false;
  }
}

// ============================================================================
// CREATING
// ============================================================================

/**
 * Track a thread: read its first message and post the card as a thread reply.
 *
 * @param {Object} p
 * @param {'command'|'mention'|'offer'} p.trigger
 * @param {{chatUserId: string, name?: string}} p.actor - who asked to track it
 * @param {number} p.userId - that person's Hub user (for reading the thread)
 * @param {string} p.spaceName
 * @param {string|null} p.threadName
 * @param {'chat_space'|'chat_dm'} [p.surface]
 * @param {string} [p.conversationId] - the Oracle conversation, when the card is a reply to @Oracle
 * @param {string} [p.commandMessageName] - the /track or @Oracle message itself
 * @param {string} [p.askText] - words typed after /track, used when the command started the thread
 * @param {Date} [p.now]
 */
export async function createTrack({
  trigger, actor, userId, spaceName, threadName, surface = 'chat_space',
  conversationId = null, commandMessageName = null, askText = null, now = new Date()
}) {
  const reply = (text) => privateReply({ spaceName, threadName, surface, chatUserId: actor.chatUserId, text });
  const done = (result) => {
    if (conversationId) markCardReply(conversationId);
    console.log(`🗂️  Track card ${result.code || 'posted'} — trigger: ${trigger}${result.stats || ''}`);
    return result;
  };

  if (!spaceName || !threadName) {
    await reply(HOW_TO);
    return done({ ok: false, code: 'no_thread' });
  }

  const existing = await store.findLiveCard('track', threadName);
  if (existing && existing.status !== 'offered') {
    await reply('This thread is already tracked — its card is in the thread.');
    return done({ ok: false, code: 'already_tracked' });
  }
  const offer = existing;

  const read = await readAsk({ spaceName, threadName, userIds: [userId, offer?.owner_user_id] });
  if (!read.ok) {
    const { MESSAGES, hubSignInUrl } = await import('../tools/chat-history.js');
    await reply(read.code === 'needs_reconsent'
      ? MESSAGES.needsReconsent(hubSignInUrl())
      : 'I couldn’t read this thread, so nothing is tracked yet — try again in a moment.');
    if (offer) await store.patchCardData(offer.id, { busy: null });
    return done({ ok: false, code: `ask_unreadable_${read.code}` });
  }

  let ask = read.ask;
  if (ask.name && ask.name === commandMessageName) {
    // The command started its own thread: there is nothing above it to track.
    const words = String(askText || '').trim();
    if (!words) {
      await reply(HOW_TO);
      return done({ ok: false, code: 'no_ask' });
    }
    ask = { ...ask, text: words, mentions: ask.mentions, mentionsAll: ask.mentionsAll };
  }

  const askedBy = ask.senderType === 'BOT' || !ask.senderChatId
    ? who(actor)
    : { chatUserId: ask.senderChatId, name: ask.senderName || null };
  const ownerPerson = await resolvePerson(askedBy.chatUserId, {
    displayName: askedBy.name,
    userId: askedBy.chatUserId === actor.chatUserId ? userId : null,
    lookupAsUserId: userId
  });
  const timeZone = await timeZoneFor(ownerPerson, now);
  const due = parseDueDate(ask.text, timeZone, ask.at ? new Date(ask.at) : now);
  const shape = detectShape(ask.text, ask.mentionsAll);
  const feedback = shape === 'everyone' && isFeedbackAsk(ask.text);
  const mentioned = await realPeople((ask.mentions || []).filter(m => m.chatUserId !== askedBy.chatUserId), userId);
  const holder = pickHolder(mentioned);

  let checklist = { built: false, code: null };
  let everyone = [];
  if (shape === 'everyone') {
    const list = await listSpaceHumans(spaceName, { exclude: [askedBy.chatUserId], lookupAsUserId: userId });
    everyone = list.people;
    checklist = { built: true, code: list.ok ? null : list.code };
  }

  const since = now.toISOString();
  const by = who(actor);
  const ball = holder
    ? { state: 'person', holder, since, by, source: ask.name, guess: false }
    : { state: 'unassigned', holder: null, since, by, source: ask.name, guess: false };
  const title = firstLine(ask.text);
  const data = {
    surface,
    requesterName: askedBy.name,
    trackedBy: { ...by, userId },
    askMessage: ask.name,
    shape,
    feedback,
    due: due ? { at: due.at.toISOString(), label: due.label, hasTime: due.hasTime } : null,
    ball,
    prevBall: null,
    history: [{ state: ball.state, holder: holder?.chatUserId || null, by: by.chatUserId, at: since, source: ask.name, guess: false }],
    suggestion: null,
    decision: null,
    responses: {},
    checklist,
    shown: {},
    busy: null,
    notice: null
  };

  let card = offer
    ? await store.updateCard(offer.id, {
      status: 'open', title, data, lastActivityAt: now, sourceMessageName: ask.name,
      ownerChatId: askedBy.chatUserId, ownerUserId: ownerPerson?.user_id || null
    })
    : await store.insertCard({
      cardType: 'track', status: 'open', spaceName, threadName, sourceMessageName: ask.name,
      conversationId: null, ownerChatId: askedBy.chatUserId, ownerUserId: ownerPerson?.user_id || null,
      title, data
    });
  if (!card) {
    await reply('This thread is already tracked — its card is in the thread.');
    return done({ ok: false, code: 'already_tracked' });
  }
  if (due) card = await store.setDue(card.id, due.at);

  await store.addParticipants(card.id, [
    { chatUserId: askedBy.chatUserId, role: 'owner', displayName: askedBy.name },
    ...(holder ? [{ chatUserId: holder.chatUserId, role: 'member', displayName: holder.name }] : []),
    ...everyone.map(p => ({ chatUserId: p.chatUserId, role: 'member', displayName: p.name, status: 'pending' }))
  ]);

  const cardsV2 = await renderCard(card);
  if (card.message_name) {
    await patchCard(card.message_name, cardsV2);   // the question becomes the card
  } else {
    const messageName = await postMessage({ spaceName, threadName, cardsV2 });
    card = await store.updateCard(card.id, { messageName });
  }

  if (holder && holder.chatUserId !== actor.chatUserId) await notifyAssigned(card, holder, askedBy);

  return done({
    ok: true,
    code: null,
    card,
    stats: `, shape: ${shape}, holder: ${holder ? 'yes' : 'no'}, people: ${everyone.length}, due: ${due ? 'yes' : 'no'}`
  });
}

/** "Keep an eye on this" — ask first, with a button. */
export async function offerTrack({ actor, userId, spaceName, threadName, surface = 'chat_space', conversationId = null }) {
  if (conversationId) markCardReply(conversationId);
  if (!spaceName || !threadName) {
    await privateReply({ spaceName, threadName, surface, chatUserId: actor.chatUserId, text: HOW_TO });
    return { ok: false, code: 'no_thread' };
  }
  const existing = await store.findLiveCard('track', threadName);
  if (existing) {
    if (existing.status !== 'offered') {
      await privateReply({ spaceName, threadName, surface, chatUserId: actor.chatUserId, text: 'This thread is already tracked — its card is in the thread.' });
    }
    return { ok: true, code: 'already_there' };
  }
  const row = await store.insertCard({
    cardType: 'track', status: 'offered', spaceName, threadName, conversationId: null,
    ownerChatId: actor.chatUserId, ownerUserId: userId, title: 'Want me to track this?',
    data: { surface, trackedBy: { ...who(actor), userId }, offer: true }
  });
  if (!row) return { ok: true, code: 'already_there' };
  const messageName = await postMessage({ spaceName, threadName, cardsV2: await renderCard(row) });
  await store.updateCard(row.id, { messageName });
  console.log('🗂️  Track card offered — reason: intent_unclear');
  return { ok: true, code: 'asked' };
}

// ============================================================================
// CHANGING THE BALL (shared by buttons, dialogs, typed commands and the hook)
// ============================================================================

async function notifyAssigned(card, holder, from) {
  const link = threadLink(card.space_name, card.thread_name);
  const sent = await notifyImmediate('assigned', {
    card,
    chatUserId: holder.chatUserId,
    text: `${mdToPlain(from?.name || 'A teammate')} passed you the ball on “${card.title}”.${link ? ` ${link}` : ''}`
  });
  if (sent.delivered) await store.markAssignedNotified(card.id, holder.chatUserId);
}

/** Move the ball. Records who, when and from which message; clears the suggestion and nudges. */
async function moveBall(card, next, actor, now, { source = null, guess = false } = {}) {
  const fresh = (await store.getCard(card.id)) || card;
  const d = fresh.data || {};
  const ball = { holder: null, ...next, since: now.toISOString(), by: who(actor), source, guess };
  const history = [
    ...(d.history || []),
    { state: ball.state, holder: ball.holder?.chatUserId || null, by: ball.by?.chatUserId || null, at: ball.since, source, guess }
  ].slice(-20);
  const patched = await store.patchCardData(card.id, {
    ball, prevBall: d.ball || null, history, suggestion: null, shown: {}, notice: null
  });
  if (ball.holder?.chatUserId) {
    await store.addParticipants(card.id, [{ chatUserId: ball.holder.chatUserId, role: 'member', displayName: ball.holder.name }]);
  }
  if (ball.chaser?.chatUserId) {
    await store.addParticipants(card.id, [{ chatUserId: ball.chaser.chatUserId, role: 'member', displayName: ball.chaser.name }]);
  }
  return patched;
}

const newHolder = (card, target) => ballOf(card).holder?.chatUserId !== target?.chatUserId;

export async function applyPass(card, actor, target, now = new Date(), source = null) {
  if (!target?.chatUserId) return { changed: false, ignored: 'no_person', reply: TYPED_HINTS['track.pass'] };
  if (ballOf(card).state === 'person' && !newHolder(card, target)) {
    return { changed: false, ignored: 'already_there', reply: `It’s already with ${nameOf(target)}.` };
  }
  await moveBall(card, { state: 'person', holder: who(target) }, actor, now, { source });
  const fresh = await store.getCard(card.id);
  return {
    changed: true,
    background: target.chatUserId !== actor.chatUserId ? () => notifyAssigned(fresh, who(target), actor) : null
  };
}

export async function applyPromise(card, actor, target, words, now = new Date(), source = null) {
  const person = who(target || actor);
  const owner = await resolvePerson(card.owner_chat_id, { userId: card.owner_user_id });
  const due = parseDueDate(words, await timeZoneFor(owner, now), now);
  const change = newHolder(card, person);
  await moveBall(card, { state: 'person', holder: person, promised: true, promisedBy: who(actor) }, actor, now, { source });
  if (due) {
    await store.setDue(card.id, due.at);
    await store.patchCardData(card.id, { due: { at: due.at.toISOString(), label: due.label, hasTime: due.hasTime } });
  }
  const fresh = await store.getCard(card.id);
  return {
    changed: true,
    background: change && person.chatUserId !== actor.chatUserId ? () => notifyAssigned(fresh, person, actor) : null
  };
}

export async function applyDecision(card, actor, text, now = new Date()) {
  const decision = cleanText(text);
  if (!decision) return { changed: false, ignored: 'empty', reply: TYPED_HINTS['track.decision'] };
  await store.patchCardData(card.id, { decision: { text: decision, by: who(actor), at: now.toISOString() } });
  await moveBall(card, { state: 'decided', holder: null }, actor, now, { source: null });
  await store.closeCard(card.id, 'decided', now);
  return { changed: true };
}

export async function applyResponse(card, actor, text, now = new Date()) {
  const response = cleanText(text);
  if (!response) return { changed: false, ignored: 'empty', reply: TYPED_HINTS['track.respond'] };
  if ((card.data?.shape || 'one') !== 'everyone') {
    return { changed: false, ignored: 'not_everyone', reply: 'This card tracks one person, so there’s nothing to respond to on it.' };
  }
  if (await isListenerChatUser(actor)) return { changed: false, ignored: 'listener_account', reply: 'This account can’t respond.' };
  const fresh = await store.getCard(card.id);
  const responses = { ...(fresh.data?.responses || {}), [actor.chatUserId]: { text: response, name: actor.name || null, at: now.toISOString() } };
  await store.patchCardData(card.id, { responses });
  const claimed = await markMember(card, actor, 'done', now);
  return { changed: true, claimed };
}

export async function applyRemove(card, actor, chatUserIds = [], now = new Date()) {
  if (actor.chatUserId !== card.owner_chat_id) {
    return { changed: false, ignored: 'not_the_owner', reply: 'Only the person who asked can take people off the list.' };
  }
  let removed = 0;
  for (const id of chatUserIds) if (await store.removeParticipant(card.id, id)) removed++;
  return removed ? { changed: true } : { changed: false, ignored: 'nobody_removed', reply: 'Nobody was taken off — they aren’t on the list.' };
}

/** Everyone shape: the presser's own row only; someone not listed is added. */
async function markMember(card, actor, status, now) {
  if (await store.setMemberStatus(card.id, actor.chatUserId, status, now)) return false;
  await store.addParticipants(card.id, [{ chatUserId: actor.chatUserId, role: 'member', displayName: actor.name, status }]);
  return store.setMemberStatus(card.id, actor.chatUserId, status, now);
}

function sameAsNow(card, s) {
  const b = ballOf(card);
  if (!s) return true;
  if (s.state !== b.state) return false;
  return s.state !== 'person' || s.holder?.chatUserId === b.holder?.chatUserId;
}

/** Apply a suggestion (confirmed, or as a best guess in a listened space). */
async function applySuggestion(card, s, actor, now, { guess = false } = {}) {
  if (s.state === 'person') {
    const outcome = s.promised
      ? await applyPromise(card, s.holder, s.holder, s.due?.label || '', now, s.source)
      : await applyPass(card, actor, s.holder, now, s.source);
    if (guess) await store.patchCardData(card.id, { ball: { ...ballOf(await store.getCard(card.id)), guess: true } });
    return outcome;
  }
  if (s.state === 'client') {
    await moveBall(card, { state: 'client', chaser: s.chaser || who(actor) }, actor, now, { source: s.source, guess });
    return { changed: true };
  }
  if (s.state === 'call') {
    await moveBall(card, { state: 'call', holder: ballOf(card).holder || null }, actor, now, { source: s.source, guess });
    return { changed: true };
  }
  // A decision needs its words: offer the decision action instead.
  return { changed: false, ignored: 'decision_needs_text', reply: TYPED_HINTS['track.decision'] };
}

// ============================================================================
// BUTTONS — database only; slow work is returned as `background`
// ============================================================================

async function handleAction({ card, actor, action, now = new Date() }) {
  const d = card.data || {};

  if (card.status === 'offered') {
    if (action !== 'track.start') return { changed: false, ignored: 'not_tracked_yet', reply: 'Press Track first.' };
    if (d.busy) return { changed: false, ignored: 'already_running', reply: 'Tracking is already being set up.' };
    await store.patchCardData(card.id, { busy: { kind: 'start', text: BUSY.start, by: actor.name || null, at: now.toISOString() } });
    return { changed: true, background: () => startFromOffer(card.id, actor, now) };
  }
  if (!isLive(card)) return { changed: false, ignored: 'not_open', reply: 'This card is closed, so nothing changed.' };
  if (TRACK_ACTIONS[action]?.dialog) {
    // A dialog button pressed without a dialog (flag off): say what to type.
    return { changed: false, ignored: 'typed_command_needed', reply: TYPED_HINTS[action] };
  }

  const b = ballOf(card);
  const everyone = (d.shape || 'one') === 'everyone';

  switch (action) {
    case 'track.take':
      if (everyone) return { changed: false, ignored: 'everyone_shape', reply: 'Everyone has a part on this card — press I’ve done it when yours is done.' };
      if (await isListenerChatUser(actor)) return { changed: false, ignored: 'listener_account', reply: 'This account can’t take the ball.' };
      if (b.state === 'person' && b.holder?.chatUserId === actor.chatUserId) {
        return { changed: false, ignored: 'already_yours', reply: 'It’s already with you.' };
      }
      await moveBall(card, { state: 'person', holder: who(actor) }, actor, now);
      return { changed: true, claimed: true };

    case 'track.client':
      if (b.state === 'client') return { changed: false, ignored: 'already_there', reply: 'It’s already waiting on the client.' };
      await moveBall(card, { state: 'client', chaser: who(actor) }, actor, now);
      return { changed: true };

    case 'track.call':
      if (b.state === 'call') return { changed: false, ignored: 'already_there', reply: 'A call is already marked as needed.' };
      await moveBall(card, { state: 'call', holder: b.holder || null }, actor, now);
      return { changed: true };

    case 'track.schedule':
      return { changed: false, ignored: 'not_available', reply: 'Scheduling from the card isn’t available yet.' };

    case 'track.resolve':
      await moveBall(card, { state: 'resolved' }, actor, now);
      await store.closeCard(card.id, 'resolved', now);
      return { changed: true };

    case 'track.refresh':
      if (d.busy?.kind === 'refresh') return { changed: false, ignored: 'already_running', reply: 'The thread is already being read.' };
      await store.patchCardData(card.id, { busy: { kind: 'refresh', text: BUSY.refresh, by: actor.name || null, at: now.toISOString() } });
      return { changed: true, background: () => refreshFromThread(card.id, actor, now) };

    case 'track.confirm': {
      if (!d.suggestion) return { changed: false, ignored: 'nothing_to_confirm', reply: 'There’s no suggestion to confirm.' };
      const outcome = await applySuggestion(card, d.suggestion, actor, now);
      if (outcome.changed) await store.patchCardData(card.id, { suggestion: null });
      return outcome;
    }

    case 'track.dismiss':
      if (!d.suggestion) return { changed: false, ignored: 'nothing_to_dismiss', reply: 'There’s no suggestion to dismiss.' };
      await store.patchCardData(card.id, { suggestion: null, notice: null });
      return { changed: true };

    case 'track.not_right':
      if (!b.guess) return { changed: false, ignored: 'not_a_guess', reply: 'This wasn’t a best guess, so there’s nothing to undo.' };
      await moveBall(card, { ...(d.prevBall || { state: 'unassigned' }), guess: false }, actor, now);
      return { changed: true };

    case 'track.switch': {
      const shape = everyone ? 'one' : 'everyone';
      const patch = { shape };
      const build = shape === 'everyone' && !d.checklist?.built;
      if (build) patch.busy = { kind: 'checklist', text: BUSY.checklist, by: actor.name || null, at: now.toISOString() };
      await store.patchCardData(card.id, patch);
      return { changed: true, background: build ? () => buildChecklist(card.id, actor) : null };
    }

    case 'track.done':
    case 'track.help': {
      if (!everyone) return { changed: false, ignored: 'one_ball_shape', reply: 'This card tracks one person — use I’ll take it or Pass to… instead.' };
      if (await isListenerChatUser(actor)) return { changed: false, ignored: 'listener_account', reply: 'This account can’t take part.' };
      const claimed = await markMember(card, actor, action === 'track.done' ? 'done' : 'needs_help', now);
      return { changed: true, claimed };
    }

    default:
      return { changed: false, ignored: 'unknown_action', reply: 'That button doesn’t do anything on this card.' };
  }
}

// ============================================================================
// BACKGROUND WORK
// ============================================================================

async function exclusionFor(messages, lookupAsUserId) {
  const ids = new Map();
  for (const m of messages) for (const x of m.mentions || []) ids.set(x.chatUserId, x);
  const real = new Set((await realPeople([...ids.values()], lookupAsUserId)).map(p => p.chatUserId));
  return (chatUserId) => !real.has(chatUserId);
}

function newestPersonMessageAt(messages) {
  const times = messages.filter(m => m.senderType !== 'BOT' && m.at).map(m => new Date(m.at).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Refresh: read the thread and suggest (or, in a listened space, apply a best guess). */
export async function refreshFromThread(cardId, actor, now = new Date()) {
  const card = await store.getCard(cardId);
  if (!isLive(card)) return;
  const d = card.data || {};
  const actorUserId = await userIdOf(actor, card.owner_user_id);
  const read = await readThread({
    spaceName: card.space_name, threadName: card.thread_name,
    userIds: [card.owner_user_id, d.trackedBy?.userId, actorUserId]
  });
  const finish = (patch) => store.patchCardData(cardId, { busy: null, ...patch });

  if (!read.ok) {
    await finish({ notice: { text: 'couldn’t read the thread', at: new Date().toISOString() } });
    if (read.code === 'needs_reconsent') {
      const { MESSAGES, hubSignInUrl } = await import('../tools/chat-history.js');
      await tellPresser(card, actor, MESSAGES.needsReconsent(hubSignInUrl()));
    }
    console.log(`🗂️  Track refresh — result: unreadable (${read.code})`);
    return;
  }

  await touchFromThread(card, read.messages);
  if (read.via !== 'user') {
    await finish({ notice: { text: 'read from the stored copy — no suggestion', at: new Date().toISOString() } });
    return;
  }

  const owner = { chatUserId: card.owner_chat_id, name: d.requesterName || null };
  const timeZone = await timeZoneFor(await resolvePerson(card.owner_chat_id, { userId: card.owner_user_id }), now);
  const s = suggestBall(read.messages, {
    since: ballOf(card).since, holderChatId: ballOf(card).holder?.chatUserId, owner,
    isExcluded: await exclusionFor(read.messages, card.owner_user_id), timeZone
  });

  if (!s || sameAsNow(card, s)) {
    await finish({ suggestion: null, notice: { text: 'no change spotted in the thread', at: new Date().toISOString() } });
    console.log('🗂️  Track refresh — result: no_change');
    return;
  }
  const suggestion = { ...s, due: s.due ? { at: s.due.at.toISOString?.() || s.due.at, label: s.due.label, hasTime: s.due.hasTime } : null, at: now.toISOString() };

  if (await storedCopyLive(card.space_name) && s.state !== 'decided') {
    await finish({});
    await applySuggestion(await store.getCard(cardId), suggestion, actor, now, { guess: true });
    console.log(`🗂️  Track refresh — result: best_guess (${s.state})`);
    return;
  }
  await finish({ suggestion, notice: null });
  console.log(`🗂️  Track refresh — result: suggested (${s.state})`);
}

/** A newer message in the thread counts as activity (and reopens a stale card). */
async function touchFromThread(card, messages) {
  const newest = newestPersonMessageAt(messages);
  if (newest && newest > new Date(card.last_activity_at)) {
    const touched = await store.touchActivity(card.id, newest);
    return touched && card.status === 'stale';
  }
  return false;
}

async function buildChecklist(cardId, actor) {
  const card = await store.getCard(cardId);
  if (!card) return;
  const list = await listSpaceHumans(card.space_name, { exclude: [card.owner_chat_id], lookupAsUserId: card.owner_user_id });
  await store.addParticipants(cardId, list.people.map(p => ({ chatUserId: p.chatUserId, role: 'member', displayName: p.name, status: 'pending' })));
  await store.patchCardData(cardId, { busy: null, checklist: { built: true, code: list.ok ? null : list.code } });
}

async function startFromOffer(cardId, actor, now) {
  const offer = await store.getCard(cardId);
  if (!offer || offer.status !== 'offered') return;
  const userId = (await userIdOf(actor, offer.owner_user_id)) || offer.owner_user_id;
  const result = await createTrack({
    trigger: 'offer', actor, userId, spaceName: offer.space_name, threadName: offer.thread_name,
    surface: offer.data?.surface || 'chat_space', now
  });
  if (!result.ok) await store.patchCardData(cardId, { busy: null });
}

/** Daily: a thread that moved on counts as activity, so a busy thread never goes stale. */
async function refresh(card, { reason = 'press' } = {}) {
  if (reason !== 'daily' || !isLive(card)) return { changed: false };
  const d = card.data || {};
  const read = await readThread({
    spaceName: card.space_name, threadName: card.thread_name, userIds: [card.owner_user_id, d.trackedBy?.userId]
  });
  if (!read.ok) return { changed: false };
  return { changed: await touchFromThread(card, read.messages) };
}

// ============================================================================
// TYPED COMMANDS AND @MENTIONS (from the Chat adapter)
// ============================================================================

const TYPED_ACTIONS = { decision: 'track.decision', response: 'track.respond', pass: 'track.pass', remove: 'track.remove', promise: 'track.promise' };

/**
 * An @Oracle message the /track card handles without the model.
 * @returns {Promise<boolean>} false → answer normally
 */
export async function handleTrackMessage({ evt, user, conversationId, messageText, intent, now = new Date() }) {
  const threadName = evt.threadIsResourceName ? evt.threadId : null;
  const spaceName = evt.spaceIsResourceName ? evt.spaceId : null;
  const surface = evt.isDm ? 'chat_dm' : 'chat_space';
  const actor = { chatUserId: evt.senderChatId, name: evt.senderDisplayName || user?.name || null, email: evt.senderEmail || null };

  if (intent === 'track') {
    await createTrack({ trigger: 'mention', actor, userId: user.id, spaceName, threadName, surface, conversationId, commandMessageName: evt.messageName, now });
    return true;
  }
  if (intent === 'maybe') {
    await offerTrack({ actor, userId: user.id, spaceName, threadName, surface, conversationId });
    return true;
  }

  const cmd = typedCommand(messageText);
  if (!cmd || !threadName) return false;
  const card = await store.findLiveCard('track', threadName);
  if (!isLive(card)) return false;

  const people = await realPeople(evt.mentions || [], user.id);
  let outcome;
  switch (cmd.kind) {
    case 'decision': outcome = await applyDecision(card, actor, cmd.text, now); break;
    case 'response': outcome = await applyResponse(card, actor, cmd.text, now); break;
    case 'pass': outcome = await applyPass(card, actor, who(people[0]), now, evt.messageName); break;
    case 'remove':
      outcome = people.length
        ? await applyRemove(card, actor, people.map(p => p.chatUserId), now)
        : { changed: false, ignored: 'no_person', reply: TYPED_HINTS['track.remove'] };
      break;
    default: outcome = await applyPromise(card, actor, who(people[0]) || actor, cmd.text || '', now, evt.messageName);
  }
  const { finishPress } = await import('./actions.js');
  await finishPress(card, trackCard, actor, TYPED_ACTIONS[cmd.kind], outcome, now);
  if (conversationId) markCardReply(conversationId);
  return true;
}

/**
 * Listened spaces only: new messages move the ball as a labelled best guess.
 * The caller passes messages from *created* events; apps (Oracle included) are
 * skipped, so a card patch can never feed back into itself.
 */
export async function onThreadMessages(spaceName, messages, now = new Date()) {
  if (!(await storedCopyLive(spaceName))) return { guessed: 0 };
  let guessed = 0;
  for (const raw of messages) {
    const m = normalizeMessage(raw);
    const threadName = raw?.thread?.name;
    if (!threadName || m.senderType === 'BOT' || !m.senderChatId) continue;

    for (const card of await store.liveCardsInThread(threadName)) {
      if (card.message_name === m.name) continue;
      const reopened = card.status === 'stale';
      await store.touchActivity(card.id, m.at ? new Date(m.at) : now);
      if (card.card_type !== 'track') {
        if (reopened) await rerenderCard(card.id);
        continue;
      }
      const d = card.data || {};
      const owner = await resolvePerson(card.owner_chat_id, { userId: card.owner_user_id });
      const s = suggestBall([m], {
        since: ballOf(card).since, holderChatId: ballOf(card).holder?.chatUserId,
        owner: { chatUserId: card.owner_chat_id, name: d.requesterName || null },
        isExcluded: await exclusionFor([m], card.owner_user_id),
        timeZone: await timeZoneFor(owner, now)
      });
      const actor = { chatUserId: m.senderChatId, name: m.senderName };
      if (s && !sameAsNow(card, s) && s.state !== 'decided') {
        const outcome = await applySuggestion(card, s, actor, now, { guess: true });
        const { finishPress } = await import('./actions.js');
        await finishPress(card, trackCard, actor, 'track.auto', { ...outcome, reply: null }, now);
        guessed++;
      } else if (reopened) {
        await rerenderCard(card.id);
      }
    }
  }
  if (guessed) console.log(`🗂️  Track best guess — applied: ${guessed}`);
  return { guessed };
}

// ============================================================================
// DIALOGS (TRACK_DIALOGS_ENABLED) — content only; routing is in dialogs.js
// ============================================================================

/** The dialog for an action, as a bare card, or null. */
export async function dialogFor(card, action, actor) {
  const d = card.data || {};
  const submit = (text) => button(text, { cardId: card.id, action, step: 'submit' });
  switch (action) {
    case 'track.decision': {
      const read = await readThread({
        spaceName: card.space_name, threadName: card.thread_name,
        userIds: [await userIdOf(actor, card.owner_user_id), card.owner_user_id, d.trackedBy?.userId]
      });
      return dialogCard('Record decision', [
        textInput('decision', 'What was decided', read.ok ? mdToPlain(draftDecision(read.messages)) : '')
      ], submit('Save decision'));
    }
    case 'track.respond':
      return dialogCard('Submit response', [textInput('response', 'Your response', d.responses?.[actor.chatUserId]?.text || '')], submit('Submit'));
    case 'track.pass':
    case 'track.promise': {
      const list = await listSpaceHumans(card.space_name, { exclude: [], lookupAsUserId: card.owner_user_id });
      const widgets = [peoplePicker('person', action === 'track.pass' ? 'Pass to' : 'Who promised', list.people)];
      if (action === 'track.promise') widgets.push(textInputLine('when', 'By when (e.g. "by Friday")'));
      return dialogCard(action === 'track.pass' ? 'Pass to…' : 'Someone promised…', widgets, submit('Save'));
    }
    case 'track.remove': {
      const people = (await store.getParticipants(card.id)).filter(p => p.role === 'member');
      return dialogCard('Remove people', [{
        selectionInput: {
          name: 'remove', label: 'Take off the list', type: 'CHECK_BOX',
          items: people.map(p => ({ text: mdToPlain(p.display_name || 'Someone'), value: p.chat_user_id, selected: false }))
        }
      }], submit('Remove'));
    }
    default:
      return null;
  }
}

/** A dialog was submitted: apply it. Returns an outcome for finishPress. */
export async function submitDialog(card, action, actor, form, now = new Date()) {
  const first = (name) => (form[name] || [])[0] || '';
  const person = async (id) => {
    if (!id) return null;
    const people = await realPeople([{ chatUserId: id }], card.owner_user_id);
    if (!people.length) return null;
    const p = await resolvePerson(id);
    return { chatUserId: id, name: p?.display_name || null };
  };
  switch (action) {
    case 'track.decision': return applyDecision(card, actor, first('decision'), now);
    case 'track.respond': return applyResponse(card, actor, first('response'), now);
    case 'track.pass': return applyPass(card, actor, await person(first('person')), now);
    case 'track.promise': return applyPromise(card, actor, await person(first('person')), first('when'), now);
    case 'track.remove': return applyRemove(card, actor, form.remove || [], now);
    default: return { changed: false, ignored: 'unknown_action' };
  }
}

function dialogCard(title, widgets, submitButton) {
  return {
    header: { title },
    sections: [{ widgets: [...widgets, { buttonList: { buttons: [submitButton] } }] }]
  };
}

function textInput(name, label, value) {
  return { textInput: { name, label, type: 'MULTIPLE_LINE', value: clip(value || '', TEXT_CHARS), validation: { characterLimit: TEXT_CHARS } } };
}

function textInputLine(name, label) {
  return { textInput: { name, label, type: 'SINGLE_LINE' } };
}

function peoplePicker(name, label, people) {
  return {
    selectionInput: {
      name, label, type: 'DROPDOWN',
      items: people.map((p, i) => ({ text: mdToPlain(p.name || 'Someone'), value: p.chatUserId, selected: i === 0 }))
    }
  };
}

// ============================================================================
// RENDER
// ============================================================================

function linkTo(card, messageName, text) {
  const href = messageLink(messageName, card.thread_name);
  return href ? `<a href="${esc(href)}">${esc(text)}</a>` : null;
}

function ballLine(card, now = new Date()) {
  const b = ballOf(card);
  const d = card.data || {};
  switch (b.state) {
    case 'person':
      return `With <b>${esc(nameOf(b.holder))}</b> · since ${esc(shortDate(b.since))}${b.promised ? ' · promised' : ''}`;
    case 'client': {
      const chaser = b.chaser ? ` (${esc(nameOf(b.chaser))} chasing)` : '';
      return `Waiting on client · ${plural(daysSince(b.since, now), 'day')}${chaser}`;
    }
    case 'call':
      return `Call needed${b.holder ? ` · with ${esc(nameOf(b.holder))}` : ''}`;
    case 'decided':
      return `<b>Decided:</b> ${textToCardHtml(d.decision?.text || '')} — ${esc(nameOf(d.decision?.by))}, ${esc(shortDate(d.decision?.at))}`;
    case 'resolved':
      return `<b>Resolved</b> — ${esc(nameOf(b.by))}, ${esc(shortDate(b.since))}`;
    default:
      return 'Unassigned — press <b>I’ll take it</b>';
  }
}

function dueLine(card, now = new Date()) {
  const due = card.data?.due;
  if (!due?.at) return null;
  const overdue = isLive(card) && new Date(due.at) < now;
  return `${overdue ? '<b>Overdue</b> — was due' : 'Due'} ${esc(dueText(due))}`;
}

function suggestionLine(card) {
  const s = card.data?.suggestion;
  if (!s) return null;
  const what = {
    person: s.replied ? `back with ${nameOf(s.holder)} (the holder replied)` : `with ${nameOf(s.holder)}${s.promised ? ' (promised)' : ''}`,
    client: 'waiting on the client',
    call: 'a call is needed',
    decided: 'a decision was made — record it'
  }[s.state] || 'a change';
  const link = linkTo(card, s.source, 'based on this message');
  return `<b>Suggestion:</b> ${esc(what)}${link ? ` — ${link}` : ''}`;
}

function names(list) {
  const shown = list.slice(0, MAX_NAMES).map(p => esc(mdToPlain(p.display_name || 'someone')));
  const more = list.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function offerCard(card, latestClick) {
  const expired = card.status === 'closed';
  const busy = !expired && card.data?.busy ? card.data.busy : null;
  return trackedCard({
    card,
    title: 'Want me to track this?',
    subtitle: '',
    sections: [{
      widgets: [paragraph(expired
        ? 'Not tracked. Reply with /track to start.'
        : 'I can keep one card here showing who has the ball, what’s left and when it’s due. Nothing is tracked unless you ask.')]
    }],
    buttons: [busy
      ? button('Setting up…', { cardId: card.id, action: 'track.start' }, { disabled: true })
      : button('Track this', { cardId: card.id, action: 'track.start' })],
    latestClick,
    labels: LABELS,
    busy
  });
}

function outcomeFor(d, latestClick) {
  const n = d.notice;
  if (!n?.text) return null;
  if (latestClick && new Date(n.at) < new Date(latestClick.created_at)) return null;
  return n.text;
}

const CLOSED_REASONS = { decided: 'Decided', resolved: 'Resolved' };

function render(card, participants = [], latestClick = null, now = new Date()) {
  if (card.status === 'offered' || card.closed_reason === 'offer_expired') return offerCard(card, latestClick);

  const d = card.data || {};
  const b = ballOf(card);
  const everyone = (d.shape || 'one') === 'everyone';
  const id = card.id;
  const sections = [];

  if (everyone) {
    const members = participants.filter(p => p.role === 'member');
    const done = members.filter(p => p.status === 'done');
    const left = members.filter(p => p.status !== 'done');
    const help = members.filter(p => p.status === 'needs_help');
    const lines = [`<b>${done.length} of ${members.length} done</b>`];
    const due = dueLine(card, now);
    if (due) lines.push(due);
    if (left.length) lines.push(`Still to do: ${names(left)}`);
    if (help.length) lines.push(`Needs help: ${names(help)}`);
    if (d.feedback) lines.push(`${plural(Object.keys(d.responses || {}).length, 'response')} so far`);
    sections.push({ widgets: [paragraph(lines.join('<br>'))] });
    const small = [d.checklist?.code
      ? 'Couldn’t list this space’s members — press I’ve done it to add yourself.'
      : 'People in this space only through a Google Group aren’t listed.'];
    sections.push({ widgets: [paragraph(`<i>${esc(small[0])}</i>`)] });
  } else {
    const lines = [ballLine(card, now)];
    const due = dueLine(card, now);
    if (due) lines.push(due);
    const source = b.state !== 'decided' && b.source ? linkTo(card, b.source, b.guess ? 'best guess from this message' : 'based on this message') : null;
    if (source) lines.push(b.guess ? `<i>Best guess</i> — ${source}` : source);
    sections.push({ widgets: [paragraph(lines.join('<br>'))] });
  }

  const suggestion = suggestionLine(card);
  if (suggestion && isLive(card)) sections.push({ widgets: [paragraph(suggestion)] });

  const busy = d.busy?.text ? d.busy : null;
  const dialog = (text, action, opts = {}) => button(text, { cardId: id, action }, { ...opts, openDialog: dialogsEnabled() && !opts.disabled });
  const refreshing = busy?.kind === 'refresh';
  const buttons = [];

  if (d.suggestion && isLive(card)) {
    buttons.push(d.suggestion.state === 'decided'
      ? dialog('Record decision', 'track.decision')
      : button('Confirm', { cardId: id, action: 'track.confirm' }));
    buttons.push(button('Dismiss', { cardId: id, action: 'track.dismiss' }));
  }

  if (everyone) {
    buttons.push(d.feedback
      ? dialog('Submit response', 'track.respond')
      : button('I’ve done it', { cardId: id, action: 'track.done' }));
    buttons.push(button('I need help', { cardId: id, action: 'track.help' }));
    buttons.push(dialog('Remove people…', 'track.remove'));
  } else {
    if (b.guess) buttons.push(button('Not right', { cardId: id, action: 'track.not_right' }));
    buttons.push(button('I’ll take it', { cardId: id, action: 'track.take' }));
    buttons.push(dialog('Pass to…', 'track.pass'));
    buttons.push(button('Waiting on client', { cardId: id, action: 'track.client' }, { disabled: b.state === 'client' }));
    buttons.push(button('Call needed', { cardId: id, action: 'track.call' }, { disabled: b.state === 'call' }));
    if (b.state === 'call' && meetAvailable()) buttons.push(button('Schedule call', { cardId: id, action: 'track.schedule' }));
    buttons.push(dialog('Someone promised…', 'track.promise'));
    if (!d.suggestion || d.suggestion.state !== 'decided') buttons.push(dialog('Record decision', 'track.decision'));
    buttons.push(button('Resolved', { cardId: id, action: 'track.resolve' }));
  }
  buttons.push(refreshing
    ? button('Reading…', { cardId: id, action: 'track.refresh' }, { disabled: true })
    : button('Refresh', { cardId: id, action: 'track.refresh' }));
  buttons.push(button(everyone ? 'Switch to one ball' : 'Switch to everyone', { cardId: id, action: 'track.switch' }, { disabled: busy?.kind === 'checklist' }));

  const closedLabel = card.status === 'closed' ? CLOSED_REASONS[card.closed_reason] : null;
  return trackedCard({
    card,
    title: card.title || 'Tracked ask',
    subtitle: [
      `Track · asked by ${d.requesterName || 'a teammate'}`,
      everyone ? (d.feedback ? 'Everyone · responses' : 'Everyone') : 'One ball',
      closedLabel
    ].filter(Boolean).join(' · '),
    sections,
    buttons,
    latestClick,
    labels: LABELS,
    busy,
    outcome: outcomeFor(d, latestClick)
  });
}

function digestLine(card, participants = []) {
  const d = card.data || {};
  if ((d.shape || 'one') === 'everyone') {
    const members = participants.filter(p => p.role === 'member');
    return `${members.filter(p => p.status === 'done').length} of ${members.length} done${d.due ? ` · due ${dueText(d.due)}` : ''}`;
  }
  return htmlToPlain(ballLine(card)) + (d.due ? ` · due ${dueText(d.due)}` : '');
}

// ============================================================================
// DIGEST AND DUE DATES
// ============================================================================

/**
 * This person's track lines for today's digest.
 * - waiting: they hold a one-ball card, or their part of an everyone card is open;
 * - nudge: waiting on the client ≥5 days (the chaser), or no movement ≥3 days
 *   (the holder) — each shown in one digest per period.
 * @returns {Promise<Array<{section: 'waiting'|'nudge', card: Object, text: string, nudge?: string}>>}
 */
async function digestItems(chatUserId, { now = new Date(), localDate = null } = {}) {
  const items = [];
  for (const card of await store.liveCardsOfType('track')) {
    const participants = await store.getParticipants(card.id);
    const mine = participants.find(p => p.chat_user_id === chatUserId);
    if (mine?.muted) continue;
    const d = card.data || {};
    const b = ballOf(card);
    const due = d.due ? ` · due ${dueText(d.due)}` : '';
    const shownOk = (key) => !d.shown?.[key] || d.shown[key] === localDate;

    if ((d.shape || 'one') === 'everyone') {
      if (mine?.role === 'member' && mine.status !== 'done') {
        items.push({ section: 'waiting', card, text: `Your part${mine.status === 'needs_help' ? ' (you asked for help)' : ''}${due}` });
      }
      continue;
    }
    if (b.state === 'person' && b.holder?.chatUserId === chatUserId) {
      items.push({ section: 'waiting', card, text: `With you since ${shortDate(b.since)}${due}` });
      if (daysSince(b.since, now) >= QUIET_AFTER_DAYS && shownOk('quietOn')) {
        items.push({ section: 'nudge', card, nudge: 'quietOn', text: `No movement for ${plural(daysSince(b.since, now), 'day')}` });
      }
    }
    if (b.state === 'client' && b.chaser?.chatUserId === chatUserId
        && daysSince(b.since, now) >= CLIENT_NUDGE_AFTER_DAYS && shownOk('clientOn')) {
      items.push({ section: 'nudge', card, nudge: 'clientOn', text: `Waiting on the client for ${plural(daysSince(b.since, now), 'day')} — you’re chasing` });
    }
  }
  return items;
}

/** Remember which nudges a digest showed, so later digests leave them out. */
async function markDigestShown(items, localDate) {
  for (const item of items.filter(i => i.nudge)) {
    const fresh = await store.getCard(item.card.id);
    if (!fresh) continue;
    const shown = fresh.data?.shown || {};
    if (!shown[item.nudge]) await store.patchCardData(item.card.id, { shown: { ...shown, [item.nudge]: localDate } });
  }
}

const sameLocalDay = (a, b, timeZone) => localClock(a, timeZone).date === localClock(b, timeZone).date;

/**
 * Hourly: the one-ball holder's due-today DM (from 08:00 their time), and the
 * requester's one private summary for an everyone card after the deadline
 * (right after a stated time, else from 08:00 the next morning).
 */
async function sendDueNotices(now = new Date()) {
  const counts = { reminders: 0, summaries: 0 };
  for (const card of await store.dueTrackCards(new Date(now.getTime() + 2 * DAY_MS))) {
    const d = card.data || {};
    const b = ballOf(card);
    const dueAt = new Date(card.due_at);
    const link = threadLink(card.space_name, card.thread_name);

    if ((d.shape || 'one') === 'one') {
      if (card.due_reminded_at || !['person', 'call'].includes(b.state) || !b.holder?.chatUserId) continue;
      const tz = await timeZoneFor(await resolvePerson(b.holder.chatUserId), now);
      const clock = localClock(now, tz);
      if (!sameLocalDay(dueAt, now, tz) || clock.hour < 8) continue;
      if (!(await store.claimDueReminder(card.id, now))) continue;
      const sent = await notifyImmediate('due_today', {
        card, chatUserId: b.holder.chatUserId,
        text: `Due today: “${card.title}”${d.due?.hasTime ? ` (${dueText(d.due)})` : ''}.${link ? ` ${link}` : ''}`
      });
      if (sent.delivered) counts.reminders++;
      continue;
    }

    if (card.due_summary_sent_at || dueAt > now) continue;
    if (!d.due?.hasTime) {
      const tz = await timeZoneFor(await resolvePerson(card.owner_chat_id, { userId: card.owner_user_id }), now);
      const clock = localClock(now, tz);
      if (sameLocalDay(dueAt, now, tz) || clock.hour < 8) continue;   // the morning after
    }
    if (!(await store.claimDueSummary(card.id, now))) continue;
    const sent = await notifyImmediate('due_summary', {
      card, chatUserId: card.owner_chat_id, text: await dueSummary(card, link)
    });
    if (sent.delivered) counts.summaries++;
  }
  if (counts.reminders || counts.summaries) {
    console.log(`⏰ Track due notices — reminders: ${counts.reminders}, summaries: ${counts.summaries}`);
  }
  return counts;
}

async function dueSummary(card, link) {
  const d = card.data || {};
  const members = (await store.getParticipants(card.id)).filter(p => p.role === 'member');
  const left = members.filter(p => p.status !== 'done');
  const help = members.filter(p => p.status === 'needs_help');
  const plain = (list) => list.map(p => mdToPlain(p.display_name || 'someone')).join(', ');
  const lines = [
    `Due-date summary for “${card.title}”: ${members.length - left.length} of ${members.length} done.`,
    left.length ? `Still to do: ${plain(left)}.` : 'Everyone is done.',
    ...(help.length ? [`Asked for help: ${plain(help)}.`] : [])
  ];
  if (d.feedback) {
    const responses = Object.values(d.responses || {});
    lines.push(responses.length ? 'Responses:' : 'No responses yet.');
    for (const r of responses) lines.push(`- ${mdToPlain(r.name || 'Someone')}: ${clip(mdToPlain(String(r.text || '')).replace(/\s+/g, ' '), SUMMARY_RESPONSE_CHARS)}`);
  }
  if (link) lines.push(link);
  return lines.join('\n');
}

// ============================================================================

export const trackCard = {
  type: 'track',
  actions: TRACK_ACTIONS,
  render,
  handleAction,
  refresh,
  digestLine,
  digestItems,
  markDigestShown,
  sendDueNotices
};

/**
 * The lead triage card — an inbound lead, in one card in the thread
 *
 * Trigger: an @Oracle message that carries contact details and sounds like a
 * lead ("Sarah called in, 604-555-1212, wants to know about training grants").
 * `leadIntent` decides that in code, before the model: a clear lead gets the
 * card, an unclear one gets "Want me to triage this lead?" first, a question
 * stays a question.
 *
 * The card shows what HubSpot knows, which tier the lead looks like (from their
 * calculator session, else their calculator answers), up to three programs
 * worth mentioning, and who covers that sector — a hint, never an assignment.
 *
 * States, in the card's own words: unassigned → callback owed → called →
 * assigned → closed. Every state change is a press or a typed command, logged
 * like any other card press.
 *
 * The only write is the outcome, and it goes through the confirmation gate as
 * one action (contact + owner + note). Nothing is written until someone
 * confirms it.
 *
 * Logs: codes and counts only. A lead's name, email address, phone number and
 * company never reach a log line — that rule holds for this whole card,
 * including its lookups (src/cards/lead-lookup.js).
 */

import crypto from 'crypto';

import * as store from '../database/tracked-cards-store.js';
import { FOUNDATION_ACTIONS, markCardReply } from './registry.js';
import { postMessage } from './chat-api.js';
import { renderCard, rerenderCard, tellPresser } from './update.js';
import { notifyImmediate } from './notify.js';
import { resolvePerson, timeZoneFor, localClock, realPeople, isListenerChatUser, dmSpaceFor } from './people.js';
import {
  trackedCard, paragraph, button, esc, clip, threadLink, messageLink,
  mdToPlain, textToCardHtml, dialogsEnabled, localInstant
} from './render.js';
import { savePendingAction, runPendingAction, summarizeAction } from '../tools/pending-actions.js';
import { listHubSpotOwners } from '../tools/hubspot.js';
import { extractLead, typedLeadCommand, OUTCOMES, outcomeFromText, TIER_WORDS } from './lead-parse.js';
import { lookupLead, calculatorUrl } from './lead-lookup.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE_CHARS = 80;
const NOTE_CHARS = 600;
const DRAFT_CHARS = 3500;
export const UNASSIGNED_NUDGE_AFTER_DAYS = 1;

const DISPLAY_TZ = process.env.DEFAULT_TIMEZONE || 'America/Vancouver';

export const LEAD_ACTIONS = {
  'lead.start': { personal: false, label: 'started triage' },
  'lead.callback': { personal: true, label: 'said they’ll call back' },
  'lead.called': { personal: false, label: 'marked the lead as called', dialog: true, saved: 'Call recorded' },
  'lead.booked': { personal: false, label: 'recorded: booked discovery' },
  'lead.sent_calc': { personal: false, label: 'recorded: sent the calculator' },
  'lead.not_a_fit': { personal: false, label: 'recorded: not a fit' },
  'lead.no_answer': { personal: false, label: 'recorded: no answer' },
  'lead.assign': { personal: false, label: 'assigned the lead', dialog: true, saved: 'Assigned' },
  'lead.calc_link': { personal: true, label: 'asked for the calculator link' },
  'lead.draft': { personal: true, label: 'asked for a draft reply' },
  'lead.record': { personal: false, label: 'wrote the outcome to HubSpot' },
  'lead.close': { personal: false, label: 'closed the lead' }
};

const LABELS = { ...FOUNDATION_ACTIONS, ...LEAD_ACTIONS };

/** Which action each outcome button records. */
const OUTCOME_ACTIONS = {
  'lead.booked': OUTCOMES.booked,
  'lead.sent_calc': OUTCOMES.calculator,
  'lead.not_a_fit': OUTCOMES.not_a_fit,
  'lead.no_answer': OUTCOMES.no_answer
};

/** What to type when a dialog is not available (dialogs are off by default). */
export const TYPED_HINTS = {
  'lead.called': 'To record the call, reply in this thread: @Oracle called: no answer (or "booked discovery", "sent calculator", "not a fit")',
  'lead.assign': 'To assign this lead, reply in this thread: @Oracle assign @Name'
};

const HOW_TO = 'To triage a lead, @mention me in a message with the lead’s name and their email address or phone number.';

const BUSY = {
  lookup: 'Looking this lead up…',
  draft: 'Drafting a reply…',
  record: 'Writing to HubSpot…'
};

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

/** Our own card HTML → plain text (digest labels and DMs render no HTML). */
function htmlToPlain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** A reply only the person sees (a plain reply in a DM). Never throws. */
async function privateReply({ spaceName, threadName, surface, chatUserId, text }) {
  if (!spaceName || !chatUserId || !text) return false;
  try {
    await postMessage({ spaceName, threadName, text, privateTo: surface === 'chat_dm' ? null : chatUserId });
    return true;
  } catch (err) {
    console.warn(`⚠️  Lead private reply failed — code: ${codeOf(err)}`);
    return false;
  }
}

/** The lead's own label — a company if we have one, else a person, else nothing. */
function leadLabel(lead = {}) {
  const name = lead.company || lead.name || lead.email || lead.phone;
  return clip(mdToPlain(name || 'New enquiry'), TITLE_CHARS);
}

// ============================================================================
// CREATING
// ============================================================================

/**
 * Triage a lead: post the card at once, then fill it in from HubSpot, our
 * lead-gen sessions and our grants table.
 *
 * @param {Object} p
 * @param {'command'|'mention'|'offer'} p.trigger
 * @param {{chatUserId: string, name?: string, email?: string}} p.actor - who brought the lead in
 * @param {number} p.userId - that person's Hub user id
 * @param {string} p.spaceName
 * @param {string|null} p.threadName
 * @param {'chat_space'|'chat_dm'} [p.surface]
 * @param {string} [p.conversationId] - the Oracle conversation; the gate needs it
 * @param {string} [p.messageText] - the message the lead arrived in
 * @param {string} [p.messageName] - that message, for the card's link
 */
export async function createLead({
  trigger, actor, userId = null, spaceName, threadName, surface = 'chat_space',
  conversationId = null, messageText = '', messageName = null, now = new Date()
}) {
  const reply = (text) => privateReply({ spaceName, threadName, surface, chatUserId: actor.chatUserId, text });
  const done = (result) => {
    if (conversationId) markCardReply(conversationId);
    console.log(`🧲 Lead card ${result.code || 'posted'} — trigger: ${trigger}${result.stats || ''}`);
    return result;
  };

  if (!spaceName || !threadName) {
    await reply(HOW_TO);
    return done({ ok: false, code: 'no_thread' });
  }

  const existing = await store.findLiveCard('lead', threadName);
  if (existing && existing.status !== 'offered') {
    await reply('This lead already has a card in this thread.');
    return done({ ok: false, code: 'already_triaged' });
  }
  const offer = existing;

  const lead = extractLead(messageText);
  if (!lead.email && !lead.phone) {
    await reply('I couldn’t see an email address or phone number in that message, so there’s nothing to look up yet.');
    return done({ ok: false, code: 'no_details' });
  }

  const data = {
    surface,
    lead,
    broughtBy: { ...who(actor), userId },
    sourceMessage: messageName,
    ball: { state: 'unassigned', holder: null, since: now.toISOString(), by: who(actor) },
    outcome: null,
    assignee: null,
    crm: null,
    fit: null,
    programs: [],
    ownerHint: null,
    hubspot: { state: 'none' },
    calls: [],
    busy: { kind: 'lookup', text: BUSY.lookup, by: actor.name || null, at: now.toISOString() },
    shown: {},
    notice: null
  };
  const title = `Lead: ${leadLabel(lead)}`;

  let card = offer
    ? await store.updateCard(offer.id, {
      status: 'open', title, data, lastActivityAt: now, sourceMessageName: messageName
    })
    : await store.insertCard({
      cardType: 'lead', status: 'open', spaceName, threadName, sourceMessageName: messageName,
      conversationId, ownerChatId: actor.chatUserId, ownerUserId: userId, title, data
    });
  if (!card) {
    await reply('This lead already has a card in this thread.');
    return done({ ok: false, code: 'already_triaged' });
  }

  await store.addParticipants(card.id, [
    { chatUserId: actor.chatUserId, role: 'owner', displayName: actor.name || null }
  ]);

  const cardsV2 = await renderCard(card);
  if (card.message_name) {
    const { patchCard } = await import('./chat-api.js');
    await patchCard(card.message_name, cardsV2);   // the question becomes the card
  } else {
    const posted = await postMessage({ spaceName, threadName, cardsV2 });
    card = await store.updateCard(card.id, { messageName: posted });
  }

  // Dynamic, like track-card's use of finishPress: actions.js imports types.js,
  // which imports this module.
  const { runInBackground } = await import('./actions.js');
  runInBackground('lead lookup', () => fillLead(card.id, messageText));

  return done({
    ok: true,
    code: null,
    card,
    stats: `, details: ${[lead.email && 'email', lead.phone && 'phone'].filter(Boolean).join('+') || 'none'}`
  });
}

/** "Sounds like a lead?" — ask first, with a button. */
export async function offerLead({ actor, userId = null, spaceName, threadName, surface = 'chat_space', conversationId = null, messageText = '', messageName = null }) {
  if (conversationId) markCardReply(conversationId);
  if (!spaceName || !threadName) {
    await privateReply({ spaceName, threadName, surface, chatUserId: actor.chatUserId, text: HOW_TO });
    return { ok: false, code: 'no_thread' };
  }
  const existing = await store.findLiveCard('lead', threadName);
  if (existing) {
    if (existing.status !== 'offered') {
      await privateReply({ spaceName, threadName, surface, chatUserId: actor.chatUserId, text: 'This lead already has a card in this thread.' });
    }
    return { ok: true, code: 'already_there' };
  }
  const row = await store.insertCard({
    cardType: 'lead', status: 'offered', spaceName, threadName, sourceMessageName: messageName,
    conversationId, ownerChatId: actor.chatUserId, ownerUserId: userId,
    title: 'Want me to triage this lead?',
    data: { surface, offer: true, broughtBy: { ...who(actor), userId }, messageText: clip(messageText, 2000), sourceMessage: messageName }
  });
  if (!row) return { ok: true, code: 'already_there' };
  const posted = await postMessage({ spaceName, threadName, cardsV2: await renderCard(row) });
  await store.updateCard(row.id, { messageName: posted });
  console.log('🧲 Lead card offered — reason: intent_unclear');
  return { ok: true, code: 'asked' };
}

/** The offer card's button: turn it into a real lead card. */
async function startFromOffer(cardId, actor, now) {
  const card = await store.getCard(cardId);
  if (!card || card.status !== 'offered') return;
  const d = card.data || {};
  const person = await resolvePerson(actor.chatUserId, { email: actor.email, displayName: actor.name, lookupAsUserId: card.owner_user_id });
  const outcome = await createLead({
    trigger: 'offer',
    actor: { chatUserId: actor.chatUserId, name: actor.name || null, email: actor.email || null },
    userId: person?.user_id || card.owner_user_id || null,
    spaceName: card.space_name,
    threadName: card.thread_name,
    surface: d.surface || 'chat_space',
    conversationId: card.conversation_id,
    messageText: d.messageText || '',
    messageName: d.sourceMessage || card.source_message_name,
    now
  });
  if (!outcome.ok) {
    await store.patchCardData(cardId, {
      busy: null,
      notice: { text: 'couldn’t triage this one — @mention me with the lead’s details', at: now.toISOString() }
    });
  }
}

/**
 * The slow half of creating a card: HubSpot, the lead-gen session, the
 * programs. Every part fails soft; what came back is stored and shown.
 */
export async function fillLead(cardId, messageText = '') {
  const card = await store.getCard(cardId);
  if (!card || !isLive(card)) return;
  const d = card.data || {};
  try {
    const found = await lookupLead(d.lead || {}, { text: messageText });
    await store.patchCardData(cardId, {
      crm: {
        found: found.crm.found,
        foundBy: found.crm.foundBy,
        phoneMatches: found.crm.phoneMatches,
        failed: found.crm.failed,
        contactId: found.crm.contact?.id || null,
        companyId: found.crm.company?.id || null,
        companyName: found.crm.company?.name || null,
        industry: found.industry,
        exClient: found.crm.exClient,
        firstSeen: found.crm.firstSeen,
        lastWon: found.crm.lastWon,
        notFit: found.crm.notFit,
        feeObjection: found.crm.feeObjection,
        ownerId: found.crm.ownerId,
        ownerName: found.crm.ownerName,
        openDeals: found.crm.openDeals.map(deal => ({ name: deal.name, program: deal.program, amount: deal.amount, closeDate: deal.closeDate }))
      },
      fit: found.fit,
      programs: found.programs,
      ownerHint: found.ownerHint,
      busy: null
    });
  } catch (err) {
    console.warn(`⚠️  Lead lookup failed — code: ${codeOf(err)}`);
    await store.patchCardData(cardId, {
      busy: null,
      notice: { text: 'couldn’t finish the lookup — the details above are what we have', at: new Date().toISOString() }
    });
  }
  await rerenderCard(cardId);
}

// ============================================================================
// STATE CHANGES (shared by buttons, dialogs and typed commands)
// ============================================================================

async function moveBall(card, next, actor, now, extra = {}) {
  const ball = {
    state: next.state,
    holder: next.holder ?? null,
    since: now.toISOString(),
    by: who(actor)
  };
  await store.patchCardData(card.id, { ball, notice: null, ...extra });
  return ball;
}

/** "I'll call back": the presser owes the call, and it is due today. */
export async function applyCallback(card, actor, now = new Date()) {
  if (await isListenerChatUser(actor)) {
    return { changed: false, ignored: 'listener_account', reply: 'This account can’t take a callback.' };
  }
  const b = ballOf(card);
  if (b.state === 'callback' && b.holder?.chatUserId === actor.chatUserId) {
    return { changed: false, ignored: 'already_yours', reply: 'You’re already down to call them back.' };
  }
  await moveBall(card, { state: 'callback', holder: who(actor) }, actor, now);
  await store.addParticipants(card.id, [{ chatUserId: actor.chatUserId, role: 'member', displayName: actor.name || null }]);

  // Due at the end of the presser's own day, so the reminder lands the morning
  // of the day they promised rather than in someone else's time zone.
  const person = await resolvePerson(actor.chatUserId, { displayName: actor.name, email: actor.email });
  const tz = await timeZoneFor(person, now);
  const { date } = localClock(now, tz);
  await store.setDue(card.id, localInstant(date, 17, 0, tz));
  return { changed: true, claimed: true };
}

/** "Called": the call happened; the outcome is a second, separate press. */
export async function applyCalled(card, actor, note = null, now = new Date()) {
  const calls = [...(card.data?.calls || []), { by: who(actor), at: now.toISOString(), note: note ? clip(mdToPlain(note), NOTE_CHARS) : null }];
  await moveBall(card, { state: 'called', holder: who(actor) }, actor, now, { calls });
  return { changed: true };
}

/** One of the four outcomes. Nothing is written to HubSpot by this. */
export async function applyOutcome(card, actor, outcome, now = new Date()) {
  if (!outcome?.key) return { changed: false, ignored: 'unknown_outcome', reply: TYPED_HINTS['lead.called'] };
  const current = card.data?.outcome;
  if (current?.key === outcome.key) {
    return { changed: false, ignored: 'already_recorded', reply: `That’s already the recorded outcome (${outcome.label}).` };
  }
  const state = ballOf(card).state === 'assigned' ? 'assigned' : 'called';
  await moveBall(card, { state, holder: ballOf(card).holder || who(actor) }, actor, now, {
    outcome: { key: outcome.key, label: outcome.label, by: who(actor), at: now.toISOString() },
    // A recorded outcome invalidates a HubSpot proposal built from the old one.
    hubspot: card.data?.hubspot?.state === 'added' ? card.data.hubspot : { state: 'none' }
  });
  return { changed: true };
}

/** Assign the lead to someone. They get the one "newly assigned" DM. */
export async function applyAssign(card, actor, target, now = new Date()) {
  if (!target?.chatUserId) {
    return { changed: false, ignored: 'no_person', reply: TYPED_HINTS['lead.assign'] };
  }
  const real = await realPeople([target], card.owner_user_id);
  if (!real.length) {
    return { changed: false, ignored: 'not_a_person', reply: 'I can only assign a lead to a person on the team.' };
  }
  if (card.data?.assignee?.chatUserId === target.chatUserId) {
    return { changed: false, ignored: 'already_assigned', reply: `${nameOf(target)} already has this lead.` };
  }
  await moveBall(card, { state: 'assigned', holder: who(target) }, actor, now, { assignee: who(target) });
  await store.addParticipants(card.id, [{ chatUserId: target.chatUserId, role: 'member', displayName: target.name || null }]);

  if (target.chatUserId !== actor.chatUserId) {
    const fresh = await store.getCard(card.id);
    const link = threadLink(card.space_name, card.thread_name);
    const sent = await notifyImmediate('assigned', {
      card: fresh || card,
      chatUserId: target.chatUserId,
      text: `${actor.name || 'Someone'} assigned you a lead: ${card.title?.replace(/^Lead: /, '') || 'a new enquiry'}.${link ? ` ${link}` : ''}`
    });
    if (sent.delivered) await store.markAssignedNotified(card.id, target.chatUserId, now);
  }
  return { changed: true };
}

// ============================================================================
// BUTTONS — database only; slow work is returned as `background`
// ============================================================================

async function handleAction({ card, actor, action, now = new Date() }) {
  const d = card.data || {};

  if (card.status === 'offered') {
    if (action !== 'lead.start') return { changed: false, ignored: 'not_triaged_yet', reply: 'Press Triage this lead first.' };
    if (d.busy) return { changed: false, ignored: 'already_running', reply: 'The lead is already being looked up.' };
    await store.patchCardData(card.id, { busy: { kind: 'lookup', text: BUSY.lookup, by: actor.name || null, at: now.toISOString() } });
    return { changed: true, background: () => startFromOffer(card.id, actor, now) };
  }
  if (!isLive(card)) return { changed: false, ignored: 'not_open', reply: 'This card is closed, so nothing changed.' };

  switch (action) {
    case 'lead.callback':
      return applyCallback(card, actor, now);

    // With dialogs on, this press opens the outcome picker and never reaches
    // here. With dialogs off, it records the call and the card then offers the
    // four outcomes as buttons — no press is wasted.
    case 'lead.called':
      if (ballOf(card).state === 'called' && !d.outcome) {
        return { changed: false, ignored: 'already_called', reply: 'The call is recorded — pick what came of it.' };
      }
      return applyCalled(card, actor, null, now);

    case 'lead.booked':
    case 'lead.sent_calc':
    case 'lead.not_a_fit':
    case 'lead.no_answer':
      return applyOutcome(card, actor, OUTCOME_ACTIONS[action], now);

    case 'lead.assign':
      // A dialog button pressed without a dialog (flag off): say what to type.
      return { changed: false, ignored: 'typed_command_needed', reply: TYPED_HINTS['lead.assign'] };

    case 'lead.calc_link': {
      const url = calculatorUrl();
      return {
        changed: false,
        ignored: url ? 'sent_privately' : 'no_link',
        reply: url
          ? `Calculator link to send them: ${url}\nSuggested wording: “Here's our grant calculator — it takes about two minutes and tells you roughly what you could claim.”`
          : 'No calculator link is on file yet (data/cards/lead-owners.json).'
      };
    }

    case 'lead.draft':
      if (d.busy?.kind === 'draft') return { changed: false, ignored: 'already_running', reply: 'A reply is already being drafted.' };
      await store.patchCardData(card.id, { busy: { kind: 'draft', text: BUSY.draft, by: actor.name || null, at: now.toISOString() } });
      return { changed: true, background: () => draftLeadReply(card.id, actor) };

    case 'lead.record': {
      if (!d.outcome) return { changed: false, ignored: 'no_outcome', reply: 'Record what came of the call first.' };
      if (d.hubspot?.state === 'added') return { changed: false, ignored: 'already_added', reply: 'This outcome is already in HubSpot.' };
      if (d.busy?.kind === 'record') return { changed: false, ignored: 'already_running', reply: 'The HubSpot write is already running.' };
      await store.patchCardData(card.id, { busy: { kind: 'record', text: BUSY.record, by: actor.name || null, at: now.toISOString() } });
      return { changed: true, background: () => recordOutcome(card.id, actor) };
    }

    case 'lead.close':
      await store.closeCard(card.id, 'resolved', now);
      return { changed: true };

    default:
      return { changed: false, ignored: 'unknown_action', reply: 'That button doesn’t do anything on this card.' };
  }
}

// ============================================================================
// BACKGROUND WORK
// ============================================================================

/** Stop the busy line and, optionally, leave a one-line outcome on the card. */
async function finish(cardId, outcome = null) {
  await store.patchCardData(cardId, {
    busy: null,
    ...(outcome ? { notice: { text: outcome, at: new Date().toISOString() } } : {})
  });
}

/**
 * Draft a first reply to the lead and send it privately to whoever asked.
 * Nothing goes to the lead. Runs as the presser's own Hub account.
 */
export async function draftLeadReply(cardId, actor) {
  const card = await store.getCard(cardId);
  if (!card) return;
  const d = card.data || {};
  const person = await resolvePerson(actor.chatUserId, { email: actor.email, displayName: actor.name, lookupAsUserId: card.owner_user_id });
  const runAs = person?.user_id || null;
  if (!runAs) {
    console.log('🧲 Lead reply draft not started — reason: no_hub_user');
    await finish(cardId, null);
    await tellPresser(card, actor, 'Only someone signed in to the Hub can draft a reply.');
    return;
  }

  let outcome;
  try {
    const [{ runAgent }, { createConversation }] = await Promise.all([
      import('../claude/client.js'),
      import('../database/messages.js')
    ]);

    // Its own conversation: the draft stays out of the thread's history, and a
    // stray proposal could never land in the thread's confirmation slot.
    const conversationId = crypto.randomUUID();
    await createConversation(conversationId, runAs, 'internal-oracle', 'Draft reply to a lead');

    const fit = d.fit || {};
    const message = [
      'Draft a short first reply to an inbound lead about grant funding.',
      'This is a DRAFT for a Granted teammate to edit and send themselves. Do not send anything, do not create or change any records, and do not use any tools.',
      `Lead: ${d.lead?.name || 'not given'}${d.lead?.company ? ` at ${d.lead.company}` : ''}.`,
      `What they seem to need: ${d.crm?.industry || 'not recorded'}.`,
      `Our read on their fit: ${TIER_WORDS[fit.tier] || 'unknown'}${fit.reason ? ` (${fit.reason})` : ''}.`,
      (d.programs || []).length
        ? `Programs worth mentioning:\n- ${(d.programs || []).map(p => p.name).filter(Boolean).join('\n- ')}`
        : 'No specific programs to mention.',
      'Reply with the email only: a subject line, then a short body. Offer a short discovery call. Do not promise an amount.'
    ].join('\n\n');

    const result = await runAgent({
      agentType: 'internal-oracle', message, conversationId, userId: runAs,
      sessionId: crypto.randomUUID(), res: null
    });
    const text = (result?.response?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!result?.success || !text) throw Object.assign(new Error('no draft'), { code: 'no_draft' });

    const body = clip(`Draft reply for ${card.title?.replace(/^Lead: /, '') || 'this lead'} — not sent:\n\n${text}`, DRAFT_CHARS);
    const dm = await dmSpaceFor(person);
    if (dm) {
      await postMessage({ spaceName: dm, text: body });
      outcome = `draft sent to ${actor.name || 'them'} by DM`;
    } else {
      await postMessage({ spaceName: card.space_name, threadName: card.thread_name, text: body });
      outcome = 'draft posted in this thread (no DM with Oracle yet)';
    }
  } catch (err) {
    console.warn(`⚠️  Lead reply draft failed — code: ${codeOf(err)}`);
    outcome = 'couldn’t draft a reply — try again';
  }
  await finish(cardId, outcome);
}

/** The note the gated write adds to the contact. Facts only, no model text. */
function outcomeNote(card) {
  const d = card.data || {};
  const link = messageLink(d.sourceMessage, card.thread_name) || threadLink(card.space_name, card.thread_name);
  const calls = (d.calls || []).filter(c => c.note);
  const fit = d.fit || {};
  return [
    `Lead triaged in Google Chat (Oracle): ${d.outcome?.label || 'outcome recorded'}.`,
    `Recorded by ${nameOf(d.outcome?.by)} on ${shortDate(d.outcome?.at)}.`,
    d.assignee ? `Assigned to ${nameOf(d.assignee)}.` : null,
    fit.tier && fit.tier !== 'unknown' ? `Looks like: ${TIER_WORDS[fit.tier]}${fit.reason ? ` (${fit.reason})` : ''}.` : null,
    calls.length ? `Call notes: ${calls.map(c => c.note).join(' | ')}` : null,
    link ? `Thread: ${link}` : null
  ].filter(Boolean).join('\n');
}

/** The HubSpot owner id for the person this lead is assigned to, if any. */
async function ownerIdFor(assignee, ownerUserId) {
  if (!assignee?.chatUserId) return { id: null, name: null };
  const person = await resolvePerson(assignee.chatUserId, { displayName: assignee.name, lookupAsUserId: ownerUserId });
  const email = person?.email ? String(person.email).toLowerCase() : null;
  if (!email) return { id: null, name: null };
  const list = await listHubSpotOwners();
  if (!list.success) return { id: null, name: null };
  const hit = (list.owners || []).find(o => String(o.email || '').toLowerCase() === email);
  return hit ? { id: String(hit.id), name: hit.fullName || null } : { id: null, name: null };
}

/**
 * The outcome write, through the confirmation gate: this press is the
 * confirmation of exactly what the card shows, so the action is stored and run
 * in one step. Nothing reaches HubSpot any other way.
 *
 * An existing contact keeps its own fields — only the owner and the note are
 * added. Text parsed out of a Chat message never overwrites CRM data.
 */
export async function recordOutcome(cardId, actor) {
  const card = await store.getCard(cardId);
  if (!card || !isLive(card)) return;
  const d = card.data || {};
  const person = await resolvePerson(actor.chatUserId, { email: actor.email, displayName: actor.name, lookupAsUserId: card.owner_user_id });

  if (!person?.user_id) {
    await finish(cardId);
    await tellPresser(card, actor, 'Only someone signed in to the Hub can write to HubSpot.');
    console.log('🧲 Lead outcome — result: no_hub_user');
    return;
  }
  if (!card.conversation_id) {
    await store.patchCardData(cardId, { busy: null, hubspot: { ...(d.hubspot || {}), state: 'blocked' } });
    await tellPresser(card, actor, 'I can’t confirm a HubSpot write from this card — @mention me in the thread and I’ll set it up again.');
    console.log('🧲 Lead outcome — result: no_conversation');
    await rerenderCard(cardId);
    return;
  }

  const contactId = d.crm?.contactId || null;
  const lead = d.lead || {};
  const [firstname, ...rest] = String(lead.name || '').trim().split(/\s+/);
  const properties = contactId ? {} : {
    ...(lead.email ? { email: lead.email } : {}),
    ...(firstname ? { firstname } : {}),
    ...(rest.length ? { lastname: rest.join(' ') } : {}),
    ...(lead.phone ? { phone: lead.phone } : {}),
    ...(lead.company ? { company: lead.company } : {})
  };

  let next;
  if (!contactId && !lead.email) {
    next = { ...(d.hubspot || {}), state: 'blocked' };
    await tellPresser(card, actor, 'There’s no HubSpot contact and no email address for this lead, so I can’t record the outcome — add the contact in HubSpot first.');
  } else {
    const owner = await ownerIdFor(d.assignee, card.owner_user_id);
    const input = {
      contact_id: contactId,
      properties,
      owner_id: owner.id,
      owner_name: owner.name,
      note: outcomeNote(card)
    };
    const summary = summarizeAction('record_lead_outcome', input);
    try {
      const saved = await savePendingAction({
        conversationId: card.conversation_id,
        toolName: 'record_lead_outcome',
        input,
        userId: person.user_id,
        summary
      });
      const run = await runPendingAction({ actionId: saved.id, userId: person.user_id });
      next = run?.ok && run.result?.success !== false
        ? { state: 'added', contactId: run.result?.contact_id || contactId, created: Boolean(run.result?.contact_created), ownerSet: Boolean(owner.id), summary }
        : { state: 'failed', summary, pendingActionId: saved.id };
      if (next.state === 'failed') {
        await tellPresser(card, actor, 'HubSpot didn’t accept that write — nothing was saved. Try again in a moment.');
      }
    } catch (err) {
      console.warn(`⚠️  Lead outcome write failed — code: ${codeOf(err)}`);
      next = { state: 'failed', summary };
    }
  }

  await store.patchCardData(cardId, { busy: null, hubspot: next });
  console.log(`🧲 Lead outcome — result: ${next.state}`);
  await rerenderCard(cardId);
}

/** Presses refresh from the card's own state only — no CRM call per press. */
async function refresh() {
  return { changed: false };
}

// ============================================================================
// TYPED COMMANDS AND @MENTIONS (from the Chat adapter)
// ============================================================================

const TYPED_ACTIONS = { assign: 'lead.assign', called: 'lead.called', outcome: 'lead.called', callback: 'lead.callback' };

/**
 * An @Oracle message the lead card handles without the model.
 * @returns {Promise<boolean>} false → answer normally
 */
export async function handleLeadMessage({ evt, user, conversationId, messageText, intent, now = new Date() }) {
  const threadName = evt.threadIsResourceName ? evt.threadId : null;
  const spaceName = evt.spaceIsResourceName ? evt.spaceId : null;
  const surface = evt.isDm ? 'chat_dm' : 'chat_space';
  const actor = { chatUserId: evt.senderChatId, name: evt.senderDisplayName || user?.name || null, email: evt.senderEmail || null };
  const common = {
    actor, userId: user?.id || null, spaceName, threadName, surface, conversationId,
    messageText, messageName: evt.messageName
  };

  // A typed command for a card that already exists wins over the intent: "called:
  // no answer" in a triaged thread is an update, not a second lead.
  const cmd = typedLeadCommand(messageText);
  const card = threadName ? await store.findLiveCard('lead', threadName) : null;
  if (cmd && isLive(card)) {
    const people = await realPeople(evt.mentions || [], user?.id || null);
    let outcome;
    switch (cmd.kind) {
      case 'assign':
        outcome = await applyAssign(card, actor, who(people[0]), now);
        break;
      case 'callback':
        outcome = await applyCallback(card, actor, now);
        break;
      case 'called': {
        const said = outcomeFromText(cmd.text);
        outcome = await applyCalled(card, actor, cmd.text, now);
        if (said && outcome.changed) {
          const fresh = await store.getCard(card.id);
          const second = await applyOutcome(fresh || card, actor, said, now);
          outcome = { ...outcome, changed: outcome.changed || second.changed };
        }
        break;
      }
      default: {
        const said = outcomeFromText(cmd.text);
        outcome = said
          ? await applyOutcome(card, actor, said, now)
          : { changed: false, ignored: 'unknown_outcome', reply: TYPED_HINTS['lead.called'] };
      }
    }
    const { finishPress } = await import('./actions.js');
    await finishPress(card, leadCard, actor, TYPED_ACTIONS[cmd.kind], outcome, now);
    if (conversationId) markCardReply(conversationId);
    return true;
  }

  if (intent === 'lead') {
    await createLead({ trigger: 'mention', ...common, now });
    return true;
  }
  if (intent === 'maybe') {
    // Nothing to look up means nothing to offer: a bare "someone called in" is
    // a message for the model, not a card with a dead button.
    const seen = extractLead(messageText);
    if (!seen.email && !seen.phone) return false;
    await offerLead(common);
    return true;
  }
  return false;
}

// ============================================================================
// DIALOGS (TRACK_DIALOGS_ENABLED) — content only; routing is in dialogs.js
// ============================================================================

export async function dialogFor(card, action, actor) {
  const submit = (text) => button(text, { cardId: card.id, action, step: 'submit' });
  switch (action) {
    case 'lead.called':
      return dialogCard('What came of the call?', [
        {
          selectionInput: {
            name: 'outcome', label: 'Outcome', type: 'RADIO_BUTTON',
            items: Object.values(OUTCOMES).map((o, i) => ({ text: o.label, value: o.key, selected: i === 0 }))
          }
        },
        { textInput: { name: 'note', label: 'Anything worth noting (optional)', type: 'MULTIPLE_LINE', validation: { characterLimit: NOTE_CHARS } } }
      ], submit('Save'));

    case 'lead.assign': {
      const { listSpaceHumans } = await import('./track-thread.js');
      const list = await listSpaceHumans(card.space_name, { exclude: [], lookupAsUserId: card.owner_user_id });
      return dialogCard('Assign this lead', [{
        selectionInput: {
          name: 'person', label: 'Assign to', type: 'DROPDOWN',
          items: list.people.map((p, i) => ({ text: mdToPlain(p.name || 'Someone'), value: p.chatUserId, selected: i === 0 }))
        }
      }], submit('Assign'));
    }
    default:
      return null;
  }
}

export async function submitDialog(card, action, actor, form, now = new Date()) {
  const first = (name) => (form[name] || [])[0] || '';
  switch (action) {
    case 'lead.called': {
      const outcome = await applyCalled(card, actor, first('note'), now);
      const said = OUTCOMES[first('outcome')];
      if (!said) return outcome;
      const fresh = await store.getCard(card.id);
      const second = await applyOutcome(fresh || card, actor, said, now);
      return { ...outcome, changed: outcome.changed || second.changed };
    }
    case 'lead.assign': {
      const id = first('person');
      const person = id ? await resolvePerson(id) : null;
      return applyAssign(card, actor, id ? { chatUserId: id, name: person?.display_name || null } : null, now);
    }
    default:
      return { changed: false, ignored: 'unknown_action' };
  }
}

function dialogCard(title, widgets, submitButton) {
  return {
    header: { title },
    sections: [{ widgets: [...widgets, { buttonList: { buttons: [submitButton] } }] }]
  };
}

// ============================================================================
// RENDER
// ============================================================================

const STATE_WORDS = {
  unassigned: 'Unassigned',
  callback: 'Callback owed',
  called: 'Called',
  assigned: 'Assigned'
};

function statusLine(card) {
  const d = card.data || {};
  const b = ballOf(card);
  const bits = [];
  if (b.state === 'callback') bits.push(`Callback owed — ${nameOf(b.holder)}`);
  else if (b.state === 'assigned') bits.push(`With ${nameOf(d.assignee || b.holder)}`);
  else bits.push(STATE_WORDS[b.state] || 'Unassigned');
  if (d.outcome) bits.push(d.outcome.label);
  return bits.join(' · ');
}

function contactLine(lead = {}) {
  const parts = [
    lead.name ? `<b>${esc(mdToPlain(lead.name))}</b>` : null,
    lead.company ? esc(mdToPlain(lead.company)) : null,
    lead.email ? esc(lead.email) : null,
    lead.phone ? esc(lead.phone) : null
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No contact details found in the message';
}

function knownLines(card) {
  const d = card.data || {};
  const crm = d.crm;
  if (!crm) return [d.busy?.kind === 'lookup' ? 'Looking them up…' : 'Nothing looked up yet'];
  const lines = [];

  if (!crm.found) {
    lines.push('No HubSpot record found');
    if (crm.phoneMatches > 1) lines.push(`${crm.phoneMatches} contacts share that phone number — check HubSpot`);
  } else {
    const seen = crm.firstSeen ? ` · in HubSpot since ${esc(shortDate(crm.firstSeen))}` : '';
    lines.push(`${crm.exClient ? '<b>Past client</b>' : 'Known to us'}${crm.foundBy === 'phone' ? ' (matched by phone)' : ''}${seen}`);
    if (crm.lastWon) lines.push(`Last closed-won deal: ${esc(shortDate(crm.lastWon))}`);
    if (crm.openDeals?.length) {
      lines.push(`Open deals: ${crm.openDeals.map(deal => esc(mdToPlain(deal.name || deal.program || 'unnamed'))).join(', ')}`);
    }
    if (crm.notFit?.reason) {
      lines.push(`Earlier "not a fit": ${esc(mdToPlain(String(crm.notFit.reason)))}${crm.notFit.program ? ` (${esc(mdToPlain(crm.notFit.program))})` : ''}`);
    }
    if (crm.feeObjection) lines.push('Mentioned price or fees before');
    if (crm.ownerName) lines.push(`HubSpot owner: ${esc(mdToPlain(crm.ownerName))}`);
  }
  if (crm.failed?.length) lines.push(`<i>Couldn’t read ${esc(crm.failed.join(' and '))} from HubSpot</i>`);
  return lines;
}

function fitLines(card) {
  const fit = card.data?.fit;
  if (!fit) return [];
  const words = TIER_WORDS[fit.tier] || 'Tier unknown';
  const lines = [];
  if (fit.tier === 'not_a_fit') {
    lines.push(`<b>Likely not a fit</b> — ${esc(fit.reason)}; suggest Get Granted`);
  } else if (fit.tier === 'unknown') {
    lines.push(`<b>Tier unknown</b> — ${esc(fit.reason)}; send the calculator`);
  } else {
    const estimate = fit.estimate ? ` · estimate ${esc(String(fit.estimate))}` : '';
    lines.push(`<b>${esc(words)}</b> — ${esc(fit.reason)}${estimate}`);
  }
  if (fit.sourceWords) lines.push(`<i>${esc(fit.sourceWords)}</i>`);
  return lines;
}

function programLines(card) {
  const programs = card.data?.programs || [];
  return programs.slice(0, 3).map(p => {
    const name = esc(mdToPlain(p.name));
    const label = p.url ? `<a href="${esc(p.url)}">${name}</a>` : name;
    const bits = [p.amount ? esc(String(p.amount)) : null, p.deadline ? `closes ${esc(shortDate(p.deadline))}` : null].filter(Boolean);
    return `${label}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
  });
}

const WHY_SUGGESTED = {
  hubspot: 'owns this contact in HubSpot',
  routing: 'covers this industry',
  text: 'covers this'
};

function ownerLine(card) {
  const hint = card.data?.ownerHint;
  const assignee = card.data?.assignee;
  if (assignee) return `Assigned to <b>${esc(nameOf(assignee))}</b>`;
  if (!hint) return null;

  const name = hint.name || hint.owner;
  if (name) {
    const who = hint.bookingLink
      ? `<a href="${esc(hint.bookingLink)}">${esc(mdToPlain(name))}</a>`
      : esc(mdToPlain(name));
    const why = WHY_SUGGESTED[hint.source] || 'suggested';
    const where = hint.source === 'hubspot' ? '' : `${hint.label ? `${esc(hint.label)} — ` : ''}`;
    return `Suggested: ${who} (${where}${esc(why)})`;
  }
  if (hint.label && hint.matched) return `Sector: ${esc(hint.label)} — nobody on file for it`;
  return 'No suggestion — assign whoever should call';
}

function hubspotLine(card) {
  const hs = card.data?.hubspot || {};
  switch (hs.state) {
    case 'added': return `Written to HubSpot — contact ${hs.created ? 'created' : 'updated'}${hs.ownerSet ? ', owner set' : ''}, note added`;
    case 'failed': return 'HubSpot write didn’t go through — nothing was saved';
    case 'blocked': return 'Can’t write to HubSpot from here — see the private reply';
    default: return null;
  }
}

function offerCard(card, latestClick) {
  const expired = card.status === 'closed';
  const busy = !expired && card.data?.busy ? card.data.busy : null;
  return trackedCard({
    card,
    title: 'Want me to triage this lead?',
    subtitle: '',
    sections: [{
      widgets: [paragraph(expired
        ? 'Not triaged. @mention me with the lead’s details to start.'
        : 'I can pull what HubSpot knows, work out which tier they look like, and keep one card here until the lead is closed.')]
    }],
    buttons: [busy
      ? button('Looking them up…', { cardId: card.id, action: 'lead.start' }, { disabled: true })
      : button('Triage this lead', { cardId: card.id, action: 'lead.start' })],
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

const CLOSED_REASONS = { resolved: 'Closed', closed_by_owner: 'Closed', auto_stale: 'Closed (inactive)' };

function render(card, participants = [], latestClick = null, now = new Date()) {
  if (card.status === 'offered' || card.closed_reason === 'offer_expired') return offerCard(card, latestClick);

  const d = card.data || {};
  const b = ballOf(card);
  const id = card.id;
  const live = isLive(card);
  const busy = d.busy?.text ? d.busy : null;
  const sections = [];

  sections.push({ widgets: [paragraph([contactLine(d.lead), ...knownLines(card)].join('<br>'))] });

  const fit = fitLines(card);
  if (fit.length) sections.push({ header: 'Likely fit', widgets: [paragraph(fit.join('<br>'))] });

  const programs = programLines(card);
  if (programs.length) sections.push({ header: 'Worth mentioning', widgets: [paragraph(programs.join('<br>'))] });

  const tail = [ownerLine(card), hubspotLine(card)].filter(Boolean);
  if (tail.length) sections.push({ widgets: [paragraph(tail.join('<br>'))] });

  const dialog = (text, action, opts = {}) => button(text, { cardId: id, action }, { ...opts, openDialog: dialogsEnabled() && !opts.disabled });
  const buttons = [];

  // Fewer buttons per state, each labelled for the state it is in. Right after
  // a call the only question is what came of it, so that state shows the four
  // outcomes and nothing else but Assign.
  const justCalled = !d.outcome && (b.state === 'called' || b.state === 'assigned');
  if (live && justCalled) {
    for (const [action, outcome] of Object.entries(OUTCOME_ACTIONS)) {
      buttons.push(button(outcome.label, { cardId: id, action }));
    }
    buttons.push(dialog(d.assignee ? 'Reassign…' : 'Assign…', 'lead.assign'));
  } else if (live) {
    if (b.state === 'callback') {
      buttons.push(button(`${nameOf(b.holder)} is calling back`, { cardId: id, action: 'lead.callback' }, { disabled: true }));
    } else {
      buttons.push(button('I’ll call back', { cardId: id, action: 'lead.callback' }));
    }
    buttons.push(dialog(d.outcome ? 'Record another call' : 'Called', 'lead.called'));
    buttons.push(dialog(d.assignee ? 'Reassign…' : 'Assign…', 'lead.assign'));

    if (!d.outcome) buttons.push(button('Send calculator link', { cardId: id, action: 'lead.calc_link' }));
    buttons.push(busy?.kind === 'draft'
      ? button('Drafting…', { cardId: id, action: 'lead.draft' }, { disabled: true })
      : button('Draft reply', { cardId: id, action: 'lead.draft' }));

    if (d.outcome) {
      const added = d.hubspot?.state === 'added';
      buttons.push(button(
        added ? 'In HubSpot' : (busy?.kind === 'record' ? 'Writing…' : 'Record in HubSpot'),
        { cardId: id, action: 'lead.record' },
        { disabled: added || busy?.kind === 'record' }
      ));
      buttons.push(button('Close lead', { cardId: id, action: 'lead.close' }));
    }
  }

  const closedLabel = card.status === 'closed' ? (CLOSED_REASONS[card.closed_reason] || 'Closed') : null;
  const subtitle = ['Lead', statusLine(card), closedLabel].filter(Boolean).join(' · ');

  return trackedCard({
    card,
    title: card.title || 'Lead',
    subtitle,
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
  return htmlToPlain(statusLine(card)) + (d.hubspot?.state === 'added' ? ' · in HubSpot' : '');
}

// ============================================================================
// DIGEST AND DUE DATES
// ============================================================================

/**
 * This person's lead lines for today's digest: a callback they owe, a lead
 * assigned to them with no outcome yet, and — for whoever brought it in — a
 * lead nobody has picked up.
 */
async function digestItems(chatUserId, { now = new Date(), localDate = null } = {}) {
  const items = [];
  for (const card of await store.liveCardsOfType('lead')) {
    const participants = await store.getParticipants(card.id);
    const mine = participants.find(p => p.chat_user_id === chatUserId);
    if (mine?.muted) continue;
    const d = card.data || {};
    const b = ballOf(card);
    const shownOk = (key) => !d.shown?.[key] || d.shown[key] === localDate;

    if (b.state === 'callback' && b.holder?.chatUserId === chatUserId && !d.outcome) {
      items.push({ section: 'waiting', card, text: `You said you’d call back — since ${shortDate(b.since)}` });
      continue;
    }
    if (d.assignee?.chatUserId === chatUserId && !d.outcome) {
      items.push({ section: 'waiting', card, text: `Assigned to you since ${shortDate(b.since)}` });
      continue;
    }
    if (b.state === 'unassigned' && card.owner_chat_id === chatUserId
        && daysSince(card.created_at, now) >= UNASSIGNED_NUDGE_AFTER_DAYS && shownOk('unassignedOn')) {
      items.push({ section: 'nudge', card, nudge: 'unassignedOn', text: 'Nobody has picked this lead up yet' });
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

/** Hourly: the promised callback's DM, from 08:00 in the promiser's own day. */
async function sendDueNotices(now = new Date()) {
  let reminders = 0;
  for (const card of await store.dueCardsOfType('lead', new Date(now.getTime() + DAY_MS))) {
    const d = card.data || {};
    const b = ballOf(card);
    if (card.due_reminded_at || b.state !== 'callback' || !b.holder?.chatUserId || d.outcome) continue;
    const tz = await timeZoneFor(await resolvePerson(b.holder.chatUserId), now);
    const clock = localClock(now, tz);
    if (!sameLocalDay(new Date(card.due_at), now, tz) || clock.hour < 8) continue;
    if (!(await store.claimDueReminder(card.id, now))) continue;
    const link = threadLink(card.space_name, card.thread_name);
    const lead = d.lead || {};
    const how = [lead.phone, lead.email].filter(Boolean).join(' · ');
    const sent = await notifyImmediate('due_today', {
      card,
      chatUserId: b.holder.chatUserId,
      text: `Callback today: ${card.title?.replace(/^Lead: /, '') || 'a lead'}${how ? ` (${how})` : ''}.${link ? ` ${link}` : ''}`
    });
    if (sent.delivered) reminders++;
  }
  if (reminders) console.log(`⏰ Lead callback reminders — sent: ${reminders}`);
  return { reminders };
}

// ============================================================================

export const leadCard = {
  type: 'lead',
  actions: LEAD_ACTIONS,
  render,
  handleAction,
  refresh,
  digestLine,
  digestItems,
  markDigestShown,
  sendDueNotices,
  dialogFor,
  submitDialog
};

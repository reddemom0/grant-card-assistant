/**
 * The /watch card — a funding program a few people want to hear about
 *
 * Trigger: "@Oracle watch" or `/watch`, as a reply to a post about a program.
 * Never automatic: Oracle does not decide on its own that something is worth
 * watching.
 *
 * One card per program per space. The card lives under a synthetic thread key,
 * `<space>/threads/watch-<programKey>`, so the existing "one live card per type
 * and thread" index gives that for free: a later post about the same program
 * updates the same card, and watching from a different post joins the same
 * watch rather than starting a second one.
 *
 * What goes where:
 * - In the space: one small card — the program, its key dates, how many people
 *   are watching, and the buttons. Nothing else is ever posted to the space.
 * - In a DM: everything about the program when you join, and every reminder —
 *   at most one per program per watcher per day, combined into a single message
 *   (the notified_on ledger from migration 033 enforces that).
 *
 * Our grants table is where the dates and the description come from, and it is
 * never named in anything Oracle posts or sends.
 *
 * When Oracle can't tell which program is meant, it asks in the thread with a
 * choice card: a watch row in a "choosing" state (data.choosing), one button
 * per program plus "None of these". Only the person who asked can pick; a pick
 * turns the same message into the normal watch card. Unanswered, it lapses
 * after 24 hours (expireWatchChoices, hourly).
 *
 * Logs: codes and counts only.
 */

import crypto from 'crypto';
import * as store from '../database/tracked-cards-store.js';
import { FOUNDATION_ACTIONS, markCardReply } from './registry.js';
import { postMessage } from './chat-api.js';
import { renderCard, rerenderCard } from './update.js';
import { notifyImmediate } from './notify.js';
import { resolvePerson, timeZoneFor, localClock, isListenerChatUser } from './people.js';
import { trackedCard, paragraph, button, esc, clip, threadLink, mdToPlain } from './render.js';
import {
  programFromPost, programsFromPost, programKey, watchThreadName, matchProgram,
  datesFromPost, closureFromPost, postMatchesProgram, dueNotices
} from './watch-match.js';
import { interpretAsk } from './interpret.js';

const DAY = 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 5;
const TITLE_CHARS = 90;
const DISPLAY_TZ = process.env.DEFAULT_TIMEZONE || 'America/Vancouver';
/** How long the "still watching this?" question waits for an answer. */
export const CHECK_ANSWER_DAYS = 14;

export const WATCH_ACTIONS = {
  'watch.join': { personal: true, label: 'started watching' },
  'watch.stop': { personal: true, label: 'stopped watching' },
  'watch.not_this': { personal: false, label: 'said it was the wrong program' },
  'watch.pick1': { personal: false, label: 'picked another program' },
  'watch.pick2': { personal: false, label: 'picked another program' },
  'watch.pick3': { personal: false, label: 'picked another program' },
  'watch.keep': { personal: false, label: 'confirmed the watch' },
  'watch.end': { personal: false, label: 'ended this watch' },
  'watch.choose1': { personal: false, label: 'picked the program' },
  'watch.choose2': { personal: false, label: 'picked the program' },
  'watch.choose3': { personal: false, label: 'picked the program' },
  'watch.choose4': { personal: false, label: 'picked the program' },
  'watch.choose5': { personal: false, label: 'picked the program' },
  'watch.choose_none': { personal: false, label: 'said none of these' }
};

const LABELS = { ...FOUNDATION_ACTIONS, ...WATCH_ACTIONS };
const PICK_ACTIONS = { 'watch.pick1': 0, 'watch.pick2': 1, 'watch.pick3': 2 };
const CHOOSE_ACTIONS = { 'watch.choose1': 0, 'watch.choose2': 1, 'watch.choose3': 2, 'watch.choose4': 3, 'watch.choose5': 4 };
const MAX_CHOICES = 5;
/** Program names checked against our grants per choice card, at most. */
const MAX_CHOICE_LOOKUPS = 8;
/** How long a choice card waits for its asker. */
export const CHOICE_ANSWER_MS = DAY;

const HOW_TO = 'To watch a program, reply "@Oracle watch" to the post about it (or use /watch there).';
const NOT_FOUND = 'I couldn’t tell which program that post is about. Reply "@Oracle watch <program name>" and I’ll look again.';

/** What a choice card says when no watch came of it: "None of these", or nobody answered. */
export const CHOICE_NOTE = 'No watch set. Try /watch followed by the program’s name.';
const notTheAsker = (name) => `Only ${name} can pick — type /watch yourself to watch this too.`;

const SETUP_FAILED = 'Sorry — I couldn’t set up that watch. Try again in a minute, or tell Chris if it keeps happening.';
/** A live watch row with no posted card, older than this, was left by a failed setup. */
const UNPOSTED_GRACE_MS = 2 * 60 * 1000;

const BUSY = { match: 'Looking the program up…', clients: 'Checking who might fit…' };

const who = (p) => (p ? { chatUserId: p.chatUserId, name: p.name ?? p.displayName ?? null } : null);
const nameOf = (p) => mdToPlain(p?.name || 'someone');
const isLive = (card) => ['open', 'stale'].includes(card?.status);
const PLURALS = { person: 'people' };
const plural = (n, word) => `${n} ${n === 1 ? word : (PLURALS[word] || `${word}s`)}`;

/**
 * The program a post names: the rules' reading, with the program's name from
 * the model when it found one in the text. The rules stand when it can't help.
 */
async function readProgram(words, now) {
  const guess = programFromPost(words);
  if (!String(words || '').trim()) return guess;
  const model = await interpretAsk({ cardType: 'watch', askText: words, timeZone: DISPLAY_TZ, now })
    .catch(err => ({ ok: false, code: `threw_${codeOf(err)}` }));
  if (!model.ok) {
    console.log(`👁️  Watch interpreter fallback — code: ${model.code}`);
    return guess;
  }
  const name = model.fields.programName;
  if (!name) return guess;
  // The rules' acronym may belong to another program in the same post.
  const acronym = guess.acronym && name.includes(guess.acronym) ? guess.acronym : null;
  return { ...guess, name, acronym };
}

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

function shortDate(at) {
  if (!at) return '';
  const date = new Date(at);
  // Never throw on a value that is not a date: the card must still post.
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_TZ, month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

/**
 * "Closes Aug 31, 2026", or the grant's own words when it has no date
 * ("Closes: Open Until Filled"). Null when there is nothing to say. Rows saved
 * before deadlineText existed hold the words in `deadline`; they read the same.
 */
function closesLine(p, { plain = false } = {}) {
  const when = shortDate(p?.deadline);
  if (when) return `Closes ${plain ? when : esc(when)}`;
  const words = clip(String(p?.deadlineText || p?.deadline || '').trim(), 60);
  if (!words) return null;
  return `Closes: ${plain ? words : esc(words)}`;
}

async function privateReply({ spaceName, threadName, surface, chatUserId, text }) {
  if (!spaceName || !chatUserId || !text) return false;
  try {
    await postMessage({ spaceName, threadName, text, privateTo: surface === 'chat_dm' ? null : chatUserId });
    return true;
  } catch (err) {
    console.warn(`⚠️  Watch private reply failed — code: ${codeOf(err)}`);
    return false;
  }
}

// ============================================================================
// STARTING A WATCH
// ============================================================================

/**
 * Watch the program a post is about.
 *
 * @param {Object} p
 * @param {'command'|'mention'} p.trigger
 * @param {{chatUserId: string, name?: string, email?: string}} p.actor
 * @param {number} [p.userId]
 * @param {string} p.spaceName
 * @param {string|null} p.threadName - the thread the post is in (not the card's own key)
 * @param {string} [p.postText] - the post's own words, when the caller has them
 * @param {string} [p.quotedMessageName] - the message the trigger quotes, if any
 */
export async function startWatch({
  trigger, actor, userId = null, spaceName, threadName, surface = 'chat_space',
  conversationId = null, messageText = '', postText = '', messageName = null, quotedMessageName = null, now = new Date()
}) {
  const reply = (text) => privateReply({ spaceName, threadName, surface, chatUserId: actor.chatUserId, text });
  const done = (result) => {
    if (conversationId) markCardReply(conversationId);
    console.log(`👁️  Watch ${result.code || 'started'} — trigger: ${trigger}${result.stats || ''}`);
    return result;
  };

  if (!spaceName) {
    await reply(HOW_TO);
    return done({ ok: false, code: 'no_space' });
  }
  if (await isListenerChatUser(actor)) return done({ ok: false, code: 'listener_account' });

  // Words after "watch" name the program when the post does not.
  const asked = String(messageText || '').replace(/^\s*(?:\/watch|watch)\b/i, '').trim();
  const source = [asked, postText].filter(Boolean).join('\n');
  if (!source.trim() && !userId) {
    await reply(NOT_FOUND);
    return done({ ok: false, code: 'no_program' });
  }

  // NOTHING SLOW BEYOND THIS POINT. Reading the post, matching the program,
  // listing possible clients and sending the joining DM are three systems'
  // worth of waiting; Chat gives an app seconds. The press or the message is
  // answered now, and the card is posted by setUpWatch when it is ready.
  const { runInBackground } = await import('./actions.js');
  runInBackground('watch setup', () => setUpWatch({
    trigger, actor, userId, spaceName, threadName, surface, conversationId,
    messageText, source, messageName, quotedMessageName, now
  }));
  return done({ ok: true, code: 'looking', stats: `, from the post: ${Boolean(postText)}` });
}

/**
 * Everything that takes time: what program this is, whether it is already
 * watched here, the card itself, and the joining DM.
 *
 * Any failure is told to the person privately — the press was answered long
 * ago, so otherwise they hear nothing at all.
 *
 * Exported so a test can drive it directly; ordinarily only startWatch calls it.
 */
export async function setUpWatch(args = {}) {
  const { spaceName, threadName = null, surface = 'chat_space', actor } = args;
  const reply = (text) => privateReply({ spaceName, threadName, surface, chatUserId: actor?.chatUserId, text });
  try {
    const result = await buildWatch(args);
    if (result?.code === 'insert_failed') await reply(SETUP_FAILED);
    return result;
  } catch (err) {
    await reply(SETUP_FAILED);
    throw err;
  }
}

async function buildWatch({
  trigger = 'mention', actor, userId = null, spaceName, threadName = null, surface = 'chat_space',
  conversationId = null, messageText = '', source = '', messageName = null, quotedMessageName = null, now = new Date()
} = {}) {
  const reply = (text) => privateReply({ spaceName, threadName, surface, chatUserId: actor?.chatUserId, text });
  let words = source;
  let guess = await readProgram(words, now);

  // No program in the trigger — a quote-reply, a DM, or a post that names none.
  // Look at what the person pointed at, or what was said just before; when that
  // is a guess, ask which program with a choice card.
  if (!guess.name) {
    const { findSubject, quoteSubject } = await import('./subject.js');
    const found = await findSubject({
      spaceName,
      threadName,
      userIds: [userId],
      triggerMessageName: messageName,
      quotedMessageName,
      looksRight: (text) => Boolean(programFromPost(text).name)
    });
    if (!found.ok || !found.text) {
      await reply(NOT_FOUND);
      console.log(`👁️  Watch subject not found — code: ${found.code || 'none'}`);
      return { ok: false, code: 'no_program' };
    }
    const ask = (choices) => postChoiceCard({
      choices, quote: quoteSubject(found.text), words: [words, found.text].filter(Boolean).join('\n'),
      trigger, actor, userId, spaceName, threadName, surface, conversationId, messageName, now
    });
    if (!found.sure) {
      const texts = (found.matches?.length ? found.matches : [found.message]).map(m => m?.text);
      const choices = await programChoices(texts, now);
      console.log(`👁️  Watch subject unclear — from: ${found.from}, others: ${found.others}, choices: ${choices.length}`);
      if (!choices.length) {
        await reply(NOT_FOUND);
        return { ok: false, code: 'no_program' };
      }
      return ask(choices);
    }
    // A quoted post that names several programs: ask which one.
    if (found.from === 'quote') {
      const choices = await programChoices([found.text], now);
      if (choices.length > 1) {
        console.log(`👁️  Watch quote names several programs — choices: ${choices.length}`);
        return ask(choices);
      }
    }
    words = [words, found.text].filter(Boolean).join('\n');
    guess = await readProgram(words, now);
    console.log(`👁️  Watch subject taken from ${found.from}`);
    if (!guess.name) {
      await reply(NOT_FOUND);
      return { ok: false, code: 'no_program' };
    }
  }

  return placeWatch({ guess, words, trigger, actor, userId, spaceName, threadName, surface, conversationId, messageName, now });
}

/**
 * Up to five programs the texts might be about, for a choice card: every name
 * the rules can see, each checked against our grants. Programs we know come
 * first, under their own names; the post's own words only when none matched.
 */
export async function programChoices(texts = [], now = new Date()) {
  const seen = new Set();
  const names = texts.flatMap(t => programsFromPost(t))
    .filter(n => !seen.has(programKey(n.name)) && seen.add(programKey(n.name)))
    .slice(0, MAX_CHOICE_LOOKUPS);
  if (!names.length) return [];

  const best = await Promise.all(names.map(n => matchProgram(n, { limit: 1, now })
    .then(found => found[0] || null)
    .catch(() => null)));
  const choices = [];
  const keys = new Set();
  for (const p of best) {
    if (!p || p.score < 50 || keys.has(p.key)) continue;
    keys.add(p.key);
    choices.push({
      name: clip(p.name, TITLE_CHARS), key: p.key, url: p.url || null,
      deadline: p.deadline || null, deadlineText: p.deadlineText || null,
      amount: p.amount ?? null, provider: p.provider || null,
      industries: p.industries || [], regions: p.regions || [], matched: true
    });
  }
  if (!choices.length) {
    for (const n of names) {
      choices.push({
        name: clip(n.name, TITLE_CHARS), key: programKey(n.name), url: null,
        deadline: null, deadlineText: null, amount: null, provider: null,
        industries: [], regions: [], matched: false
      });
    }
  }
  return choices.slice(0, MAX_CHOICES);
}

/**
 * The choice card: posted in the thread for everyone to see, answered only by
 * the person who asked. Filed under the real thread, so a refusal to someone
 * else lands there; a newer one in the same thread replaces it.
 */
async function postChoiceCard({
  choices, quote = '', words = '', trigger, actor, userId = null, spaceName, threadName = null,
  surface = 'chat_space', conversationId = null, messageName = null, now = new Date()
}) {
  const threadKey = threadName || `${spaceName}/threads/watch-choose-${crypto.randomUUID().slice(0, 8)}`;
  const previous = threadName ? await store.findLiveCard('watch', threadKey) : null;
  if (previous?.data?.choosing) await closeChoice(previous, CHOICE_NOTE, 'replaced', now);

  let card = await store.insertCard({
    cardType: 'watch', status: 'open', spaceName, threadName: threadKey,
    sourceMessageName: messageName, conversationId,
    ownerChatId: actor.chatUserId, ownerUserId: userId,
    title: 'Which program?',
    data: {
      surface,
      noThread: !threadName,
      choosing: {
        choices,
        askedBy: { ...who(actor), userId },
        threadName, messageName, trigger, quote,
        words: clip(words, 2000)
      },
      busy: null,
      notice: null
    }
  });
  if (!card) return { ok: false, code: 'insert_failed' };

  try {
    const posted = await postMessage({ spaceName, threadName, cardsV2: await renderCard(card) });
    card = await store.updateCard(card.id, { messageName: posted });
  } catch (err) {
    await store.closeCard(card.id, 'setup_failed', now).catch(() => {});
    throw err;
  }
  console.log(`👁️  Watch choice card posted — trigger: ${trigger}, choices: ${choices.length}`);
  return { ok: true, code: 'choosing', card };
}

/** A choice card that is done: one line, closed, patched in place (no ping). */
async function closeChoice(card, note, reason, now = new Date()) {
  await store.patchCardData(card.id, { choiceNote: note, busy: null });
  await store.closeCard(card.id, reason, now);
  await rerenderCard(card.id);
}

/**
 * The asker picked a program: the same setup as a sure match. A program already
 * watched here is joined and the choice card says so; otherwise the choice
 * card's message becomes the new watch card.
 */
export async function chooseProgram(cardId, choice, now = new Date()) {
  const card = await store.getCard(cardId);
  const c = card?.data?.choosing;
  if (!card || !isLive(card) || !c) return null;
  const actor = { chatUserId: card.owner_chat_id, name: c.askedBy?.name || null };
  const surface = card.data?.surface || 'chat_space';
  const failed = async () => {
    await store.patchCardData(cardId, { busy: null });
    await privateReply({ spaceName: card.space_name, threadName: c.threadName, surface, chatUserId: actor.chatUserId, text: SETUP_FAILED });
  };
  try {
    const result = await placeWatch({
      guess: { name: choice.name, acronym: /\b([A-Z][A-Z0-9]{2,9})\b/.exec(choice.name)?.[1] || null, url: choice.url || null },
      words: c.words || '',
      trigger: c.trigger || 'mention',
      actor,
      userId: c.askedBy?.userId ?? card.owner_user_id,
      spaceName: card.space_name,
      threadName: c.threadName,
      surface,
      conversationId: card.conversation_id,
      messageName: c.messageName,
      now,
      choiceCard: card
    });
    if (result?.code === 'insert_failed') await failed();
    return result;
  } catch (err) {
    await failed();
    throw err;
  }
}

/**
 * Watch a program that is known: match it, join a live watch on it or start
 * one, then the joining DM. From a choice card (`choiceCard`), that card's
 * message becomes the watch card, or says which watch was joined.
 */
async function placeWatch({
  guess, words = '', trigger = 'mention', actor, userId = null, spaceName, threadName = null,
  surface = 'chat_space', conversationId = null, messageName = null, now = new Date(), choiceCard = null
}) {
  const reply = (text) => privateReply({ spaceName, threadName, surface, chatUserId: actor?.chatUserId, text });
  const joinedNote = (name) => `Joined the watch on ${mdToPlain(name || 'that program')} — its card is in the space.`;

  let candidates = [];
  try {
    candidates = await matchProgram(guess, { now });
  } catch (err) {
    console.warn(`⚠️  Watch program match failed — code: ${codeOf(err)}`);
  }
  const stated = datesFromPost(words, now);
  const best = candidates[0] || null;
  const program = {
    name: clip(best?.name || guess.name, TITLE_CHARS),
    key: programKey(best?.name || guess.name),
    url: best?.url || guess.url || null,
    // A date in the post is what a person just read; ours is the fallback.
    deadline: stated.deadline ? stated.deadline.toISOString() : (best?.deadline || null),
    deadlineText: stated.deadline ? null : (best?.deadlineText || null),
    opensAt: stated.opensAt ? stated.opensAt.toISOString() : null,
    amount: best?.amount ?? null,
    provider: best?.provider || null,
    industries: best?.industries || [],
    regions: best?.regions || [],
    matched: Boolean(best),
    statedDeadline: Boolean(stated.deadline)
  };

  const threadKey = watchThreadName(spaceName, program.key);
  let existing = await store.findLiveCard('watch', threadKey);

  // A row whose card never posted is left by a setup that failed part-way.
  // Nobody can see it, so it must not answer "already watching": start over.
  if (existing && !existing.message_name && now.getTime() - new Date(existing.created_at).getTime() > UNPOSTED_GRACE_MS) {
    await store.closeCard(existing.id, 'never_posted', now);
    console.log('👁️  Watch replacing a card that never posted');
    existing = null;
  }

  if (existing) {
    const joined = await joinWatch(existing, actor, { now });
    // A later post about the same program keeps the card up to date.
    await notePost(existing, { messageName, threadName, postText: words, now });
    await rerenderCard(existing.id);
    if (joined.added) await sendJoiningDm(existing.id, actor.chatUserId, userId);
    else await reply(`You’re already watching ${mdToPlain(existing.data?.program?.name || existing.title || 'that program')} — the card is here: ${threadLink(existing.space_name, null)}`);
    if (choiceCard) await closeChoice(choiceCard, joinedNote(existing.data?.program?.name || existing.title), 'resolved', now);
    console.log(`👁️  Watch ${joined.added ? 'joined' : 'already_watching'} — watchers: ${joined.watchers}`);
    return { ok: true, code: joined.added ? 'joined' : 'already_watching', card: existing };
  }

  const data = {
    surface,
    program,
    // "Not this one?" offers the OTHER matches; the one on the card is not an option.
    candidates: candidates.filter(c => c.key !== program.key).slice(0, 3)
      .map(c => ({ name: c.name, key: c.key, url: c.url, deadline: c.deadline, deadlineText: c.deadlineText || null, provider: c.provider })),
    picking: false,
    posts: messageName ? [{ messageName, threadName, at: now.toISOString(), kind: 'start' }] : [],
    startedBy: { ...who(actor), userId },
    source: clip(words, 2000),
    sent: {},
    check: null,
    busy: null,
    notice: null,
    shown: {}
  };

  let card = await store.insertCard({
    cardType: 'watch', status: 'open', spaceName, threadName: threadKey,
    sourceMessageName: messageName, conversationId,
    ownerChatId: actor.chatUserId, ownerUserId: userId,
    title: program.name, data
  });
  if (!card) {
    // Someone started the same watch a moment ago.
    const live = await store.findLiveCard('watch', threadKey);
    if (!live) return { ok: false, code: 'insert_failed' };
    const joined = await joinWatch(live, actor, { now });
    await rerenderCard(live.id);
    if (joined.added) await sendJoiningDm(live.id, actor.chatUserId, userId);
    if (choiceCard) await closeChoice(choiceCard, joinedNote(live.data?.program?.name || live.title), 'resolved', now);
    return { ok: true, code: 'joined', card: live };
  }

  try {
    await store.addParticipants(card.id, [
      { chatUserId: actor.chatUserId, role: 'owner', displayName: actor.name || null }
    ]);

    if (choiceCard?.message_name) {
      // The choice card's message becomes the watch card, in place: no second
      // post, no ping. One message belongs to one card, so the choice card
      // lets go of it first.
      await store.closeCard(choiceCard.id, 'resolved', now);
      await store.updateCard(choiceCard.id, { messageName: null });
      card = await store.updateCard(card.id, { messageName: choiceCard.message_name });
      await rerenderCard(card.id);
    } else {
      // The watch card is its own message in the space, not a reply to the post.
      const posted = await postMessage({ spaceName, cardsV2: await renderCard(card) });
      card = await store.updateCard(card.id, { messageName: posted });
    }
  } catch (err) {
    // Nothing was posted: close the row so the next /watch starts clean.
    await store.closeCard(card.id, 'setup_failed', now).catch(() => {});
    throw err;
  }

  // Anyone who watched this program before, in this space, hears that it is back.
  const told = await dmPastWatchers(card, now);
  await sendJoiningDm(card.id, actor.chatUserId, userId);
  await rerenderCard(card.id);

  console.log(`👁️  Watch card posted — trigger: ${trigger}, matched: ${program.matched}, deadline: ${program.deadline ? 'yes' : 'no'}, told: ${told}${choiceCard ? ', from a choice card' : ''}`);
  return { ok: true, code: null, card };
}

/**
 * Add someone to a watch. Database only — the joining DM needs HubSpot and our
 * grants table, so it is sent by sendJoiningDm() after the press is answered.
 */
export async function joinWatch(card, actor, { now = new Date() } = {}) {
  const participants = await store.getParticipants(card.id);
  const already = participants.find(p => p.chat_user_id === actor.chatUserId);
  if (!already) {
    await store.addParticipants(card.id, [
      { chatUserId: actor.chatUserId, role: 'member', displayName: actor.name || null }
    ]);
  }
  return { added: !already, watchers: participants.length + (already ? 0 : 1) };
}

/** The DM a new watcher gets: everything we know about the program, once. */
export async function sendJoiningDm(cardId, chatUserId, userId = null) {
  if (!chatUserId) return false;
  const card = await store.getCard(cardId);
  if (!card || !isLive(card)) return false;
  try {
    const sent = await notifyImmediate('watched_grant', {
      card, chatUserId, text: await joiningMessage(card, { userId })
    });
    return sent.delivered;
  } catch (err) {
    console.warn(`⚠️  Watch joining DM failed — code: ${codeOf(err)}`);
    return false;
  }
}

/** Up to five companies that might fit — by past deals, then by industry. */
export async function possibleClients(program, { limit = MAX_CLIENTS } = {}) {
  const out = [];
  const seen = new Set();
  const add = (name, why) => {
    const key = String(name || '').toLowerCase();
    if (!name || seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push({ name, why });
  };

  try {
    const hubspot = await import('../tools/hubspot.js');
    const deals = await hubspot.searchGrantApplications({ grant_program: program.name });
    for (const app of (deals?.applications || []).slice(0, limit)) {
      add(app.companyName || app.company_name || app.name, 'applied before');
    }
    if (out.length < limit && program.industries?.length) {
      const companies = await hubspot.searchHubSpotCompanies(program.industries[0]);
      for (const company of (companies?.companies || []).slice(0, limit)) {
        add(company.name, 'same industry');
      }
    }
  } catch (err) {
    console.warn(`⚠️  Watch client list failed — code: ${codeOf(err)}`);
  }
  console.log(`👁️  Watch possible clients — found: ${out.length}`);
  return out;
}

/** The DM someone gets when they start watching: everything we know, once. */
export async function joiningMessage(card, { userId = null } = {}) {
  const d = card.data || {};
  const p = d.program || {};
  const clients = await possibleClients(p);
  const link = threadLink(card.space_name, null);

  const dates = [];
  if (p.opensAt) dates.push(`Opens ${shortDate(p.opensAt)}`);
  const closes = closesLine(p, { plain: true });
  if (closes) dates.push(`${closes}${p.statedDeadline || !shortDate(p.deadline) ? '' : ' (check the page to be sure)'}`);
  if (!dates.length) dates.push('No dates on file — check the page');

  const lines = [
    `You’re watching ${p.name}.`,
    [p.provider ? `Run by ${p.provider}.` : null, p.amount ? `Up to ${p.amount}.` : null].filter(Boolean).join(' ') || null,
    dates.join(' · '),
    p.url || null,
    clients.length
      ? `Clients who might fit (matched on past applications and industry — not on what they've told us they need):\n${clients.map(c => `- ${c.name} (${c.why})`).join('\n')}`
      : 'No obvious clients for it yet.',
    'I’ll DM you: the day before it opens, 14 days and 2 days before the deadline, when someone posts about it, and if it closes. At most one message a day.',
    'Press Stop watching on the card in the space to stop.',
    link || null
  ].filter(Boolean);
  return lines.join('\n\n');
}

/** Everyone who watched this program in this space before, told it is back. */
async function dmPastWatchers(card, now) {
  const d = card.data || {};
  let told = 0;
  try {
    const closed = (await store.listCardsByStatus(['closed']))
      .filter(c => c.card_type === 'watch' && c.space_name === card.space_name && c.thread_name === card.thread_name && c.id !== card.id);
    const seen = new Set();
    for (const old of closed) {
      for (const person of await store.getParticipants(old.id)) {
        if (seen.has(person.chat_user_id) || person.chat_user_id === d.startedBy?.chatUserId) continue;
        seen.add(person.chat_user_id);
        const sent = await notifyImmediate('watched_grant', {
          card,
          chatUserId: person.chat_user_id,
          text: `${d.program?.name} is back — ${nameOf(d.startedBy)} started watching it again. Press Watch this on the card in the space to hear about it too.`
        });
        if (sent.delivered) told++;
      }
    }
  } catch (err) {
    console.warn(`⚠️  Watch reopen notices failed — code: ${codeOf(err)}`);
  }
  if (told) console.log(`👁️  Watch reopened — past watchers told: ${told}`);
  return told;
}

/** Record that a post talked about this program, and what it said. */
async function notePost(card, { messageName, threadName, postText = '', program = null, now = new Date() }) {
  const d = card.data || {};
  const posts = [...(d.posts || [])];
  if (messageName && !posts.some(p => p.messageName === messageName)) {
    posts.push({ messageName, threadName, at: now.toISOString(), kind: 'mention' });
  }
  const patch = { posts: posts.slice(-10) };

  // A date in a new post is newer than anything we had.
  const stated = datesFromPost(postText, now);
  if (stated.deadline) {
    patch.program = { ...d.program, deadline: stated.deadline.toISOString(), statedDeadline: true };
  }
  if (stated.opensAt) {
    patch.program = { ...(patch.program || d.program), opensAt: stated.opensAt.toISOString() };
  }
  await store.patchCardData(card.id, patch);
}

// ============================================================================
// BUTTONS
// ============================================================================

async function handleAction({ card, actor, action, now = new Date() }) {
  const d = card.data || {};
  if (!isLive(card)) return { changed: false, ignored: 'not_open', reply: 'This watch has ended.' };
  if (d.choosing) return handleChoice({ card, actor, action, now });

  if (action in PICK_ACTIONS) {
    const pick = (d.candidates || [])[PICK_ACTIONS[action]];
    if (!pick) return { changed: false, ignored: 'no_such_program', reply: 'That option isn’t on the card any more.' };
    return { changed: true, background: () => switchProgram(card.id, actor, pick, now) };
  }

  switch (action) {
    case 'watch.join': {
      if (await isListenerChatUser(actor)) return { changed: false, ignored: 'listener_account', reply: 'This account can’t watch a program.' };
      const joined = await joinWatch(card, actor, { now });
      if (!joined.added) return { changed: false, ignored: 'already_watching', reply: `You’re already watching ${d.program?.name || 'it'}.` };
      // The DM needs HubSpot and our grants table: after the answer, not before.
      return { changed: true, claimed: true, background: () => sendJoiningDm(card.id, actor.chatUserId) };
    }

    case 'watch.stop': {
      const participants = await store.getParticipants(card.id);
      const mine = participants.find(p => p.chat_user_id === actor.chatUserId);
      if (!mine) return { changed: false, ignored: 'not_watching', reply: 'You weren’t watching this one.' };
      await store.removeParticipant(card.id, actor.chatUserId);
      // The last watcher leaving ends the watch: nobody is listening any more.
      if (participants.length <= 1) {
        await store.closeCard(card.id, 'resolved', now);
        return { changed: true, notice: 'nobody is watching this any more' };
      }
      return { changed: true };
    }

    case 'watch.not_this':
      if (!(d.candidates || []).length) {
        return { changed: false, ignored: 'no_options', reply: 'I don’t have another program to offer — reply "@Oracle watch <program name>" instead.' };
      }
      await store.patchCardData(card.id, { picking: !d.picking });
      return { changed: true };

    case 'watch.keep':
      if (!d.check) return { changed: false, ignored: 'nothing_to_confirm', reply: 'Nothing is waiting to be confirmed on this card.' };
      await store.patchCardData(card.id, { check: null, sent: { ...(d.sent || {}), still_watching: null }, notice: null });
      await store.touchActivity(card.id, now);
      return { changed: true };

    case 'watch.end':
      await store.closeCard(card.id, 'resolved', now);
      return { changed: true };

    default:
      return { changed: false, ignored: 'unknown_action', reply: 'That button doesn’t do anything on this card.' };
  }
}

/** A press on a choice card. Only the person who asked can answer it. */
async function handleChoice({ card, actor, action, now = new Date() }) {
  const d = card.data || {};
  if (!(action in CHOOSE_ACTIONS) && action !== 'watch.choose_none') {
    return { changed: false, ignored: 'unknown_action', reply: 'That button doesn’t do anything on this card.' };
  }
  if (actor.chatUserId !== card.owner_chat_id) {
    return { changed: false, ignored: 'not_the_asker', reply: notTheAsker(nameOf(d.choosing.askedBy)) };
  }
  if (action === 'watch.choose_none') {
    await store.patchCardData(card.id, { choiceNote: CHOICE_NOTE, busy: null });
    await store.closeCard(card.id, 'none_chosen', now);
    return { changed: true };
  }
  if (d.busy) return { changed: false, ignored: 'busy', reply: 'Already setting that up — one moment.' };
  const choice = (d.choosing.choices || [])[CHOOSE_ACTIONS[action]];
  if (!choice) return { changed: false, ignored: 'no_such_program', reply: 'That option isn’t on the card any more.' };
  await store.patchCardData(card.id, { busy: { text: BUSY.match, at: now.toISOString() } });
  return { changed: true, background: () => chooseProgram(card.id, choice, now) };
}

/**
 * "Not this one?" → the watch moves to the program someone picked. The card's
 * thread key is fixed at insert, so the old card is closed and a new one takes
 * its place under the new key, carrying its watchers over.
 */
export async function switchProgram(cardId, actor, pick, now = new Date()) {
  const card = await store.getCard(cardId);
  if (!card || !isLive(card)) return;
  const d = card.data || {};
  const key = pick.key || programKey(pick.name);
  const threadKey = watchThreadName(card.space_name, key);

  if (threadKey === card.thread_name) {
    await store.patchCardData(cardId, { picking: false });
    await rerenderCard(cardId);
    return store.getCard(cardId);
  }

  const watchers = await store.getParticipants(cardId);
  const program = {
    ...d.program,
    name: clip(pick.name, TITLE_CHARS),
    key,
    url: pick.url || d.program?.url || null,
    // A date someone read in the post still beats ours.
    deadline: d.program?.statedDeadline ? d.program.deadline : (pick.deadline || null),
    deadlineText: d.program?.statedDeadline ? null : (pick.deadlineText || null),
    amount: pick.amount ?? d.program?.amount ?? null,
    provider: pick.provider || null,
    industries: pick.industries || d.program?.industries || [],
    matched: true,
    statedDeadline: Boolean(d.program?.statedDeadline)
  };

  const existing = await store.findLiveCard('watch', threadKey);
  let target = existing;
  if (!existing) {
    target = await store.insertCard({
      cardType: 'watch', status: 'open', spaceName: card.space_name, threadName: threadKey,
      sourceMessageName: card.source_message_name, conversationId: card.conversation_id,
      ownerChatId: card.owner_chat_id, ownerUserId: card.owner_user_id,
      title: program.name,
      data: { ...d, program, picking: false, sent: {}, check: null, busy: null, notice: null }
    });
  }
  if (!target) {
    await store.patchCardData(cardId, { picking: false, notice: { text: 'couldn’t switch the program', at: now.toISOString() } });
    await rerenderCard(cardId);
    return store.getCard(cardId);
  }

  await store.addParticipants(target.id, watchers.map(p => ({
    chatUserId: p.chat_user_id, role: p.role === 'owner' ? 'owner' : 'member', displayName: p.display_name
  })));

  // The old card's message becomes the new card's message: one card in the
  // space, in place, with no second post and no ping. The old card has to let
  // go of it first — one message belongs to one card (a unique index).
  await store.closeCard(cardId, 'resolved', now);
  if (card.message_name && !target.message_name) {
    await store.updateCard(cardId, { messageName: null });
    target = await store.updateCard(target.id, { messageName: card.message_name });
  }
  await rerenderCard(target.id);
  console.log(`👁️  Watch program switched — watchers: ${watchers.length}, same message: ${Boolean(card.message_name)}`);
  return store.getCard(target.id);
}

/** Presses read nothing new: the program's facts come from posts and the job. */
async function refresh() {
  return { changed: false };
}

// ============================================================================
// REMINDERS (DM ONLY, ONE A DAY PER WATCHER)
// ============================================================================

/**
 * Hourly: the day's reminders for every live watch, combined into one DM per
 * watcher per program per day. A watch whose deadline has passed sends its last
 * note and closes.
 */
async function sendDueNotices(now = new Date()) {
  const counts = { watchNotices: 0, watchClosed: 0 };

  for (const card of await store.liveCardsOfType('watch')) {
    const d = card.data || {};
    if (d.choosing) continue;                                   // a question, not a watch
    const { due, ends } = dueNotices({
      program: d.program || {},
      sent: d.sent || {},
      now,
      createdAt: card.created_at
    });
    const pending = [...due, ...(d.pending || [])];
    if (!pending.length) {
      if (d.check && now.getTime() - new Date(d.check.at).getTime() >= CHECK_ANSWER_DAYS * DAY) {
        await store.closeCard(card.id, 'resolved', now);
        await rerenderCard(card.id);
        counts.watchClosed++;
      }
      continue;
    }

    const participants = await store.getParticipants(card.id);
    const link = threadLink(card.space_name, null);
    let sentTo = 0;

    for (const person of participants) {
      if (person.muted) continue;
      const tz = await timeZoneFor(await resolvePerson(person.chat_user_id), now);
      const { date, hour } = localClock(now, tz);
      if (hour < 8) continue;                                   // nothing before their morning
      if (!(await store.claimParticipantNotice(card.id, person.chat_user_id, date))) continue;

      const text = [
        `${d.program?.name || 'A program you watch'} — what's new:`,
        ...pending.map(item => `- ${item.text}`),
        d.program?.url || null,
        link || null
      ].filter(Boolean).join('\n');
      const sent = await notifyImmediate('watched_grant', { card, chatUserId: person.chat_user_id, text });
      if (sent.delivered) sentTo++;
    }

    if (sentTo) {
      counts.watchNotices += sentTo;
      const sent = { ...(d.sent || {}) };
      const today = new Date(now).toISOString().slice(0, 10);
      for (const item of pending) sent[item.kind] = today;
      const patch = { sent, pending: [] };
      if (pending.some(item => item.kind === 'still_watching')) patch.check = { at: now.toISOString() };
      await store.patchCardData(card.id, patch);
      await rerenderCard(card.id);
    }

    if (ends) {
      await store.closeCard(card.id, 'resolved', now);
      await rerenderCard(card.id);
      counts.watchClosed++;
    }
  }

  if (counts.watchNotices || counts.watchClosed) {
    console.log(`👁️  Watch notices — DMs: ${counts.watchNotices}, watches ended: ${counts.watchClosed}`);
  }
  return counts;
}

// ============================================================================
// NEW POSTS IN A LISTENED SPACE
// ============================================================================

/**
 * Stored-copy hook: new messages in a listened space. A message about a watched
 * program becomes tomorrow's DM line (never an immediate ping), and a post
 * saying the program has closed ends the watch.
 *
 * Inactive until a space is listened to, which is why it is tested rather than
 * observed.
 */
export async function onStoredMessages(spaceName, messages = [], now = new Date()) {
  const cards = (await store.liveCardsOfType('watch')).filter(c => c.space_name === spaceName && !c.data?.choosing);
  if (!cards.length) return { matched: 0, ended: 0 };
  let matched = 0;
  let ended = 0;

  for (const raw of messages) {
    const text = String(raw?.text || raw?.argumentText || '');
    const messageName = raw?.name || null;
    const senderType = raw?.sender?.type || raw?.sender_type || 'HUMAN';
    if (!text.trim() || senderType === 'BOT') continue;

    for (const card of cards) {
      const d = card.data || {};
      if (!postMatchesProgram(text, d.program)) continue;
      if ((d.posts || []).some(p => p.messageName === messageName)) continue;
      matched++;

      const closure = closureFromPost(text);
      const line = closure === 'closed'
        ? `Someone posted that ${d.program.name} has closed.`
        : closure === 'nearly_gone'
          ? `Someone posted that ${d.program.name} is nearly gone.`
          : `Someone posted about ${d.program.name} in this space.`;

      const pending = [...(d.pending || [])];
      if (!pending.some(item => item.text === line)) pending.push({ kind: `post_${messageName || pending.length}`, text: line });
      await store.patchCardData(card.id, { pending });
      await notePost(card, { messageName, threadName: raw?.thread?.name || null, postText: text, now });
      await store.touchActivity(card.id, now);

      if (closure === 'closed') {
        // The last word goes out with the rest of the day's lines, then the
        // watch ends — nothing more will happen to this program.
        await store.patchCardData(card.id, { endedBy: 'closed_post' });
        ended++;
      }
      await rerenderCard(card.id);
    }
  }

  if (matched) console.log(`👁️  Watch posts matched — posts: ${matched}, ending: ${ended}`);
  return { matched, ended };
}

/**
 * Hourly: choice cards nobody answered in 24 hours say "No watch set…" and
 * close. Patching notifies nobody; nothing is posted.
 */
export async function expireWatchChoices(now = new Date()) {
  let expired = 0;
  for (const card of await store.liveCardsOfType('watch')) {
    if (!card.data?.choosing) continue;
    if (now.getTime() - new Date(card.created_at).getTime() < CHOICE_ANSWER_MS) continue;
    await closeChoice(card, CHOICE_NOTE, 'expired', now);
    expired++;
  }
  if (expired) console.log(`👁️  Watch choice cards expired — cards: ${expired}`);
  return { expired };
}

// ============================================================================
// RENDER
// ============================================================================

function datesLine(card) {
  const p = card.data?.program || {};
  const bits = [];
  if (p.opensAt) bits.push(`Opens ${esc(shortDate(p.opensAt))}`);
  const closes = closesLine(p);
  if (closes) bits.push(`${closes}${p.statedDeadline || !shortDate(p.deadline) ? '' : ' (check the page)'}`);
  if (!bits.length) bits.push('No dates on file — check the page');
  if (p.amount) bits.push(`Up to ${esc(String(p.amount))}`);
  return bits.join(' · ');
}

function headLines(card, watchers) {
  const p = card.data?.program || {};
  const lines = [];
  const name = p.url ? `<a href="${esc(p.url)}">${esc(p.name)}</a>` : `<b>${esc(p.name)}</b>`;
  lines.push(`${name}${p.provider ? ` · ${esc(p.provider)}` : ''}`);
  lines.push(datesLine(card));
  lines.push(`${plural(watchers, 'person')} watching`);
  if (!p.matched) lines.push('<i>Taken from the post — press Not this one? if that’s wrong</i>');
  return lines;
}

function pickLines(card) {
  return (card.data?.candidates || []).slice(0, 3)
    .map((c, i) => `${i + 1}. ${esc(c.name)}${c.provider ? ` · ${esc(c.provider)}` : ''}`);
}

function outcomeFor(d, latestClick) {
  const n = d.notice;
  if (!n?.text) return null;
  if (latestClick && new Date(n.at) < new Date(latestClick.created_at)) return null;
  return n.text;
}

/** The choice card: which program, one button each, and "None of these". */
function renderChoice(card, latestClick) {
  const d = card.data || {};
  const c = d.choosing || {};
  const live = isLive(card);
  const choices = (c.choices || []).slice(0, MAX_CHOICES);
  const sections = [];
  if (!live || d.choiceNote) {
    sections.push({ widgets: [paragraph(esc(d.choiceNote || CHOICE_NOTE))] });
  } else {
    const lines = [`${esc(nameOf(c.askedBy))}, which program should I watch?`];
    if (c.quote) lines.push(`<i>“${esc(c.quote)}”</i>`);
    sections.push({ widgets: [paragraph(lines.join('<br>'))] });
    sections.push({
      widgets: [paragraph(choices.map((p, i) => `${i + 1}. ${esc(p.name)}${p.provider ? ` · ${esc(p.provider)}` : ''}`).join('<br>'))]
    });
  }

  const buttons = [];
  if (live && !d.choiceNote) {
    choices.forEach((p, i) => {
      buttons.push(button(`${i + 1}. ${clip(mdToPlain(p.name), 28)}`, { cardId: card.id, action: `watch.choose${i + 1}` }));
    });
    buttons.push(button('None of these', { cardId: card.id, action: 'watch.choose_none' }));
  }

  return trackedCard({
    card,
    title: card.title || 'Which program?',
    subtitle: 'Watch',
    sections,
    buttons,
    latestClick,
    labels: LABELS,
    busy: d.busy?.text ? d.busy : null,
    outcome: outcomeFor(d, latestClick)
  });
}

function render(card, participants = [], latestClick = null, now = new Date()) {
  const d = card.data || {};
  if (d.choosing) return renderChoice(card, latestClick);
  const id = card.id;
  const live = isLive(card);
  const watchers = participants.length;
  const sections = [{ widgets: [paragraph(headLines(card, watchers).join('<br>'))] }];

  if (live && d.picking) {
    const picks = pickLines(card);
    sections.push({
      header: 'Did you mean',
      widgets: [paragraph(picks.length ? picks.join('<br>') : 'Nothing else came close — reply "@Oracle watch &lt;program name&gt;".')]
    });
  }
  if (live && d.check) {
    sections.push({ widgets: [paragraph('<b>Still watching this?</b> Nothing has come up for six months.')] });
  }

  const buttons = [];
  if (live) {
    if (d.picking) {
      (d.candidates || []).slice(0, 3).forEach((c, i) => {
        buttons.push(button(`${i + 1}. ${clip(mdToPlain(c.name), 28)}`, { cardId: id, action: `watch.pick${i + 1}` }));
      });
      buttons.push(button('Keep this one', { cardId: id, action: 'watch.not_this' }));
    } else if (d.check) {
      buttons.push(button('Yes, keep watching', { cardId: id, action: 'watch.keep' }));
      buttons.push(button('Stop watching', { cardId: id, action: 'watch.stop' }));
    } else {
      buttons.push(button('Watch this', { cardId: id, action: 'watch.join' }));
      buttons.push(button('Not this one?', { cardId: id, action: 'watch.not_this' }));
      buttons.push(button('Stop watching', { cardId: id, action: 'watch.stop' }));
    }
  }

  const closed = card.status === 'closed'
    ? (d.endedBy === 'closed_post' ? 'Ended — the program closed' : 'Ended')
    : null;

  return trackedCard({
    card,
    title: card.title || d.program?.name || 'A funding program',
    subtitle: ['Watching', closed].filter(Boolean).join(' · '),
    sections,
    buttons,
    latestClick,
    labels: LABELS,
    busy: d.busy?.text ? d.busy : null,
    outcome: outcomeFor(d, latestClick)
  });
}

function digestLine(card, participants = []) {
  const p = card.data?.program || {};
  return [
    closesLine(p, { plain: true }) || 'No dates on file',
    `${plural(participants.length, 'person')} watching`
  ].join(' · ');
}

/** Watches say nothing in the digest: they are a DM-only card by design. */
async function digestItems() {
  return [];
}

// ============================================================================
// ENTRY POINTS
// ============================================================================

/**
 * "@Oracle watch" in a thread — handled without the model. The post being
 * watched is the message above, read as the person who asked.
 * @returns {Promise<boolean>} false → answer normally
 */
export async function handleWatchMessage({ evt, user, conversationId, messageText, now = new Date() }) {
  const threadName = evt.threadIsResourceName ? evt.threadId : null;
  const spaceName = evt.spaceIsResourceName ? evt.spaceId : null;
  const actor = { chatUserId: evt.senderChatId, name: evt.senderDisplayName || user?.name || null, email: evt.senderEmail || null };
  const surface = evt.isDm ? 'chat_dm' : 'chat_space';

  // The post itself is read in the background (setUpWatch), not here: reading
  // Chat is a network call, and this runs while the person is waiting.
  await startWatch({
    trigger: 'mention', actor, userId: user?.id || null, spaceName, threadName, surface,
    conversationId, messageText, messageName: evt.messageName,
    quotedMessageName: evt.quotedMessageName || null, now
  });
  return true;
}

// ============================================================================

export const watchCard = {
  type: 'watch',
  actions: WATCH_ACTIONS,
  // A watch on a program that closes in three months is not neglected because
  // nobody pressed a button; it ends on its own dates instead.
  neverStale: true,
  render,
  handleAction,
  refresh,
  digestLine,
  digestItems,
  sendDueNotices
};

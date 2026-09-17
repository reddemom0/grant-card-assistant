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
 * Logs: codes and counts only.
 */

import * as store from '../database/tracked-cards-store.js';
import { FOUNDATION_ACTIONS, markCardReply } from './registry.js';
import { postMessage } from './chat-api.js';
import { renderCard, rerenderCard } from './update.js';
import { notifyImmediate } from './notify.js';
import { resolvePerson, timeZoneFor, localClock, isListenerChatUser } from './people.js';
import { trackedCard, paragraph, button, esc, clip, threadLink, mdToPlain } from './render.js';
import {
  programFromPost, programKey, watchThreadName, matchProgram,
  datesFromPost, closureFromPost, postMatchesProgram, dueNotices
} from './watch-match.js';

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
  'watch.end': { personal: false, label: 'ended this watch' }
};

const LABELS = { ...FOUNDATION_ACTIONS, ...WATCH_ACTIONS };
const PICK_ACTIONS = { 'watch.pick1': 0, 'watch.pick2': 1, 'watch.pick3': 2 };

const HOW_TO = 'To watch a program, reply "@Oracle watch" to the post about it (or use /watch there).';
const NOT_FOUND = 'I couldn’t tell which program that post is about. Reply "@Oracle watch <program name>" and I’ll look again.';

const BUSY = { match: 'Looking the program up…', clients: 'Checking who might fit…' };

const who = (p) => (p ? { chatUserId: p.chatUserId, name: p.name ?? p.displayName ?? null } : null);
const nameOf = (p) => mdToPlain(p?.name || 'someone');
const isLive = (card) => ['open', 'stale'].includes(card?.status);
const PLURALS = { person: 'people' };
const plural = (n, word) => `${n} ${n === 1 ? word : (PLURALS[word] || `${word}s`)}`;

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

function shortDate(at) {
  if (!at) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_TZ, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(at));
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
 */
export async function startWatch({
  trigger, actor, userId = null, spaceName, threadName, surface = 'chat_space',
  conversationId = null, messageText = '', postText = '', messageName = null, now = new Date()
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
  const guess = programFromPost(source);
  if (!guess.name) {
    await reply(NOT_FOUND);
    return done({ ok: false, code: 'no_program' });
  }

  const candidates = await matchProgram(guess, { now });
  const stated = datesFromPost(source, now);
  const best = candidates[0] || null;
  const program = {
    name: clip(best?.name || guess.name, TITLE_CHARS),
    key: programKey(best?.name || guess.name),
    url: best?.url || guess.url || null,
    // A date in the post is what a person just read; ours is the fallback.
    deadline: stated.deadline ? stated.deadline.toISOString() : (best?.deadline || null),
    opensAt: stated.opensAt ? stated.opensAt.toISOString() : null,
    amount: best?.amount ?? null,
    provider: best?.provider || null,
    industries: best?.industries || [],
    regions: best?.regions || [],
    matched: Boolean(best),
    statedDeadline: Boolean(stated.deadline)
  };

  const threadKey = watchThreadName(spaceName, program.key);
  const existing = await store.findLiveCard('watch', threadKey);

  if (existing) {
    const joined = await joinWatch(existing, actor, { now, userId });
    // A later post about the same program keeps the card up to date.
    await notePost(existing, { messageName, threadName, program, postText: source, now });
    await rerenderCard(existing.id);
    return done({
      ok: true,
      code: joined.added ? 'joined' : 'already_watching',
      card: existing,
      stats: `, watchers: ${joined.watchers}`
    });
  }

  const data = {
    surface,
    program,
    // "Not this one?" offers the OTHER matches; the one on the card is not an option.
    candidates: candidates
      .filter(c => c.key !== program.key)
      .slice(0, 3)
      .map(c => ({ name: c.name, key: c.key, url: c.url, deadline: c.deadline, provider: c.provider })),
    picking: false,
    posts: messageName ? [{ messageName, threadName, at: now.toISOString(), kind: 'start' }] : [],
    startedBy: { ...who(actor), userId },
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
    if (live) {
      const joined = await joinWatch(live, actor, { now, userId });
      await rerenderCard(live.id);
      return done({ ok: true, code: 'joined', card: live, stats: `, watchers: ${joined.watchers}` });
    }
    return done({ ok: false, code: 'insert_failed' });
  }

  await store.addParticipants(card.id, [
    { chatUserId: actor.chatUserId, role: 'owner', displayName: actor.name || null }
  ]);

  // The watch card is its own message in the space, not a reply to the post.
  const posted = await postMessage({ spaceName, cardsV2: await renderCard(card) });
  card = await store.updateCard(card.id, { messageName: posted });

  // Anyone who watched this program before, in this space, hears that it is back.
  const reopened = await dmPastWatchers(card, now);
  // Whoever started it is already on the card (as its owner), so the joining DM
  // is sent here rather than through joinWatch.
  await notifyImmediate('watched_grant', {
    card, chatUserId: actor.chatUserId, text: await joiningMessage(card, { userId })
  });
  await rerenderCard(card.id);

  return done({
    ok: true,
    code: null,
    card,
    stats: `, matched: ${program.matched}, deadline: ${program.deadline ? 'yes' : 'no'}, told: ${reopened}`
  });
}

/** Add someone to a watch and DM them everything about the program. */
export async function joinWatch(card, actor, { now = new Date(), userId = null, silent = false } = {}) {
  const participants = await store.getParticipants(card.id);
  const already = participants.find(p => p.chat_user_id === actor.chatUserId);
  if (!already) {
    await store.addParticipants(card.id, [
      { chatUserId: actor.chatUserId, role: 'member', displayName: actor.name || null }
    ]);
  }
  const watchers = (already ? participants : [...participants, { chat_user_id: actor.chatUserId }]).length;
  const added = !already;
  if (added && !silent) {
    const text = await joiningMessage(card, { userId });
    await notifyImmediate('watched_grant', { card, chatUserId: actor.chatUserId, text });
  }
  return { added, watchers };
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
  if (p.deadline) dates.push(`Closes ${shortDate(p.deadline)}${p.statedDeadline ? '' : ' (check the page to be sure)'}`);
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
      return { changed: true, claimed: true };
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
    return;
  }

  const watchers = await store.getParticipants(cardId);
  const program = {
    ...d.program,
    name: clip(pick.name, TITLE_CHARS),
    key,
    url: pick.url || null,
    deadline: pick.deadline || null,
    provider: pick.provider || null,
    matched: true,
    statedDeadline: false
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
    return;
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
  const cards = (await store.liveCardsOfType('watch')).filter(c => c.space_name === spaceName);
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

// ============================================================================
// RENDER
// ============================================================================

function datesLine(card) {
  const p = card.data?.program || {};
  const bits = [];
  if (p.opensAt) bits.push(`Opens ${esc(shortDate(p.opensAt))}`);
  if (p.deadline) bits.push(`Closes ${esc(shortDate(p.deadline))}${p.statedDeadline ? '' : ' (check the page)'}`);
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

function render(card, participants = [], latestClick = null, now = new Date()) {
  const d = card.data || {};
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
    p.deadline ? `Closes ${shortDate(p.deadline)}` : 'No dates on file',
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

  let postText = '';
  if (threadName && user?.id) {
    try {
      const { readAsk } = await import('./track-thread.js');
      const read = await readAsk({ spaceName, threadName, userIds: [user.id] });
      if (read.ok && read.ask?.name !== evt.messageName) postText = String(read.ask?.text || '');
    } catch (err) {
      console.warn(`⚠️  Watch post read failed — code: ${codeOf(err)}`);
    }
  }

  await startWatch({
    trigger: 'mention', actor, userId: user?.id || null, spaceName, threadName, surface,
    conversationId, messageText, postText, messageName: evt.messageName, now
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

/**
 * Tracked card notifications — deliberately few
 *
 * Card changes never ping anyone: they patch the card's own message. The only
 * immediate DMs are the kinds in IMMEDIATE_KINDS. Everything else a person needs
 * to see goes into one digest DM at 08:00 in their own calendar time zone.
 *
 * A muted card is left out of both. A person Oracle has no DM with (they never
 * messaged it) cannot be DMed — their items simply wait for the digest, which
 * needs the same DM, so the card itself stays the source of truth.
 */

import * as store from '../database/tracked-cards-store.js';
import { resolvePerson, dmSpaceFor, timeZoneFor, localClock } from './people.js';
import { postMessage } from './chat-api.js';
import { cardTypeOf, allCardTypes } from './types.js';
import { button, buttonRow, decorated, paragraph, esc, clip, threadLink, mdToPlain, finalizeCards } from './render.js';

export const DIGEST_HOUR = 8;

/** The only reasons Oracle may DM someone straight away. */
export const IMMEDIATE_KINDS = Object.freeze([
  'assigned',       // you were newly assigned to a card
  'due_today',      // something you hold is due today (track card)
  'confirmation',   // an action you started is waiting for confirmation
  'due_summary',    // your "everyone" ask is past its due date: one private summary (track card)
  'watched_grant'   // hook — watched-grant updates are not built yet
]);

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

/**
 * Send one immediate DM. Refuses any kind not in IMMEDIATE_KINDS.
 * @returns {Promise<{delivered: boolean, reason?: string}>}
 */
export async function notifyImmediate(kind, { card, chatUserId, text }) {
  if (!IMMEDIATE_KINDS.includes(kind)) {
    throw new Error(`notifyImmediate: "${kind}" is not an immediate notification`);
  }

  const outcome = await (async () => {
    const participants = await store.getParticipants(card.id);
    if (participants.find(p => p.chat_user_id === chatUserId)?.muted) {
      return { delivered: false, reason: 'muted' };
    }
    const person = await resolvePerson(chatUserId, { lookupAsUserId: card.owner_user_id });
    const dm = await dmSpaceFor(person);
    if (!dm) return { delivered: false, reason: 'no_dm' };
    try {
      await postMessage({ spaceName: dm, text });
      return { delivered: true };
    } catch (err) {
      return { delivered: false, reason: `post_failed_${codeOf(err)}` };
    }
  })();

  console.log(`🔔 Tracked card notification — kind: ${kind}, delivered: ${outcome.delivered}${outcome.reason ? `, reason: ${outcome.reason}` : ''}`);
  return outcome;
}

// ============================================================================
// DIGEST
// ============================================================================

const STATUS_WORDS = { not_started: 'Not started', reviewing: 'Reviewing', done: 'Done' };

/**
 * A person's digest content: what waits on them, what they asked for, what went
 * quiet. A completed request appears in one digest only — the one dated
 * `localDate` if that digest showed it, otherwise the next one sent.
 * Card types add their own lines through `digestItems` (`extras`): more
 * "waiting on you" lines, and "needs a nudge" lines.
 */
export async function buildDigest(chatUserId, localDate = null, now = new Date()) {
  const [waiting, requests, stale] = await Promise.all([
    store.waitingOn(chatUserId),
    store.ownedBy(chatUserId, ['open'], localDate),
    store.ownedBy(chatUserId, ['stale'], localDate)
  ]);
  const extras = [];
  for (const type of allCardTypes()) {
    if (type.digestItems) extras.push(...(await type.digestItems(chatUserId, { now, localDate })));
  }
  return { waiting, requests, stale, extras };
}

export function digestIsEmpty(d) {
  return d.waiting.length === 0 && d.requests.length === 0 && d.stale.length === 0 && !(d.extras || []).length;
}

function titleLink(card) {
  const link = threadLink(card.space_name, card.thread_name);
  const title = esc(clip(mdToPlain(card.title || 'Tracked card'), 120));
  return link ? `<a href="${link}">${title}</a>` : title;
}

/**
 * The digest card. Buttons act on the underlying tracked card; `from: digest`
 * tells the click handler to answer by re-rendering this digest.
 */
export async function renderDigest(chatUserId, digest, localDate, notice = null) {
  const sections = [];
  if (notice) sections.push({ widgets: [paragraph(`<i>${esc(notice)}</i>`)] });

  const extras = digest.extras || [];
  const mute = (card) => button('Mute', { cardId: card.id, action: 'card.mute', from: 'digest' });
  const waiting = [
    ...digest.waiting.map(card => decorated({
      text: titleLink(card),
      bottom: `Your status: ${STATUS_WORDS[card.my_status] || 'Not started'}`,
      buttonSpec: mute(card)
    })),
    ...extras.filter(i => i.section === 'waiting').map(i => decorated({ text: titleLink(i.card), bottom: i.text, buttonSpec: mute(i.card) }))
  ];
  if (waiting.length) sections.push({ header: 'Waiting on you', widgets: waiting });

  const nudges = extras.filter(i => i.section === 'nudge');
  if (nudges.length) {
    sections.push({
      header: 'Needs a nudge',
      widgets: nudges.map(i => decorated({ text: titleLink(i.card), bottom: i.text, buttonSpec: mute(i.card) }))
    });
  }

  if (digest.requests.length) {
    const widgets = [];
    for (const card of digest.requests) {
      const participants = await store.getParticipants(card.id);
      const type = cardTypeOf(card);
      widgets.push(decorated({
        text: titleLink(card),
        bottom: type?.digestLine ? type.digestLine(card, participants) : null,
        buttonSpec: button('Mute', { cardId: card.id, action: 'card.mute', from: 'digest' })
      }));
    }
    sections.push({ header: 'Your open requests', widgets });
  }

  if (digest.stale.length) {
    const widgets = [];
    for (const card of digest.stale) {
      widgets.push(decorated({ text: titleLink(card), bottom: 'No activity for 30 days — still needed?' }));
      widgets.push(buttonRow([
        button('Keep', { cardId: card.id, action: 'card.keep', from: 'digest' }),
        button('Close', { cardId: card.id, action: 'card.close', from: 'digest' })
      ]));
    }
    sections.push({ header: 'Gone quiet', widgets });
  }

  if (sections.length === 0 || (notice && sections.length === 1)) {
    sections.push({ widgets: [paragraph('Nothing waiting on you.')] });
  }

  return finalizeCards([{
    cardId: `digest-${localDate}`,
    card: {
      header: { title: 'Your Oracle digest', subtitle: localDate },
      sections
    }
  }]);
}

/**
 * Send every digest that is due: 08:xx in the person's time zone, at most once
 * per local day, never empty. Returns counts; logs one line of counts.
 */
export async function sendDueDigests(now = new Date()) {
  const people = await store.digestCandidates();
  const counts = { people: people.length, sent: 0, notDue: 0, alreadySent: 0, empty: 0, noDm: 0, failed: 0 };

  for (const chatUserId of people) {
    try {
      const person = await resolvePerson(chatUserId);
      const timeZone = await timeZoneFor(person, now);
      const { date, hour } = localClock(now, timeZone);
      if (hour !== DIGEST_HOUR) { counts.notDue++; continue; }
      if (await store.digestSent(chatUserId, date)) { counts.alreadySent++; continue; }

      const digest = await buildDigest(chatUserId, date, now);
      if (digestIsEmpty(digest)) { counts.empty++; continue; }

      const dm = await dmSpaceFor(person, now);
      if (!dm) { counts.noDm++; continue; }

      // Claim the day before posting, so a retry can never send a second digest.
      if (!(await store.recordDigest(chatUserId, date))) { counts.alreadySent++; continue; }
      await postMessage({ spaceName: dm, cardsV2: await renderDigest(chatUserId, digest, date) });
      counts.sent++;
      // A completed request has now been shown once; later digests leave it out.
      await store.markCompletionShown(
        [...digest.requests, ...digest.stale].filter(c => c.completed_at).map(c => c.id), date
      );
      // Nudges are shown in one digest each.
      for (const type of allCardTypes()) {
        const items = digest.extras.filter(i => i.card.card_type === type.type);
        if (items.length && type.markDigestShown) await type.markDigestShown(items, date);
      }
    } catch (err) {
      counts.failed++;
      console.warn(`⚠️  Tracked card digest failed — code: ${codeOf(err)}`);
    }
  }

  console.log(
    `📬 Tracked card digests — people: ${counts.people}, sent: ${counts.sent}, not due: ${counts.notDue}, ` +
    `already sent: ${counts.alreadySent}, empty: ${counts.empty}, no DM: ${counts.noDm}, failed: ${counts.failed}`
  );
  return counts;
}

/**
 * Hourly, after the digests: due-date messages from card types that have them
 * (the track card's due-today DM and due-date summary). Each claims its own
 * "sent" marker first, so a repeat run sends nothing twice.
 */
export async function sendDueReminders(now = new Date()) {
  const totals = {};
  for (const type of allCardTypes()) {
    if (!type.sendDueNotices) continue;
    try {
      Object.assign(totals, await type.sendDueNotices(now));
    } catch (err) {
      console.warn(`⚠️  Due reminders failed — type: ${type.type}, code: ${codeOf(err)}`);
    }
  }
  return totals;
}

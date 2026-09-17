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
import { cardTypeOf } from './types.js';
import { button, buttonRow, decorated, paragraph, esc, clip, threadLink } from './render.js';

export const DIGEST_HOUR = 8;

/** The only reasons Oracle may DM someone straight away. */
export const IMMEDIATE_KINDS = Object.freeze([
  'assigned',       // you were newly assigned to a card
  'due_today',      // hook — no card type has due dates yet
  'confirmation',   // an action you started is waiting for confirmation
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
 */
export async function buildDigest(chatUserId, localDate = null) {
  const [waiting, requests, stale] = await Promise.all([
    store.waitingOn(chatUserId),
    store.ownedBy(chatUserId, ['open'], localDate),
    store.ownedBy(chatUserId, ['stale'], localDate)
  ]);
  return { waiting, requests, stale };
}

export function digestIsEmpty(d) {
  return d.waiting.length === 0 && d.requests.length === 0 && d.stale.length === 0;
}

function titleLink(card) {
  const link = threadLink(card.space_name, card.thread_name);
  const title = esc(clip(card.title || 'Tracked card', 120));
  return link ? `<a href="${link}">${title}</a>` : title;
}

/**
 * The digest card. Buttons act on the underlying tracked card; `from: digest`
 * tells the click handler to answer by re-rendering this digest.
 */
export async function renderDigest(chatUserId, digest, localDate, notice = null) {
  const sections = [];
  if (notice) sections.push({ widgets: [paragraph(`<i>${esc(notice)}</i>`)] });

  if (digest.waiting.length) {
    sections.push({
      header: 'Waiting on you',
      widgets: digest.waiting.map(card => decorated({
        text: titleLink(card),
        bottom: `Your status: ${STATUS_WORDS[card.my_status] || 'Not started'}`,
        buttonSpec: button('Mute', { cardId: card.id, action: 'card.mute', from: 'digest' })
      }))
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

  return [{
    cardId: `digest-${localDate}`,
    card: {
      header: { title: 'Your Oracle digest', subtitle: localDate },
      sections
    }
  }];
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

      const digest = await buildDigest(chatUserId, date);
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

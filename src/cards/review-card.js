/**
 * Review card — the first tracked card
 *
 * Trigger: an @Oracle mention asking for a review of Google Docs (any grant).
 * Oracle reads the Docs, lists the pre-check issues against the program's
 * source where one exists (the RTRI skill for RTRI), and calls track_review.
 * Everything that decides WHO and WHAT — reviewers, Docs, space, thread,
 * requester — comes from the verified Chat event, never from the model's input.
 * Oracle itself, the Chat-copy listener account and other apps are never
 * reviewers.
 *
 * The card is compact, one screen: "<client> · <program>", a status line, one
 * line per reviewer and per Doc (names only, never links or previews), at most
 * three pre-check issues (the first shown, the rest collapsed), how many client
 * items are still needed (the list collapsed), then the last update and the
 * buttons. Button labels follow the state; buttons that no longer apply are
 * disabled.
 *
 * Anyone may take a review by pressing "I'm reviewing" or "Mark my review done".
 * A press that cannot apply gets a short private reply, never silence.
 *
 * When every reviewer is done it proposes an outcome note on the matching
 * HubSpot deal through the confirmation gate; nothing is written until someone
 * confirms. After completion the card shows once in the requester's digest, and
 * closes as soon as the note is added or declined — or 7 days after completion
 * (lifecycle.js), whichever comes first.
 */

import crypto from 'crypto';
import * as store from '../database/tracked-cards-store.js';
import { getDocCommentSummary } from '../tools/google-drive.js';
import { searchGrantApplications } from '../tools/hubspot.js';
import { savePendingAction, runPendingAction, summarizeAction, declinePendingAction } from '../tools/pending-actions.js';
import { markCardReply, takeCardReply, FOUNDATION_ACTIONS } from './registry.js';
import { postMessage, patchCard } from './chat-api.js';
import { renderCard, rerenderCard, tellPresser } from './update.js';
import { notifyImmediate } from './notify.js';
import { resolvePerson, dmSpaceFor, realPeople, isListenerChatUser } from './people.js';
import { trackedCard, paragraph, button, esc, clip, threadLink, mdToPlain, textToCardHtml } from './render.js';

const MAX_DOCS = 10;
const MAX_REVIEWERS = 20;
const MAX_MISSING = 10;
const MAX_ISSUES = 3;
const ISSUE_CHARS = 100;
const MISSING_CHARS = 80;
const DOC_NAME_CHARS = 45;

/** Words that make a message an explicit review request. Anything else is asked about. */
export const REVIEW_INTENT =
  /\b(review|reviews|reviewing|proof-?read|look (?:it |them |these |this )?over|feedback on|second (?:set|pair) of eyes|sign[- ]?off)\b/i;

export const REVIEW_ACTIONS = {
  'review.reviewing': { personal: true, label: 'started reviewing' },
  'review.done': { personal: true, label: 'marked their review done' },
  'review.draft': { personal: false, label: 'asked for a client follow-up draft' },
  'review.hubspot': { personal: false, label: 'confirmed the HubSpot note' },
  'review.hubspot_decline': { personal: false, label: 'declined the HubSpot note' },
  'review.track': { personal: false, label: 'asked to track this as a review' }
};

const LABELS = { ...FOUNDATION_ACTIONS, ...REVIEW_ACTIONS };
const STATUS_WORDS = { not_started: 'Not started', reviewing: 'Reviewing', done: 'Done' };
const SOURCES = { 'rtri-tariff': 'RTRI program facts' };

/** Shown in the last-update line while slow work runs. */
const BUSY = {
  draft: 'Drafting follow-up…',
  hubspot: 'Adding note to HubSpot…',
  track: 'Setting up the review…'
};

/** HubSpot note states that still wait for someone to add or decline the note. */
const OPEN_NOTE_STATES = ['proposed', 'expired', 'failed'];
/** Note states that settle the review: the card closes. */
const SETTLED_NOTE_REASONS = { added: 'note_added', declined: 'note_declined' };

// Check marks mean "this is fine" — the pre-check lists issues only.
const CHECK_MARKS = /[✅✔☑✓]️?/gu;
const STARTS_WITH_CHECK = /^\s*(?:[-*•]\s*)?[✅✔☑✓]/u;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'someone';

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

/** Which program source a pre-check can use, if any. */
export function programSource(program) {
  return /\b(rtri|regional tariff response)\b/i.test(String(program || '')) ? 'rtri-tariff' : null;
}

/** One short plain line: no Markdown, no line breaks. */
function cleanLine(value, max) {
  if (typeof value !== 'string') return null;
  const plain = mdToPlain(value.replace(CHECK_MARKS, '')).replace(/\s+/g, ' ').trim();
  return plain ? clip(plain, max) : null;
}

/** Pre-check issues: at most three short lines; confirmations are dropped. */
export function cleanIssues(list) {
  return (Array.isArray(list) ? list : [])
    .filter(v => typeof v === 'string' && !STARTS_WITH_CHECK.test(v))
    .map(v => cleanLine(v, ISSUE_CHARS))
    .filter(Boolean)
    .slice(0, MAX_ISSUES);
}

function cleanInput(input = {}) {
  // An older prompt may still send prose; its lines are treated as a list.
  const issues = Array.isArray(input.precheck_issues)
    ? input.precheck_issues
    : typeof input.precheck === 'string' ? input.precheck.split(/\n+/) : [];
  return {
    title: cleanLine(input.title, 150),
    client: cleanLine(input.client_name, 100),
    program: cleanLine(input.program, 60),
    issues: cleanIssues(issues),
    missingInfo: (Array.isArray(input.missing_info) ? input.missing_info : [])
      .map(v => cleanLine(v, MISSING_CHARS))
      .filter(Boolean)
      .slice(0, MAX_MISSING)
  };
}

function cleanMentions(list = []) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const id = m?.chatUserId;
    if (typeof id !== 'string' || !/^users\/[^/]+$/.test(id) || id === 'users/all' || seen.has(id)) continue;
    seen.add(id);
    out.push({ chatUserId: id, displayName: m.displayName ? clip(mdToPlain(m.displayName), 80) : null });
  }
  return out;
}

/** Reviewers named earlier in the thread stay; newly @mentioned ones are added. */
function mergeReviewers(prior = [], mentioned = []) {
  const seen = new Set();
  return [...prior, ...mentioned].filter(r => r?.chatUserId && !seen.has(r.chatUserId) && seen.add(r.chatUserId));
}

function mergeDocIds(existing = [], files = []) {
  const ids = [...existing, ...files.map(f => f?.fileId)]
    .filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{10,}$/.test(id));
  return [...new Set(ids)];
}

async function readDocs(fileIds, email) {
  return Promise.all(fileIds.map(async (fileId) => {
    const s = await getDocCommentSummary(fileId, email);
    return { fileId, name: s.name, openComments: s.openComments, readable: s.readable };
  }));
}

function headerTitle(client, program, fallback) {
  return [client, program].filter(Boolean).join(' · ') || fallback || 'Document review';
}

// ============================================================================
// TOOL: track_review
// ============================================================================

/**
 * @param {Object} input - model-written: client_name, program, precheck_issues,
 *   missing_info, title
 * @param {Object} ctx - server-built: userId, conversationId, chatContext. NEVER from input.
 */
export async function trackReview(input = {}, { userId = null, conversationId = null, chatContext = {} } = {}) {
  const cc = chatContext || {};
  if (!['chat_space', 'chat_dm'].includes(cc.surface) || !cc.spaceName || !cc.threadName) {
    return { success: false, error: 'Review cards only work in a Google Chat thread. Answer normally instead.' };
  }

  const existing = await store.findLiveCard('review', cc.threadName);
  if (existing && ['open', 'stale'].includes(existing.status)) {
    return {
      success: true,
      already_tracked: true,
      message: 'This thread already has a review card, and it stays the one place for this review. Say that briefly; do not create another.'
    };
  }
  const offer = existing;   // 'offered' | 'awaiting_docs' | null
  const prior = offer?.data || {};

  const requester = offer
    ? { chatUserId: offer.owner_chat_id, userId: offer.owner_user_id, name: prior.requesterName || null }
    : { chatUserId: cc.senderChatId, userId, name: cc.senderDisplayName || null };
  if (!requester.chatUserId) {
    return { success: false, error: 'Could not tell who asked for the review. Answer normally instead.' };
  }

  const draft = cleanInput(input);
  const mentioned = cleanMentions(cc.mentions).filter(m => m.chatUserId !== requester.chatUserId);
  // Never Oracle, the Chat-copy listener account or @all (people.js).
  const reviewers = (await realPeople(mergeReviewers(prior.reviewers, mentioned), requester.userId))
    .slice(0, MAX_REVIEWERS);
  const docIds = mergeDocIds(prior.docIds, cc.driveFiles || []).slice(0, MAX_DOCS);

  const carried = {
    requesterName: requester.name,
    surface: cc.surface,
    reviewers,
    docIds,
    client: draft.client || prior.client || null,
    program: draft.program || prior.program || null
  };

  const confirmed = Boolean(offer) && (cc.trackConfirmedOfferId === offer.id || offer.status === 'awaiting_docs');
  const asked = REVIEW_INTENT.test(String(cc.messageText || ''));

  // Not clearly a review request: ask, with a button — never guess.
  if (!asked && !confirmed) {
    if (offer?.status === 'offered') {
      markCardReply(conversationId);
      return { success: true, asked: true, message: 'You already asked whether to track this as a review. Say nothing else.' };
    }
    const row = offer
      ? await store.updateCard(offer.id, { status: 'offered', data: { ...prior, ...carried }, lastActivityAt: new Date() })
      : await store.insertCard({
        cardType: 'review', status: 'offered',
        spaceName: cc.spaceName, threadName: cc.threadName, sourceMessageName: cc.messageName || null,
        conversationId, ownerChatId: requester.chatUserId, ownerUserId: requester.userId,
        title: headerTitle(carried.client, carried.program, draft.title), data: carried
      });
    if (!row) {
      return { success: true, already_tracked: true, message: 'This thread already has a review card. Say that briefly.' };
    }
    const messageName = await postMessage({
      spaceName: cc.spaceName, threadName: cc.threadName, cardsV2: await renderCard(row)
    });
    await store.updateCard(row.id, { messageName });
    markCardReply(conversationId);
    console.log('🗂️  Review card offered — reason: intent_unclear');
    return { success: true, asked: true, message: 'Posted a "Track this as a review?" card with a button. Say nothing else.' };
  }

  // Missing pieces: ask in plain words and remember what we have.
  const missing = docIds.length === 0 ? 'docs' : reviewers.length === 0 ? 'reviewers' : null;
  if (missing) {
    if (offer) {
      await store.updateCard(offer.id, { status: 'awaiting_docs', data: { ...prior, ...carried }, lastActivityAt: new Date() });
    } else {
      await store.insertCard({
        cardType: 'review', status: 'awaiting_docs',
        spaceName: cc.spaceName, threadName: cc.threadName, sourceMessageName: cc.messageName || null,
        conversationId, ownerChatId: requester.chatUserId, ownerUserId: requester.userId,
        title: headerTitle(carried.client, carried.program, draft.title), data: carried
      });
    }
    console.log(`🗂️  Review card waiting — reason: needs_${missing}`);
    return missing === 'docs'
      ? { success: false, needs_docs: true, message: 'This request has no Google Doc links. Ask which Docs should be reviewed — they can reply in this thread with the links and @mention you. Do not create anything else.' }
      : { success: false, needs_reviewers: true, message: 'Nobody who can review was @mentioned (you and the listener account do not count). Ask exactly: "Who should review this?" — they can reply in this thread @mentioning the reviewers and you. Do not create anything else.' };
  }

  // Build the card.
  const requesterPerson = await resolvePerson(requester.chatUserId, {
    displayName: requester.name, userId: requester.userId, lookupAsUserId: requester.userId
  });
  const docs = await readDocs(docIds, requesterPerson?.email || null);
  const source = programSource(carried.program);
  const title = headerTitle(carried.client, carried.program, draft.title || offer?.title);
  const data = {
    ...carried,
    requesterName: requester.name || requesterPerson?.display_name || null,
    docs,
    precheck: { source, issues: source ? draft.issues : [] },
    missingInfo: draft.missingInfo.length ? draft.missingInfo : (prior.missingInfo || []),
    hubspot: { state: 'none' },
    busy: null,
    notice: null
  };

  let card = offer
    ? await store.updateCard(offer.id, {
      status: 'open', title, data, lastActivityAt: new Date(),
      conversationId: offer.conversation_id || conversationId
    })
    : await store.insertCard({
      cardType: 'review', status: 'open',
      spaceName: cc.spaceName, threadName: cc.threadName, sourceMessageName: cc.messageName || null,
      conversationId, ownerChatId: requester.chatUserId, ownerUserId: requester.userId, title, data
    });
  if (!card) {
    return { success: true, already_tracked: true, message: 'This thread already has a review card. Say that briefly.' };
  }

  await store.addParticipants(card.id, [
    { chatUserId: requester.chatUserId, role: 'owner', displayName: data.requesterName },
    ...reviewers.map(r => ({ chatUserId: r.chatUserId, role: 'reviewer', displayName: r.displayName }))
  ]);

  const cardsV2 = await renderCard(card);
  if (card.message_name) {
    await patchCard(card.message_name, cardsV2);   // the offer card becomes the review card
  } else {
    const messageName = await postMessage({ spaceName: card.space_name, threadName: card.thread_name, cardsV2 });
    card = await store.updateCard(card.id, { messageName });
  }

  const link = threadLink(card.space_name, card.thread_name);
  for (const r of reviewers) {
    const sent = await notifyImmediate('assigned', {
      card,
      chatUserId: r.chatUserId,
      text: `${data.requesterName || 'A teammate'} asked you to review ${title}.${link ? ` ${link}` : ''}`
    });
    if (sent.delivered) await store.markAssignedNotified(card.id, r.chatUserId);
  }

  markCardReply(conversationId);
  console.log(`🗂️  Review card posted — reviewers: ${reviewers.length}, docs: ${docs.length}, unreadable docs: ${docs.filter(d => !d.readable).length}, pre-check issues: ${source ? draft.issues.length : 'no_source'}`);
  return { success: true, card_posted: true, message: 'The review card is posted in this thread. Do not add any other reply.' };
}

// ============================================================================
// RENDER
// ============================================================================

/** The outcome of the latest slow action, shown only until someone presses again. */
function outcomeFor(d, latestClick) {
  const n = d.notice;
  if (!n) return null;
  if (typeof n === 'string') return n;   // cards written before outcomes carried a time
  if (latestClick && new Date(n.at) < new Date(latestClick.created_at)) return null;
  return n.text || null;
}

function busyFor(d) {
  if (d.busy?.text) return d.busy;
  if (d.settingUp) return { text: BUSY.track };   // cards written before busy states
  return null;
}

function offerCard(card, latestClick) {
  const d = card.data || {};
  const expired = card.status === 'closed';
  const busy = expired ? null : busyFor(d);
  const text = expired
    ? 'Not tracked. @mention me with the Docs and reviewers to set up a review.'
    : 'I can keep one card here with each reviewer’s status, open comments on the Docs, and a pre-check. Nothing is tracked unless you ask.';
  return trackedCard({
    card,
    title: 'Track this as a review?',
    subtitle: '',
    sections: [{ widgets: [paragraph(text)] }],
    buttons: [busy
      ? button('Setting up…', { cardId: card.id, action: 'review.track' }, { disabled: true })
      : button('Track as review', { cardId: card.id, action: 'review.track' })],
    latestClick,
    labels: LABELS,
    busy,
    outcome: busy ? null : outcomeFor(d, latestClick)
  });
}

function noteState(hs = {}) {
  return hs.state === 'needs_hub_user' ? 'proposed' : hs.state;   // older cards
}

function hubspotLine(hs = {}) {
  const deal = hs.dealName ? `“${hs.dealName}”` : 'the matching deal';
  switch (noteState(hs)) {
    case 'proposed': return `HubSpot: outcome note ready for ${deal} — add it below, or reply “@Oracle yes”.`;
    case 'expired': return `HubSpot: the note for ${deal} was not confirmed in time — add it below.`;
    case 'failed': return `HubSpot: the note for ${deal} could not be added — try again.`;
    case 'added': return `HubSpot: outcome note added to ${deal}.`;
    case 'declined': return `HubSpot: note for ${deal} declined — nothing recorded.`;
    case 'no_match': return 'HubSpot: no matching deal — outcome not recorded.';
    case 'ambiguous': return `HubSpot: ${plural(hs.count || 0, 'possible deal')} — outcome not recorded.`;
    default: return null;
  }
}

/** Issues to show: structured, or (older cards) the prose's lines. */
function precheckIssues(pc = {}) {
  if (Array.isArray(pc.issues)) return cleanIssues(pc.issues);
  if (typeof pc.text === 'string') return cleanIssues(pc.text.split(/\n+/));
  return [];
}

function reviewButtons(card, reviewers, d) {
  const id = card.id;
  const done = reviewers.filter(r => r.status === 'done');
  const reviewing = reviewers.filter(r => r.status === 'reviewing');
  const complete = reviewers.length > 0 && done.length === reviewers.length;

  // Everyone sees the same card: labels name the one person when there is one,
  // and count otherwise.
  const reviewingLabel = complete || reviewing.length === 0
    ? 'I’m reviewing'
    : reviewing.length === 1 ? `Reviewing · ${firstName(reviewing[0].display_name)}` : `Reviewing · ${reviewing.length}`;
  const doneLabel = done.length === 0
    ? 'Mark my review done'
    : done.length === 1 && (complete || reviewers.length > 1)
      ? `Done ✓ · ${firstName(done[0].display_name)}`
      : complete ? `All ${done.length} done ✓` : `Done ✓ · ${done.length} of ${reviewers.length}`;

  const busy = d.busy?.kind;
  const buttons = [
    button(reviewingLabel, { cardId: id, action: 'review.reviewing' }, { disabled: complete }),
    button(doneLabel, { cardId: id, action: 'review.done' }, { disabled: complete }),
    busy === 'draft'
      ? button('Drafting…', { cardId: id, action: 'review.draft' }, { disabled: true })
      : button('Draft client follow-up', { cardId: id, action: 'review.draft' })
  ];
  if (OPEN_NOTE_STATES.includes(noteState(d.hubspot))) {
    if (busy === 'hubspot') {
      buttons.push(button('Adding note…', { cardId: id, action: 'review.hubspot' }, { disabled: true }));
    } else {
      buttons.push(button('Add note to HubSpot', { cardId: id, action: 'review.hubspot' }));
      buttons.push(button('Don’t add note', { cardId: id, action: 'review.hubspot_decline' }));
    }
  }
  return buttons;
}

function render(card, participants = [], latestClick = null) {
  if (card.status === 'offered' || card.status === 'awaiting_docs' || card.closed_reason === 'offer_expired') {
    return offerCard(card, latestClick);
  }

  const d = card.data || {};
  const reviewers = participants.filter(p => p.role === 'reviewer');
  const done = reviewers.filter(p => p.status === 'done').length;
  const complete = reviewers.length > 0 && done === reviewers.length;
  const docs = d.docs || [];
  const openTotal = docs.reduce((n, doc) => n + (doc.openComments || 0), 0);

  const sections = [];

  const status = `${complete ? '<b>Review complete</b> · ' : ''}${done} of ${plural(reviewers.length, 'review')} done · ${plural(openTotal, 'open comment')}`;
  const hs = hubspotLine(d.hubspot);
  sections.push({ widgets: [paragraph(hs ? `${status}<br>${esc(hs)}` : status)] });

  sections.push({
    header: 'Reviewers',
    widgets: [paragraph(reviewers.length
      ? reviewers.map(r => `${esc(mdToPlain(r.display_name || 'Reviewer'))} · ${STATUS_WORDS[r.status] || STATUS_WORDS.not_started}`).join('<br>')
      : 'Nobody yet — press <b>I’m reviewing</b> to take it.')]
  });

  if (docs.length) {
    sections.push({
      header: 'Documents',
      widgets: [paragraph(docs.map(doc => {
        const name = esc(clip(mdToPlain(doc.name || 'Untitled document'), DOC_NAME_CHARS));
        const count = doc.readable === false ? 'can’t read comments' : plural(doc.openComments || 0, 'comment');
        return `${name} · ${count}`;
      }).join('<br>'))]
    });
  }

  const source = d.precheck?.source;
  const issues = source ? precheckIssues(d.precheck) : [];
  if (!source) {
    sections.push({ header: 'Pre-check', widgets: [paragraph('No program source on file — pre-check skipped.')] });
  } else if (issues.length === 0) {
    sections.push({ header: `Pre-check · ${SOURCES[source] || source}`, widgets: [paragraph('No issues found.')] });
  } else {
    sections.push({
      header: `Pre-check · ${SOURCES[source] || source} · ${plural(issues.length, 'issue')}`,
      collapsible: true,
      shown: 1,
      widgets: issues.map(issue => paragraph(`• ${textToCardHtml(issue)}`))
    });
  }

  const missing = (d.missingInfo || []).map(item => cleanLine(item, MISSING_CHARS)).filter(Boolean);
  if (missing.length) {
    sections.push({
      header: 'Missing client info',
      collapsible: true,
      shown: 1,
      widgets: [
        paragraph(`${plural(missing.length, 'item')} still needed`),
        paragraph(missing.map(item => `• ${textToCardHtml(item)}`).join('<br>'))
      ]
    });
  }

  return trackedCard({
    card,
    title: card.title || headerTitle(d.client, d.program),
    subtitle: `Review · requested by ${d.requesterName || 'a teammate'}`,
    sections,
    buttons: reviewButtons(card, reviewers, d),
    latestClick,
    labels: LABELS,
    busy: busyFor(d),
    outcome: outcomeFor(d, latestClick)
  });
}

function digestLine(card, participants = []) {
  const reviewers = participants.filter(p => p.role === 'reviewer');
  const done = reviewers.filter(p => p.status === 'done').length;
  const open = (card.data?.docs || []).reduce((n, doc) => n + (doc.openComments || 0), 0);
  if (card.completed_at) {
    const note = OPEN_NOTE_STATES.includes(noteState(card.data?.hubspot)) ? ' · HubSpot note waiting for you' : '';
    return `Review complete · ${plural(open, 'open comment')}${note}`;
  }
  return `${done}/${reviewers.length} reviews done · ${plural(open, 'open comment')}`;
}

// ============================================================================
// BUTTONS — fast: database only. Slow work is returned as `background`.
// ============================================================================

/** Merge fields into a card's data, re-reading it first. */
async function updateData(cardId, patch, fields = {}) {
  const fresh = await store.getCard(cardId);
  if (!fresh) return null;
  return store.updateCard(cardId, { data: { ...(fresh.data || {}), ...patch }, ...fields });
}

const setBusy = (cardId, kind, actor, now) =>
  updateData(cardId, { busy: { kind, text: BUSY[kind], by: actor.name || null, at: now.toISOString() }, notice: null });

const finish = (cardId, text) =>
  updateData(cardId, { busy: null, notice: text ? { text, at: new Date().toISOString() } : null });

async function handleAction({ card, actor, action, now = new Date() }) {
  const live = ['open', 'stale'].includes(card.status);
  const d = card.data || {};

  switch (action) {
    case 'review.reviewing':
    case 'review.done': {
      if (!live) return { changed: false, ignored: 'not_open', reply: 'This review isn’t open any more, so nothing changed.' };
      const status = action === 'review.done' ? 'done' : 'reviewing';
      // Personal: only the presser's own row moves. Someone not on the card
      // takes the review by pressing.
      let moved = await store.setReviewerStatus(card.id, actor.chatUserId, status, now);
      let claimed = false;
      if (!moved) {
        if (await isListenerChatUser(actor)) {
          return { changed: false, ignored: 'listener_account', reply: 'This account can’t take a review.' };
        }
        await store.addParticipants(card.id, [{ chatUserId: actor.chatUserId, role: 'reviewer', displayName: actor.name }]);
        moved = await store.setReviewerStatus(card.id, actor.chatUserId, status, now);
        claimed = moved;
      }
      if (!moved) return { changed: false, ignored: 'not_a_reviewer', reply: 'Couldn’t add you to this review — try again.' };

      if (status === 'done' && !card.completed_at) {
        const reviewers = (await store.getParticipants(card.id)).filter(p => p.role === 'reviewer');
        if (reviewers.length && reviewers.every(p => p.status === 'done')) {
          await store.updateCard(card.id, { completedAt: now });
          return { changed: true, claimed, background: () => proposeOutcomeNote(card.id) };
        }
      }
      return { changed: true, claimed };
    }

    case 'review.draft':
      if (!live) return { changed: false, ignored: 'not_open', reply: 'This review is closed, so there’s nothing to draft from.' };
      if (d.busy?.kind === 'draft') return { changed: false, ignored: 'already_running', reply: 'A follow-up draft is already being written.' };
      await setBusy(card.id, 'draft', actor, now);
      return { changed: true, background: () => draftFollowUp(card.id, actor) };

    case 'review.hubspot':
      if (!live || !OPEN_NOTE_STATES.includes(noteState(d.hubspot))) {
        return { changed: false, ignored: 'nothing_to_confirm', reply: 'There’s no HubSpot note waiting on this card.' };
      }
      if (d.busy?.kind === 'hubspot') return { changed: false, ignored: 'already_running', reply: 'The note is already being added.' };
      await setBusy(card.id, 'hubspot', actor, now);
      return { changed: true, background: () => confirmOutcomeNote(card.id, actor) };

    // Declining closes the card, so — like Close — only the requester may.
    case 'review.hubspot_decline': {
      const hs = d.hubspot || {};
      if (!live || !OPEN_NOTE_STATES.includes(noteState(hs))) {
        return { changed: false, ignored: 'nothing_to_confirm', reply: 'There’s no HubSpot note waiting on this card.' };
      }
      if (actor.chatUserId !== card.owner_chat_id) {
        return { changed: false, ignored: 'not_the_owner', reply: 'Only the requester can decline the note.' };
      }
      if (hs.pendingActionId) {
        await declinePendingAction({ actionId: hs.pendingActionId, chatUserId: actor.chatUserId });
      }
      await settleNote(card.id, { ...hs, state: 'declined' }, now);
      return { changed: true };
    }

    case 'review.track':
      if (card.status !== 'offered') {
        return { changed: false, ignored: 'not_an_open_offer', reply: 'This request is already being tracked.' };
      }
      if (busyFor(d)) return { changed: false, ignored: 'already_running', reply: 'The review is already being set up.' };
      await setBusy(card.id, 'track', actor, now);
      return { changed: true, background: () => trackFromOffer(card.id, actor) };

    default:
      return { changed: false, ignored: 'unknown_action', reply: 'That button doesn’t do anything on this card.' };
  }
}

// ============================================================================
// REAL SOURCES
// ============================================================================

function hubspotStateFrom(gate, hs) {
  if (gate?.status === 'confirmed') return gate.result?.success === false ? 'failed' : 'added';
  if (gate?.status === 'failed') return 'failed';
  if (gate?.status === 'declined') return 'declined';
  if (gate?.status === 'pending' && new Date(gate.expires_at) > new Date()) return noteState(hs);
  // Expired, superseded or gone: the button stores it again.
  return noteState(hs) === 'proposed' ? 'expired' : noteState(hs);
}

/**
 * Record the note's state; an added or declined note settles the review and
 * closes the card (frozen, still readable).
 */
async function settleNote(cardId, hubspot, now = new Date()) {
  await updateData(cardId, { hubspot, busy: null, notice: null });
  const reason = SETTLED_NOTE_REASONS[hubspot.state];
  if (reason) await store.closeCard(cardId, reason, now);
}

async function refresh(card) {
  if (!['open', 'stale'].includes(card.status)) return { changed: false };
  const d = card.data || {};
  let changed = false;

  const owner = await resolvePerson(card.owner_chat_id, {
    userId: card.owner_user_id, lookupAsUserId: card.owner_user_id
  });
  const docs = [];
  for (const doc of d.docs || []) {
    const fresh = await getDocCommentSummary(doc.fileId, owner?.email || null);
    const next = fresh.readable
      ? { fileId: doc.fileId, name: fresh.name || doc.name, openComments: fresh.openComments, readable: true }
      : { ...doc, readable: false };
    if (next.openComments !== doc.openComments || next.readable !== doc.readable || next.name !== doc.name) changed = true;
    docs.push(next);
  }

  let hubspot = { ...(d.hubspot || { state: 'none' }), state: noteState(d.hubspot) || 'none' };
  if (OPEN_NOTE_STATES.includes(hubspot.state) && hubspot.pendingActionId) {
    const state = hubspotStateFrom(await store.pendingActionState(hubspot.pendingActionId), hubspot);
    if (state !== hubspot.state) {
      hubspot = { ...hubspot, state };
      changed = true;
    }
  }

  // Only what this refresh owns is written, so a press made meanwhile keeps its changes.
  const updated = await updateData(card.id, { docs, hubspot }, { lastRefreshedAt: new Date() });
  // Settled elsewhere (e.g. "@Oracle yes" in the thread): close now.
  const reason = SETTLED_NOTE_REASONS[hubspot.state];
  if (reason) await store.closeCard(card.id, reason);
  return { changed, card: updated || card };
}

// ============================================================================
// BACKGROUND WORK (after the press has been answered)
// ============================================================================

function programKey(program) {
  return String(program || '').toLowerCase().match(/[a-z0-9]{3,}/)?.[0] || null;
}

async function findDeals(client, program) {
  if (!client) return [];
  let res = await searchGrantApplications({ company_name: client, limit: 10 });
  let apps = res?.success ? res.applications || [] : [];
  if (apps.length === 0) {
    res = await searchGrantApplications({ deal_name: client, limit: 10 });
    apps = res?.success ? res.applications || [] : [];
  }
  const key = programKey(program);
  if (key && apps.length > 1) {
    const narrowed = apps.filter(a => `${a.program || ''} ${a.name || ''}`.toLowerCase().includes(key));
    if (narrowed.length) apps = narrowed;
  }
  return apps;
}

/** All reviews done: propose (never write) an outcome note on the one matching deal. */
export async function proposeOutcomeNote(cardId) {
  const card = await store.getCard(cardId);
  if (!card) return;
  const d = card.data || {};
  let hubspot;

  try {
    const deals = await findDeals(d.client, d.program);
    if (deals.length !== 1 || !card.conversation_id) {
      hubspot = { state: deals.length > 1 ? 'ambiguous' : 'no_match', count: deals.length };
    } else {
      const deal = deals[0];
      const participants = await store.getParticipants(cardId);
      const names = participants.filter(p => p.role === 'reviewer').map(p => p.display_name || 'a reviewer');
      const open = (d.docs || []).reduce((n, doc) => n + (doc.openComments || 0), 0);
      const input = {
        deal_id: String(deal.id),
        deal_name: deal.name || null,
        body: [
          `Review complete (tracked by Oracle in Google Chat): ${card.title}.`,
          `Reviewers: ${names.join(', ')}.`,
          `Open comments at completion: ${open} across ${plural((d.docs || []).length, 'document')}.`
        ].join('\n')
      };
      const summary = summarizeAction('create_hubspot_note', input);
      const saved = await savePendingAction({
        conversationId: card.conversation_id,
        toolName: 'create_hubspot_note',
        input,
        userId: card.owner_user_id,
        summary
      });
      hubspot = { state: 'proposed', dealId: input.deal_id, dealName: input.deal_name, pendingActionId: saved.id, summary, input };

      const link = threadLink(card.space_name, card.thread_name);
      await notifyImmediate('confirmation', {
        card,
        chatUserId: card.owner_chat_id,
        text: `All reviews are done for ${card.title}. A HubSpot note is ready to add to "${input.deal_name || input.deal_id}" — confirm it on the card.${link ? ` ${link}` : ''}`
      });
    }
  } catch (err) {
    console.warn(`⚠️  Review outcome note not proposed — code: ${codeOf(err)}`);
    hubspot = { state: 'no_match', count: 0 };
  }

  await updateData(cardId, { hubspot });
  console.log(`🗂️  Review complete — HubSpot: ${hubspot.state}`);
}

/** The "Add note to HubSpot" button: run the stored proposal as this person's confirmation. */
export async function confirmOutcomeNote(cardId, actor) {
  const card = await store.getCard(cardId);
  if (!card || !['open', 'stale'].includes(card.status)) return;   // e.g. declined meanwhile
  const hs = { ...(card.data?.hubspot || {}), state: noteState(card.data?.hubspot) };
  const person = await resolvePerson(actor.chatUserId, {
    email: actor.email, displayName: actor.name, lookupAsUserId: card.owner_user_id
  });

  if (!person?.user_id) {
    await finish(cardId, null);
    await tellPresser(card, actor, 'Only someone signed in to the Hub can add the HubSpot note.');
    console.log('🗂️  Review HubSpot note — result: no_hub_user');
    return;
  }

  let next;
  if (!hs.input || !card.conversation_id) {
    next = { ...hs, state: 'failed' };
  } else {
    let actionId = hs.pendingActionId;
    const gate = await store.pendingActionState(actionId);

    if (gate?.status === 'confirmed' && gate.result?.success !== false) {
      next = { ...hs, state: 'added' };   // someone already confirmed with "yes"
    } else if (gate?.status === 'declined') {
      next = { ...hs, state: 'declined' };
    } else {
      if (!(gate?.status === 'pending' && new Date(gate.expires_at) > new Date())) {
        // Expired, superseded or failed: store the identical action again; this
        // press is the confirmation of exactly what the card shows.
        const saved = await savePendingAction({
          conversationId: card.conversation_id,
          toolName: 'create_hubspot_note',
          input: hs.input,
          userId: person.user_id,
          summary: hs.summary || summarizeAction('create_hubspot_note', hs.input)
        });
        actionId = saved.id;
      }
      const run = await runPendingAction({ actionId, userId: person.user_id });
      next = run?.ok && run.result?.success !== false
        ? { ...hs, state: 'added', pendingActionId: actionId }
        : { ...hs, state: 'failed', pendingActionId: actionId };
    }
  }

  await settleNote(cardId, next);
  console.log(`🗂️  Review HubSpot note — result: ${next.state}`);
}

/**
 * Draft a client follow-up and send it privately to whoever asked. Nothing goes
 * to the client. Runs as the presser's own Hub account and never as anyone
 * else's: the drafting run still has Oracle's tools, so a press must not borrow
 * the requester's access.
 */
export async function draftFollowUp(cardId, actor) {
  const card = await store.getCard(cardId);
  if (!card) return;
  const d = card.data || {};
  const person = await resolvePerson(actor.chatUserId, {
    email: actor.email, displayName: actor.name, lookupAsUserId: card.owner_user_id
  });
  const runAs = person?.user_id || null;
  if (!runAs) {
    console.log('🗂️  Review follow-up draft not started — reason: no_hub_user');
    await finish(cardId, null);
    await tellPresser(card, actor, 'Only someone signed in to the Hub can draft a follow-up.');
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
    await createConversation(conversationId, runAs, 'internal-oracle', 'Draft client follow-up');

    const open = (d.docs || []).reduce((n, doc) => n + (doc.openComments || 0), 0);
    const message = [
      'Draft a short follow-up email to the client about their grant application review.',
      'This is a DRAFT for a Granted teammate to edit and send themselves. Do not send anything, do not create or change any records, and do not use any tools.',
      `Client: ${d.client || 'not recorded'}`,
      `Program: ${d.program || 'not recorded'}`,
      d.missingInfo?.length
        ? `Information still needed from the client:\n- ${d.missingInfo.join('\n- ')}`
        : 'No missing client information was recorded.',
      `Open reviewer comments in the documents: ${open}.`,
      'Reply with the email only: a subject line, then a short body.'
    ].join('\n\n');

    const result = await runAgent({
      agentType: 'internal-oracle', message, conversationId, userId: runAs,
      sessionId: crypto.randomUUID(), res: null
    });
    const text = (result?.response?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!result?.success || !text) throw Object.assign(new Error('no draft'), { code: 'no_draft' });

    const body = clip(`Draft client follow-up for ${card.title} — not sent:\n\n${text}`, 3500);
    const dm = await dmSpaceFor(person);
    if (dm) {
      await postMessage({ spaceName: dm, text: body });
      outcome = `sent to ${actor.name || 'them'} by DM`;
    } else {
      await postMessage({ spaceName: card.space_name, threadName: card.thread_name, text: body });
      outcome = 'posted in this thread (no DM with Oracle yet)';
    }
  } catch (err) {
    console.warn(`⚠️  Review follow-up draft failed — code: ${codeOf(err)}`);
    outcome = 'couldn’t draft it — try again';
  }

  await finish(cardId, outcome);
}

/** The offer card's "Track as review" button: Oracle writes the pre-check, then track_review. */
export async function trackFromOffer(cardId, actor) {
  const card = await store.getCard(cardId);
  if (!card || card.status !== 'offered') return;
  const d = card.data || {};
  const person = await resolvePerson(actor.chatUserId, {
    email: actor.email, displayName: actor.name, lookupAsUserId: card.owner_user_id
  });

  if (!person?.user_id) {
    await updateData(cardId, { busy: null, settingUp: false });
    await tellPresser(card, actor, 'Only someone signed in to the Hub can start tracking.');
    return;
  }

  if (card.conversation_id) {
    try {
      const { runAgent } = await import('../claude/client.js');
      await runAgent({
        agentType: 'internal-oracle',
        message: [
          'Yes — track the review request earlier in this thread as a review card.',
          'Follow the tracked-card instructions: read the linked Docs, list the pre-check issues and the missing client information, then call track_review.',
          d.docIds?.length ? `Linked Google Doc ids: ${d.docIds.join(', ')}` : ''
        ].filter(Boolean).join('\n'),
        conversationId: card.conversation_id,
        userId: person.user_id,
        sessionId: crypto.randomUUID(),
        res: null,
        chatContext: {
          surface: d.surface || 'chat_space',
          spaceName: card.space_name,
          spaceDisplayName: null,
          senderChatId: actor.chatUserId,
          senderDisplayName: actor.name || null,
          messageName: card.source_message_name,
          threadName: card.thread_name,
          mentions: [],
          driveFiles: [],
          messageText: '',
          trackConfirmedOfferId: card.id
        }
      });
    } catch (err) {
      console.warn(`⚠️  Review offer setup failed — code: ${codeOf(err)}`);
    } finally {
      takeCardReply(card.conversation_id);
    }
  }

  const after = await store.getCard(cardId);
  if (after?.status === 'offered') {
    await updateData(cardId, {
      busy: null,
      settingUp: false,
      notice: { text: 'couldn’t set up the review — @mention me to try again', at: new Date().toISOString() }
    });
  }
}

// ============================================================================

export const reviewCard = {
  type: 'review',
  actions: REVIEW_ACTIONS,
  render,
  handleAction,
  refresh,
  digestLine
};

export { rerenderCard };

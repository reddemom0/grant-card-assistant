/**
 * The intro card — what a space sees when Oracle arrives
 *
 * One card, posted once per space: who Oracle is, what it can do *in that
 * space* (each line naming the command that starts it), what to DM it about,
 * and what is worth knowing before using it. It replaces both the plain-text
 * intro and the listening notice, so a space is told about the stored copy in
 * the same card that explains everything else.
 *
 * Posted once, not once per event: `space_intros` (migration 034) is claimed
 * before posting and given back if the post fails, which is also what keeps
 * listening's "refuse to start until members were told" guarantee intact.
 *
 * The wording lives in data/chat/space-guides.json, per space, so changing it
 * needs no deploy of code.
 *
 * `/help` (or "@Oracle help") shows the same card as a private reply, with the
 * example prompts already in it.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import * as store from '../database/tracked-cards-store.js';
import { FOUNDATION_ACTIONS } from './registry.js';
import { postMessage } from './chat-api.js';
import { finalizeCards, paragraph, button, esc, clip, mdToPlain } from './render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_LINES = 4;
const MAX_EXAMPLES = 6;
/** The synthetic thread the space's intro card lives under. */
export const introThreadName = (spaceName) => `${spaceName}/threads/intro`;

export const INTRO_ACTIONS = {
  'intro.examples': { personal: true, label: 'asked for example prompts' }
};

const LABELS = { ...FOUNDATION_ACTIONS, ...INTRO_ACTIONS };

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

// ============================================================================
// THE WORDING
// ============================================================================

let guides = null;

function load() {
  if (guides) return guides;
  const empty = { guideUrl: null, privately: [], goodToKnow: [], listeningNote: null, generic: { can: [], examples: [] }, dm: { can: [], examples: [] }, byName: new Map() };
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, '../../data/chat/space-guides.json'), 'utf8'));
    guides = {
      guideUrl: raw.guideUrl || null,
      privately: Array.isArray(raw.privately) ? raw.privately : [],
      goodToKnow: Array.isArray(raw.goodToKnow) ? raw.goodToKnow : [],
      listeningNote: raw.listeningNote || null,
      generic: raw.generic || { can: [], examples: [] },
      dm: raw.dm || { can: [], examples: [] },
      byName: new Map(Object.entries(raw.spaces || {}).map(([name, entry]) => [name.trim().toLowerCase(), entry]))
    };
  } catch (err) {
    console.warn(`⚠️  Space guides file unreadable — code: ${codeOf(err)}`);
    guides = empty;
  }
  return guides;
}

/**
 * What the card says here.
 * @param {Object} p
 * @param {string} [p.displayName] - the space's display name
 * @param {boolean} [p.isDm]
 * @param {boolean} [p.listening] - Oracle keeps a copy of this space
 */
export function introContent({ displayName = null, isDm = false, listening = false } = {}) {
  const g = load();
  const specific = !isDm && displayName ? g.byName.get(String(displayName).trim().toLowerCase()) : null;
  const entry = isDm ? g.dm : (specific || g.generic);
  return {
    where: isDm ? 'this DM' : (displayName ? String(displayName) : 'this space'),
    specific: Boolean(specific),
    can: (entry.can || []).slice(0, MAX_LINES),
    examples: (entry.examples || []).slice(0, MAX_EXAMPLES),
    privately: isDm ? [] : g.privately,
    goodToKnow: [
      ...(listening && g.listeningNote ? [g.listeningNote] : []),
      ...g.goodToKnow.filter(line => !(listening && /only see messages where I'm @mentioned/i.test(line)))
    ],
    guideUrl: g.guideUrl
  };
}

/** The examples, as the private reply the card's button sends. */
export function examplesText(content) {
  if (!content.examples.length) return 'I don’t have example prompts on file for this space yet.';
  return ['Copy any of these into the thread:', ...content.examples.map(e => `• ${e}`)].join('\n');
}

// ============================================================================
// THE CARD
// ============================================================================

const bullets = (lines) => lines.map(line => `• ${esc(mdToPlain(line))}`).join('<br>');

/** A button that opens a link — no callback, so it needs no card behind it. */
function linkButton(text, url) {
  return { text, onClick: { openLink: { url } } };
}

/**
 * The intro card's cardsV2.
 * @param {Object} content - introContent() result
 * @param {Object} [opts]
 * @param {string} [opts.cardId] - a tracked card to hang the examples button on
 * @param {boolean} [opts.withExamples] - print the examples instead of a button
 */
export function introCardV2(content, { cardId = null, withExamples = false } = {}) {
  const sections = [];
  if (content.can.length) sections.push({ header: `What I can do in ${clip(content.where, 60)}`, widgets: [paragraph(bullets(content.can))] });
  if (content.privately.length) sections.push({ header: 'Privately (DM me)', widgets: [paragraph(bullets(content.privately))] });
  if (content.goodToKnow.length) sections.push({ header: 'Good to know', widgets: [paragraph(bullets(content.goodToKnow))] });
  if (withExamples && content.examples.length) {
    sections.push({ header: 'Try one of these', widgets: [paragraph(content.examples.map(e => `• ${esc(e)}`).join('<br>'))] });
  }

  const buttons = [];
  if (content.guideUrl) buttons.push(linkButton('Open the Oracle guide', content.guideUrl));
  if (!withExamples && cardId && content.examples.length) {
    buttons.push(button('Show example prompts', { cardId, action: 'intro.examples' }));
  }
  if (buttons.length) sections.push({ widgets: [{ buttonList: { buttons } }] });

  return finalizeCards([{
    cardId: 'oracle-intro',
    card: {
      header: {
        title: 'Hi, I’m Oracle',
        subtitle: clip(`Granted’s assistant — now in ${content.where}`, 200)
      },
      sections
    }
  }]);
}

// ============================================================================
// POSTING IT ONCE
// ============================================================================

/**
 * Post the intro card in a space, once and only once.
 *
 * Returns true when the space has its intro — whether this call posted it or an
 * earlier one did — and false only when posting was tried and failed. Listening
 * relies on that: a false answer pauses the space with `notice_failed` rather
 * than reading messages nobody was told about.
 *
 * @param {Object} p
 * @param {string} p.spaceName
 * @param {string} [p.displayName]
 * @param {boolean} [p.listening]
 * @param {boolean} [p.isDm]
 * @returns {Promise<boolean>}
 */
export async function postIntro({ spaceName, displayName = null, listening = false, isDm = false } = {}) {
  if (!spaceName) return false;
  const kind = isDm ? 'dm' : 'space';

  let claimed;
  try {
    claimed = await store.claimSpaceIntro(spaceName, kind);
  } catch (err) {
    console.warn(`⚠️  Intro claim failed — code: ${codeOf(err)}`);
    return false;
  }
  if (!claimed) {
    console.log(`👋 Intro already posted — kind: ${kind}`);
    return true;
  }

  const content = introContent({ displayName, isDm, listening });
  try {
    // A tracked card row is what the "Show example prompts" button hangs on: it
    // has no participants and never goes stale, so it appears in nobody's
    // digest and nothing ever expires it.
    const row = await store.insertCard({
      cardType: 'intro', status: 'open', spaceName, threadName: introThreadName(spaceName),
      conversationId: null, ownerChatId: 'oracle', ownerUserId: null,
      title: 'Hi, I’m Oracle',
      data: { displayName, isDm, listening, kind }
    });
    const cardsV2 = introCardV2(content, { cardId: row?.id || null });
    const messageName = await postMessage({ spaceName, cardsV2 });
    if (row) await store.updateCard(row.id, { messageName });
    await store.setSpaceIntroMessage(spaceName, messageName);
    console.log(`👋 Intro card posted — kind: ${kind}, tailored: ${content.specific}, listening: ${listening}`);
    return true;
  } catch (err) {
    // Give the claim back, so the next pass can try again.
    await store.releaseSpaceIntro(spaceName).catch(() => {});
    console.warn(`⚠️  Intro card post failed — code: ${codeOf(err)}`);
    return false;
  }
}

/**
 * The same card as a private reply, for `/help`, "@Oracle help" and a person's
 * first DM. Never claims anything: it can be asked for as often as you like.
 */
export async function replyWithIntro({ spaceName, threadName = null, displayName = null, isDm = false, listening = false, chatUserId = null } = {}) {
  if (!spaceName) return false;
  const content = introContent({ displayName, isDm, listening });
  try {
    await postMessage({
      spaceName,
      threadName,
      cardsV2: introCardV2(content, { withExamples: true }),
      privateTo: isDm ? null : chatUserId
    });
    console.log(`👋 Intro shown on request — private: ${!isDm}, tailored: ${content.specific}`);
    return true;
  } catch (err) {
    console.warn(`⚠️  Intro reply failed — code: ${codeOf(err)}`);
    return false;
  }
}

/** Has this person already had the DM intro? */
export async function dmIntroDone(spaceName) {
  try {
    return Boolean(await store.spaceIntro(spaceName));
  } catch (err) {
    // Never block an answer because the check failed; worst case is a repeat.
    console.warn(`⚠️  Intro check failed — code: ${codeOf(err)}`);
    return true;
  }
}

// ============================================================================
// THE CARD TYPE (for the examples button)
// ============================================================================

function render(card, participants = [], latestClick = null) {
  const d = card.data || {};
  const content = introContent({ displayName: d.displayName, isDm: d.isDm, listening: d.listening });
  // Never the tracked-card frame: no "Last update" line and no status on an
  // intro, which has no state to show.
  return introCardV2(content, { cardId: card.id });
}

async function handleAction({ card, actor, action }) {
  if (action !== 'intro.examples') {
    return { changed: false, ignored: 'unknown_action', reply: 'That button doesn’t do anything on this card.' };
  }
  const d = card.data || {};
  const content = introContent({ displayName: d.displayName, isDm: d.isDm, listening: d.listening });
  // Nothing changes on the card; the examples go only to whoever pressed.
  return { changed: false, ignored: 'examples_sent', reply: examplesText(content) };
}

async function refresh() {
  return { changed: false };
}

function digestLine() {
  return 'Oracle’s intro card';
}

/** Intros are in nobody's digest: they have no participants and no state. */
async function digestItems() {
  return [];
}

export const introType = {
  type: 'intro',
  actions: INTRO_ACTIONS,
  neverStale: true,
  render,
  handleAction,
  refresh,
  digestLine,
  digestItems
};

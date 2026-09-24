/**
 * Tracked cards — cardsV2 building blocks
 *
 * Every tracked card has the same frame: a header, the type's sections, a
 * "Last update" line naming the latest button press, and buttons. A closed card
 * is frozen: it keeps its content, says it is closed, and has no buttons.
 *
 * Button presses come back to Oracle's Chat endpoint. For a Chat app built as a
 * Workspace add-on, a button's `function` must be that endpoint's URL — the same
 * URL Chat's tokens are verified against (GOOGLE_CHAT_AUDIENCE). The action name
 * travels as a parameter, because add-ons receive no function name.
 *
 * Card text is the Cards v2 HTML subset (<b>, <i>, <br>, <a>), never Markdown.
 * Model-written text often carries Markdown, so finalizeCards() runs over every
 * text field of every card before it leaves: Markdown emphasis becomes <b>/<i>
 * where HTML renders, and is stripped where it does not (headers, labels,
 * buttons).
 */

const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE || 'America/Vancouver';

function endpoint() {
  return process.env.GOOGLE_CHAT_AUDIENCE || null;
}

/** Card text fields accept a little HTML; anything we did not write is escaped. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function clip(value, max) {
  const s = String(value ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ============================================================================
// MARKDOWN → CARD TEXT
// ============================================================================

const MD_LINK = /\[([^\]\n]+)\]\((?:https?:\/\/|mailto:)[^)\s]*\)/g;
const MD_CODE = /`+([^`\n]*)`+/g;
// Only asterisk emphasis: underscores are left alone, they occur in names.
const MD_BOLD = /\*\*(?=\S)([^\n]*?\S)\*\*/g;
const MD_ITALIC = /(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g;
const MD_LINE_START = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?=\S)|\d+[.)][ \t]+(?=\S))/gm;
const MD_LEFTOVER = /\*\*|`/g;

/** Markdown removed: plain text for fields that render no HTML. */
export function mdToPlain(value) {
  return String(value ?? '')
    .replace(MD_LINK, '$1')
    .replace(MD_CODE, '$1')
    .replace(MD_BOLD, '$1')
    .replace(MD_ITALIC, '$1$2')
    .replace(MD_LINE_START, '')
    .replace(MD_LEFTOVER, '')
    .trim();
}

/**
 * Card HTML from text that may already be card HTML (ours, escaped) but may
 * still carry Markdown from the model: emphasis becomes <b>/<i>, the rest of
 * the Markdown syntax is removed. Never un-escapes anything.
 */
export function mdToCardHtml(html) {
  // Tags (ours) pass through untouched; only the text between them changes.
  return String(html ?? '')
    .split(/(<[^>]*>)/)
    .map(part => (part.startsWith('<') ? part : part
      .replace(MD_LINK, '$1')
      .replace(MD_CODE, '$1')
      .replace(MD_BOLD, '<b>$1</b>')
      .replace(MD_ITALIC, '$1<i>$2</i>')
      .replace(MD_LINE_START, '')
      .replace(MD_LEFTOVER, '')))
    .join('');
}

/** Raw text (model or user) → safe card HTML. */
export function textToCardHtml(value) {
  return mdToCardHtml(esc(value));
}

/**
 * Last pass over outgoing cards: every text field gets the treatment its
 * widget supports. Returns the same array, changed in place.
 */
export function finalizeCards(cardsV2) {
  const plainKeys = new Set(['title', 'subtitle', 'topLabel', 'bottomLabel']);
  const walk = (node, key) => {
    if (Array.isArray(node)) {
      node.forEach(item => walk(item, key));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'onClick') continue;   // function URL and parameters are not text
      if (typeof v === 'string') {
        const html = (k === 'text' && (key === 'textParagraph' || key === 'decoratedText')) || k === 'header';
        if (html) node[k] = mdToCardHtml(v);   // section headers take simple HTML too
        else if (k === 'text' || plainKeys.has(k)) node[k] = mdToPlain(v);
      } else {
        walk(v, k);
      }
    }
  };
  walk(cardsV2, null);
  return cardsV2;
}

/**
 * Best-effort link to a Chat thread (the API has no permalink field). Same
 * construction as threadLink in src/tools/chat-history.js, kept here so card
 * code does not load the Chat-history tool.
 */
export function threadLink(spaceName, threadName) {
  const space = String(spaceName || '').split('/')[1];
  const thread = String(threadName || '').split('/')[3];
  if (!space) return null;
  return thread
    ? `https://chat.google.com/room/${space}/${thread}`
    : `https://chat.google.com/room/${space}`;
}

/**
 * A button that calls back to Oracle with these parameters. A disabled button
 * stays visible (its label shows the state) but cannot be pressed.
 * `openDialog` makes the press open a dialog (add-on dialogs are a Developer
 * Preview feature — callers only set it when TRACK_DIALOGS_ENABLED is on).
 */
export function button(text, params, { disabled = false, openDialog = false } = {}) {
  return {
    text,
    ...(disabled ? { disabled: true } : {}),
    onClick: {
      action: {
        function: endpoint(),
        parameters: Object.entries(params).map(([key, value]) => ({ key, value: String(value) })),
        ...(openDialog ? { interaction: 'OPEN_DIALOG' } : { loadIndicator: 'SPINNER' })
      }
    }
  };
}

/** Link to one message in its thread (best effort, like threadLink). */
export function messageLink(messageName, threadName) {
  const [, space, , message] = String(messageName || '').split('/');
  const thread = String(threadName || '').split('/')[3];
  if (!space || !message) return null;
  return thread
    ? `https://chat.google.com/room/${space}/${thread}/${message}`
    : `https://chat.google.com/room/${space}`;
}

/**
 * Are card dialogs switched on? Add-on dialogs are a Developer Preview
 * feature, and one Google reference says the button setting that opens them
 * strips the card, so every dialog has a typed fallback and this stays off
 * until it has been tried in a real space.
 *
 * A card type can opt in on its own (`dialogs: true`): the lesson card does, so
 * its Edit dialog can be tried live without switching dialogs on for every
 * card. LESSON_DIALOGS_DISABLED=true turns that off again without a deploy.
 *
 * @param {Object} [type] - a card type; omitted means "every card"
 */
export const dialogsEnabled = (type = null) =>
  process.env.TRACK_DIALOGS_ENABLED === 'true'
  || (type?.dialogs === true && process.env.LESSON_DIALOGS_DISABLED !== 'true');

export function buttonsAvailable() {
  return Boolean(endpoint());
}

export function paragraph(html) {
  return { textParagraph: { text: html } };
}

export function decorated({ top = null, text, bottom = null, buttonSpec = null }) {
  return {
    decoratedText: {
      ...(top ? { topLabel: top } : {}),
      text,
      wrapText: true,
      ...(bottom ? { bottomLabel: bottom } : {}),
      ...(buttonSpec ? { button: buttonSpec } : {})
    }
  };
}

export function buttonRow(buttons) {
  return { buttonList: { buttons } };
}

/**
 * A time zone's offset from UTC at that instant, in minutes. Intl is the only
 * place Node exposes this, and cards need it twice: to turn a local wall time
 * (end of someone's day, a meeting slot) into a real instant.
 */
export function tzOffsetMinutes(at, timeZone = DEFAULT_TZ) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(at)).find(p => p.type === 'timeZoneName')?.value || '';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!m) return 0;   // "GMT" itself
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch {
    return 0;
  }
}

/** The instant a local wall time falls on, e.g. ('2026-09-17', 17, 0, tz). */
export function localInstant(localDate, hour = 0, minute = 0, timeZone = DEFAULT_TZ) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const asUtc = new Date(`${localDate}T${hh}:${mm}:00Z`);
  // The offset is read at the guessed instant; a DST boundary inside the same
  // day moves it by an hour at most, which no card cares about.
  return new Date(asUtc.getTime() - tzOffsetMinutes(asUtc, timeZone) * 60_000);
}

/** "Sep 17, 3:04 PM PDT" in the team's default time zone. */
export function formatWhen(date, timeZone = DEFAULT_TZ) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(date));
}

/**
 * The latest button press, as one line. While slow work runs, `busy` replaces
 * it ("Drafting follow-up…"); an outcome note is appended after a dash.
 */
export function lastUpdateLine(click, labels = {}, { busy = null, outcome = null } = {}) {
  if (busy?.text) {
    const who = busy.by ? ` · ${esc(busy.by)}` : '';
    const when = busy.at ? ` · ${esc(formatWhen(busy.at))}` : '';
    return `Last update: ${esc(busy.text)}${who}${when}`;
  }
  if (!click) return outcome ? `Last update: ${esc(outcome)}` : null;
  const who = click.actor_name || 'Someone';
  const what = labels[click.action]?.label || click.action;
  const tail = outcome ? ` — ${esc(outcome)}` : '';
  return `Last update: ${esc(who)} ${esc(what)}${tail} · ${esc(formatWhen(click.created_at))}`;
}

/**
 * Assemble a tracked card.
 * @param {Object} p
 * @param {Object} p.card - tracked_cards row
 * @param {string} p.title
 * @param {string} [p.subtitle]
 * @param {Array} p.sections - [{header?, widgets}]
 * @param {Array} [p.buttons] - button() results; dropped on a closed card
 * @param {Object} [p.latestClick]
 * @param {Object} [p.labels] - action → {label}
 * @returns {Array} cardsV2
 */
export function trackedCard({ card, title, subtitle = '', sections, buttons = [], latestClick = null, labels = {}, busy = null, outcome = null }) {
  const closed = card.status === 'closed';
  const stale = card.status === 'stale';

  const status = closed
    ? `Closed${card.closed_reason === 'auto_stale' ? ' (inactive)' : ''}`
    : stale ? 'Inactive — confirm in the owner’s digest' : null;

  const out = sections.filter(s => s && s.widgets?.length).map(s => {
    const collapsible = Boolean(s.collapsible) && s.widgets.length > (s.shown ?? 1);
    return {
      ...(s.header ? { header: s.header } : {}),
      ...(collapsible ? { collapsible: true, uncollapsibleWidgetsCount: s.shown ?? 1 } : {}),
      widgets: s.widgets
    };
  });

  const footer = [];
  const last = lastUpdateLine(latestClick, labels, { busy: closed ? null : busy, outcome });
  if (last) footer.push(paragraph(`<i>${last}</i>`));
  if (!closed && buttons.length && buttonsAvailable()) footer.push(buttonRow(buttons));
  if (footer.length) out.push({ widgets: footer });

  return finalizeCards([{
    cardId: `tracked-${card.id}`,
    card: {
      header: {
        title: clip(mdToPlain(title), 200),
        subtitle: clip([subtitle, status].filter(Boolean).map(mdToPlain).join(' · '), 200)
      },
      sections: out
    }
  }]);
}

/** Response body that replaces the clicked message's card in place. */
export function updateMessageResponse(cardsV2) {
  return { hostAppDataAction: { chatDataAction: { updateMessageAction: { message: { cardsV2 } } } } };
}

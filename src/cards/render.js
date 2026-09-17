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

/** A button that calls back to Oracle with these parameters. */
export function button(text, params) {
  return {
    text,
    onClick: {
      action: {
        function: endpoint(),
        parameters: Object.entries(params).map(([key, value]) => ({ key, value: String(value) })),
        loadIndicator: 'SPINNER'
      }
    }
  };
}

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

/** "Sep 17, 3:04 PM PDT" in the team's default time zone. */
export function formatWhen(date, timeZone = DEFAULT_TZ) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(date));
}

/** The latest button press, as one line. */
export function lastUpdateLine(click, labels = {}) {
  if (!click) return null;
  const who = click.actor_name || 'Someone';
  const what = labels[click.action]?.label || click.action;
  return `Last update: ${esc(who)} ${esc(what)} · ${esc(formatWhen(click.created_at))}`;
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
export function trackedCard({ card, title, subtitle = '', sections, buttons = [], latestClick = null, labels = {} }) {
  const closed = card.status === 'closed';
  const stale = card.status === 'stale';

  const status = closed
    ? `Closed${card.closed_reason === 'auto_stale' ? ' (inactive)' : ''}`
    : stale ? 'Inactive — confirm in the owner’s digest' : null;

  const out = sections.filter(s => s && s.widgets?.length).map(s => ({
    ...(s.header ? { header: s.header } : {}),
    widgets: s.widgets
  }));

  const footer = [];
  const last = lastUpdateLine(latestClick, labels);
  if (last) footer.push(paragraph(`<i>${last}</i>`));
  if (!closed && buttons.length && buttonsAvailable()) footer.push(buttonRow(buttons));
  if (footer.length) out.push({ widgets: footer });

  return [{
    cardId: `tracked-${card.id}`,
    card: {
      header: {
        title: clip(title, 200),
        subtitle: clip([subtitle, status].filter(Boolean).join(' · '), 200)
      },
      sections: out
    }
  }];
}

/** Response body that replaces the clicked message's card in place. */
export function updateMessageResponse(cardsV2) {
  return { hostAppDataAction: { chatDataAction: { updateMessageAction: { message: { cardsV2 } } } } };
}

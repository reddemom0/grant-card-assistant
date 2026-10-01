/**
 * Tracked cards — reading the ask with a small model
 *
 * One Haiku call per new card: it reads the ask and returns the card's fields
 * (a short title, the shape, the holder, a due date …) and which of the card's
 * existing buttons fit the ask. The rules in track-parse.js still run first and
 * are what the card uses whenever this returns ok: false — an error, a
 * timeout, output that does not validate, or the step being switched off.
 *
 * Safeguards:
 * - The model picks buttons only from the card type's fixed pool; unknown ids
 *   are dropped. Refresh and Switch are never in the pool, so never removable.
 * - Every field is validated; one that fails falls back to its rule value.
 * - The ask is quoted inside the untrusted-data envelope (tool-output.js) and
 *   the model is told it is data. Mentions go in as ids and names; links as
 *   file ids and names — never URLs.
 * - Off under a test runner (NODE_ENV=test) unless CARD_INTERPRETER=on, and
 *   anywhere with CARD_INTERPRETER=off or no ANTHROPIC_API_KEY.
 *
 * Logs: codes and counts only — never the ask, names or ids.
 */

import Anthropic from '@anthropic-ai/sdk';
import { wrapToolOutput, UNTRUSTED_DATA_INSTRUCTION } from '../claude/tool-output.js';
import { logAPICost } from '../utils/cost-logger.js';
import { zonedTime } from './track-parse.js';

export const INTERPRET_MODEL = 'claude-haiku-4-5-20251001';
export const INTERPRET_TIMEOUT_MS = 6000;
const MAX_ASK_CHARS = 2000;
const TITLE_MAX_CHARS = 60;
const TOOL_NAME = 'card_fields';

let client = null;
const anthropic = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

function codeOf(err) {
  return err?.status ?? err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

export function interpreterEnabled() {
  const flag = String(process.env.CARD_INTERPRETER || '').toLowerCase();
  if (flag === 'off') return false;
  if (!process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.NODE_ENV === 'test' && flag !== 'on') return false;
  return true;
}

// ============================================================================
// SHARED VALIDATION
// ============================================================================

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A short title that names the ask — never a copy of the message. */
export function cleanTitle(value, askText) {
  const t = String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'“‘\s]+|["'”’\s.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = t ? t.split(' ').length : 0;
  if (words < 2 || words > 10 || t.length > TITLE_MAX_CHARS) return null;
  const firstLine = String(askText || '').split(/\n/).map(l => l.trim()).find(Boolean) || '';
  if (squash(t) === squash(firstLine)) return null;
  // A copied opening ("show me an example for if") is a copy, not a title.
  if (words >= 4 && squash(firstLine).startsWith(squash(t))) return null;
  return t;
}

/** Button ids the model returned, kept only when they are in the pool, pool order. */
export function pickButtons(ids, pool) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
  return pool.filter(id => wanted.has(id));
}

// ============================================================================
// PER-CARD SPECS
// ============================================================================

const TRACK_POOL = {
  one: {
    'track.take': 'I’ll take it — someone volunteers to hold the ask',
    'track.pass': 'Pass to… — hand the ask to a named person',
    'track.client': 'Waiting on client — the ball is with an outside client',
    'track.call': 'Call needed — the ask needs a meeting to settle',
    'track.promise': 'Someone promised… — record who promised it and by when',
    'track.decision': 'Record decision — the ask ends in a decision',
    'track.resolve': 'Resolved — close the ask when it is done'
  },
  everyone: {
    'track.done': 'I’ve done it — each person marks their own part done (reading, doing a task)',
    'track.respond': 'Submit response — each person gives an answer, vote or feedback',
    'track.help': 'I need help — a person flags they are stuck',
    'track.remove': 'Remove people… — take people who are not involved off the list'
  }
};

const TRACK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '3–8 word title naming the ask, e.g. "Team reads Oracle guide". Never copy the message.' },
    shape: { type: 'string', enum: ['one', 'everyone'], description: '"everyone" when every person in the space (the team, all of us, everybody) must each act; "one" when one person holds it.' },
    feedback: { type: 'boolean', description: 'For "everyone": true when each person is asked for an answer, opinion or vote rather than to do something.' },
    holder_id: { type: ['string', 'null'], description: 'For "one": the id of the mentioned person the ask is directed at, or null.' },
    due: {
      type: ['object', 'null'],
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD in the requester’s time zone' },
        time: { type: ['string', 'null'], description: 'HH:MM (24h) when a time is stated, "17:00" for end of day, else null' },
        phrase: { type: 'string', description: 'The words that set the deadline, e.g. "by Friday"' }
      },
      required: ['date']
    },
    buttons: { type: 'array', items: { type: 'string' }, description: 'Button ids from the pool for the chosen shape that fit this ask. Leave out ones that make no sense for it.' }
  },
  required: ['title', 'shape', 'buttons']
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function cleanDue(due, timeZone, now) {
  if (due === null) return { at: null };                     // the model says: no deadline
  const d = DATE.exec(String(due?.date || ''));
  if (!d) return undefined;
  const t = due.time ? TIME.exec(String(due.time)) : null;
  if (due.time && !t) return undefined;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  const at = zonedTime(year, month, day, t ? Number(t[1]) : 23, t ? Number(t[2]) : 59, timeZone);
  // A deadline before the ask was written, or years out, is a misreading.
  if (at < new Date(now.getTime() - 24 * 60 * 60 * 1000) || at > new Date(now.getTime() + 2 * YEAR_MS)) return undefined;
  return { at, label: String(due.phrase || '').trim().slice(0, 60) || 'due', hasTime: Boolean(t) };
}

const SPECS = {
  track: {
    schema: TRACK_SCHEMA,
    instructions: [
      'You set up a card that tracks an ask made in a team chat thread: who has the ball, or — when everyone must act — a checklist of the team.',
      'Choose the shape from what the requester wants done, not from exact words: "the full team to read this" is everyone.',
      'Pick only buttons that fit this ask. A reading or to-do ask for everyone does not need "Submit response"; one that asks for opinions does not need "I’ve done it".',
      'Due dates: resolve relative words ("Friday", "tomorrow", "EOD") against the time the ask was written, in the requester’s time zone. No deadline stated → null.'
    ],
    context: ({ mentions }) => [
      `Mentioned people (id — name): ${mentions.length ? mentions.map(m => `${m.chatUserId} — ${m.name || 'unknown'}`).join('; ') : 'none'}`,
      `Button pool when shape is "one":\n${Object.entries(TRACK_POOL.one).map(([id, d]) => `- ${id}: ${d}`).join('\n')}`,
      `Button pool when shape is "everyone":\n${Object.entries(TRACK_POOL.everyone).map(([id, d]) => `- ${id}: ${d}`).join('\n')}`
    ],
    validate(raw, { askText, mentions, timeZone, now }) {
      const shape = raw.shape === 'one' || raw.shape === 'everyone' ? raw.shape : undefined;
      const fields = {
        title: cleanTitle(raw.title, askText) ?? undefined,
        shape,
        feedback: typeof raw.feedback === 'boolean' ? raw.feedback : undefined,
        holderId: raw.holder_id === null
          ? null
          : (mentions.some(m => m.chatUserId === raw.holder_id) ? raw.holder_id : undefined),
        due: raw.due === undefined ? undefined : cleanDue(raw.due, timeZone, now)
      };
      // Buttons are only meaningful against a shape the model also chose.
      const buttons = shape ? pickButtons(raw.buttons, Object.keys(TRACK_POOL[shape])) : [];
      return { fields, buttons: buttons.length ? { shape, ids: buttons } : null };
    }
  }
};

// --- meet --------------------------------------------------------------------
// Meet's buttons follow the card's state (slots found, booked, rescheduling);
// the only one an ask can make pointless is "Ignore working hours".
const MEET_POOL = {
  'meet.ignore_hours': 'Ignore working hours — look outside 9–5 (keep it unless the ask rules that out, e.g. "during work hours")'
};
const MEET_WINDOWS = ['today', 'tomorrow', 'this week', 'next week', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

SPECS.meet = {
  schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: '2–8 word topic for the call, e.g. "Budget review with client". Never copy the message.' },
      duration_minutes: { type: ['integer', 'null'], description: 'Length asked for, in minutes; null when not stated.' },
      window: { type: ['string', 'null'], enum: [...MEET_WINDOWS, null], description: 'When to look; null when not stated.' },
      buttons: { type: 'array', items: { type: 'string' }, description: 'Button ids from the pool that fit this ask.' }
    },
    required: ['topic', 'buttons']
  },
  instructions: [
    'You set up a card that finds a meeting time for the people mentioned in a team chat message.',
    'Name the topic from what the call is about, not from the words "find time" or the people’s names.'
  ],
  context: ({ mentions }) => [
    `People to meet (id — name): ${mentions.length ? mentions.map(m => `${m.chatUserId} — ${m.name || 'unknown'}`).join('; ') : 'none'}`,
    `Button pool:\n${Object.entries(MEET_POOL).map(([id, d]) => `- ${id}: ${d}`).join('\n')}`
  ],
  validate(raw, { askText }) {
    const minutes = Number(raw.duration_minutes);
    const ids = pickButtons(raw.buttons, Object.keys(MEET_POOL));
    return {
      fields: {
        title: cleanTitle(raw.topic, askText) ?? undefined,
        durationMinutes: raw.duration_minutes === null
          ? null
          : (Number.isInteger(minutes) && minutes >= 5 && minutes <= 8 * 60 ? minutes : undefined),
        window: raw.window === null ? null : (MEET_WINDOWS.includes(raw.window) ? raw.window : undefined)
      },
      // An empty list is a choice too: the model dropped the one optional button.
      buttons: Array.isArray(raw.buttons) ? { ids } : null
    };
  }
};

// --- watch -------------------------------------------------------------------
// No optional buttons: the model only names the program to look up.
SPECS.watch = {
  schema: {
    type: 'object',
    properties: {
      program_name: { type: ['string', 'null'], description: 'The funding program the post is about, as named in it (full name, or the acronym if that is all there is). null when no program is named.' }
    },
    required: ['program_name']
  },
  instructions: [
    'You set up a card that watches one funding program (a grant, loan or tax credit) a team chat post is about.',
    'Return the program’s name as the post gives it. Never invent a program the post does not name.'
  ],
  context: () => [],
  validate(raw, { askText }) {
    const name = typeof raw.program_name === 'string' ? raw.program_name.replace(/\s+/g, ' ').trim() : null;
    const askWords = new Set(squash(askText).split(' '));
    // The name must come from the post: at least one of its words is in it.
    const grounded = name && name.length <= 120 && !/https?:/i.test(name)
      && squash(name).split(' ').some(w => w.length >= 3 && askWords.has(w));
    return { fields: { programName: raw.program_name === null ? null : (grounded ? name : undefined) }, buttons: null };
  }
};

export const BUTTON_POOLS = { track: TRACK_POOL, meet: MEET_POOL };

// ============================================================================
// THE CALL
// ============================================================================

function whenWritten(now, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(now);
}

/**
 * Read an ask for one card type.
 *
 * @param {Object} p
 * @param {'track'|'meet'|'watch'} p.cardType
 * @param {string} p.askText
 * @param {Array<{chatUserId: string, name?: string}>} [p.mentions] - real people only
 * @param {Array<{fileId: string, name?: string|null}>} [p.links]
 * @param {string} p.timeZone - the requester's IANA zone
 * @param {Date} [p.now] - when the ask was written
 * @returns {Promise<{ok: true, fields: Object, buttons: {shape?: string, ids: string[]}|null}|{ok: false, code: string}>}
 *   A field left undefined means "use the rule value".
 */
export async function interpretAsk({ cardType, askText, mentions = [], links = [], timeZone, now = new Date() }) {
  const spec = SPECS[cardType];
  if (!spec) return { ok: false, code: 'unknown_card_type' };
  if (!interpreterEnabled()) return { ok: false, code: 'disabled' };
  const text = String(askText || '').trim();
  if (!text) return { ok: false, code: 'no_text' };

  const ctx = { askText: text, mentions, timeZone, now };
  const user = [
    `Card type: ${cardType}`,
    `The ask was written ${whenWritten(now, timeZone)} (requester’s time zone ${timeZone}).`,
    ...spec.context(ctx),
    links.length
      ? `Documents the ask links to: ${links.map(l => l.name ? `"${l.name}"` : 'a Google doc').join(', ')}`
      : 'The ask links to no documents.',
    'The ask, quoted from chat:',
    wrapToolOutput('chat_ask', text.slice(0, MAX_ASK_CHARS)),
    `Call ${TOOL_NAME} once.`
  ].join('\n\n');

  let response;
  try {
    response = await anthropic().messages.create({
      model: INTERPRET_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: [...spec.instructions, UNTRUSTED_DATA_INSTRUCTION].join('\n\n'),
      tools: [{ name: TOOL_NAME, description: `The ${cardType} card’s fields and buttons.`, input_schema: spec.schema }],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: user }]
    }, { timeout: INTERPRET_TIMEOUT_MS, maxRetries: 0 });
  } catch (err) {
    return { ok: false, code: `call_failed_${codeOf(err)}` };
  }

  if (response?.usage) {
    logAPICost({ usage: response.usage, model: INTERPRET_MODEL, source: 'card-interpret', metadata: { cardType } });
  }

  const raw = (response?.content || []).find(b => b.type === 'tool_use' && b.name === TOOL_NAME)?.input;
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'no_tool_call' };

  let result;
  try {
    result = spec.validate(raw, ctx);
  } catch {
    return { ok: false, code: 'invalid' };
  }
  const usable = Object.values(result.fields).some(v => v !== undefined) || result.buttons;
  return usable ? { ok: true, ...result } : { ok: false, code: 'invalid' };
}

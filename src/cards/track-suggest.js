/**
 * /track — who has the ball, guessed from the thread. Pure functions, no I/O,
 * no model: a handful of plain rules, each pointing at the message it read.
 *
 * Newest message first, only messages after the ball last moved, people only
 * (never apps, never Oracle). The first rule that matches wins:
 *   1. someone @mentions a person          → with that person
 *   2. the sender promises ("I'll… by Fri") → with the sender (and the date)
 *   3. client wording ("sent to the client") → waiting on client, sender chasing
 *   4. call wording ("jump on a call")       → call needed
 *   5. decision wording ("we decided")       → record the decision
 *   6. the holder replied, nothing else      → back with the person who asked
 * A suggestion is only ever shown with Confirm / Dismiss — except in a listened
 * space, where it is applied as a labelled best guess that anyone can undo.
 */

import { parseDueDate } from './track-parse.js';

const PROMISE = /\b(?:i'?ll|i will|i can (?:do|take|send|get)|will do|on it|i'?m on it|leave it with me|i'?ll handle|consider it done)\b/i;
const CLIENT = /\b(?:sent (?:it |this |that )?(?:over )?to (?:the )?client|waiting (?:to hear back from|on|for) (?:the )?client|(?:asked|emailed|pinged|chased|followed up with) (?:the )?client|client (?:hasn'?t|has not|hasnt) (?:replied|responded|gotten back|answered))\b/i;
const CALL = /\b(?:(?:jump|hop|get) on a (?:quick )?call|(?:need|needs|let'?s (?:have|do)|set up|book|schedule) a (?:quick )?call|call (?:needed|to discuss)|talk (?:it |this )?through (?:live|on a call))\b/i;
const DECISION = /\b(?:we(?:'ve| have)? decided|(?:the )?decision(?: is|:)|(?:we'?re |we are )?going with|agreed (?:to|on)|let'?s go with|final answer)\b/i;

/**
 * @typedef {Object} ThreadMessage
 * @property {string} name - message resource name
 * @property {string} senderChatId
 * @property {string} [senderName]
 * @property {string} [senderType] - HUMAN | BOT
 * @property {Array<{chatUserId: string, displayName?: string}>} [mentions]
 * @property {string} text
 * @property {string|Date} at
 */

/**
 * @param {ThreadMessage[]} messages - any order
 * @param {Object} ctx
 * @param {string|Date} [ctx.since] - when the ball last moved
 * @param {string} [ctx.holderChatId]
 * @param {{chatUserId: string, name?: string}} [ctx.owner] - who asked
 * @param {(chatUserId: string) => boolean} [ctx.isExcluded] - Oracle, listener, @all
 * @param {string} [ctx.timeZone]
 * @returns {{state: string, holder?: Object, chaser?: Object, due?: Object, source: string}|null}
 */
export function suggestBall(messages, { since = null, holderChatId = null, owner = null, isExcluded = () => false, timeZone = 'UTC' } = {}) {
  const after = since ? new Date(since).getTime() : -Infinity;
  const recent = people(messages).filter(m => new Date(m.at).getTime() > after);
  const person = (chatUserId, name) => ({ chatUserId, name: name || null });

  for (const m of recent) {
    const named = (m.mentions || []).find(x =>
      x?.chatUserId && x.chatUserId !== m.senderChatId && x.chatUserId !== 'users/all' && !isExcluded(x.chatUserId));
    if (named) return { state: 'person', holder: person(named.chatUserId, named.displayName), source: m.name };

    const text = String(m.text || '');
    if (CLIENT.test(text)) return { state: 'client', chaser: person(m.senderChatId, m.senderName), source: m.name };
    if (PROMISE.test(text)) {
      const due = parseDueDate(text, timeZone, new Date(m.at));
      return { state: 'person', holder: person(m.senderChatId, m.senderName), promised: true, ...(due ? { due } : {}), source: m.name };
    }
    if (CALL.test(text)) return { state: 'call', source: m.name };
    if (DECISION.test(text)) return { state: 'decided', source: m.name };
  }

  const newest = recent[0];
  if (newest && holderChatId && newest.senderChatId === holderChatId && owner?.chatUserId && owner.chatUserId !== holderChatId) {
    return { state: 'person', holder: person(owner.chatUserId, owner.name), replied: true, source: newest.name };
  }
  return null;
}

/**
 * A draft for "Record decision": the latest message with decision wording,
 * else the latest message. Plain text, at most 500 characters.
 */
export function draftDecision(messages) {
  const list = people(messages);
  const pick = list.find(m => DECISION.test(String(m.text || ''))) || list[0];
  const text = String(pick?.text || '').replace(/\s+/g, ' ').trim();
  return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}

/** People's messages, newest first. */
function people(messages = []) {
  return messages
    .filter(m => m && m.senderType !== 'BOT' && m.senderChatId)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

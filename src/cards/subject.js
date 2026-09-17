/**
 * What is this card about? — shared by /track, /watch, /review and lead triage
 *
 * In a space, a card's subject is the message it was a reply to: the thread's
 * first message. Two cases have no such message:
 *   - a DM, where Chat usually gives every message its own thread, so the
 *     thread's first message IS the "@Oracle …" that triggered the card;
 *   - a trigger that started a new thread in a space.
 *
 * Rather than asking the same question again, the card looks at the last few
 * messages of that conversation and takes the nearest one that looks like what
 * it needs — the program post, the ask, the review request, the lead. When more
 * than one could be it, the card quotes what it picked and asks.
 *
 * Reads are as the person who asked, through the same path as readThread, so
 * nothing is read that they cannot read themselves.
 */

import { readAsk, readRecent, RECENT_MESSAGES } from './track-thread.js';
import { mdToPlain, clip } from './render.js';

const QUOTE_CHARS = 160;

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

/** Oracle's own messages, and empty ones, are never the subject. */
const usable = (m, skipMessageName) =>
  Boolean(m?.text?.trim()) && m.senderType !== 'BOT' && m.name !== skipMessageName;

/** One line of the subject, for quoting back. */
export function quoteSubject(text) {
  const line = String(text || '').split(/\n/).map(l => l.trim()).find(Boolean) || '';
  return clip(mdToPlain(line), QUOTE_CHARS);
}

/**
 * Find what a card should act on.
 *
 * @param {Object} p
 * @param {string} p.spaceName
 * @param {string|null} p.threadName
 * @param {number[]} p.userIds - whose Chat grant to read with, in order
 * @param {string|null} p.triggerMessageName - the "@Oracle …" or command message
 * @param {(text: string, message: Object) => boolean} [p.looksRight] - is this the subject?
 * @param {number} [p.limit]
 * @param {number} [p.maxAgeMs] - a fallback message older than this is quoted
 *   back rather than acted on. A DM is one conversation, so it passes Infinity;
 *   a space has many, and the message before a command may be about something
 *   else entirely.
 * @param {Date} [p.now]
 * @returns {Promise<{ok: boolean, code?: string, message?: Object, text?: string,
 *   from?: 'thread'|'recent', sure?: boolean, others?: number}>}
 */
export async function findSubject({
  spaceName, threadName = null, userIds = [], triggerMessageName = null,
  looksRight = () => true, limit = RECENT_MESSAGES, maxAgeMs = Infinity, now = new Date()
} = {}) {
  if (!spaceName) return { ok: false, code: 'no_space' };

  // 1. The thread's own first message, when there is one and it is not the
  //    trigger itself. This is the ordinary case in a space.
  let fromThread = null;
  if (threadName) {
    try {
      const read = await readAsk({ spaceName, threadName, userIds });
      if (read.ok && usable(read.ask, triggerMessageName)) {
        if (looksRight(read.ask.text, read.ask)) {
          return { ok: true, message: read.ask, text: read.ask.text, from: 'thread', sure: true, others: 0 };
        }
        // It is the message the card was a reply to, but it does not look like
        // what this card needs — worth falling back on, not worth acting on.
        fromThread = read.ask;
      }
      if (!read.ok && read.code === 'needs_reconsent') return { ok: false, code: 'needs_reconsent' };
    } catch (err) {
      console.warn(`⚠️  Subject thread read failed — code: ${codeOf(err)}`);
    }
  }

  // 2. Otherwise the last few messages of this conversation, newest first.
  let recent;
  try {
    recent = await readRecent({ spaceName, userIds, limit });
  } catch (err) {
    console.warn(`⚠️  Subject recent read failed — code: ${codeOf(err)}`);
    return { ok: false, code: `read_failed_${codeOf(err)}` };
  }
  if (!recent.ok) {
    return fromThread
      ? { ok: true, message: fromThread, text: fromThread.text, from: 'thread', sure: false, others: 0 }
      : { ok: false, code: recent.code };
  }

  const candidates = recent.messages.filter(m => usable(m, triggerMessageName));
  if (!candidates.length) {
    return fromThread
      ? { ok: true, message: fromThread, text: fromThread.text, from: 'thread', sure: false, others: 0 }
      : { ok: false, code: 'nothing_recent' };
  }

  const fresh = (m) => {
    if (!Number.isFinite(maxAgeMs)) return true;
    const at = m.at ? new Date(m.at).getTime() : null;
    return at === null ? false : now.getTime() - at <= maxAgeMs;
  };
  const matching = candidates.filter(m => {
    try {
      return Boolean(looksRight(m.text, m)) && fresh(m);
    } catch {
      return false;
    }
  });

  // One message that looks right is the subject. Several, or none that look
  // right, and the card quotes the nearest and asks.
  if (matching.length === 1) {
    return { ok: true, message: matching[0], text: matching[0].text, from: 'recent', sure: true, others: 0 };
  }
  const nearest = matching[0] || fromThread || candidates[0];
  return {
    ok: true,
    message: nearest,
    text: nearest.text,
    from: 'recent',
    sure: false,
    others: Math.max(0, (matching.length || candidates.length) - 1)
  };
}

/** "Did you mean this? …" — the question a card asks when it had to guess. */
export function confirmSubject(what, text) {
  return `Which ${what} did you mean? The nearest one I can see is:\n\n“${quoteSubject(text)}”\n\nReply with the details, or @mention me on that message itself.`;
}

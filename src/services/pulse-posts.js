/**
 * GetGranted Pulse: the posts Oracle delivered, so replies to them have context
 *
 * Every delivered Pulse message — weekly digest, morning roundup, spike alert —
 * is recorded per recipient in pulse_posts (migration 041): where it went, its
 * message and thread names, the period it covered and the text the recipient
 * saw. When someone replies in that thread, or quotes the post,
 * src/api/chat-google.js finds the row and src/claude/client.js adds
 * pulseContextBlock() to Oracle's instructions: answer about that post, and
 * default to its period.
 *
 * Recording never fails a send: an error, or the table not existing yet, is
 * logged once with a code and the delivery carries on. The database is
 * imported lazily, so client.js can use pulseContextBlock without loading it.
 */

import { wrapToolOutput } from '../claude/tool-output.js';

export const PULSE_KINDS = ['digest', 'roundup', 'spike'];
const KIND_LABELS = { digest: 'weekly digest', roundup: 'morning roundup', spike: 'chat spike alert' };
const TZ = 'America/Vancouver';
const SUMMARY_CHARS = 6000;

const codeOf = (err) => err?.code ?? err?.name ?? 'unknown';
let warnedNoTable = false;

async function defaultQuery(text, params) {
  const { query } = await import('../database/connection.js');
  return query(text, params);
}

/**
 * Record one delivered post. Never throws.
 * @param {{kind: string, isTest?: boolean, recipientEmail?: string|null, spaceName: string, messageName: string,
 *          threadName?: string|null, periodStart: Date, periodEnd: Date, summary: string}} row
 * @returns {Promise<boolean>} whether a row was written
 */
export async function recordPulsePost(row, runQuery = defaultQuery) {
  if (!PULSE_KINDS.includes(row?.kind) || !row.spaceName || !row.messageName) return false;
  try {
    await runQuery(
      `INSERT INTO pulse_posts
         (kind, is_test, recipient_email, space_name, message_name, thread_name, period_start, period_end, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [row.kind, Boolean(row.isTest), row.recipientEmail || null, row.spaceName, row.messageName,
        row.threadName || null, row.periodStart, row.periodEnd, String(row.summary || '').slice(0, SUMMARY_CHARS)]
    );
    return true;
  } catch (err) {
    if (err?.code === '42P01') {
      if (!warnedNoTable) {
        warnedNoTable = true;
        console.warn('⚠️  Pulse posts: pulse_posts missing (apply migration 041) — replies will get no post context.');
      }
    } else {
      console.warn(`⚠️  Pulse posts: not recorded — code: ${codeOf(err)}`);
    }
    return false;
  }
}

/**
 * A recorder for one send: called with (subscriber, delivery result) for each
 * recipient the post reached. Results without a message name record nothing.
 */
export function pulsePostRecorder({ kind, isTest = false, periodStart, periodEnd, summary }, record = recordPulsePost) {
  return async (subscriber, result) => {
    if (!result?.messageName) return false;
    return record({
      kind, isTest, recipientEmail: subscriber.email, spaceName: subscriber.dmSpace,
      messageName: result.messageName, threadName: result.threadName || null, periodStart, periodEnd, summary
    });
  };
}

/**
 * The post a message is replying to: same space, and either the same thread or
 * a quote of the post. Null when nothing matches or the table isn't there.
 */
export async function findPulsePost({ spaceName, threadName = null, quotedMessageName = null }, runQuery = defaultQuery) {
  if (!spaceName || (!threadName && !quotedMessageName)) return null;
  try {
    const r = await runQuery(
      `SELECT kind, is_test, period_start, period_end, summary, created_at
         FROM pulse_posts
        WHERE space_name = $1
          AND (($2::text IS NOT NULL AND thread_name = $2) OR ($3::text IS NOT NULL AND message_name = $3))
        ORDER BY created_at DESC
        LIMIT 1`,
      [spaceName, threadName, quotedMessageName]
    );
    const row = r.rows?.[0];
    if (!row || !PULSE_KINDS.includes(row.kind)) return null;
    return {
      kind: row.kind,
      isTest: row.is_test,
      periodStart: new Date(row.period_start),
      periodEnd: new Date(row.period_end),
      summary: row.summary,
      postedAt: new Date(row.created_at)
    };
  } catch (err) {
    if (err?.code !== '42P01') console.warn(`⚠️  Pulse posts: lookup failed — code: ${codeOf(err)}`);
    return null;
  }
}

const fmt = (date, opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(date);

/** The period in Vancouver time: whole days for the digest, times for the others. */
export function periodLabel(kind, start, end) {
  if (kind === 'digest') {
    const lastDay = new Date(end.getTime() - 1);
    return `${fmt(start, { weekday: 'short', month: 'short', day: 'numeric' })} – ${fmt(lastDay, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} (Vancouver time)`;
  }
  const at = (d) => fmt(d, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${at(start)} – ${at(end)} (Vancouver time)`;
}

/** The system block for a reply to a Pulse post. */
export function pulseContextBlock(post) {
  return [
    '## The post being replied to',
    '',
    'The user is replying to this post; default to its period unless they say otherwise.',
    '',
    `Post: Oracle's ${KIND_LABELS[post.kind] || post.kind}${post.isTest ? ' (a test send)' : ''}`,
    `Period: ${periodLabel(post.kind, post.periodStart, post.periodEnd)} — UTC ${post.periodStart.toISOString()} to ${post.periodEnd.toISOString()}`,
    '',
    'What the post showed (Oracle\'s own post, recorded when it was sent):',
    wrapToolOutput('pulse_post', post.summary)
  ].join('\n');
}

/** Test-only. */
export function _resetPulsePostsForTests() {
  warnedNoTable = false;
}

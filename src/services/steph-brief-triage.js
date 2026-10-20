/**
 * Steph morning brief — triage. PURE: no I/O, no Gmail, no model. Everything
 * the brief decides about which mail becomes which card item, and in what
 * order, lives here so it can be tested without fakes.
 *
 * Input threads are getThread() results from src/tools/gmail.js:
 *   { id, subject, messages: [parseMessage(...)] }
 *
 * Heuristics for automated and government mail are ported from
 * scripts/one-off/steph-inbox-snapshot.js (the 2026-10-08 header-only
 * snapshot of her inbox), copied rather than imported: that script is a
 * one-off and not part of the app.
 */

import { addressOf, replyState } from '../tools/gmail.js';

const DAY_MS = 24 * 3600 * 1000;

/** Card order. 'docs' (Drive notifications) is not one of the five mail groups; it goes last. */
export const GROUP_ORDER = Object.freeze(['client', 'partner', 'lead', 'team', 'government', 'docs']);

export const GROUP_LABELS = Object.freeze({
  client: 'Clients',
  partner: 'Partners',
  lead: 'Leads',
  team: 'Team',
  government: 'Government programs',
  docs: 'Docs & comments'
});

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

export const domainOf = (address) => String(address || '').split('@')[1]?.toLowerCase() || '';

const NOREPLY = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|bounces?|postmaster|news(letter)?|marketing|info-noreply)\b/i;

/** Bulk or machine mail: List-Unsubscribe, Precedence bulk/list/junk, or a no-reply local part. */
export function isAutomated(msg) {
  if (String(msg.list_unsubscribe || '').trim()) return true;
  if (/^(bulk|list|junk)$/i.test(String(msg.precedence || '').trim())) return true;
  return NOREPLY.test(addressOf(msg.from).split('@')[0] || '');
}

export function isGovDomain(domain) {
  const d = String(domain || '').toLowerCase();
  return /(^|\.)gc\.ca$/.test(d) || /(^|\.)canada\.ca$/.test(d) || /(^|\.)gov\.[a-z]{2}\.ca$/.test(d)
    || /(^|\.)gouv\.qc\.ca$/.test(d) || /(^|\.)(bdc|edc)\.ca$/.test(d)
    || /(^|\.)(alberta|ontario|novascotia|manitoba|saskatchewan|gnb|princeedwardisland|yukon)\.ca$/.test(d);
}

export const isInternal = (address) => domainOf(address) === 'granted.ca';

const DRIVE_SENDERS = /^(comments-noreply@docs\.google\.com|drive-shares-dm-noreply@google\.com|drive-shares-noreply@google\.com|.*@docs\.google\.com)$/i;

/** A Google Docs / Sheets / Slides / Drive notification (comments, mentions, shares). */
export function isDriveNotification(msg) {
  return DRIVE_SENDERS.test(addressOf(msg.from));
}

/** "Name <a@b>" → "Name", else the address. */
export function displayName(from) {
  const s = String(from || '').trim();
  const m = s.match(/^"?([^"<]+?)"?\s*</);
  return (m ? m[1] : s).trim();
}

export function firstName(from) {
  const name = displayName(from);
  if (name.includes('@')) return '';
  return name.split(/\s+/)[0].replace(/[^\p{L}'-]/gu, '');
}

// ---------------------------------------------------------------------------
// Threads → unanswered candidates
// ---------------------------------------------------------------------------

const inboundOf = (thread) => (thread.messages || []).filter(m => !m.is_draft && !m.from_user);

/** Does the thread already hold a draft (hers or ours)? Then no new draft. */
export function hasDraft(thread) {
  return (thread.messages || []).some(m => m.is_draft);
}

/**
 * The inbound messages that arrived after her last reply (all inbound when she
 * never replied), oldest first.
 */
export function unansweredInbound(thread) {
  const real = (thread.messages || []).filter(m => !m.is_draft);
  const lastOut = real.filter(m => m.from_user).reduce((t, m) => Math.max(t, m.internal_date), 0);
  return inboundOf(thread).filter(m => m.internal_date > lastOut).sort((a, b) => a.internal_date - b.internal_date);
}

/**
 * Split threads into the ones the brief can act on.
 * @returns {{ mail: Array, notifications: Array, counts: {automated, replied, notifications_dropped} }}
 *   mail entries: { thread, latest, unanswered } — replyState(thread).replied === false, not automated
 */
export function sortThreads(threads) {
  const mail = [];
  const notifications = [];
  const counts = { automated: 0, replied: 0 };
  for (const thread of threads) {
    const state = replyState(thread);
    if (state.replied !== false) { counts.replied += state.replied === true ? 1 : 0; continue; }
    const unanswered = unansweredInbound(thread);
    const latest = unanswered[unanswered.length - 1];
    if (!latest) continue;
    if (isDriveNotification(latest)) { notifications.push(thread); continue; }
    if (isAutomated(latest)) { counts.automated += 1; continue; }
    mail.push({ thread, latest, unanswered });
  }
  return { mail, notifications, counts };
}

// ---------------------------------------------------------------------------
// Nudges
// ---------------------------------------------------------------------------

export const FOLLOW_UP = /\b(following up|follow(ing)?[- ]up on|just checking in|checking in (again|on)|circling back|any update|bump(ing)? (this|this up)|gentle reminder|friendly reminder|haven'?t heard back|did you (get|see) my)\b/i;

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * Nudge level for one thread: the number of unanswered inbound messages, or at
 * least 2 when any of them uses follow-up phrasing ("following up", "just
 * checking in"…). Level ≥ 2 is a nudge. days = since the first unanswered one.
 */
export function nudgeInfo(thread, now = Date.now()) {
  const unanswered = unansweredInbound(thread);
  if (unanswered.length === 0) return { level: 0, days: 0, phrase: false };
  const phrase = unanswered.some(m => FOLLOW_UP.test(`${m.subject}\n${String(m.body || '').slice(0, 1500)}`));
  const level = Math.max(unanswered.length, phrase ? 2 : 0);
  const days = Math.max(0, Math.floor((now - unanswered[0].internal_date) / DAY_MS));
  return { level, days, phrase };
}

export function nudgeLabel(level, days) {
  if (level < 2) return null;
  return `${ordinal(level)} nudge · ${days} ${days === 1 ? 'day' : 'days'}`;
}

// ---------------------------------------------------------------------------
// Grouping — one item per sender
// ---------------------------------------------------------------------------

/**
 * Multiple unanswered emails from one sender → one item.
 * @param {Array<{thread, latest, unanswered}>} mail
 * @returns {Array<{item_key, sender, sender_address, subject, threads, thread_ids, first_inbound_at, last_inbound_at, nudge, nudge_days}>}
 */
export function groupBySender(mail, now = Date.now()) {
  const bySender = new Map();
  for (const entry of mail) {
    const address = addressOf(entry.latest.reply_to || entry.latest.from);
    const key = address || `thread:${entry.thread.id}`;
    const item = bySender.get(key) || {
      item_key: key, sender: displayName(entry.latest.from), sender_address: address,
      subject: '', threads: [], thread_ids: [], first_inbound_at: Infinity, last_inbound_at: 0, nudge: 0, nudge_days: 0
    };
    item.threads.push(entry.thread);
    item.thread_ids.push(entry.thread.id);
    const first = entry.unanswered[0].internal_date;
    const last = entry.latest.internal_date;
    item.first_inbound_at = Math.min(item.first_inbound_at, first);
    if (last >= item.last_inbound_at) { item.last_inbound_at = last; item.subject = entry.latest.subject || entry.thread.subject || ''; }
    const n = nudgeInfo(entry.thread, now);
    if (n.level > item.nudge || (n.level === item.nudge && n.days > item.nudge_days)) { item.nudge = n.level; item.nudge_days = n.days; }
    bySender.set(key, item);
  }
  return [...bySender.values()];
}

// ---------------------------------------------------------------------------
// Drive / Docs notifications
// ---------------------------------------------------------------------------

const MENTION = /\bmentioned you\b|\b(added|tagged) you (in|to) a comment\b|@[a-z.]*ssang\b/i;
const ASSIGNED = /\bassigned (you )?(an? )?(action item|comment|task)\b|\bassigned to you\b|\baction item(s)? (was|were )?assigned\b/i;
const SHARED = /\bshared (an? )?(document|spreadsheet|presentation|file|folder|form|pdf|item)?\s*(with you)\b|\bhas shared\b|\binvited you to (edit|comment|view)\b/i;
const ASKS = /\?|\b(can you|could you|would you|please|let me know|thoughts|your (input|feedback|review)|review|take a look|have a look|sign off|approve)\b/i;
const DOC_ID = /\/(?:document|spreadsheets|presentation|file|forms)\/d\/([A-Za-z0-9_-]{20,})/;

function docTitle(subject) {
  const s = String(subject || '').trim();
  const quoted = s.match(/["“]([^"”]+)["”]/);
  if (quoted) return quoted[1];
  return s.replace(/^(re:\s*)?(document|spreadsheet|presentation|file|folder)s? shared with you:\s*/i, '')
    .replace(/\s*-\s*(new comment|new comments|\d+ new comments?).*$/i, '').trim();
}

/** The sharer's own words in a share notification (lines that aren't Google's boilerplate). */
function shareMessage(body) {
  return String(body || '').split('\n').map(l => l.trim()).filter(Boolean)
    .filter(l => !SHARED.test(l) && !/^(open|google (docs|drive|sheets|slides)|you have received|logo|this email|google llc|unsubscribe)/i.test(l) && !/^https?:\/\//.test(l))
    .join(' ').slice(0, 500);
}

/**
 * Keep only notifications that ask something of her: an @mention, a comment
 * or action item assigned to her, or a share whose message asks her
 * something. Grouped per document.
 * @returns {{ items: Array<{item_key, sender, subject, thread_ids, kinds, first_inbound_at, last_inbound_at}>, dropped: number }}
 */
export function driveNotificationItems(threads) {
  const byDoc = new Map();
  let dropped = 0;
  for (const thread of threads) {
    for (const m of unansweredInbound(thread)) {
      if (!isDriveNotification(m)) continue;
      const text = `${m.subject}\n${m.body}`;
      let kind = null;
      if (ASSIGNED.test(text)) kind = 'assigned';
      else if (MENTION.test(text)) kind = 'mention';
      else if (SHARED.test(text) && ASKS.test(shareMessage(m.body))) kind = 'share_with_ask';
      if (!kind) { dropped += 1; continue; }
      const id = (String(m.body).match(DOC_ID) || [])[1];
      const title = docTitle(m.subject || thread.subject);
      const key = id ? `doc:${id}` : `doc:title:${title.toLowerCase()}`;
      const item = byDoc.get(key) || {
        item_key: key, category: 'docs', sender: displayName(m.from).replace(/\s*\((google )?(docs|sheets|slides|drive)\)\s*$/i, ''),
        subject: title, thread_ids: [], kinds: [], first_inbound_at: Infinity, last_inbound_at: 0, nudge: 0, nudge_days: 0
      };
      if (!item.thread_ids.includes(thread.id)) item.thread_ids.push(thread.id);
      if (!item.kinds.includes(kind)) item.kinds.push(kind);
      item.first_inbound_at = Math.min(item.first_inbound_at, m.internal_date);
      item.last_inbound_at = Math.max(item.last_inbound_at, m.internal_date);
      byDoc.set(key, item);
    }
  }
  return { items: [...byDoc.values()], dropped };
}

export function docsAssessment(item) {
  const words = { mention: 'mentioned you', assigned: 'assigned you a comment', share_with_ask: 'shared it and asked you something' };
  return `${item.sender || 'Someone'} ${item.kinds.map(k => words[k]).join(' and ')}.`;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Card order: group (GROUP_ORDER), then nudges first within the group, then:
 *   leads — most mature first (lead_maturity: 3 open deal, 2 HubSpot contact,
 *           1 calculator session, 0 unknown), then newest;
 *   team  — finance first, then urgency (0–3, higher first), then oldest;
 *   other groups — oldest unanswered first.
 */
export function orderItems(items) {
  const g = (i) => { const k = GROUP_ORDER.indexOf(i.category); return k < 0 ? GROUP_ORDER.length : k; };
  const nudged = (i) => ((i.nudge || 0) >= 2 ? 1 : 0);
  return [...items].sort((a, b) =>
    g(a) - g(b)
    || nudged(b) - nudged(a)
    || (a.category === 'lead' ? ((b.lead_maturity || 0) - (a.lead_maturity || 0)) || (b.last_inbound_at - a.last_inbound_at) : 0)
    || (a.category === 'team' ? (Number(!!b.finance) - Number(!!a.finance)) || ((b.urgency || 0) - (a.urgency || 0)) : 0)
    || (a.first_inbound_at - b.first_inbound_at)
    || String(a.item_key).localeCompare(String(b.item_key)));
}

// ---------------------------------------------------------------------------
// Carry-over and auto-tick
// ---------------------------------------------------------------------------

export function carryLabel(firstSeenAt, now = Date.now()) {
  if (!firstSeenAt) return null;
  // Rounded, not floored: runs are ~24 h apart give or take seconds (and DST
  // makes a day 23 or 25 h), so "yesterday" must survive 23h59m.
  const days = Math.round((now - new Date(firstSeenAt).getTime()) / DAY_MS);
  if (days <= 0) return null;
  return days === 1 ? 'from yesterday' : `${days} days`;
}

/**
 * Reconcile yesterday's items with today's.
 *
 * @param {Array} previous - stored items (state open | done | auto_done), each
 *   { id, item_key, category, state, state_at, first_seen_at, thread_ids }
 * @param {Array} fresh - today's items (from groupBySender / driveNotificationItems,
 *   classified), built from every currently-unanswered thread, including the
 *   re-fetched threads of `previous`
 * @returns {{ show: Array, autoDone: Array, reopened: Array, keptDone: Array }}
 *   show — fresh items to put on today's card, each with `previous` (the stored
 *          row, if any) and `carry` ("from yesterday" / "3 days" / null)
 *   autoDone — stored open items that have no unanswered mail any more (she replied)
 *   keptDone — stored done/auto_done items with no new inbound: stay off the card
 */
export function carryOver(previous, fresh, now = Date.now()) {
  const prevByKey = new Map(previous.map(p => [p.item_key, p]));
  const freshKeys = new Set(fresh.map(f => f.item_key));
  const show = [];
  const reopened = [];
  const keptDone = [];
  for (const item of fresh) {
    const prev = prevByKey.get(item.item_key);
    if (!prev) { show.push({ ...item, previous: null, carry: null }); continue; }
    if (prev.state === 'open') {
      show.push({ ...item, previous: prev, carry: carryLabel(prev.first_seen_at, now) });
      continue;
    }
    // done / auto_done: back only if something new arrived after it was closed.
    if (item.last_inbound_at > new Date(prev.state_at).getTime()) {
      reopened.push(prev);
      show.push({ ...item, previous: prev, carry: carryLabel(prev.first_seen_at, now), reopened: true });
    } else {
      keptDone.push(prev);
    }
  }
  // An open mail item with nothing unanswered left: she replied. Docs items
  // have no reply signal — they stay open until she presses Done.
  const autoDone = previous.filter(p => p.state === 'open' && p.category !== 'docs' && !freshKeys.has(p.item_key));
  for (const p of previous) {
    if (p.state === 'open' && p.category === 'docs' && !freshKeys.has(p.item_key)) {
      show.push({ ...p, previous: p, carry: carryLabel(p.first_seen_at, now), carried_only: true });
    }
  }
  return { show, autoDone, reopened, keptDone };
}

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

/**
 * Card order. 'promise' (commitments she made that are due) leads — ranked by
 * consequence, not arrival. 'docs' (Drive notifications that ask something
 * of her) come next to last; 'other' — mail triage wasn't sure about,
 * surfaced and never dropped — is last.
 */
export const GROUP_ORDER = Object.freeze(['promise', 'client', 'partner', 'lead', 'team', 'government', 'docs', 'other']);

export const GROUP_LABELS = Object.freeze({
  promise: 'Your promises',
  client: 'Clients',
  partner: 'Partners',
  lead: 'Leads',
  team: 'Team',
  government: 'Government programs',
  docs: 'Docs that need you',
  other: 'Not sure if this needs you'
});

/** How many days back the brief reads; older unanswered mail is left to the Stage 3 catch-up. */
export const READ_DAYS = 14;

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
export function sortThreads(threads, { since = null } = {}) {
  const mail = [];
  const notifications = [];
  const covered = [];
  const agedOut = [];
  const counts = { automated: 0, replied: 0 };
  const sinceMs = since ? new Date(since).getTime() : null;
  for (const thread of threads) {
    const state = replyState(thread);
    if (state.replied !== false) { counts.replied += state.replied === true ? 1 : 0; continue; }
    const unanswered = unansweredInbound(thread);
    const latest = unanswered[unanswered.length - 1];
    if (!latest) continue;
    // Older than the reading window: left to the Stage 3 catch-up.
    if (sinceMs != null && latest.internal_date < sinceMs) { agedOut.push(thread.id); continue; }
    // A colleague already answered the outside sender: never reply below them.
    const by = coveredBy(thread);
    if (by) { covered.push({ thread_id: thread.id, by }); continue; }
    if (isDriveNotification(latest)) { notifications.push(thread); continue; }
    // A bill is never "automated": invoices from billing@ / no-reply senders
    // carry List-Unsubscribe too, and must still surface.
    if (isAutomated(latest) && !isBill(latest)) { counts.automated += 1; continue; }
    mail.push({ thread, latest, unanswered });
  }
  return { mail, notifications, covered, agedOut, counts };
}

/**
 * Who covered this thread? A non-draft message from another @granted.ca
 * address after the latest EXTERNAL inbound → that colleague's name. Internal-
 * only threads have no external inbound and are never "covered".
 */
export function coveredBy(thread) {
  const real = (thread.messages || []).filter(m => !m.is_draft);
  const external = real.filter(m => !m.from_user && !isInternal(addressOf(m.from)) && !isDriveNotification(m));
  if (!external.length) return null;
  const lastExternal = external.reduce((t, m) => Math.max(t, m.internal_date), 0);
  const colleague = real.filter(m => !m.from_user && isInternal(addressOf(m.from)) && m.internal_date > lastExternal)
    .sort((a, b) => b.internal_date - a.internal_date)[0];
  return colleague ? displayName(colleague.from) : null;
}

/** "Covered by Ruk: 2 threads · Tom: 1 thread" — names only, for the card footer. */
export function coveredSummary(covered) {
  const byName = new Map();
  for (const c of covered) byName.set(c.by, (byName.get(c.by) || 0) + 1);
  return [...byName.entries()].map(([by, threads]) => ({ by, threads }));
}

// ---------------------------------------------------------------------------
// Bills, payment/credential safety, lookalike domains (pure)
// ---------------------------------------------------------------------------

const BILL_AMOUNT = /(?:\$|cad\s?|usd\s?)\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*\.\d{2}\s?(?:cad|usd)\b/i;
const BILL_DUE = /\b(due (date|on|by)?|payable (by|on|upon)|amount due|balance due|past due|overdue|pay by)\b/i;
const BILL_PAY = /\b(pay(ment)? (link|online|here|now)|remit|e-?transfer|interac|wire|bank transfer|eft|pay (this|the) invoice|invoice #?\w*|cheque|credit card on file)\b/i;

/** An amount owed + a due date + payment instructions. Receipts (already paid) don't match "due". */
export function isBill(msg) {
  const text = `${msg.subject || ''}\n${String(msg.body || '').slice(0, 4000)}`;
  if (/\b(receipt|payment received|thank you for your payment|paid in full)\b/i.test(text) && !BILL_DUE.test(text)) return false;
  return BILL_AMOUNT.test(text) && BILL_DUE.test(text) && BILL_PAY.test(text);
}

/** "$1,250.00 due Oct 31" for the badge, best effort. */
export function billSummary(msg) {
  const text = `${msg.subject || ''}\n${String(msg.body || '').slice(0, 4000)}`;
  const amount = (text.match(BILL_AMOUNT) || [])[0]?.trim() || null;
  const due = (text.match(/\b(?:due|payable by|pay by)\s*(?:date|on|by)?\s*:?\s*([a-z]{3,9}\.? \d{1,2}(?:,? \d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i) || [])[1] || null;
  return { amount, due };
}

/** Requests to verify by phone. Deterministic backup to the classify call: it can only add a flag. */
export const SAFETY_RE = Object.freeze({
  bank_change: /\b(new|updated?|change[ds]?|different)\b[^.\n]{0,60}\b(bank(ing)? (details|info(rmation)?|account)|remit(-| )?to|remittance (details|address)|payment (details|instructions|method)|account number|routing number|iban|swift)\b/i,
  urgent_payment: /\b(urgent(ly)?|asap|immediately|today|right away|now)\b[^.\n]{0,60}\b(wire|payment|transfer|pay)\b|\b(wire|transfer|pay)\b[^.\n]{0,30}\b(urgent(ly)?|asap|immediately|today|right away|now)\b|\b(wire|transfer) (the )?(funds|payment|money)\b|\bwire (of )?\$?\s?\d|\b(send|make|process) (a |the )?(wire|bank transfer)\b|\bgift cards?\b/i,
  credential: /\b(password|passcode|verification code|security code|one[- ]time (code|password)|2fa|mfa|login (details|credentials|info)|sign[- ]in code|otp)\b|\b(what('?s| is) (the|your)|send (me )?(the |your )?|share (the |your )?)\s*(login|username|log-?in|credentials?|code(?! of))\b/i
});

export function safetyFlag(msg) {
  const text = `${msg.subject || ''}\n${String(msg.body || '').slice(0, 4000)}`;
  for (const [kind, re] of Object.entries(SAFETY_RE)) if (re.test(text)) return kind;
  return null;
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

const unconfuse = (s) => s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/[0]/g, 'o').replace(/[1l]/g, 'i').replace(/-/g, '');
const nameOf = (domain) => String(domain || '').toLowerCase().split('.').slice(0, -1).join('.') || String(domain || '').toLowerCase();

/**
 * Does `sender` look like `known` without being it? Same name on another TLD,
 * a near-miss spelling (edit distance ≤ 2), or a homoglyph/hyphen variant
 * (rn↔m, 0↔o, 1/l↔i, granted-ca.com). Exact matches and subdomains of the
 * known domain are not lookalikes. Against granted.ca callers pass
 * maxDistance 1, so a real company like grants.ca isn't flagged.
 */
export function lookalikeOf(sender, known, { maxDistance = 2 } = {}) {
  const s = String(sender || '').toLowerCase();
  const k = String(known || '').toLowerCase();
  if (!s || !k || s === k || s.endsWith(`.${k}`)) return false;
  const sn = nameOf(s);
  const kn = nameOf(k);
  if (sn === kn) return true;                                   // acme.co vs acme.com
  if (unconfuse(s.replace(/\./g, '')) === unconfuse(k.replace(/\./g, ''))) return true;  // granted-ca.com vs granted.ca
  if (unconfuse(sn) === unconfuse(kn)) return true;             // rnicrosoft vs microsoft
  if (unconfuse(sn) === unconfuse(k.replace(/\./g, ''))) return true;  // granted-ca.com vs granted.ca
  // Near-miss spellings: distance 1 for short names, up to maxDistance for 6+ letters.
  const d = editDistance(sn, kn);
  return kn.length >= 4 && (d <= 1 || (kn.length >= 6 && d <= maxDistance));  // grantedd vs granted
}

// ---------------------------------------------------------------------------
// Item type, badge, draft rule (pure)
// ---------------------------------------------------------------------------

export const ITEM_TYPES = Object.freeze(['mail', 'promise', 'safety', 'sensitive', 'unhappy', 'bill', 'unsure']);

/**
 * What kind of item this is, its badge, and whether it may be drafted.
 * Precedence: safety > sensitive > bill > unhappy > unsure > mail.
 *   draft: 'none' | 'ack' (acknowledgement only) | 'normal'
 * @param {{ category, safety?, lookalike?, sensitivity?, is_bill?, bill? }} item
 */
export function decideItemType(item) {
  if (item.safety || item.lookalike) {
    return { item_type: 'safety', badge: 'Verify by phone first', draft: 'none' };
  }
  if (['legal', 'dispute', 'negotiation', 'refund'].includes(item.sensitivity)) {
    return { item_type: 'sensitive', badge: 'Sensitive · write this yourself', draft: 'none' };
  }
  if (item.is_bill) {
    const b = item.bill || {};
    const badge = ['Bill', b.amount, b.due && `due ${b.due}`].filter(Boolean).join(' · ').replace(/ · due/, ' due');
    return { item_type: 'bill', badge, draft: 'none' };
  }
  if (item.sensitivity === 'unhappy') {
    return { item_type: 'unhappy', badge: 'Unhappy client · call recommended', draft: 'ack' };
  }
  if (item.category === 'other') {
    return { item_type: 'unsure', badge: "Wasn't sure if this needs you", draft: 'none' };
  }
  return { item_type: 'mail', badge: null, draft: 'normal' };
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

// ---------------------------------------------------------------------------
// Her own words (pure)
// ---------------------------------------------------------------------------

/**
 * The text a message's author actually wrote: quoted history ("On … wrote:",
 * "-----Original Message-----", Outlook "From: … Sent: …" headers, ">" lines)
 * and everything after it removed.
 */
export function ownText(body) {
  const lines = String(body || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*On .{3,200}wrote:\s*$/i.test(l) || /^\s*On .{3,120}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] || '')) break;
    if (/^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i.test(l)) break;
    if (/^\s*From:\s.+/i.test(l) && /^\s*(Sent|Date):\s/i.test(lines[i + 1] || '')) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

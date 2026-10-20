/**
 * Steph's morning brief card — render, and the Done button.
 *
 * Laid out to be read in about 90 seconds (inbox-manager digest format):
 *   header        "Good morning, Steph" · date · N emails need you · M replies drafted
 *   explainer     what an item is and what Done means (same words every day)
 *   Start here    the 1–2 most urgent items, each with what happens if it waits
 *                 (steph-brief-rank.js — "Verify by phone first" always first)
 *   groups        Your promises → Clients → Partners → Leads → Team →
 *                 Government → Docs that need you → Not sure if this needs you
 *                 Clients, Leads and promises in full detail; the rest one line
 *   +N more       past the 10 most urgent: sender — subject, Open email, Done
 *   footer        counts only — covered by colleagues, and what was kept out of
 *                 her way. Never itemised. Money only on dry runs.
 * FYIs (no reply needed) are counted in the footer, not listed.
 *
 * Not a tracked card: like the confirm card (confirm-card.js), the brief has
 * its own table (steph_brief_items, migrations 051–053) and its own branch in
 * pressAnswer (actions.js: params.action 'brief.*'). A press marks the item
 * done and answers with the whole card rebuilt from the database, then
 * patches the message as a safety net — database work only, well inside
 * actions.js's ANSWER_BUDGET_MS.
 *
 * Only the run's recipient may press. Buttons carry the run id, so pressing
 * Done on an older brief re-renders that brief, not today's.
 */

import { button, buttonRow, buttonsAvailable, clip, esc, finalizeCards, paragraph, decorated, updateMessageResponse } from './render.js';
import { GROUP_LABELS, GROUP_ORDER, ordinal } from '../services/steph-brief-triage.js';
import { rankItems, startHere, ymd } from '../services/steph-brief-rank.js';

/** Items shown in full layout; the rest go to "+N more". */
export const SHOWN_ITEMS = 10;
/** "+N more" rows, kept under Chat's 100-widget card limit. */
export const MORE_ROWS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GREY = '#5f6368';
const ACCENT = '#1a73e8';
const BADGE = '#b06000';
const FULL_DETAIL = new Set(['promise', 'client', 'lead']);
/** Always one line, whatever their group: nothing for Steph to read in depth. */
const ONE_LINE_TYPES = new Set(['security', 'cc']);
/** Last-resort caps. The model writes to length (≤25 / ≤15 words); these only stop a runaway. */
const NET_ASSESSMENT = 400;
const NET_SUMMARY = 240;

export const EXPLAINER = 'Each item is an email waiting on you. I read the thread, checked HubSpot, Drive, Granola and Chat, and saved a reply in your Gmail drafts. Open it, edit, send. Replying ticks it off here automatically. Press Done if you handled it another way.';

const defaultQuery = async (...a) => (await import('../database/connection.js')).query(...a);
const defaultPatch = async (...a) => (await import('./chat-api.js')).patchCard(...a);

/** "Tue Oct 20" from the run's local_date — a Date (pg DATE) or a 'YYYY-MM-DD' string. */
export function briefDate(localDate) {
  const d = ymd(localDate);
  if (!d) return '';
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
}

const money = (v) => `$${(Number(v) || 0).toFixed(Number(v) < 0.01 ? 4 : 3)}`;
const modelLabel = (m) => (/haiku/i.test(m) ? 'Haiku' : /sonnet/i.test(m) ? 'Sonnet' : String(m || ''));
const daysSince = (at, now = Date.now()) => (at ? Math.max(0, Math.floor((now - new Date(at).getTime()) / 86400000)) : 0);

/** "Run cost $0.84 — classify $0.010 · drafts $0.050 · …" (dry-run card only). */
export function runCostLine(c) {
  if (!c) return null;
  const parts = [['classify', c.classify], ['promises', c.promises], ['learning', c.learn], ['drafts', c.drafting], ['Oracle', c.oracle],
    ['web lookups', c.website], ['search fees', c.search_fees], ['comparison', c.compare]].filter(([, v]) => v > 0).map(([k, v]) => `${k} ${money(v)}`);
  return `Run cost ${money(c.total)}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function linkButton(text, url) {
  return { text, onClick: { openLink: { url } } };
}

const gmailBase = (mailbox) => `https://mail.google.com/mail/u/${encodeURIComponent(mailbox || '0')}`;

/** Open draft (when one was saved), Open doc (Drive items), else Open email. */
export function openLink(item, mailbox) {
  if (item.draft_message_id) return { text: 'Open draft', url: `${gmailBase(mailbox)}/#drafts?compose=${encodeURIComponent(item.draft_message_id)}` };
  const docId = /^doc:([A-Za-z0-9_-]{20,})$/.exec(item.item_key || '')?.[1];
  if (item.category === 'docs' && docId) return { text: 'Open doc', url: `https://drive.google.com/open?id=${docId}` };
  const thread = (item.thread_ids || []).at(-1);
  return thread ? { text: 'Open email', url: `${gmailBase(mailbox)}/#all/${encodeURIComponent(thread)}` } : null;
}

function actions(item, run, mailbox) {
  if (item.state !== 'open') return null;
  const buttons = [];
  const open = openLink(item, mailbox);
  if (open) buttons.push(linkButton(open.text, open.url));
  if (buttonsAvailable()) buttons.push(button('Done', { action: 'brief.done', runId: run.id, itemId: item.id }));
  return buttons.length ? buttonRow(buttons) : null;
}

// ---------------------------------------------------------------------------
// Item text
// ---------------------------------------------------------------------------

/** The badges for an item, most important first. */
export function badgesOf(item, now = Date.now()) {
  const out = [];
  if (item.badge) out.push(item.badge);
  if (item.held && item.item_type === 'mail') out.push('Holding reply · check first');
  if ((item.nudge || 0) >= 2) { const d = daysSince(item.first_inbound_at, now); out.push(`${ordinal(item.nudge)} follow-up · ${d} ${d === 1 ? 'day' : 'days'}`); }
  if (item.carry) out.push(item.carry === 'from yesterday' ? 'From yesterday' : `Waiting ${item.carry}`);
  if (item.sent_to) out.push(`Sent to ${item.sent_to}`);
  return out;
}

const NO_DRAFT_WHY = {
  safety: 'verify the request by phone first',
  sensitive: 'write this one yourself',
  bill: 'pay it or pass it to finance',
  unsure: "not sure it needs a reply",
  security: 'a security alert for IT',
  cc: "you're only cc'd",
  promise: "the facts to keep this promise aren't in the thread"
};

function draftLine(item) {
  const hasDraft = item.draft_ids?.length || item.draft_preview;
  if (item.held && hasDraft) {
    const unclear = /Unclear: ([^]*?)(?=(Held back|Removed a meeting|$))/.exec(item.note || '')?.[1]?.trim();
    return `<b>Before you send:</b> ${esc(clip(unclear || 'the draft is a holding reply — confirm the facts first', 220))}`;
  }
  // What the draft DOES, in the drafting call's own words — never its first sentence.
  if (hasDraft && item.draft_summary) return `<b>Draft says:</b> ${esc(clip(item.draft_summary, NET_SUMMARY))}`;
  if (hasDraft) return '<b>Draft saved</b> in your Gmail drafts.';
  const why = NO_DRAFT_WHY[item.item_type] || (item.item_type === 'mail' ? "past today's draft limit" : null);
  return `<b>No draft</b>${why ? ` — ${esc(why)}` : ''}`;
}

/** The note without its "Unclear: …" part (which the draft line shows). */
function otherNote(note) {
  return String(note || '').replace(/Unclear: [^]*?(?=(Held back|Removed a meeting|Grant match|A draft already|Lead lookup|No GetGranted|GetGranted lookup|Context lookup|Draft could not|$))/, '').trim();
}

function who(item) {
  const sender = clip(item.sender || 'Unknown sender', 60);
  const company = item.company && !String(item.sender || '').toLowerCase().includes(String(item.company).toLowerCase()) ? clip(item.company, 50) : null;
  return company ? `${sender}, ${company}` : sender;
}

function strike(html, done) {
  return done ? `<font color="${GREY}">✅ <s>${html}</s></font>` : html;
}

function fullItem(item, run, { dryRun, mailbox, now }) {
  const done = item.state !== 'open';
  const lines = [
    `<b>${esc(who(item))}</b> — ${esc(clip(item.subject || '(no subject)', 120))}`,
    item.assessment ? `<b>What's going on:</b> ${esc(clip(item.assessment, NET_ASSESSMENT))}` : null,
    item.facts_line ? `<font color="${GREY}">${esc(clip(item.facts_line, 200))}</font>` : null,
    draftLine(item),
    item.sources?.length ? `<font color="${GREY}">Checked ${esc(item.sources.join(', '))}</font>` : null,
    item.note && item.item_type === 'safety' ? `<font color="${BADGE}">⚠️ ${esc(clip(item.note, 200))}</font>` : null,
    // Other notes (missing match facts, an existing draft, a held-back reason);
    // "Unclear: …" already feeds "Before you send".
    item.note && item.item_type !== 'safety' && otherNote(item.note) ? `<font color="${GREY}">Note: ${esc(clip(otherNote(item.note), 200))}</font>` : null
  ].filter(Boolean);
  const badges = badgesOf(item, now);
  const widgets = [decorated({ top: badges.length ? clip(badges.join(' · '), 120) : null, text: strike(lines.join('<br>'), done) })];
  const row = actions(item, run, mailbox);
  if (row) widgets.push(row);
  if (dryRun && !done) widgets.push(...dryRunExtras(item));
  return widgets;
}

function oneLineItem(item, run, { dryRun, mailbox, now }) {
  const done = item.state !== 'open';
  const summary = clip(item.summary || item.assessment || item.subject || '', NET_SUMMARY);
  const noDraft = !item.draft_ids?.length && !item.draft_preview && item.category !== 'docs'
    ? ` <font color="${GREY}">· No draft${item.owner_hint ? `; suggest ${esc(clip(item.owner_hint, 60))}` : ''}</font>` : '';
  const warn = item.note && item.item_type === 'safety' ? `<br><font color="${BADGE}">⚠️ ${esc(clip(item.note, 160))}</font>` : '';
  const text = `<b>${esc(who(item))}</b> — ${esc(summary)}${noDraft}${warn}`;
  const badges = badgesOf(item, now);
  const widgets = [decorated({ top: badges.length ? clip(badges.join(' · '), 120) : null, text: strike(text, done) })];
  const row = actions(item, run, mailbox);
  if (row) widgets.push(row);
  if (dryRun && !done) widgets.push(...dryRunExtras(item));
  return widgets;
}

function dryRunExtras(item) {
  const out = [];
  if (item.draft_preview) {
    const label = `Draft${item.model ? ` · ${modelLabel(item.model)}` : ''}${item.cost_usd != null ? ` · ${money(item.cost_usd)}` : ''}`;
    out.push(paragraph(`<font color="${GREY}"><i>${esc(label)}:</i> ${esc(clip(item.draft_preview, 600)).replace(/\n/g, '<br>')}</font>`));
  }
  let cmp = item.compare;
  if (typeof cmp === 'string') { try { cmp = JSON.parse(cmp); } catch { cmp = null; } }
  if (cmp?.draft) {
    out.push(paragraph(`<font color="${GREY}"><i>${esc(`${cmp.label} · ${modelLabel(cmp.model)} · ${money(cmp.cost_usd)}`)}:</i> ${esc(clip(cmp.draft, 600)).replace(/\n/g, '<br>')}</font>`));
  }
  return out;
}

function moreRow(item, run, mailbox) {
  const open = openLink(item, mailbox);
  const text = `<b>${esc(clip(item.sender || 'Unknown sender', 50))}</b> — ${esc(clip(item.subject || '(no subject)', 80))}${open ? ` · <a href="${open.url}">${esc(open.text)}</a>` : ''}`;
  return decorated({
    text: strike(text, item.state !== 'open'),
    buttonSpec: item.state === 'open' && buttonsAvailable() ? button('Done', { action: 'brief.done', runId: run.id, itemId: item.id }) : null
  });
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

/** "Kept out of your way: 12 notifications, 3 sales pitches, 2 FYIs (no reply needed), 4 emails to former staff". */
export function keptOutLine(counts, fyis) {
  const n = (v) => Number(v) || 0;
  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const notifications = n(counts.automated) + n(counts.handled) + n(counts.notifications_dropped);
  const parts = [
    notifications && plural(notifications, 'notification', 'notifications'),
    n(counts.vendor) && plural(n(counts.vendor), 'sales pitch', 'sales pitches'),
    fyis && plural(fyis, 'FYI (no reply needed)', 'FYIs (no reply needed)'),
    n(counts.former_staff_kept_out) && plural(n(counts.former_staff_kept_out), 'email to former staff', 'emails to former staff')
  ].filter(Boolean);
  return parts.length ? `Kept out of your way: ${parts.join(', ')}.` : null;
}

export function coveredLine(counts) {
  return Array.isArray(counts.covered) && counts.covered.length
    ? `Covered by colleagues: ${counts.covered.map(c => `${c.by} (${c.threads})`).join(', ')}.` : null;
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/**
 * @param {object} run - steph_brief_runs row (id, local_date, is_test, owner_email, counts)
 * @param {Array} items - steph_brief_items rows in card order, each optionally with `carry`
 * @param {{ dryRun?: boolean, now?: number }} [opts]
 * @returns {Array} cardsV2
 */
export function renderBrief(run, items, { dryRun = !!run.is_test, now = Date.now() } = {}) {
  const counts = run.counts || {};
  const mailbox = run.owner_email;
  const today = ymd(run.local_date) || new Date(now).toISOString().slice(0, 10);
  // FYIs are counted in the footer, not listed.
  const fyis = items.filter(i => i.no_reply).length;
  const listed = items.filter(i => !i.no_reply);
  const ranked = rankItems(listed, { today, now });
  const shown = new Set(ranked.slice(0, SHOWN_ITEMS).map(r => r.item.id));
  const more = ranked.slice(SHOWN_ITEMS).map(r => r.item);

  const needYou = listed.filter(i => i.state === 'open').length;
  const drafted = listed.filter(i => i.draft_ids?.length || i.draft_preview).length;

  const sections = [{ widgets: [paragraph(`<font color="${GREY}">${esc(EXPLAINER)}</font>`)] }];

  const first = startHere(listed, { today, now });
  if (first.length) {
    const lines = first.map((r, i) => `${i === 0 ? '' : 'Then '}<b>${esc(clip(r.item.sender || 'Unknown sender', 60))}</b> — ${esc(r.reason)}.`);
    sections.push({ header: `<font color="${ACCENT}">👉 Start here</font>`, widgets: [paragraph(`<font color="${ACCENT}">${lines.join('<br>')}</font>`)] });
  }

  for (const group of GROUP_ORDER) {
    const inGroup = listed.filter(i => i.category === group && shown.has(i.id));
    if (!inGroup.length) continue;
    const render = (i) => (FULL_DETAIL.has(group) && !ONE_LINE_TYPES.has(i.item_type) ? fullItem : oneLineItem)(i, run, { dryRun, mailbox, now });
    sections.push({
      header: `${GROUP_LABELS[group]} · ${inGroup.length}`,
      widgets: inGroup.flatMap(render)
    });
  }
  if (!listed.length) sections.push({ widgets: [paragraph('Nothing waiting on you in the last 14 days.')] });

  if (more.length) {
    const rows = more.slice(0, MORE_ROWS).map(i => moreRow(i, run, mailbox));
    if (more.length > MORE_ROWS) rows.push(paragraph(`<font color="${GREY}">…and ${more.length - MORE_ROWS} more in your inbox.</font>`));
    sections.push({ header: `+${more.length} more`, widgets: rows });
  }

  const footer = [
    coveredLine(counts),
    keptOutLine(counts, fyis),
    counts.auto_done ? `${counts.auto_done} ticked off since the last brief — you replied.` : null,
    dryRun && counts.cost ? runCostLine(counts.cost) : null
  ].filter(Boolean);
  if (footer.length) sections.push({ widgets: footer.map(line => paragraph(`<font color="${GREY}">${esc(line)}</font>`)) });

  return finalizeCards([{
    cardId: `steph-brief-${run.id}`,
    card: {
      header: {
        title: dryRun ? 'DRY RUN — Good morning, Steph' : 'Good morning, Steph',
        subtitle: `${briefDate(run.local_date)} · ${needYou} ${needYou === 1 ? 'email needs' : 'emails need'} you · ${drafted} ${drafted === 1 ? 'reply' : 'replies'} drafted${dryRun ? ' (not saved)' : ''}`
      },
      sections
    }
  }]);
}

/** One run's card from the database. */
export async function loadBriefCard(runId, query = defaultQuery) {
  const r = await query('SELECT * FROM steph_brief_runs WHERE id = $1', [runId]);
  const run = r.rows[0];
  if (!run) return null;
  const ids = run.item_ids || [];
  const items = ids.length
    ? (await query('SELECT * FROM steph_brief_items WHERE id = ANY($1::uuid[])', [ids])).rows
    : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const carry = run.counts?.carry || {};
  return { run, items: items.map(i => ({ ...i, carry: carry[i.id] || null })) };
}

/**
 * The Done button. Returns updateMessageResponse(cardsV2), or {} when the
 * press is ignored (bad parameters, not the recipient, unknown run).
 */
export async function handleBriefClick(evt, { query = defaultQuery, patchCard = defaultPatch } = {}) {
  const params = evt.parameters || {};
  const runId = Number(params.runId);
  if (params.action !== 'brief.done' || !UUID.test(params.itemId || '') || !Number.isInteger(runId) || !evt.actorChatId) {
    console.log('↩️  Brief click ignored — reason: missing_parameters');
    return {};
  }
  const loaded = await loadBriefCard(runId, query);
  if (!loaded) return {};
  if (!loaded.run.recipient_chat_id || evt.actorChatId !== loaded.run.recipient_chat_id) {
    console.log('↩️  Brief click ignored — reason: not_the_recipient');
    return {};
  }
  if (!(loaded.run.item_ids || []).includes(params.itemId)) return {};
  await query(
    `UPDATE steph_brief_items SET state = 'done', state_at = NOW() WHERE id = $1 AND state = 'open'`,
    [params.itemId]
  );
  const fresh = await loadBriefCard(runId, query);
  const cardsV2 = renderBrief(fresh.run, fresh.items);
  if (evt.messageName) patchCard(evt.messageName, cardsV2).catch(() => {});
  console.log(`✅ Brief item done (run ${runId})`);
  return updateMessageResponse(cardsV2);
}

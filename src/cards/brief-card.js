/**
 * Steph's morning brief card — render, and the Done button.
 *
 * Not a tracked card: like the confirm card (confirm-card.js), the brief has
 * its own table (steph_brief_items, migration 051) and its own branch in
 * pressAnswer (actions.js: params.action 'brief.*'). A press marks the item
 * done and answers with the whole card rebuilt from the database, then
 * patches the message as a safety net — database work only, well inside
 * actions.js's ANSWER_BUDGET_MS.
 *
 * Only the run's recipient may press. Buttons carry the run id, so pressing
 * Done on an older brief re-renders that brief, not today's.
 */

import { button, buttonsAvailable, clip, esc, finalizeCards, paragraph, decorated, updateMessageResponse } from './render.js';
import { GROUP_LABELS, GROUP_ORDER, nudgeLabel } from '../services/steph-brief-triage.js';

export const MAX_ITEMS = 40;
export const MAX_ITEMS_DRY_RUN = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GREY = '#5f6368';

const defaultQuery = async (...a) => (await import('../database/connection.js')).query(...a);
const defaultPatch = async (...a) => (await import('./chat-api.js')).patchCard(...a);

function weekday(ymd) {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const daysSince = (at) => (at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000)) : 0);

const money = (v) => `$${(Number(v) || 0).toFixed(Number(v) < 0.01 ? 4 : 3)}`;
const modelLabel = (m) => (/haiku/i.test(m) ? 'Haiku' : /sonnet/i.test(m) ? 'Sonnet' : String(m || ''));

/** "Run cost $0.84 — classify $0.010 · drafts $0.050 · …" (dry-run card only). */
export function runCostLine(c) {
  if (!c) return null;
  const parts = [['classify', c.classify], ['drafts', c.drafting], ['Oracle', c.oracle], ['web lookups', c.website],
    ['search fees', c.search_fees], ['comparison', c.compare]].filter(([, v]) => v > 0).map(([k, v]) => `${k} ${money(v)}`);
  return `Run cost ${money(c.total)}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
}

function itemMeta(item, { carry }) {
  return [
    item.nudge >= 2 && nudgeLabel(item.nudge, item.nudge_days ?? daysSince(item.first_inbound_at)),
    carry,
    item.category === 'docs' ? null
      : item.no_reply ? 'no reply needed'
        : (item.draft_ids?.length ? 'draft saved' : item.draft_preview ? 'draft (dry run — not saved)' : 'no draft'),
    item.owner_hint && `suggest: ${item.owner_hint}`
  ].filter(Boolean).join(' · ');
}

function itemWidgets(item, run, { dryRun }) {
  const done = item.state !== 'open';
  const head = `<b>${esc(clip(item.sender || 'Unknown sender', 80))}</b> — ${esc(clip(item.subject || '(no subject)', 120))}`;
  const lines = [
    head,
    item.assessment ? esc(clip(item.assessment, 300)) : null,
    item.facts_line ? `<font color="${GREY}">${esc(clip(item.facts_line, 240))}</font>` : null,
    item.note ? `<font color="${GREY}">⚠️ ${esc(clip(item.note, 300))}</font>` : null
  ].filter(Boolean);
  const meta = itemMeta(item, { carry: item.carry || null });
  const text = done
    ? `<font color="${GREY}">✅ <s>${lines.join('<br>')}</s></font>`
    : lines.join('<br>') + (meta ? `<br><font color="${GREY}">${esc(meta)}</font>` : '');
  const widgets = [decorated({
    text,
    buttonSpec: !done && buttonsAvailable() ? button('Done', { action: 'brief.done', runId: run.id, itemId: item.id }) : null
  })];
  if (dryRun && item.draft_preview && !done) {
    const label = `Draft${item.model ? ` · ${modelLabel(item.model)}` : ''}${item.cost_usd != null ? ` · ${money(item.cost_usd)}` : ''}`;
    widgets.push(paragraph(`<font color="${GREY}"><i>${esc(label)}:</i> ${esc(clip(item.draft_preview, 700)).replace(/\n/g, '<br>')}</font>`));
    let cmp = item.compare;
    if (typeof cmp === 'string') { try { cmp = JSON.parse(cmp); } catch { cmp = null; } }
    if (cmp?.draft) {
      widgets.push(paragraph(`<font color="${GREY}"><i>${esc(`${cmp.label} · ${modelLabel(cmp.model)} · ${money(cmp.cost_usd)}`)}:</i> ${esc(clip(cmp.draft, 700)).replace(/\n/g, '<br>')}</font>`));
    }
  }
  return widgets;
}

/**
 * @param {object} run - steph_brief_runs row (id, local_date, is_test, counts)
 * @param {Array} items - steph_brief_items rows in card order, each optionally with `carry`
 * @returns {Array} cardsV2
 */
export function renderBrief(run, items, { dryRun = !!run.is_test } = {}) {
  const max = dryRun ? MAX_ITEMS_DRY_RUN : MAX_ITEMS;
  const shown = items.slice(0, max);
  const open = items.filter(i => i.state === 'open').length;
  const drafts = items.filter(i => i.draft_ids?.length).length;
  const counts = run.counts || {};

  const sections = [];
  for (const group of GROUP_ORDER) {
    const inGroup = shown.filter(i => i.category === group);
    if (!inGroup.length) continue;
    sections.push({
      header: `${GROUP_LABELS[group]} (${inGroup.length})`,
      widgets: inGroup.flatMap(i => itemWidgets(i, run, { dryRun }))
    });
  }
  if (!sections.length) sections.push({ widgets: [paragraph('Nothing unanswered in your inbox since the last brief.')] });

  const footer = [
    items.length > max && `${items.length - max} more not shown.`,
    counts.auto_done && `${counts.auto_done} ticked off — you replied.`,
    [counts.automated && `${counts.automated} automated`, counts.vendor && `${counts.vendor} vendor pitches`,
      counts.handled && `${counts.handled} receipts & newsletters`, counts.notifications_dropped && `${counts.notifications_dropped} doc notifications`]
      .filter(Boolean).join(' · ') + (counts.automated || counts.vendor || counts.handled || counts.notifications_dropped ? ' skipped.' : ''),
    // A colleague already answered these: never drafted, never items.
    Array.isArray(counts.covered) && counts.covered.length
      ? `Covered by colleagues: ${counts.covered.map(c => `${c.by} (${c.threads})`).join(', ')}.` : null,
    counts.no_draft_cap && `${counts.no_draft_cap} past today's draft limit — assessed only.`,
    dryRun && counts.cost && runCostLine(counts.cost)
  ].filter(Boolean);
  if (footer.length) sections.push({ widgets: [paragraph(`<font color="${GREY}">${esc(footer.join(' '))}</font>`)] });

  return finalizeCards([{
    cardId: `steph-brief-${run.id}`,
    card: {
      header: {
        title: dryRun ? `DRY RUN — Steph's brief · ${weekday(run.local_date)}` : `Morning brief · ${weekday(run.local_date)}`,
        subtitle: `${open} to answer · ${drafts} draft${drafts === 1 ? '' : 's'} saved${dryRun ? ' (none in dry run)' : ''}`
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

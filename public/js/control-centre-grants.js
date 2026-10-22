/**
 * Control Centre — Grants tab.
 *
 *   #grants                          every live grant: three views, sortable, filterable,
 *   #grants?view=most_ignored&sort=ignored&dir=desc&q=swpp
 *                                    follows the range and "Include internal accounts"
 *   #grants/<id>                     one grant: companies matched by goal track (Why
 *                                    matched? / Flag), tags vs card text, engagement
 *                                    trend, recent edits, review cards
 *
 * Data: GET /api/control-centre/grants?range=&view= (both variants — client-only
 * and with internal accounts — so the switch needs no refetch) and
 * /grants/:id?range=. "Why matched?" and "Flag as bad match" are the Companies
 * tab's own (CCCompanies.toggleWhy / toggleFlag). Loaded before
 * control-centre.js, which calls CCGrants.render(panel, ctx).
 * Docs: docs/control-centre.md (Grants tab).
 */
(function () {
  'use strict';

  const API = '/api/control-centre/grants';
  const VIEWS = [
    { key: 'all', label: 'All grants', sub: 'Every live grant.' },
    { key: 'most_ignored', label: 'Most ignored', sub: 'Displayed to at least 3 clients in the range, most “shown but never opened” first.' },
    { key: 'not_matching', label: 'Not matching anyone', sub: 'Live grants no client was matched to in the range, longest since their last match first.' }
  ];
  const COLUMNS = [
    { key: 'title', label: 'Grant', type: 'text' },
    { key: 'clients_matched', label: 'Clients matched', type: 'num', hint: 'Clients the engine showed this grant to in the range' },
    { key: 'opens', label: 'Card opens', type: 'num', hint: 'Grant card opens in the range' },
    { key: 'saves', label: 'Saves', type: 'num', hint: 'Added to a watchlist in the range' },
    { key: 'cuts', label: 'AI cuts', type: 'num', hint: 'Clients the AI review cut this grant for in the range' },
    { key: 'ignored', label: 'Shown, never opened', type: 'num', hint: 'Clients it was displayed to (not cut by the AI review) who have never opened its card' },
    { key: 'bounced', label: 'Bounced', type: 'num', hint: 'Card opens with under 3 seconds on screen' },
    { key: 'removed', label: 'Removed', type: 'num', hint: 'Taken off a watchlist in the range' },
    { key: 'open_cards', label: 'Open cards', type: 'num', hint: 'Review cards about this grant that are still open' },
    { key: 'last_matched', label: 'Last matched', type: 'date', hint: 'The last day any client was matched to it' }
  ];
  const DEFAULT_SORT = { all: ['clients_matched', 'desc'], most_ignored: ['ignored', 'desc'], not_matching: ['last_matched', 'asc'] };
  const ELIGIBILITY_WORDS = { Likely: 'Likely eligible', Possible: 'Possibly eligible', Unlikely: 'Unlikely eligible' };
  const STATUS_WORDS = { new: 'New', diagnosed: 'Diagnosed', in_progress: 'In progress', closed: 'Closed' };
  const OWNER_WORDS = { client: 'Client', research: 'Research', chris: 'Chris', jason: 'Jason', consulting: 'Consulting' };
  const TYPE_WORDS = { match: 'Match', grant_pattern: 'Grant pattern', chat: 'Chat', empty_track: 'Empty track', grant_deadline: 'Deadline' };
  const TREND = [
    { key: 'opens', label: 'Card opens' },
    { key: 'saves', label: 'Saves' },
    { key: 'bounces', label: 'Bounces' },
    { key: 'removals', label: 'Removals' },
    { key: 'ignored', label: 'Shown, never opened' }
  ];

  let ctx = null;
  const listCache = new Map();   // `${range}|${view}` → payload
  const pageCache = new Map();   // `${range}|${id}` → payload
  let seq = 0;

  const esc = (v) => ctx.esc(v);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}${y !== new Date().getFullYear() ? `, ${y}` : ''}`;
  };
  const when = (iso) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' });
  /** "2000000" → "Up to $2,000,000"; free text stays as written; 0 or blank → nothing. */
  const money = (v) => {
    const t = String(v ?? '').trim();
    if (!t || t === '0') return null;
    return /^\d+(\.\d+)?$/.test(t) ? `Up to $${Number(t).toLocaleString('en-CA')}` : t;
  };
  const internalTag = (on) => (on ? ' <span class="cc-tag-internal">Internal</span>' : '');
  const variant = () => (ctx.includeInternal() ? 'all' : 'clients');

  // ---------------------------------------------------------------- routing helpers
  function readQuery() {
    const q = new URLSearchParams(ctx.state().gq || '');
    const view = VIEWS.some((v) => v.key === q.get('view')) ? q.get('view') : 'all';
    const [ds, dd] = DEFAULT_SORT[view];
    const sort = COLUMNS.some((c) => c.key === q.get('sort')) ? q.get('sort') : ds;
    const dir = q.get('dir') === 'asc' || q.get('dir') === 'desc' ? q.get('dir') : (q.get('sort') ? (sort === 'title' ? 'asc' : 'desc') : dd);
    return { view, sort, dir, q: q.get('q') || '' };
  }
  function writeQuery(next) {
    const p = new URLSearchParams();
    if (next.view !== 'all') p.set('view', next.view);
    const [ds, dd] = DEFAULT_SORT[next.view];
    if (next.sort !== ds || next.dir !== dd) { p.set('sort', next.sort); p.set('dir', next.dir); }
    if (next.q) p.set('q', next.q);
    return p.toString();
  }

  // ---------------------------------------------------------------- render
  async function render(panel, helpers) {
    ctx = helpers;
    const id = ctx.state().grant;
    if (id) return renderPage(panel, id);
    return renderList(panel);
  }

  // ---------------------------------------------------------------- list
  async function renderList(panel) {
    const my = ++seq;
    const range = ctx.state().range;
    const { view } = readQuery();
    const key = `${range}|${view}`;
    if (!panel.querySelector('.gr-list')) { panel.innerHTML = '<div class="cc-card"><div class="cc-skel" style="width:30%"></div><div class="cc-skel" style="width:80%"></div><div class="cc-skel" style="width:70%"></div></div>'; }
    panel.classList.add('cc-loading');
    let data = listCache.get(key);
    if (!data) {
      try {
        data = await ctx.api(`${API}?range=${range}&view=${view}`);
        listCache.set(key, data);
      } catch (err) {
        if (my !== seq) return;
        panel.classList.remove('cc-loading');
        panel.innerHTML = `<div class="cc-error">${esc(err.status === 503 ? "The grant list can't reach its databases right now." : "The grant list didn't load. Refresh the page to try again.")}</div>`;
        return;
      }
    }
    if (my !== seq || ctx.state().tab !== 'grants' || ctx.state().grant) return;
    panel.classList.remove('cc-loading');
    paintList(panel, data);
  }

  const valueOf = (g, key) => {
    if (key === 'title') return g.title.toLowerCase();
    if (key === 'last_matched') return g.last_matched ?? '';   // "Never" sorts as the oldest
    return g[key] ?? 0;
  };

  function paintList(panel, data) {
    const { view, sort, dir, q } = readQuery();
    const internal = ctx.includeInternal();
    const needle = q.trim().toLowerCase();
    let rows = data[variant()];
    if (needle) rows = rows.filter((g) => g.title.toLowerCase().includes(needle) || String(g.grant_id) === needle
      || String(g.grantor || '').toLowerCase().includes(needle));
    rows = [...rows].sort((a, b) => {
      const va = valueOf(a, sort); const vb = valueOf(b, sort);
      const cmp = va < vb ? -1 : va > vb ? 1 : a.title.localeCompare(b.title);
      return dir === 'asc' ? cmp : -cmp;
    });
    const other = data[internal ? 'clients' : 'all'].length;
    const first = !panel.querySelector('.gr-list');
    const arrow = (k) => (k === sort ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
    const v = VIEWS.find((x) => x.key === view);
    const cols = view === 'not_matching' ? COLUMNS : COLUMNS.filter((c) => c.key !== 'last_matched');
    const cell = (g, c) => {
      if (c.key === 'title') return `<td><span class="co-name">${esc(g.title)}</span> <span class="cc-muted co-id">#${g.grant_id}</span>${g.grantor ? `<div class="cc-muted gr-grantor">${esc(g.grantor)}</div>` : ''}</td>`;
      if (c.key === 'last_matched') return `<td>${g.last_matched ? esc(day(g.last_matched)) : '<span class="gr-never">Never</span>'}</td>`;
      const n = g[c.key] ?? 0;
      const hot = (c.key === 'ignored' || c.key === 'bounced' || c.key === 'removed' || c.key === 'cuts') && n > 0;
      if (c.key === 'open_cards') return `<td class="num">${n ? `<span class="co-open">${ctx.fmt(n)}</span>` : '0'}</td>`;
      return `<td class="num${hot ? ' gr-hot' : ''}${n === 0 ? ' gr-zero' : ''}">${ctx.fmt(n)}</td>`;
    };
    panel.innerHTML = `<section class="cc-card co-list gr-list${first && !ctx.reduceMotion ? ' co-enter' : ''}">
      <div class="co-list-head">
        <div><h2>Grants</h2>
          <p class="cc-sub">${esc(v.sub)} Counts are ${esc(ctx.rangeWords(data.range))}.</p></div>
        <div class="co-tools">
          <input type="search" class="co-filter gr-filter" placeholder="Filter by grant name, ID or funder" value="${esc(q)}" aria-label="Filter grants">
          <label class="cc-switch"><input type="checkbox" role="switch" ${internal ? 'checked' : ''}><span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label>
        </div>
      </div>
      <div class="gr-views" role="tablist" aria-label="Grant lists">${VIEWS.map((x) => `<button type="button" role="tab" class="gr-view" data-view="${x.key}" aria-selected="${x.key === view}">${esc(x.label)}</button>`).join('')}</div>
      <p class="co-count">${ctx.plural(rows.length, 'grant')}${view !== 'all' ? ` of ${ctx.fmt(data.live_grants)} live` : ''}${other !== data[variant()].length ? ` · ${ctx.fmt(other)} ${internal ? 'without' : 'with'} internal accounts` : ''}</p>
      <div class="co-scroll"><table class="cc-table co-table gr-table">
        <thead><tr>${cols.map((c) => `<th scope="col" class="${c.type === 'num' ? 'num' : ''}" aria-sort="${c.key === sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
          <button type="button" data-sort="${c.key}"${c.hint ? ` title="${esc(c.hint)}"` : ''}>${esc(c.label)}${arrow(c.key)}</button></th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map((g) => `<tr tabindex="0" data-id="${g.grant_id}">${cols.map((c) => cell(g, c)).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="cc-empty">${needle ? `No grant matches “${esc(q)}”.` : view === 'most_ignored' ? 'No grant was displayed to 3 or more clients in this range.' : view === 'not_matching' ? 'Every live grant matched at least one client in this range.' : 'No live grants.'}</td></tr>`}</tbody>
      </table></div>
    </section>`;

    panel.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      const next = b.dataset.view;
      const [s, d] = DEFAULT_SORT[next];
      ctx.go({ gq: writeQuery({ view: next, sort: s, dir: d, q }) }, { push: false });
    }));
    panel.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.sort;
      const nextDir = key === sort ? (dir === 'asc' ? 'desc' : 'asc') : (key === 'title' || key === 'last_matched' ? 'asc' : 'desc');
      ctx.go({ gq: writeQuery({ view, sort: key, dir: nextDir, q }) }, { push: false });
    }));
    const filter = panel.querySelector('.gr-filter');
    let t = null;
    filter.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        ctx.go({ gq: writeQuery({ view, sort, dir, q: filter.value.trim() }) }, { push: false });
        const f = document.querySelector('.gr-filter'); f?.focus(); f?.setSelectionRange(f.value.length, f.value.length);
      }, 200);
    });
    panel.querySelector('.cc-switch input').addEventListener('change', (e) => { ctx.setIncludeInternal(e.target.checked); paintList(panel, data); });
    panel.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      const open = () => ctx.go({ grant: Number(tr.dataset.id) });
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }

  // ---------------------------------------------------------------- page
  async function renderPage(panel, id) {
    const my = ++seq;
    const range = ctx.state().range;
    const key = `${range}|${id}`;
    panel.classList.add('cc-loading');
    let data = pageCache.get(key);
    if (!data) {
      if (!panel.querySelector('.gr-page')) panel.innerHTML = '<div class="cc-card"><div class="cc-skel" style="width:45%"></div><div class="cc-skel" style="width:75%"></div><div class="cc-skel" style="width:60%"></div></div>';
      try {
        data = await ctx.api(`${API}/${id}?range=${range}`);
        pageCache.set(key, data);
      } catch (err) {
        if (my !== seq) return;
        panel.classList.remove('cc-loading');
        panel.innerHTML = `<p><a href="#grants" class="co-back">← All grants</a></p><div class="cc-error">${esc(err.status === 404 ? `Grant #${id} isn't live, so it has no page here.` : err.status === 503 ? "This grant can't reach its databases right now." : "This grant didn't load. Try again.")}</div>`;
        bindBack(panel);
        return;
      }
    }
    if (my !== seq || ctx.state().grant !== id) return;
    panel.classList.remove('cc-loading');
    paintPage(panel, data);
    window.scrollTo({ top: 0 });
  }

  function bindBack(panel) {
    panel.querySelectorAll('.co-back').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.go({ grant: null }); }));
  }

  const section = (title, sub, body, cls = '') => `<section class="cc-card co-sec ${cls}"><div class="co-sec-head"><h2>${title}</h2>${sub ? `<span class="cc-muted">${sub}</span>` : ''}</div>${body}</section>`;
  const tile = (n, label, hot = false) => `<div class="co-tile${hot ? ' gr-tile-hot' : ''}"><b>${n}</b><span>${label}</span></div>`;

  function paintPage(panel, d) {
    const first = !panel.querySelector('.gr-page');
    const internal = ctx.includeInternal();
    const t = d.totals[variant()];
    const g = d.grant;
    panel.innerHTML = `<div class="gr-page">
      <p><a href="#grants" class="co-back">← All grants</a></p>
      <header class="co-head cc-card gr-head">
        <p class="co-eyebrow">Grant</p>
        <h1>${esc(g.title)} <span class="cc-muted co-id">#${g.root_id}</span></h1>
        <p class="cc-muted">${[g.grantor, g.type, money(g.value), g.deadline ? `Deadline ${/^\d{4}-\d{2}-\d{2}/.test(g.deadline) ? day(g.deadline) : g.deadline}` : null, g.version_number ? `version ${g.version_number}` : null].filter(Boolean).map(esc).join(' · ')}</p>
        <div class="gr-head-tools"><span class="cc-muted">Counts ${esc(ctx.rangeWords(d.range))}, ${internal ? 'internal accounts included' : 'clients only'}.</span>
          <label class="cc-switch"><input type="checkbox" role="switch" ${internal ? 'checked' : ''}><span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label></div>
        <div class="co-tiles gr-tiles">
          ${tile(ctx.fmt(t.clients_matched), t.clients_matched === 1 ? 'client matched' : 'clients matched')}
          ${tile(ctx.fmt(t.opens), 'card opens')}${tile(ctx.fmt(t.saves), 'watchlist saves')}
          ${tile(ctx.fmt(t.ignored), 'shown, never opened', t.ignored > 0)}${tile(ctx.fmt(t.bounced), 'bounced', t.bounced > 0)}
          ${tile(ctx.fmt(t.removed), 'removed', t.removed > 0)}${tile(ctx.fmt(t.cuts), 'AI review cuts', t.cuts > 0)}
          ${tile(t.last_matched ? esc(day(t.last_matched)) : 'Never', 'last matched')}
        </div>
      </header>
      ${tracksHtml(d.tracks, internal, g)}
      ${trendHtml(d.trend[variant()], d)}
      ${tagsHtml(d.tags)}
      <div class="co-grid gr-grid">${cardsHtml(d.cards)}${editsHtml(d.edits)}</div>
    </div>`;
    if (first && !ctx.reduceMotion) panel.querySelector('.gr-page').classList.add('co-enter');
    bindPage(panel, d);
  }

  function tracksHtml(tracks, internal, grant) {
    const hiddenCount = tracks.reduce((n, t) => n + t.companies.filter((c) => c.internal).length, 0);
    const shown = tracks.map((t) => ({ ...t, companies: t.companies.filter((c) => internal || !c.internal) })).filter((t) => t.companies.length);
    const total = new Set(shown.flatMap((t) => t.companies.map((c) => c.company_id))).size;
    const row = (c, track) => `<li class="co-grant${c.ai_review?.action === 'cut' ? ' is-cut' : ''}">
      <div class="co-grant-main">
        <span class="co-pos">${c.best_position ? `#${c.best_position}` : '—'}</span>
        <div class="co-grant-text">
          ${c.company_id != null ? `<a class="co-grant-name" href="#companies/${c.company_id}" data-company-link="${c.company_id}">${esc(c.company_name || `Company #${c.company_id}`)}</a>${internalTag(c.internal)} <span class="cc-muted co-id">#${c.company_id}</span>`
    : '<span class="co-grant-name">A client with no company</span>'}
          <div class="co-grant-meta"><span>Last shown ${esc(day(c.last_day))}${c.days > 1 ? ` · ${c.days} days in range` : ''}</span>${c.eligibility ? `<span>${esc(ELIGIBILITY_WORDS[c.eligibility] || c.eligibility)}</span>` : ''}
            ${c.ai_review ? `<span class="co-review co-review-${esc(c.ai_review.action)}" title="${esc(c.ai_review.reason || '')}">${esc(c.ai_review.words)}</span>` : ''}</div>
          ${c.ai_review?.reason ? `<p class="co-review-reason">${esc(c.ai_review.reason)}</p>` : ''}
        </div>
        ${c.company_id != null ? `<div class="co-actions"><button type="button" class="co-btn" data-why="${grant.root_id}" data-company="${c.company_id}">Why matched?</button><button type="button" class="co-btn" data-flag="${grant.root_id}" data-company="${c.company_id}" data-name="${esc(grant.title)}" data-track="${esc(track)}">⚑ Flag as bad match</button></div>` : ''}
      </div>
      <div class="co-slot" hidden></div>
    </li>`;
    const sub = `${ctx.plural(total, 'company', 'companies')} ${esc(ctx.rangeWords(ctx.state().range))}${!internal && hiddenCount ? ` · ${ctx.fmt(hiddenCount)} internal hidden` : ''}`;
    if (!shown.length) return section('Companies matched', sub, `<p class="cc-muted">No ${internal ? '' : 'client '}company was matched to this grant ${esc(ctx.rangeWords(ctx.state().range))}.</p>`);
    return section('Companies matched', sub, `<div class="co-tracks">${shown.map((t) => `<div class="co-track"><h3>${esc(t.label)} <span class="cc-muted co-alias">${ctx.plural(t.companies.length, 'company', 'companies')}</span></h3>
      <ol class="co-grants">${t.companies.map((c) => row(c, t.label)).join('')}</ol></div>`).join('')}</div>`, 'co-tracks-sec');
  }

  /** Small multiples: one bar strip per measure, one bar per day of the range. */
  function trendHtml(series, d) {
    const many = series.length > 31;
    // The year range has 365 days: group by week so each bar stays readable.
    const points = many ? weekly(series) : series;
    const strip = (m) => {
      const max = Math.max(1, ...points.map((p) => p[m.key]));
      const total = series.reduce((n, p) => n + p[m.key], 0);
      return `<div class="gr-strip"><div class="gr-strip-head"><span>${esc(m.label)}</span><b>${ctx.fmt(total)}</b></div>
        <div class="gr-bars" style="--n:${points.length}">${points.map((p) => `<i style="--h:${(p[m.key] / max) * 100}%" class="${p[m.key] ? '' : 'is-zero'}" title="${esc(`${many ? 'Week of ' : ''}${day(p.day)}: ${p[m.key]}`)}"></i>`).join('')}</div></div>`;
    };
    return section('Engagement', `${many ? 'by week' : 'by day'}, ${esc(day(d.current.from))} – ${esc(day(d.current.to))}`,
      `<div class="gr-strips">${TREND.map(strip).join('')}</div>
      <p class="cc-muted co-note">A bounce is a card open with under ${d.definitions.bounce_ms / 1000} seconds on screen. “Shown, never opened” counts each client once, on the first day it was displayed to them (not cut by the AI review); card opens are only recorded from ${esc(day(d.definitions.opens_tracked_from))}.</p>`, 'gr-trend');
  }
  function weekly(series) {
    const out = [];
    for (let i = 0; i < series.length; i += 7) {
      const chunk = series.slice(i, i + 7);
      const p = { day: chunk[0].day };
      for (const m of TREND) p[m.key] = chunk.reduce((n, x) => n + x[m.key], 0);
      out.push(p);
    }
    return out;
  }

  function tagsHtml(tags) {
    if (!tags) return section('Tags and card text', '', '<p class="co-gap">This grant isn\'t in the Hub\'s copy of the grant data yet, so its tags and card text can\'t be shown.</p>');
    const list = (xs) => (xs?.length ? esc(xs.join(', ')) : '<span class="co-missing">None</span>');
    const elig = tags.eligibility_tags;
    const eligText = Array.isArray(elig) ? list(elig) : elig && typeof elig === 'object' ? list(Object.entries(elig).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)) : elig ? esc(elig) : '<span class="co-missing">None</span>';
    return section('Tags and card text', 'what matching reads, beside what clients read', `<div class="gr-compare">
      <div class="gr-tags"><h3>Tags</h3><table class="co-kv">
        <tr><th>Industries</th><td>${list(tags.industries)}</td></tr>
        <tr><th>Regions</th><td>${list(tags.regions)}</td></tr>
        <tr><th>Grant types</th><td>${list(tags.grant_types)}</td></tr>
        <tr><th>Eligibility</th><td>${eligText}</td></tr>
        <tr><th>Top goals</th><td>${list((tags.top_genres || []).map((x) => (typeof x === 'string' ? x : `${x.genre ?? x.name ?? ''}${x.score != null ? ` (${x.score})` : ''}`)))}</td></tr>
        <tr><th>Boosts</th><td>${list(tags.boost_tags)}</td></tr>
        ${tags.tagging_confidence ? `<tr><th>Tagging confidence</th><td>${esc(tags.tagging_confidence)}${tags.tagging_notes ? `<details class="gr-notes"><summary>Tagging notes</summary><p>${esc(tags.tagging_notes)}</p></details>` : ''}</td></tr>` : ''}
      </table></div>
      <div class="gr-card-text"><h3>Card text</h3>${tags.card.length ? tags.card.map((s) => `<details class="gr-card-sec"${s.section.toLowerCase().includes('eligib') ? ' open' : ''}><summary>${esc(s.section)}</summary><p>${esc(s.text)}</p></details>`).join('') : '<p class="co-missing">No card text on record.</p>'}</div>
    </div>`, 'gr-tags-sec');
  }

  function editsHtml(edits) {
    if (!edits.length) return section('Recent edits', '', '<p class="cc-muted">No edits on record.</p>');
    return section('Recent edits', `newest ${edits.length}`, `<ol class="gr-edits">${edits.map((e) => `<li>
        <div class="gr-edit-top"><b>${esc(e.what)}</b><span class="cc-muted">${esc(when(e.at))}</span></div>
        ${e.before || e.after ? `<p class="gr-edit-change">${e.before ? `<span class="gr-before">${esc(e.before)}</span>` : ''}${e.before && e.after ? ' → ' : ''}${e.after ? `<span class="gr-after">${esc(e.after)}</span>` : ''}</p>` : ''}
        <span class="cc-muted">by app user #${esc(e.who.user_id)}${e.who.email ? ` (${esc(e.who.email)})` : ''}</span></li>`).join('')}</ol>
      <p class="cc-muted co-note">The app doesn't store editors' names, so edits show the app user number.</p>`);
  }

  function cardsHtml(cards) {
    const open = cards.filter((c) => c.status !== 'closed').length;
    return section('Review cards', cards.length ? `${open} open` : '', cards.length
      ? `<ul class="co-cards">${cards.map((c) => `<li><a href="#review/${c.id}"><span class="rq-type rq-type-${esc(c.kind)}">${TYPE_WORDS[c.kind] || esc(c.kind)}</span> ${esc(c.title)}</a>
        <span class="cc-muted">${c.company_internal ? '<span class="cc-tag-internal">Internal</span> · ' : ''}${STATUS_WORDS[c.status] || esc(c.status)}${c.owner ? ` · ${OWNER_WORDS[c.owner] || esc(c.owner)}` : ''} · ${ctx.plural(c.flag_count, 'flag')}</span></li>`).join('')}</ul>`
      : '<p class="cc-muted">No review cards about this grant.</p>');
  }

  // ---------------------------------------------------------------- page actions
  function bindPage(panel, data) {
    bindBack(panel);
    panel.querySelector('.gr-head .cc-switch input').addEventListener('change', (e) => { ctx.setIncludeInternal(e.target.checked); paintPage(panel, data); });
    panel.querySelectorAll('a[href^="#review/"]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.goReview(Number(a.getAttribute('href').split('/')[1])); }));
    panel.querySelectorAll('[data-company-link]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.goCompany(Number(a.dataset.companyLink)); }));
    if (panel._grClick) panel.removeEventListener('click', panel._grClick);
    panel._grClick = async (e) => {
      if (!e.target.closest('.gr-page')) return;
      const why = e.target.closest('[data-why]');
      const flag = e.target.closest('[data-flag]');
      // Same components as the Companies tab: the company is the row's, the grant this page's.
      if (why) { e.preventDefault(); await window.CCCompanies.toggleWhy(why, Number(why.dataset.company), ctx.companiesCtx); }
      else if (flag) { e.preventDefault(); window.CCCompanies.toggleFlag(flag, Number(flag.dataset.company), ctx.companiesCtx); }
    };
    panel.addEventListener('click', panel._grClick);
  }

  window.CCGrants = {
    render,
    clearCache: () => { listCache.clear(); pageCache.clear(); }
  };
})();

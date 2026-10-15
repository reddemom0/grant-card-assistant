/**
 * Control Centre page (step 6). Overview is live; the other tabs are
 * placeholders until their steps land.
 *
 * State lives in the URL — ?tab=&range=&company=&grant= — so every view is
 * deep-linkable and the back button works (pushState + popstate). The last
 * range is also remembered in localStorage when it's available.
 *
 * Data: GET /api/control-centre/overview?range=…, GET /api/control-centre/search?q=…
 * Docs: docs/control-centre.md
 */
(function () {
  'use strict';

  const RANGES = ['day', 'week', 'month', 'year'];
  const RANGE_DAYS = { day: 1, week: 7, month: 30, year: 365 };
  const TABS = ['overview', 'inbox', 'companies', 'grants', 'review', 'coverage', 'themes'];
  const STORE_KEY = 'cc.range';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SOON = {
    inbox: ['Inbox', 'Every thumbs-down and staff flag that needs a look, newest first, with its diagnosis.'],
    companies: ['Companies', "Each client's journey: the grant matches on their goal tracks, the grant cards they opened, how they rated them, what they asked."],
    grants: ['Grants', 'Each grant: how many clients it was matched to over time, who opened its grant card, and why it matched.'],
    review: ['Review queue', 'Every flagged grant match and chat answer, with its owner, diagnosis and status.'],
    coverage: ['Coverage & changes', 'What changed in matching and why, grant cards matched widely but never opened, and thin coverage by industry.'],
    themes: ['Chat themes', 'What people ask the assistant, grouped into themes you can read through.']
  };

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-CA');
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = (d) => { const [, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}`; };
  const span = (a, b) => (a === b ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`);
  // Plain words for the selected range: "this week" vs "last week".
  const NOW_WORDS = { 1: 'today', 7: 'this week', 30: 'in the last 30 days', 365: 'in the last year' };
  const BEFORE_WORDS = { 1: 'yesterday', 7: 'last week', 30: 'the 30 days before', 365: 'the year before' };
  const nowWords = (n) => NOW_WORDS[n] ?? `in the last ${n} days`;
  const beforeWords = (n) => BEFORE_WORDS[n] ?? `the ${n} days before`;
  const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${Math.abs(n) === 1 ? one : many}`;

  function storeGet() { try { return window.localStorage.getItem(STORE_KEY); } catch { return null; } }
  function storeSet(v) { try { window.localStorage.setItem(STORE_KEY, v); } catch { /* private mode etc. */ } }

  // ---------------------------------------------------------------- state + URL
  let state = { tab: 'overview', range: 'week', company: null, grant: null };
  const knownNames = { company: new Map(), grant: new Map() };
  /** companies.id of internal accounts seen in any response (search, overview). */
  const internalIds = new Set();
  const internalTag = (id) => (internalIds.has(Number(id)) ? ' <span class="cc-tag-internal">Internal</span>' : '');

  function readUrl() {
    const p = new URLSearchParams(window.location.search);
    const id = (v) => (/^\d{1,9}$/.test(v || '') ? Number(v) : null);
    const stored = storeGet();
    return {
      tab: TABS.includes(p.get('tab')) ? p.get('tab') : 'overview',
      range: RANGES.includes(p.get('range')) ? p.get('range') : (RANGES.includes(stored) ? stored : 'week'),
      company: id(p.get('company')),
      grant: id(p.get('grant'))
    };
  }

  function urlFor(s) {
    const p = new URLSearchParams();
    if (s.tab !== 'overview') p.set('tab', s.tab);
    p.set('range', s.range);
    if (s.tab === 'companies' && s.company) p.set('company', s.company);
    if (s.tab === 'grants' && s.grant) p.set('grant', s.grant);
    return `${window.location.pathname}?${p}`;
  }

  function go(next, { push = true } = {}) {
    state = { ...state, ...next };
    if (state.tab !== 'companies') state.company = null;
    if (state.tab !== 'grants') state.grant = null;
    storeSet(state.range);
    const url = urlFor(state);
    if (push) window.history.pushState(state, '', url);
    else window.history.replaceState(state, '', url);
    render();
  }

  // ---------------------------------------------------------------- tooltip
  const tip = document.createElement('div');
  tip.className = 'cc-tip';
  tip.setAttribute('role', 'tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function hideTip() { tip.classList.remove('on'); }
  function bindTip(el, htmlFn) {
    el.addEventListener('mousemove', (e) => showTip(htmlFn(e), e.clientX, e.clientY));
    el.addEventListener('mouseleave', hideTip);
  }

  // ---------------------------------------------------------------- data
  const overviewCache = new Map();
  let loadSeq = 0;

  async function api(path) {
    const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function errorText(err) {
    if (err.status === 401) return 'Your session has expired. Sign in again to see the Control Centre.';
    if (err.status === 503) return "The Control Centre can't reach its databases right now. The read-only connection isn't configured on this server.";
    return "The overview didn't load. Refresh the page to try again.";
  }

  async function loadOverview(range) {
    if (!overviewCache.has(range)) {
      overviewCache.set(range, api(`/api/control-centre/overview?range=${range}`).catch((e) => { overviewCache.delete(range); throw e; }));
    }
    return overviewCache.get(range);
  }

  // ---------------------------------------------------------------- chrome
  function renderChrome(data) {
    $$('#cc-range button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
    $$('#cc-tabs .cc-tab').forEach((t) => {
      const on = t.dataset.tab === state.tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    const nav = $('#cc-tabs');
    const act = $('.cc-tab[aria-selected="true"]', nav);
    if (act && (act.offsetLeft + act.offsetWidth > nav.scrollLeft + nav.clientWidth || act.offsetLeft < nav.scrollLeft)) {
      nav.scrollLeft = Math.max(0, act.offsetLeft - 16);
    }
    updateTabsMore();
    const period = $('#cc-period');
    if (data) {
      const n = RANGE_DAYS[data.range];
      period.innerHTML = n === 1
        ? '<strong>Today so far</strong> vs yesterday'
        : `<strong>${span(data.current.from, data.current.to)}</strong> vs ${span(data.previous.from, data.previous.to)} · today so far`;
      const need = data.need_action || 0;
      const action = $('#cc-action');
      action.hidden = need === 0;
      $('#cc-action-n').textContent = fmt(need);
      action.href = urlFor({ ...state, tab: 'inbox' });
      $$('#cc-tabs [data-badge]').forEach((b) => { b.hidden = need === 0; b.textContent = fmt(need); });
    } else {
      period.textContent = 'Loading…';
    }
  }

  /** Show the fade + arrow only while more tabs sit off-screen to the right. */
  function updateTabsMore() {
    const nav = $('#cc-tabs');
    const wrap = $('#cc-tabs-wrap');
    if (!nav || !wrap) return;
    wrap.classList.toggle('more', nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 4);
  }

  // ---------------------------------------------------------------- count-up
  function countUp(el, to) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
    const start = performance.now();
    const dur = 750;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- sparkline
  function sparkline(series, prevSeries, label) {
    const W = 200; const H = 40; const pad = 3;
    const vals = series.map((p) => p.value);
    const pvals = prevSeries.map((p) => p.value);
    const max = Math.max(1, ...vals, ...pvals);
    const n = Math.max(series.length, 2);
    const x = (i) => (series.length === 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v) => H - pad - (v / max) * (H - pad * 2);
    const line = (vs) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'cc-spark');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${label}: daily values`);
    const path = (cls, d) => { const p = document.createElementNS(svgNS, 'path'); p.setAttribute('class', cls); p.setAttribute('d', d); p.setAttribute('vector-effect', 'non-scaling-stroke'); svg.appendChild(p); return p; };

    if (series.length === 1) {
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('class', 'dot'); c.setAttribute('cx', W / 2); c.setAttribute('cy', y(vals[0])); c.setAttribute('r', 3);
      svg.appendChild(c);
      return svg;
    }
    if (pvals.length === vals.length) path('prev', line(pvals));
    path('area', `${line(vals)}L${W},${H}L0,${H}Z`).removeAttribute('vector-effect');
    const cur = path('cur', line(vals));
    if (!reduceMotion) {
      cur.style.strokeDasharray = '1000';
      cur.style.strokeDashoffset = '1000';
      cur.style.transition = 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)';
      requestAnimationFrame(() => requestAnimationFrame(() => { cur.style.strokeDashoffset = '0'; }));
    }
    const marker = document.createElementNS(svgNS, 'line');
    marker.setAttribute('class', 'marker'); marker.setAttribute('y1', 0); marker.setAttribute('y2', H);
    marker.setAttribute('vector-effect', 'non-scaling-stroke'); marker.style.display = 'none';
    svg.appendChild(marker);
    const hit = document.createElementNS(svgNS, 'rect');
    hit.setAttribute('class', 'hit'); hit.setAttribute('width', W); hit.setAttribute('height', H);
    svg.appendChild(hit);

    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(series.length - 1, Math.round(((e.clientX - r.left) / r.width) * (series.length - 1))));
      marker.setAttribute('x1', x(i)); marker.setAttribute('x2', x(i)); marker.style.display = '';
      const prev = prevSeries[i];
      showTip(`<b>${dayLabel(series[i].day)}</b>: ${fmt(series[i].value)}${prev ? `<br>${dayLabel(prev.day)}: ${fmt(prev.value)}` : ''}`, e.clientX, r.top);
    });
    svg.addEventListener('mouseleave', () => { marker.style.display = 'none'; hideTip(); });
    return svg;
  }

  // ---------------------------------------------------------------- tiles
  const TILES = [
    { key: 'signups', label: 'sign-ups', cls: '' },
    { key: 'active_clients', metric: 'active_companies', label: 'active clients', cls: '' },
    { key: 'grant_matches', metric: 'matches_shown', label: 'grant matches', cls: '', hint: 'A grant card shown to a client on their goal tracks; each client counts once per grant' },
    { key: 'cards_opened', metric: 'grants_opened', label: 'grant cards opened', cls: 'o' },
    { key: 'ratings', label: 'ratings 👍 / 👎', cls: 'y' },
    { key: 'watchlist_adds', label: 'watchlist adds', cls: 'g' },
    { key: 'chats', label: 'chats started', cls: 'y' }
  ];

  function ratingsMetric(m) {
    const up = m.ratings_up; const down = m.ratings_down;
    const add = (a, b) => a.map((p, i) => ({ day: p.day, value: p.value + (b[i]?.value || 0) }));
    const current = up.current + down.current; const previous = up.previous + down.previous;
    return { current, previous, delta: current - previous,
      delta_pct: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
      series: add(up.series, down.series), previous_series: add(up.previous_series, down.previous_series),
      up: up.current, down: down.current,
      internal_up: up.internal?.current ?? 0, internal_down: down.internal?.current ?? 0,
      internal_prev: (up.internal?.previous ?? 0) + (down.internal?.previous ?? 0) };
  }

  function deltaChip(m, n) {
    const el = document.createElement('span');
    const cls = m.delta > 0 ? 'up' : m.delta < 0 ? 'down' : '';
    el.className = `cc-delta ${cls}`;
    const pct = m.delta_pct == null ? null : Math.abs(m.delta_pct) >= 10 ? Math.round(m.delta_pct) : m.delta_pct;
    el.textContent = m.delta === 0 ? 'no change' : `${signed(m.delta)}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}`;
    bindTip(el, () => `Previous ${n === 1 ? 'day' : `${n} days`}: <b>${fmt(m.previous)}</b>`);
    return el;
  }

  const lastShown = new Map(); // tile key → last displayed value, so a range change rolls old → new

  function rollTo(el, key, value) {
    el.dataset.v = lastShown.get(key) ?? 0;
    lastShown.set(key, value);
    countUp(el, value);
  }

  function renderTiles(root, data) {
    const n = RANGE_DAYS[data.range];
    const grid = document.createElement('div');
    grid.className = 'cc-tiles';
    root.appendChild(grid);
    for (const t of TILES) {
      const m = t.key === 'ratings' ? ratingsMetric(data.metrics) : data.metrics[t.metric ?? t.key];
      const tile = document.createElement('div');
      tile.className = `cc-tile ${t.cls}`;
      const top = document.createElement('div'); top.className = 'cc-tile-top';
      const num = document.createElement('div'); num.className = 'cc-num';
      if (t.key === 'ratings') {
        num.innerHTML = '<span class="u">0</span><small>/</small><span class="dn">0</span>';
        rollTo($('.u', num), 'ratings_up', m.up);
        rollTo($('.dn', num), 'ratings_down', m.down);
      } else {
        rollTo(num, t.key, m.current);
      }
      top.append(num, deltaChip(m, n));
      const label = document.createElement('div'); label.className = 'cc-label'; label.textContent = t.label;
      if (t.hint) label.title = t.hint;
      // How much of this number came from internal accounts (they're counted, not hidden).
      const inner = t.key === 'ratings'
        ? { now: m.internal_up + m.internal_down, text: `${fmt(m.internal_up)} / ${fmt(m.internal_down)} internal` }
        : { now: m.internal?.current ?? 0, text: `${fmt(m.internal?.current ?? 0)} internal` };
      const sub = document.createElement('div');
      sub.className = 'cc-internal';
      sub.textContent = inner.now > 0 ? inner.text : 'none internal';
      if (inner.now > 0) bindTip(sub, () => `From Granted staff and test companies. Previous ${n === 1 ? 'day' : `${n} days`}: <b>${fmt(t.key === 'ratings' ? m.internal_prev : m.internal?.previous ?? 0)}</b>`);
      tile.append(top, label, sub, sparkline(m.series, m.previous_series, t.label));
      grid.appendChild(tile);
    }
  }

  // ---------------------------------------------------------------- charts
  function grantLink(id) { return urlFor({ ...state, tab: 'grants', grant: id }); }
  function openGrant(g) { knownNames.grant.set(g.grant_id, g.title); go({ tab: 'grants', grant: g.grant_id }); }

  /** Diverging bars around a centre axis: rows of {name, value, tip, onClick}. */
  function diverging(rows) {
    const wrap = document.createElement('div');
    wrap.className = 'cc-div';
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
    // Labels with units ("+65 grant matches") need more room past the bar end.
    const narrow = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    const reach = rows.some((r) => r.label) ? (narrow ? 18 : 28) : 44;
    const bars = [];
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'cc-div-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'link');
      row.setAttribute('aria-label', `${r.name}: ${signed(r.value)}`);
      const name = document.createElement('div'); name.className = 'cc-div-name'; name.textContent = r.name;
      const track = document.createElement('div'); track.className = 'cc-div-track';
      track.innerHTML = '<div class="cc-div-axis"></div>';
      const up = r.value >= 0;
      const pct = (Math.abs(r.value) / max) * reach;
      const bar = document.createElement('div'); bar.className = `cc-div-bar ${up ? 'up' : 'down'}`;
      const val = document.createElement('div'); val.className = `cc-div-val ${up ? 'up' : 'down'}`; val.textContent = r.label ?? signed(r.value);
      // Down labels sit left of the bar end, right-aligned (translateX(-100%) in CSS).
      if (!up) { bar.style.left = '50%'; val.style.left = 'calc(50% - 6px)'; } else { val.style.left = 'calc(50% + 6px)'; }
      track.append(bar, val);
      row.append(name, track);
      if (r.tip) { bindTip(name, r.tip); bindTip(track, r.tip); }
      if (r.onClick) {
        row.addEventListener('click', r.onClick);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') r.onClick(); });
      }
      wrap.appendChild(row);
      bars.push({ bar, val, up, pct });
    }
    const apply = () => bars.forEach(({ bar, val, up, pct }) => {
      bar.style.width = `${pct}%`;
      if (up) val.style.left = `calc(50% + ${pct}% + 6px)`;
      else { bar.style.left = `${50 - pct}%`; val.style.left = `calc(${50 - pct}% - 6px)`; }
    });
    if (reduceMotion) apply(); else requestAnimationFrame(() => requestAnimationFrame(apply));
    return wrap;
  }

  function card(title, sub, right) {
    const el = document.createElement('section');
    el.className = 'cc-card';
    el.innerHTML = `<div class="cc-card-head"><h2>${esc(title)}</h2></div>${sub ? `<p class="cc-sub">${esc(sub)}</p>` : ''}`;
    if (right) $('.cc-card-head', el).appendChild(right);
    return el;
  }

  function renderMovers(data, nDays) {
    const c = card(`Grants matched to more / fewer clients ${nowWords(nDays)}`,
      `Each bar is how many more or fewer clients a grant was matched to than ${beforeWords(nDays)}; before → now is beside it. Click a grant to open it.`);
    c.classList.add('cc-hero');
    const { risers, drops } = data.movers;
    if (!risers.length && !drops.length) {
      c.insertAdjacentHTML('beforeend', `<p class="cc-empty">Every grant was matched to the same number of clients as ${beforeWords(nDays)}.</p>`);
      return c;
    }
    // Two columns on one shared scale, so a +6 and a −6 bar are the same length.
    const max = Math.max(1, ...[...risers, ...drops].map((g) => Math.abs(g.change)));
    const cols = document.createElement('div');
    cols.className = 'cc-movers';
    cols.append(
      moverColumn(`Matched to more clients · ${fmt(data.movers.up_count)}`, risers, 'up', max, 'No grant was matched to more clients.'),
      moverColumn(`Matched to fewer clients · ${fmt(data.movers.down_count)}`, drops, 'down', max, 'No grant was matched to fewer clients.')
    );
    c.appendChild(cols);
    const apply = () => $$('.cc-mv-bar[data-w]', cols).forEach((b) => { b.style.setProperty('--w', b.dataset.w); });
    if (reduceMotion) apply(); else requestAnimationFrame(() => requestAnimationFrame(apply));
    return c;
  }

  /** One column of the movers chart: name, bar (shared scale), signed change. */
  function moverColumn(title, list, dir, max, emptyText) {
    const col = document.createElement('div');
    col.className = `cc-mv-col ${dir}`;
    col.innerHTML = `<h3 class="cc-mv-head">${esc(title)}</h3>`;
    if (!list.length) { col.insertAdjacentHTML('beforeend', `<p class="cc-empty">${esc(emptyText)}</p>`); return col; }
    for (const g of list) {
      const row = document.createElement('div');
      row.className = 'cc-mv-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'link');
      row.setAttribute('aria-label', `${g.title}: matched to ${g.previous} then ${g.companies} clients (${signed(g.change)})`);
      const w = Math.max(4, Math.round((Math.abs(g.change) / max) * 100));
      row.innerHTML = `<span class="cc-mv-name">${esc(g.title)}</span>
        <span class="cc-mv-track"><span class="cc-mv-bar" data-w="${w}"></span><span class="cc-mv-val">${signed(g.change)}</span>
        <span class="cc-mv-ba" title="clients before → now">${fmt(g.previous)} → ${fmt(g.companies)}</span></span>`;
      bindTip(row, () => `<b>${esc(g.title)}</b><br>Matched to ${plural(g.previous, 'client')} before, ${plural(g.companies, 'client')} now${g.opens ? `<br>Card opened ${fmt(g.opens)}×` : ''}`);
      row.addEventListener('click', () => openGrant(g));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openGrant(g); });
      col.appendChild(row);
    }
    return col;
  }

  function barCell(value, max, cls = '') {
    const w = max ? Math.max(4, Math.round((value / max) * 56)) : 0;
    return `<span class="cc-bar"><span class="b ${cls}" data-w="${w}"></span>${fmt(value)}</span>`;
  }
  function growBars(root) {
    const apply = () => $$('span.b[data-w]', root).forEach((b) => { b.style.width = `${b.dataset.w}px`; });
    if (reduceMotion) apply(); else requestAnimationFrame(() => requestAnimationFrame(apply));
  }
  function bindRows(table, list) {
    $$('tbody tr', table).forEach((tr, i) => {
      tr.tabIndex = 0;
      tr.addEventListener('click', () => openGrant(list[i]));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openGrant(list[i]); });
    });
  }

  function renderMostMatched(data, nDays) {
    const c = card('Most matched grants',
      `Each bar is how many clients the grant was matched to ${nowWords(nDays)}; Before is ${beforeWords(nDays)}. Click a grant to open it.`);
    const list = data.most_matched;
    if (!list.length) { c.insertAdjacentHTML('beforeend', `<p class="cc-empty">No grant was matched to a client ${nowWords(nDays)}.</p>`); return c; }
    const max = Math.max(...list.map((g) => g.companies));
    const prevLabel = nDays === 1 ? 'Yesterday' : 'Before';
    c.insertAdjacentHTML('beforeend', `<table class="cc-table"><thead><tr><th>Grant</th><th>Clients</th><th class="hide-sm">${prevLabel}</th><th>Change</th><th class="hide-sm">Card opens</th></tr></thead><tbody>${
      list.map((g) => `<tr data-href="${esc(grantLink(g.grant_id))}"><td><span class="cc-gname">${esc(g.title)}</span></td><td>${barCell(g.companies, max)}</td><td class="hide-sm cc-muted">${fmt(g.previous)}</td><td><span class="cc-chg ${g.change > 0 ? 'up' : g.change < 0 ? 'down' : ''}">${g.change === 0 ? '—' : signed(g.change)}</span></td><td class="hide-sm cc-muted">${g.opens ? `${fmt(g.opens)}×` : '—'}</td></tr>`).join('')
    }</tbody></table>`);
    bindRows($('table', c), list);
    return c;
  }

  /** Grant card opens by where the client opened them from, now vs before. */
  function renderSources(data, nDays) {
    const c = card('How clients found grant cards',
      `Each bar is how many times a grant card was opened from that place ${nowWords(nDays)}; Before is ${beforeWords(nDays)}.`);
    c.classList.add('cc-wide');
    const list = data.open_sources || [];
    if (!list.some((s) => s.current || s.previous)) {
      c.insertAdjacentHTML('beforeend', `<p class="cc-empty">No grant card was opened ${nowWords(nDays)} or ${beforeWords(nDays)}.</p>`);
      return c;
    }
    const total = list.reduce((a, s) => a + s.current, 0);
    const max = Math.max(1, ...list.map((s) => Math.max(s.current, s.previous)));
    const prevLabel = nDays === 1 ? 'Yesterday' : 'Before';
    c.insertAdjacentHTML('beforeend', `<table class="cc-table cc-sources"><thead><tr><th>Opened from</th><th>Card opens</th><th class="hide-sm">Share</th><th>${prevLabel}</th><th>Change</th></tr></thead><tbody>${
      list.map((s) => `<tr><td>${esc(s.label)}</td><td>${barCell(s.current, max)}</td>`
        + `<td class="hide-sm cc-muted">${total ? `${Math.round((s.current / total) * 100)}%` : '—'}</td>`
        + `<td class="cc-muted">${fmt(s.previous)}</td>`
        + `<td><span class="cc-chg ${s.delta > 0 ? 'up' : s.delta < 0 ? 'down' : ''}">${s.delta === 0 ? '—' : signed(s.delta)}</span></td></tr>`).join('')
    }</tbody></table>`);
    return c;
  }

  /** Chat: the range's numbers (toggle applies), then the latest digest week's themes and questions. */
  function renderChat(view, data, nDays) {
    const c = card('Chat', `Each number counts chats clients started ${nowWords(nDays)}, compared with ${beforeWords(nDays)}.`);
    c.classList.add('cc-wide');
    const s = view.chat;
    if (s) {
      const stats = [
        ['chats started', s.chats_started],
        ['clients who chatted', s.clients_chatted],
        ['questions asked', s.questions_asked, 'Each message a client typed in a chat started this period'],
        ['questions per chat', s.avg_questions_per_chat, 'Questions asked ÷ chats started', true],
        ['grant cards opened from chat', s.cards_opened_from_chat]
      ];
      const grid = document.createElement('div');
      grid.className = 'cc-chat-stats';
      for (const [label, m, hint, decimal] of stats) {
        const cell = document.createElement('div');
        cell.className = 'cc-chat-stat';
        const num = document.createElement('div');
        num.className = 'cc-chat-num';
        num.textContent = decimal ? m.current.toFixed(1) : fmt(m.current);
        const chip = document.createElement('span');
        chip.className = `cc-delta ${m.delta > 0 ? 'up' : m.delta < 0 ? 'down' : ''}`;
        chip.textContent = m.delta === 0 ? 'no change' : `${m.delta > 0 ? '+' : '−'}${decimal ? Math.abs(m.delta).toFixed(1) : fmt(Math.abs(m.delta))}`;
        bindTip(chip, () => `${beforeWords(nDays)[0].toUpperCase()}${beforeWords(nDays).slice(1)}: <b>${decimal ? m.previous.toFixed(1) : fmt(m.previous)}</b>`);
        const lab = document.createElement('div');
        lab.className = 'cc-label';
        lab.textContent = label;
        if (hint) lab.title = hint;
        const top = document.createElement('div');
        top.className = 'cc-tile-top';
        top.append(num, chip);
        cell.append(top, lab);
        grid.appendChild(cell);
      }
      c.appendChild(grid);
    }
    c.appendChild(renderAsked(data.asked, data.asked_error));
    return c;
  }

  function renderAsked(asked, error) {
    const box = document.createElement('div');
    box.className = 'cc-asked';
    if (!asked) {
      box.innerHTML = `<h3 class="cc-asked-head">What clients asked about</h3><p class="cc-empty">${
        error ? 'Themes couldn\'t be read right now.' : 'No weekly digest has stored its themes yet. They appear here after the next Monday digest.'}</p>`;
      return box;
    }
    const week = span(asked.week_start, asked.week_end);
    const backfill = asked.source === 'backfill_summary';
    box.innerHTML = `<h3 class="cc-asked-head">What clients asked about <span class="cc-week">Week of ${esc(week)}</span></h3>
      <p class="cc-sub">Each bar is how many client questions the weekly digest placed in that theme. It always shows the latest digest week, whatever range is picked above.</p>`;
    const max = Math.max(1, ...asked.themes.map((t) => t.count));
    const list = document.createElement('div');
    list.className = 'cc-themes';
    for (const t of asked.themes) {
      const row = document.createElement('div');
      row.className = 'cc-theme';
      row.innerHTML = `<div class="cc-theme-name">${esc(t.name)}</div>
        <div class="cc-bar"><span class="b" data-w="${Math.max(4, Math.round((t.count / max) * 56))}"></span>${plural(t.count, 'question')}</div>
        <div class="cc-theme-take">${esc(t.takeaway || '')}${t.internal_count ? ` <span class="cc-muted">(${plural(t.internal_count, 'question')} from internal accounts)</span>` : ''}</div>`;
      list.appendChild(row);
    }
    box.appendChild(list);

    const qs = (asked.recent_questions || []).filter((q) => includeInternal || !q.company_internal).slice(0, 8);
    const qh = document.createElement('div');
    qh.innerHTML = `<h3 class="cc-asked-head cc-recent-head">Recent client questions</h3>
      <p class="cc-sub">Each line is a client's question as the weekly digest rewrote it, with names and details taken out${
        backfill ? '. This week was recovered from the digest\'s summary, so it shows one example per theme and who asked isn\'t recorded.' : '; newest first.'}</p>`;
    box.appendChild(qh);
    if (!qs.length) {
      box.insertAdjacentHTML('beforeend', `<p class="cc-empty">${includeInternal ? 'No rewritten questions stored for this week.' : 'Every stored question this week came from an internal account. Turn on "Include internal accounts" to see them.'}</p>`);
      return box;
    }
    const ul = document.createElement('ul');
    ul.className = 'cc-questions';
    for (const q of qs) {
      const who = q.company_id != null
        ? `${esc(q.company_name || `Company #${q.company_id}`)}${q.company_internal ? ' <span class="cc-tag-internal">Internal</span>' : ''} <span class="cc-muted">#${q.company_id}</span>`
        : `<span class="cc-muted">${q.linked ? 'client not linked to a company' : 'who asked isn\'t recorded'}</span>`;
      const li = document.createElement('li');
      li.innerHTML = `<p class="cc-q">“${esc(q.text)}”</p><p class="cc-q-meta">${q.theme ? `<span class="chip">${esc(q.theme)}</span>` : ''}${who}</p>`;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    return box;
  }

  function renderPopular(data, nDays) {
    const c = card('Most opened grant cards',
      `Each bar is how many times the grant card was opened ${nowWords(nDays)}; Saved is how often it was added to a watchlist.`);
    const list = data.popular;
    if (!list.length) { c.insertAdjacentHTML('beforeend', `<p class="cc-empty">No grant card was opened or saved ${nowWords(nDays)}.</p>`); return c; }
    const max = Math.max(1, ...list.map((g) => g.opens));
    c.insertAdjacentHTML('beforeend', `<table class="cc-table"><thead><tr><th>Grant</th><th>Card opens</th><th>Saved</th><th class="hide-sm">Opens before</th></tr></thead><tbody>${
      list.map((g) => `<tr><td><span class="cc-gname">${esc(g.title)}</span></td><td>${barCell(g.opens, max, 'y')}</td><td>${g.saves ? fmt(g.saves) : '—'}</td><td class="hide-sm cc-muted">${fmt(g.previous_opens)}</td></tr>`).join('')
    }</tbody></table>`);
    bindRows($('table', c), list);
    return c;
  }

  const trendView = { dim: 'industries', measure: 'matches' };
  function renderTrends(data, nDays) {
    const toggles = document.createElement('div');
    toggles.className = 'cc-toggles';
    const mk = (key, opts) => {
      const g = document.createElement('div'); g.className = 'cc-toggle'; g.setAttribute('role', 'group');
      for (const [val, label] of opts) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.setAttribute('aria-pressed', String(trendView[key] === val));
        b.addEventListener('click', () => { trendView[key] = val; c.replaceWith(renderTrends(data, nDays)); });
        g.appendChild(b);
      }
      return g;
    };
    toggles.append(mk('dim', [['industries', 'Industries'], ['provinces', 'Provinces']]), mk('measure', [['matches', 'Matches'], ['signups', 'Sign-ups']]));
    const field = trendView.measure === 'matches' ? 'matches' : 'signups';
    const unit = field === 'matches' ? ['match', 'matches'] : ['sign-up', 'sign-ups'];
    const where = trendView.dim === 'industries' ? 'industry' : 'province';
    const c = card('Shifting trends',
      field === 'matches'
        ? `Each bar is how many more or fewer grant matches clients in that ${where} got ${nowWords(nDays)} than ${beforeWords(nDays)}.`
        : `Each bar is how many more or fewer clients in that ${where} signed up ${nowWords(nDays)} than ${beforeWords(nDays)}.`);
    c.classList.add('cc-wide');
    c.appendChild(toggles);
    const rows = (data.trends[trendView.dim] || [])
      .filter((r) => r[`${field}_change`] !== 0)
      .sort((a, b) => b[`${field}_change`] - a[`${field}_change`])
      .map((r) => {
        const v = r[`${field}_change`];
        return {
          name: r.name, value: v,
          label: `${signed(v)} ${Math.abs(v) === 1 ? unit[0] : unit[1]}`,
          tip: () => `<b>${esc(r.name)}</b><br>${plural(r[`previous_${field}`], unit[0], unit[1])} → ${plural(r[field], unit[0], unit[1])}`
        };
      });
    if (!rows.length) c.insertAdjacentHTML('beforeend', `<p class="cc-empty">No ${where} gained or lost ${unit[1]} ${nowWords(nDays)}.</p>`);
    else c.appendChild(diverging(rows));
    return c;
  }

  function lede(data, nDays) {
    const m = data.metrics;
    const p = document.createElement('p');
    p.className = 'cc-lede';
    const up = data.movers.up_count;
    const opens = m.grants_opened.current;
    p.innerHTML = `<b>${fmt(up)}</b> grant ${up === 1 ? 'card was' : 'cards were'} matched to more clients than ${beforeWords(nDays)}, `
      + `<b class="down">${fmt(data.movers.down_count)}</b> to fewer. `
      + `<b>${fmt(m.active_companies.current)}</b> ${m.active_companies.current === 1 ? 'client was' : 'clients were'} active and opened grant cards `
      + `<b>${fmt(opens)}</b> ${opens === 1 ? 'time' : 'times'}.`;
    return p;
  }

  function footnote(data) {
    const s = data.sources || {};
    const el = document.createElement('div');
    el.className = 'cc-foot';
    const internal = (data.internal_accounts || []).map((c) => (c.name ? `${c.name} (#${c.id})` : `Company #${c.id}`));
    const p = document.createElement('p');
    p.textContent = 'Staff and client use combined; automated test traffic excluded. '
      + (internal.length
        ? 'Internal accounts (Granted staff and test companies) count in every tile, which shows how much came from them. '
          + `The grant lists, card sources and trends leave them out unless "Include internal accounts" is on. `
        : '')
      + 'A grant match is a grant card shown to a client on their goal tracks; each client counts once per grant. '
      + 'Ratings count every click, including changed minds. '
      + `History comes from the nightly roll-ups${s.last_rolled_day ? ` (latest ${dayLabel(s.last_rolled_day)})` : ''}; `
      + 'later days, including today, are read live. Updated every 5 minutes.'
      + (s.stale_rollup ? ' The nightly roll-up is more than two weeks behind, so older days in this range may be missing.' : '');
    el.appendChild(p);
    if (internal.length) {
      // The names are one click away rather than a 28-name paragraph.
      const d = document.createElement('details');
      d.innerHTML = `<summary>${internal.length} internal ${internal.length === 1 ? 'account' : 'accounts'}</summary><p></p>`;
      d.querySelector('p').textContent = internal.join(' · ');
      el.appendChild(d);
    }
    return el;
  }

  // ---------------------------------------------------------------- panels
  async function renderOverview(panel) {
    const seq = ++loadSeq;
    panel.classList.add('cc-loading');
    let data;
    try {
      data = await loadOverview(state.range);
    } catch (err) {
      if (seq !== loadSeq) return;
      panel.classList.remove('cc-loading');
      panel.innerHTML = `<div class="cc-error">${esc(errorText(err))}</div>`;
      renderChrome(null);
      $('#cc-period').textContent = '';
      return;
    }
    if (seq !== loadSeq || state.tab !== 'overview') return;
    renderChrome(data);
    for (const c of data.internal_accounts || []) internalIds.add(c.id);
    paintOverview(panel, data);
  }

  /** Draw the Overview from a loaded payload. The internal-accounts toggle
   *  repaints from the same payload: both rankings are already in it. */
  function paintOverview(panel, data) {
    const n = RANGE_DAYS[data.range];
    const view = { ...data, ...data.rankings[includeInternal ? 'all' : 'clients'] };
    panel.innerHTML = '';
    panel.classList.remove('cc-loading');
    panel.appendChild(lede(view, n));
    renderTiles(panel, data);
    const row = document.createElement('div'); row.className = 'cc-grid-2 even';
    row.append(renderMostMatched(view, n), renderPopular(view, n));
    panel.append(internalToggle(panel, data), renderMovers(view, n), renderSources(view, n), renderChat(view, data, n), row, renderTrends(view, n), footnote(data));
    growBars(panel);
  }

  // ---------------------------------------------------------------- internal accounts toggle
  const INTERNAL_KEY = 'cc.includeInternal';
  let includeInternal = (() => { try { return window.localStorage.getItem(INTERNAL_KEY) === '1'; } catch { return false; } })();

  function internalToggle(panel, data) {
    const n = (data.internal_accounts || []).length;
    const bar = document.createElement('div');
    bar.className = 'cc-scope';
    bar.innerHTML = `<span class="cc-scope-label">Grant lists, card sources and trends</span>
      <label class="cc-switch"><input type="checkbox" role="switch" ${includeInternal ? 'checked' : ''}>
      <span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label>
      <span class="cc-scope-note">${includeInternal ? `Showing everyone, including ${fmt(n)} internal ${n === 1 ? 'account' : 'accounts'}` : `Clients only — ${fmt(n)} internal ${n === 1 ? 'account' : 'accounts'} left out`}</span>`;
    $('input', bar).addEventListener('change', (e) => {
      includeInternal = e.target.checked;
      try { window.localStorage.setItem(INTERNAL_KEY, includeInternal ? '1' : '0'); } catch { /* per-browser nicety */ }
      const y = window.scrollY;
      paintOverview(panel, data);
      window.scrollTo(0, y);
      $('.cc-switch input', panel)?.focus();
    });
    return bar;
  }

  async function nameFor(type, id) {
    if (knownNames[type].has(id)) return knownNames[type].get(id);
    try {
      const r = await api(`/api/control-centre/search?q=${id}`);
      const hit = (type === 'company' ? r.companies : r.grants).find((x) => x.id === id);
      if (hit?.internal) internalIds.add(hit.id);
      if (hit) { knownNames[type].set(id, hit.name); return hit.name; }
    } catch { /* name is a nicety */ }
    return null;
  }

  async function renderSoon(panel) {
    const [title, what] = SOON[state.tab];
    const sel = state.tab === 'companies' && state.company ? ['company', state.company]
      : state.tab === 'grants' && state.grant ? ['grant', state.grant] : null;
    panel.innerHTML = `<div class="cc-soon"><span class="pill">Coming soon</span><h2>${esc(title)}</h2><p>${esc(what)}</p>
      <div data-sel></div><div class="cc-skel" style="width:82%"></div><div class="cc-skel" style="width:58%"></div><div class="cc-skel" style="width:34%"></div></div>`;
    if (sel) {
      const [type, id] = sel;
      const fallback = type === 'company' ? `Company #${id}` : `Grant #${id}`;
      const box = $('[data-sel]', panel);
      const tag = () => (type === 'company' ? internalTag(id) : '');
      box.innerHTML = `<p><strong>Selected:</strong> ${esc(fallback)}${tag()}</p>`;
      const name = await nameFor(type, id);
      if (name && state.tab === (type === 'company' ? 'companies' : 'grants')) box.innerHTML = `<p><strong>Selected:</strong> ${esc(name)}${tag()} <span class="cc-muted">(#${id})</span></p>`;
    }
    loadOverview(state.range).then(renderChrome).catch(() => renderChrome(null));
  }

  function render() {
    hideTip();
    renderChrome(null);
    const panel = $('#cc-panel');
    if (state.tab === 'overview') renderOverview(panel);
    else { loadSeq++; renderSoon(panel); }
  }

  // ---------------------------------------------------------------- search
  function bindSearch() {
    const input = $('#cc-search');
    const box = $('#cc-results');
    let timer = null; let items = []; let active = -1; let seq = 0;

    const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const choose = (it) => {
      knownNames[it.type].set(it.id, it.name);
      input.value = '';
      close();
      go(it.type === 'company' ? { tab: 'companies', company: it.id } : { tab: 'grants', grant: it.id });
    };
    const paint = () => {
      if (!items.length) { box.innerHTML = '<div class="empty">No company or grant matches that.</div>'; return; }
      box.innerHTML = items.map((it, i) => `<button type="button" class="cc-result" role="option" aria-selected="${i === active}" data-i="${i}">
        <span class="chip ${it.type}">${it.type === 'company' ? 'Company' : 'Grant'}</span><span class="name">${esc(it.name)}</span>${it.internal ? '<span class="cc-tag-internal">Internal</span>' : ''}<span class="id">#${it.id}</span></button>`).join('');
      $$('.cc-result', box).forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); choose(items[Number(b.dataset.i)]); }));
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { close(); return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          const r = await api(`/api/control-centre/search?q=${encodeURIComponent(q)}`);
          if (my !== seq) return;
          items = [...r.companies, ...r.grants];
          for (const c of r.companies) if (c.internal) internalIds.add(c.id);
        } catch { items = []; }
        active = -1; paint(); box.hidden = false; input.setAttribute('aria-expanded', 'true');
      }, 180);
    });
    input.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[Math.max(0, active)]) { choose(items[Math.max(0, active)]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  // ---------------------------------------------------------------- init
  function init() {
    document.body.appendChild(tip);
    state = readUrl();
    window.history.replaceState(state, '', urlFor(state));
    storeSet(state.range);

    $$('#cc-range button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.range !== state.range) go({ range: b.dataset.range }); }));
    $$('#cc-tabs .cc-tab').forEach((t) => t.addEventListener('click', () => { if (t.dataset.tab !== state.tab) go({ tab: t.dataset.tab }); }));
    $('#cc-tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TABS.indexOf(state.tab) + (e.key === 'ArrowRight' ? 1 : -1);
      const next = TABS[(i + TABS.length) % TABS.length];
      go({ tab: next });
      $(`#cc-tabs [data-tab="${next}"]`).focus();
    });
    $('#cc-action').addEventListener('click', (e) => { e.preventDefault(); go({ tab: 'inbox' }); });
    window.addEventListener('popstate', () => { state = readUrl(); render(); });
    window.addEventListener('scroll', hideTip, { passive: true });
    $('#cc-tabs').addEventListener('scroll', updateTabsMore, { passive: true });
    window.addEventListener('resize', updateTabsMore, { passive: true });
    $('#cc-tabs-more').addEventListener('click', () => { const n = $('#cc-tabs'); n.scrollLeft += n.clientWidth * 0.7; });
    bindSearch();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

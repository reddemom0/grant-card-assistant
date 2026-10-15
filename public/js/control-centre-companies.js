/**
 * Control Centre — Companies tab (step 7).
 *
 *   #companies                      every client: sortable, filterable, follows the
 *                                   range (activity counts) and "Include internal accounts"
 *   #companies?sort=chats&dir=desc&q=acme
 *   #companies/<id>                 one company: profile + gaps, goals, goal tracks
 *                                   (Why matched? / Flag), timeline, chats, review cards
 *
 * Data: GET /api/control-centre/companies?range=; a company page in two steps —
 * /companies/:id (header, profile, goals, goal tracks; usable at once) then
 * /:id/feed (tiles, timeline, chats, review cards); /:id/why?grant=;
 * /:id/chats/:conversationId (each transcript view is logged); POST
 * /:id/empty-track ("Flag empty track"). "Flag as bad match" reuses POST
 * /api/control-centre/review/flag. The timeline shows TIMELINE_PAGE events at a time. Loaded before control-centre.js, which
 * calls CCCompanies.render(panel, ctx). Docs: docs/control-centre.md.
 */
(function () {
  'use strict';

  const API = '/api/control-centre/companies';
  const COLUMNS = [
    { key: 'name', label: 'Company', type: 'text' },
    { key: 'province', label: 'Province', type: 'text' },
    { key: 'industry', label: 'Industry', type: 'text' },
    { key: 'last_active', label: 'Last active', type: 'date' },
    { key: 'grant_matches', label: 'Matches', type: 'num', hint: 'Different grants shown to them in the range' },
    { key: 'cards_opened', label: 'Opened', type: 'num', hint: 'Grant cards opened in the range' },
    { key: 'chats', label: 'Chats', type: 'num', hint: 'Chats started in the range' },
    { key: 'open_cards', label: 'Open cards', type: 'num', hint: 'Review cards about them that are still open' }
  ];
  const ELIGIBILITY_WORDS = { Likely: 'Likely eligible', Possible: 'Possibly eligible', Unlikely: 'Unlikely eligible' };
  const STATUS_WORDS = { new: 'New', diagnosed: 'Diagnosed', in_progress: 'In progress', closed: 'Closed' };
  const OWNER_WORDS = { client: 'Client', research: 'Research', chris: 'Chris', jason: 'Jason' };
  const TYPE_WORDS = { match: 'Match', grant_pattern: 'Grant pattern', chat: 'Chat', empty_track: 'Empty track' };
  const RANGE_WORDS = { day: 'today', week: 'in the last 7 days', month: 'in the last 30 days', year: 'in the last year' };
  const TIMELINE_PAGE = 30;

  let ctx = null;
  const listCache = new Map();   // range → payload
  const pageCache = new Map();   // id → core payload
  const feedCache = new Map();   // id → feed payload
  let seq = 0;

  const esc = (v) => ctx.esc(v);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}${y !== new Date().getFullYear() ? `, ${y}` : ''}`;
  };
  const fullDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Vancouver' });
  const time = (iso) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' });
  const vanDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
  const internalTag = (on) => (on ? ' <span class="cc-tag-internal">Internal</span>' : '');

  // ---------------------------------------------------------------- routing helpers
  function readQuery() {
    const q = new URLSearchParams(ctx.state().cq || '');
    const sort = COLUMNS.some((c) => c.key === q.get('sort')) ? q.get('sort') : 'last_active';
    const dir = q.get('dir') === 'asc' ? 'asc' : q.get('dir') === 'desc' ? 'desc' : (sort === 'name' || sort === 'province' || sort === 'industry' ? 'asc' : 'desc');
    return { sort, dir, q: q.get('q') || '' };
  }
  function writeQuery(next) {
    const p = new URLSearchParams();
    if (next.sort !== 'last_active') p.set('sort', next.sort);
    if (next.dir !== 'desc' || next.sort !== 'last_active') p.set('dir', next.dir);
    if (next.q) p.set('q', next.q);
    return p.toString();
  }

  // ---------------------------------------------------------------- render
  async function render(panel, helpers) {
    ctx = helpers;
    const id = ctx.state().company;
    if (id) return renderPage(panel, id);
    return renderList(panel);
  }

  // ---------------------------------------------------------------- list
  async function renderList(panel) {
    const my = ++seq;
    const range = ctx.state().range;
    if (!panel.querySelector('.co-list')) { panel.innerHTML = ''; panel.classList.add('cc-loading'); }
    let data = listCache.get(range);
    if (!data) {
      try {
        data = await ctx.api(`${API}?range=${range}`);
        listCache.set(range, data);
      } catch (err) {
        if (my !== seq) return;
        panel.classList.remove('cc-loading');
        panel.innerHTML = `<div class="cc-error">${esc(err.status === 503 ? "The company list can't reach its databases right now." : "The company list didn't load. Refresh the page to try again.")}</div>`;
        return;
      }
    }
    if (my !== seq || ctx.state().tab !== 'companies' || ctx.state().company) return;
    panel.classList.remove('cc-loading');
    paintList(panel, data);
  }

  const valueOf = (c, key) => {
    if (key === 'province') return (c.provinces[0] || '').toLowerCase();
    if (key === 'industry') return (c.industries[0] || '').toLowerCase();
    if (key === 'name') return c.name.toLowerCase();
    return c[key] ?? '';
  };

  /** The first value, "+N" for the rest; the whole list on hover. */
  const firstPlus = (xs) => (xs.length
    ? `<span title="${esc(xs.join(', '))}">${esc(xs[0])}${xs.length > 1 ? ` <span class="cc-muted">+${xs.length - 1}</span>` : ''}</span>`
    : '<span class="co-missing">None</span>');

  function paintList(panel, data) {
    const { sort, dir, q } = readQuery();
    const internal = ctx.includeInternal();
    const needle = q.trim().toLowerCase();
    const all = data.companies;
    let rows = all.filter((c) => internal || !c.internal);
    if (needle) rows = rows.filter((c) => c.name.toLowerCase().includes(needle) || String(c.id) === needle
      || c.provinces.join(' ').toLowerCase().includes(needle) || c.industries.join(' ').toLowerCase().includes(needle));
    rows.sort((a, b) => {
      const va = valueOf(a, sort); const vb = valueOf(b, sort);
      const cmp = va < vb ? -1 : va > vb ? 1 : a.name.localeCompare(b.name);
      return dir === 'asc' ? cmp : -cmp;
    });
    const hidden = all.filter((c) => c.internal).length;
    const first = !panel.querySelector('.co-list');
    const arrow = (k) => (k === sort ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
    panel.innerHTML = `<section class="cc-card co-list${first && !ctx.reduceMotion ? ' co-enter' : ''}">
      <div class="co-list-head">
        <div><h2>Companies</h2>
          <p class="cc-sub">Every client with a sign-in. Matches, card opens and chats count ${esc(RANGE_WORDS[data.range] || 'in the range')}; last active is any time.</p></div>
        <div class="co-tools">
          <input type="search" class="co-filter" placeholder="Filter by name, ID, province or industry" value="${esc(q)}" aria-label="Filter companies">
          <label class="cc-switch"><input type="checkbox" role="switch" ${internal ? 'checked' : ''}><span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label>
        </div>
      </div>
      <p class="co-count">${ctx.plural(rows.length, 'company', 'companies')}${!internal && hidden ? ` · ${ctx.fmt(hidden)} internal ${hidden === 1 ? 'account' : 'accounts'} hidden` : ''}</p>
      <div class="co-scroll"><table class="cc-table co-table">
        <thead><tr>${COLUMNS.map((c) => `<th scope="col" class="${c.type === 'num' ? 'num' : ''}" aria-sort="${c.key === sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
          <button type="button" data-sort="${c.key}"${c.hint ? ` title="${esc(c.hint)}"` : ''}>${esc(c.label)}${arrow(c.key)}</button></th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map((c) => `<tr tabindex="0" data-id="${c.id}">
          <td><span class="co-name">${esc(c.name)}</span>${internalTag(c.internal)} <span class="cc-muted co-id">#${c.id}</span></td>
          <td class="co-clip">${firstPlus(c.provinces)}</td>
          <td class="co-clip">${firstPlus(c.industries)}</td>
          <td>${esc(day(c.last_active))}</td>
          <td class="num">${ctx.fmt(c.grant_matches)}</td><td class="num">${ctx.fmt(c.cards_opened)}</td><td class="num">${ctx.fmt(c.chats)}</td>
          <td class="num">${c.open_cards ? `<span class="co-open">${ctx.fmt(c.open_cards)}</span>` : '0'}</td></tr>`).join('')
    : `<tr><td colspan="${COLUMNS.length}" class="cc-empty">No company matches “${esc(q)}”.</td></tr>`}</tbody>
      </table></div>
    </section>`;

    panel.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.sort;
      const nextDir = key === sort ? (dir === 'asc' ? 'desc' : 'asc') : (['name', 'province', 'industry'].includes(key) ? 'asc' : 'desc');
      ctx.go({ cq: writeQuery({ sort: key, dir: nextDir, q }) }, { push: false });
    }));
    const filter = panel.querySelector('.co-filter');
    let t = null;
    filter.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        ctx.go({ cq: writeQuery({ sort, dir, q: filter.value.trim() }) }, { push: false });
        const f = document.querySelector('.co-filter'); f?.focus(); f?.setSelectionRange(f.value.length, f.value.length);
      }, 200);
    });
    panel.querySelector('.cc-switch input').addEventListener('change', (e) => { ctx.setIncludeInternal(e.target.checked); paintList(panel, data); });
    panel.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      const open = () => ctx.go({ company: Number(tr.dataset.id) });
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }

  // ---------------------------------------------------------------- page
  async function renderPage(panel, id) {
    const my = ++seq;
    panel.classList.add('cc-loading');
    let data = pageCache.get(id);
    // The feed is asked for once the first half is in: both share the app DB's
    // small read-only pool, and the first half is what makes the page usable.
    const loadFeed = () => (feedCache.has(id) ? Promise.resolve(feedCache.get(id))
      : ctx.api(`${API}/${id}/feed`).then((f) => { feedCache.set(id, f); return f; }));
    if (!data) {
      if (!panel.querySelector('.co-page')) panel.innerHTML = '<div class="cc-card"><div class="cc-skel" style="width:40%"></div><div class="cc-skel" style="width:75%"></div><div class="cc-skel" style="width:60%"></div></div>';
      try {
        data = await ctx.api(`${API}/${id}`);
        pageCache.set(id, data);
      } catch (err) {
        if (my !== seq) return;
        panel.classList.remove('cc-loading');
        panel.innerHTML = `<p><a href="#companies" class="co-back">← All companies</a></p><div class="cc-error">${esc(err.status === 404 ? `There's no company #${id}.` : "This company didn't load. Try again.")}</div>`;
        bindBack(panel);
        return;
      }
    }
    if (my !== seq || ctx.state().company !== id) return;
    panel.classList.remove('cc-loading');
    panel.innerHTML = pageHtml(data);
    if (!ctx.reduceMotion) panel.querySelector('.co-page').classList.add('co-enter');
    bindPage(panel, data);
    window.scrollTo({ top: 0 });
    try {
      const feed = await loadFeed();
      if (my !== seq || ctx.state().company !== id) return;
      fillFeed(panel, data, feed);
    } catch (err) {
      if (my !== seq) return;
      panel.querySelectorAll('[data-feed]').forEach((el) => {
        el.innerHTML = `<p class="cc-error">${esc(err.status === 503 ? "This part can't reach its databases right now." : "This part didn't load. Refresh to try again.")}</p>`;
      });
    }
  }

  function bindBack(panel) {
    panel.querySelectorAll('.co-back').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.go({ company: null }); }));
  }

  const section = (title, sub, body, cls = '') => `<section class="cc-card co-sec ${cls}"><div class="co-sec-head"><h2>${title}</h2>${sub ? `<span class="cc-muted">${sub}</span>` : ''}</div>${body}</section>`;

  const tileHtml = (n, label) => `<div class="co-tile"><b>${n}</b><span>${label}</span></div>`;
  function tilesHtml(t) {
    return `${tileHtml(ctx.fmt(t.grant_views), 'grant card views')}${tileHtml(ctx.fmt(t.grants_opened), 'grants opened')}
      ${tileHtml(`${t.minutes_on_grants}m`, 'time on grant cards')}${tileHtml(`${t.thumbs_up} / ${t.thumbs_down}`, '👍 / 👎')}${tileHtml(ctx.fmt(t.chats), t.chats === 1 ? 'chat' : 'chats')}`;
  }
  const skeleton = '<div class="cc-skel" style="width:70%"></div><div class="cc-skel" style="width:50%"></div><div class="cc-skel" style="width:60%"></div>';

  function pageHtml(d) {
    const c = d.company;
    const pending = (title, key) => section(title, '<span class="co-loading">Loading…</span>', `<div data-feed="${key}">${skeleton}</div>`);
    return `<div class="co-page">
      <p><a href="#companies" class="co-back">← All companies</a></p>
      <header class="co-head cc-card">
        <p class="co-eyebrow">Company</p>
        <h1>${esc(c.name)}${internalTag(c.internal)} <span class="cc-muted co-id">#${c.id}</span></h1>
        <p class="cc-muted" data-head-meta>Signed up ${esc(day(c.signed_up))}${c.deleted ? ' · <b>deleted</b>' : ''}</p>
        <div class="co-tiles" data-feed="tiles">${['grant card views', 'grants opened', 'time on grant cards', '👍 / 👎', 'chats'].map((l) => tileHtml('<span class="co-tile-wait">–</span>', l)).join('')}</div>
      </header>
      <div class="co-grid">
        ${profileHtml(d.profile)}
        ${goalsHtml(d.goals)}
      </div>
      ${tracksHtml(d.goal_tracks, c)}
      <div class="co-grid co-grid-wide">
        <div data-slot="timeline">${pending('Timeline', 'timeline')}</div>
        <div class="co-side"><div data-slot="chats">${pending('Chats', 'chats')}</div><div data-slot="cards">${pending('Review cards', 'cards')}</div></div>
      </div>
    </div>`;
  }

  /** Put the second half in place once it lands. */
  function fillFeed(panel, data, feed) {
    data.chats = feed.chats;
    const c = data.company;
    panel.querySelector('[data-head-meta]').innerHTML = `Signed up ${esc(day(c.signed_up))} · last active ${esc(day(feed.last_active || c.signed_up))} · ${ctx.plural(feed.users, 'sign-in')}${c.deleted ? ' · <b>deleted</b>' : ''}`;
    panel.querySelector('[data-feed="tiles"]').innerHTML = tilesHtml(feed.tiles);
    panel.querySelector('[data-slot="timeline"]').innerHTML = timelineHtml(feed.timeline);
    panel.querySelector('[data-slot="chats"]').innerHTML = chatsHtml(feed.chats);
    panel.querySelector('[data-slot="cards"]').innerHTML = cardsHtml(feed.review_cards);
    panel.querySelectorAll('[data-slot] a[href^="#review/"]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.goReview(Number(a.getAttribute('href').split('/')[1])); }));
    if (!ctx.reduceMotion) panel.querySelectorAll('[data-slot] > .co-sec').forEach((el) => el.classList.add('co-fade'));
  }

  function profileHtml(p) {
    if (!p.found) return section('Profile', '', '<p class="co-gap">No company profile on record — matching has nothing to check against.</p>');
    const e = p.engine;
    const row = (label, value, other) => `<tr><th>${label}</th><td>${value}${other ? `<div class="co-also">Also on record: ${other}</div>` : ''}</td></tr>`;
    const list = (xs) => (xs.length ? esc(xs.join(', ')) : '<span class="co-missing">None</span>');
    return section('Profile', 'as matching sees it', `
      ${p.gaps.length ? `<ul class="co-gaps">${p.gaps.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ul>` : '<p class="co-ok">Nothing missing that matching relies on.</p>'}
      <table class="co-kv">
        ${row('Industries', list(e.industries), p.differs?.industries && p.also_on_record.industries.length ? esc(p.also_on_record.industries.join(', ')) : '')}
        ${row('Provinces', list(e.provinces), p.differs?.regions && p.also_on_record.regions.length ? esc(p.also_on_record.regions.join(', ')) : '')}
        ${row('Company size', e.employee_count != null ? esc(e.employee_count) : '<span class="co-missing">None</span>')}
        ${row('Revenue', e.annual_revenue != null ? esc(e.annual_revenue) : '<span class="co-missing">None</span>')}
        ${row('Business type', p.business_type ? esc(p.business_type) : '<span class="co-missing">None</span>')}
        ${row('Incorporated', p.incorporation_date ? esc(day(p.incorporation_date)) : '<span class="co-missing">None</span>')}
        ${p.also_on_record?.headquarters_province ? row('Headquarters', esc(p.also_on_record.headquarters_province)) : ''}
      </table>`);
  }

  function goalsHtml(g) {
    return section('Goals', g.active.length ? `${g.active.length} selected` : '', `
      ${g.active.length ? `<ul class="co-goals">${g.active.map((x) => `<li>${esc(x.name)}<span class="cc-muted"> since ${esc(day(x.added))}</span></li>`).join('')}</ul>` : '<p class="co-gap">No goals selected — goal tracks have nothing to rank for.</p>'}
      ${g.earlier.length ? `<details class="co-earlier"><summary>${ctx.plural(g.earlier.length, 'earlier goal')}</summary><ul>${g.earlier.map((x) => `<li>${esc(x.name)} <span class="cc-muted">${esc(day(x.added))} – ${esc(day(x.removed))}</span></li>`).join('')}</ul></details>` : ''}
      <p class="cc-muted co-answers">${g.module_answers ? `${ctx.plural(g.module_answers, 'goal question')} answered` : 'No goal questions answered yet'}.</p>`);
  }

  function tracksHtml(gt, company) {
    if (!gt.as_of) return section('Goal tracks', '', '<p class="cc-muted">No recorded match run for this company yet.</p>');
    const grantRow = (g, track) => `<li class="co-grant${g.review?.action === 'cut' ? ' is-cut' : ''}${!g.shown ? ' is-hidden' : ''}" data-grant="${g.grant_id}">
      <div class="co-grant-main">
        <span class="co-pos">${g.shown && g.position ? `#${g.position}` : '—'}</span>
        <div class="co-grant-text">
          <a class="co-grant-name" href="${esc(ctx.grantHref(g.grant_id))}" data-grant-link="${g.grant_id}">${esc(g.grant_name || `Grant #${g.grant_id}`)}</a>
          <div class="co-grant-meta">${g.eligibility ? `<span>${esc(ELIGIBILITY_WORDS[g.eligibility] || g.eligibility)}</span>` : ''}${!g.shown ? `<span>Not shown${g.removed_at ? ` (removed at ${esc(g.removed_at.replace(/_/g, ' '))})` : ''}</span>` : ''}
            ${g.review ? `<span class="co-review co-review-${g.review.action}" title="${esc(g.review.reason || '')}">${esc(g.review.label)}</span>` : ''}</div>
          ${g.review?.reason ? `<p class="co-review-reason">${esc(g.review.reason)}</p>` : ''}
        </div>
        <div class="co-actions"><button type="button" class="co-btn" data-why="${g.grant_id}">Why matched?</button><button type="button" class="co-btn" data-flag="${g.grant_id}" data-name="${esc(g.grant_name || '')}" data-track="${esc(track)}">⚑ Flag as bad match</button></div>
      </div>
      <div class="co-slot" hidden></div>
    </li>`;
    const block = (t) => `<div class="co-track"><h3>${esc(t.goal)}${t.goal !== 'All goals' && t.section !== t.goal ? ` <span class="cc-muted co-alias">(track “${esc(t.section)}”)</span>` : ''}</h3>
      ${!t.in_run ? '<p class="cc-muted">This goal wasn\'t in the latest run — it was added after it, or the track was empty.</p>'
    : t.grants.length ? `<p class="cc-muted co-track-sub">${ctx.plural(t.shown, 'grant')} shown${t.considered ? ` of ${ctx.fmt(t.considered)} considered` : ''}${t.grants.some((g) => g.review?.action === 'cut') ? ` · ${t.grants.filter((g) => g.review?.action === 'cut').length} cut by the AI review` : ''}</p><ol class="co-grants">${t.grants.map((g) => grantRow(g, t.goal)).join('')}</ol>`
      : emptyTrackHtml(t, company)}</div>`;
    return section('Goal tracks', `as of ${esc(day(gt.as_of))}, ${esc(time(gt.as_of))} — the latest recorded run`, `<div class="co-tracks">${gt.tracks.map(block).join('')}</div>`, 'co-tracks-sec');
  }

  /** A track that showed the client nothing: the prominent state, where the grants went, one-click flag. */
  function emptyTrackHtml(t, company) {
    const max = Math.max(1, ...(t.removed || []).map((r) => r.n));
    return `<div class="co-empty" data-track="${esc(t.section)}">
      <p class="co-empty-head"><b>${esc(company.name)} saw nothing here.</b> ${t.considered ? `${ctx.fmt(t.considered)} grants were considered; none made the list.` : 'No grants made the list.'}</p>
      ${t.removed?.length ? `<ul class="co-removed">${t.removed.map((r) => `<li><span class="co-removed-label">${esc(r.words.charAt(0).toUpperCase() + r.words.slice(1))}</span>
        <span class="co-removed-bar"><i style="--w:${(r.n / max) * 100}%"></i></span><b>${ctx.fmt(r.n)}</b></li>`).join('')}</ul>` : ''}
      <div class="co-empty-foot">${t.card && t.card.status !== 'closed'
    ? `<span class="co-empty-result">⚑ Already flagged — <a href="#review/${t.card.id}">review card #${t.card.id}</a> (${esc(STATUS_WORDS[t.card.status] || t.card.status)})</span>`
    : `<button type="button" class="co-btn co-btn-warn" data-empty-track="${esc(t.section)}">⚑ Flag empty track${t.card ? ' again' : ''}</button><span class="co-empty-result" role="status">${t.card ? `Card #${t.card.id} was closed; flagging reopens it.` : ''}</span>`}</div>
    </div>`;
  }

  const TL_ICON = { signed_up: '★', matches: '◆', opened: '●', rated: '●', saved: '●', unsaved: '○', chat: '◼', card_filed: '⚑', card_closed: '✓' };
  function timelineHtml(events, shown = TIMELINE_PAGE) {
    if (!events.length) return section('Timeline', '', '<p class="cc-muted">Nothing recorded yet.</p>');
    return section('Timeline', `${ctx.plural(events.length, 'event')}, newest first`,
      `<div class="co-tl-wrap" data-shown="${Math.min(shown, events.length)}">${timelineItems(events.slice(0, shown))}</div>${moreButton(events.length, shown)}`, 'co-timeline');
  }
  const moreButton = (total, shown) => (total > shown
    ? `<button type="button" class="co-btn co-more" data-more-timeline>Show ${Math.min(TIMELINE_PAGE, total - shown)} more <span class="cc-muted">(${ctx.fmt(total - shown)} older)</span></button>` : '');

  function timelineItems(events) {
    const groups = [];
    for (const e of events) {
      const k = vanDay(e.at);
      if (!groups.length || groups.at(-1).k !== k) groups.push({ k, at: e.at, items: [] });
      groups.at(-1).items.push(e);
    }
    const item = (e) => `<li class="co-tl-${e.type}"><span class="co-dot" aria-hidden="true">${TL_ICON[e.type] || '●'}</span>
      <div class="co-tl-body">
        <div class="co-tl-top"><span class="co-tl-text">${e.link ? `<a href="#review/${e.card_id}">${esc(e.text)}</a>` : e.type === 'chat' ? `<a href="#" data-open-chat="${e.conversation_id}">${esc(e.text)}</a>` : esc(e.text)}</span>${e.source ? `<span class="co-chip">${esc(e.source)}</span>` : ''}</div>
        <span class="cc-muted">${esc(time(e.at))}${e.seconds != null ? ` · ${e.seconds}s on page` : ''}</span>
        ${e.type === 'opened' ? `<div class="co-actions"><button type="button" class="co-btn" data-why="${e.grant_id}">Why matched?</button><button type="button" class="co-btn" data-flag="${e.grant_id}" data-name="${esc(e.grant_name || '')}">⚑ Flag as bad match</button></div><div class="co-slot" hidden></div>` : ''}
      </div></li>`;
    return groups.map((g) => `<h3 class="co-tl-day">${esc(fullDay(g.at))}</h3><ol class="co-tl">${g.items.map(item).join('')}</ol>`).join('');
  }

  function viewedBy(v) {
    if (!v?.length) return 'Not viewed from here yet';
    return `Viewed by ${v.map((x) => `${esc(x.name || x.viewer)} (${esc(day(x.last_viewed_at))}${x.views > 1 ? `, ${x.views}×` : ''})`).join(', ')}`;
  }

  function chatsHtml(chats) {
    return section('Chats', chats.length ? ctx.plural(chats.length, 'conversation') : '', chats.length ? `<ul class="co-chats">${chats.map((c) => `<li data-chat="${c.conversation_id}">
        <div class="co-chat-top"><span class="co-chat-q">“${esc(c.first_question || '…')}”</span></div>
        <span class="cc-muted">${esc(day(c.started))} · ${ctx.plural(c.questions, 'question')}</span>
        <div class="co-chat-foot"><span class="cc-muted co-viewed">${viewedBy(c.viewed_by)}</span><button type="button" class="co-btn" data-open-chat="${c.conversation_id}">Open</button></div>
        <div class="co-transcript" hidden></div></li>`).join('')}</ul>
        <p class="cc-muted co-note">Opening a chat shows the client's own words and is logged with your name.</p>` : '<p class="cc-muted">No chats yet.</p>');
  }

  function cardsHtml(cards) {
    const own = cards.filter((c) => !c.involves_client);
    const patterns = cards.filter((c) => c.involves_client);
    const li = (c) => `<li><a href="#review/${c.id}">
        <span class="rq-type rq-type-${c.kind}">${TYPE_WORDS[c.kind] || esc(c.kind)}</span> ${esc(c.title)}</a>
        <span class="cc-muted">${c.involves_client ? `<b class="co-involves">Pattern involving this client</b> · ${ctx.plural(c.cuts_for_client, 'cut')} of theirs · ` : ''}${STATUS_WORDS[c.status] || esc(c.status)}${c.owner ? ` · ${OWNER_WORDS[c.owner]}` : ''} · ${ctx.plural(c.flag_count, 'flag')}</span></li>`;
    return section('Review cards', cards.length ? `${cards.filter((c) => c.status !== 'closed').length} open` : '', cards.length
      ? `${own.length ? `<ul class="co-cards">${own.map(li).join('')}</ul>` : '<p class="cc-muted">No cards filed about this company itself.</p>'}
        ${patterns.length ? `<h3 class="co-sub">Grant patterns involving this client</h3><ul class="co-cards">${patterns.map(li).join('')}</ul>` : ''}`
      : '<p class="cc-muted">No review cards about this company.</p>');
  }

  // ---------------------------------------------------------------- page actions
  function bindPage(panel, data) {
    const companyId = data.company.id;
    bindBack(panel);
    panel.querySelectorAll('[data-grant-link]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.openGrant(Number(a.dataset.grantLink), a.textContent); }));
    panel.querySelectorAll('a[href^="#review/"]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.goReview(Number(a.getAttribute('href').split('/')[1])); }));

    // One delegated handler per page render; the panel element outlives renders.
    if (panel._coClick) panel.removeEventListener('click', panel._coClick);
    panel._coClick = async (e) => {
      if (!e.target.closest('.co-page')) return;
      const why = e.target.closest('[data-why]');
      const flag = e.target.closest('[data-flag]');
      const chat = e.target.closest('[data-open-chat]');
      const more = e.target.closest('[data-more-timeline]');
      const empty = e.target.closest('[data-empty-track]');
      if (more) { e.preventDefault(); showMore(panel, companyId, more); return; }
      if (empty) { e.preventDefault(); await flagEmptyTrack(empty, companyId); return; }
      if (why) { e.preventDefault(); await toggleWhy(why, companyId); }
      else if (flag) { e.preventDefault(); toggleFlag(flag, companyId); }
      else if (chat) { e.preventDefault(); await openChat(panel, Number(chat.dataset.openChat), companyId, data); }
    };
    panel.addEventListener('click', panel._coClick);
  }

  /** The next TIMELINE_PAGE events, appended under the ones already shown. */
  function showMore(panel, companyId, btn) {
    const feed = feedCache.get(companyId);
    const wrap = panel.querySelector('.co-tl-wrap');
    if (!feed || !wrap) return;
    const shown = Number(wrap.dataset.shown);
    const next = Math.min(feed.timeline.length, shown + TIMELINE_PAGE);
    wrap.insertAdjacentHTML('beforeend', timelineItems(feed.timeline.slice(shown, next)));
    wrap.dataset.shown = String(next);
    const replacement = moreButton(feed.timeline.length, next);
    if (replacement) btn.outerHTML = replacement; else btn.remove();
  }

  /** One click: a staff empty_track card with the track's evidence (built server-side). */
  async function flagEmptyTrack(btn, companyId) {
    const out = btn.parentElement.querySelector('.co-empty-result');
    btn.disabled = true;
    out.textContent = 'Filing…';
    try {
      const r = await ctx.send('POST', `${API}/${companyId}/empty-track`, { track: btn.dataset.emptyTrack });
      out.innerHTML = `${r.created ? 'Filed' : r.reopened ? 'Reopened' : 'Added to'} — <a href="#review/${r.id}">review card #${r.id}</a>`;
      out.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); ctx.goReview(r.id); });
      btn.textContent = '⚑ Flagged';
      feedCache.delete(companyId);
      pageCache.delete(companyId);
    } catch (err) {
      out.textContent = err.status === 409 ? 'This track showed grants after all — refresh the page.' : "That didn't file. Try again.";
      btn.disabled = false;
    }
  }

  const slotOf = (btn) => btn.closest('li').querySelector(':scope > .co-slot, :scope .co-tl-body > .co-slot');

  async function toggleWhy(btn, companyId) {
    const slot = slotOf(btn);
    if (!slot.hidden && slot.dataset.mode === 'why') { slot.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    slot.dataset.mode = 'why'; slot.hidden = false; btn.setAttribute('aria-expanded', 'true');
    slot.innerHTML = '<p class="cc-muted co-checking">Checking this grant against the profile… (no AI involved — the same checks matching runs)</p>';
    try {
      const r = await ctx.api(`${API}/${companyId}/why?grant=${btn.dataset.why}`);
      slot.innerHTML = `<div class="co-why">${window.CCReview.whyMatchedHtml(r, ctx.reviewCtx)}
        <p class="cc-muted">${r.passes_eligibility_now === false ? 'With the profile as it is now, this grant would no longer pass eligibility.' : r.passes_eligibility_now ? 'With the profile as it is now, this grant still passes eligibility.' : ''}</p></div>`;
    } catch (err) {
      slot.innerHTML = `<p class="cc-error">${esc(err.status === 503 ? 'The match explanation service isn\'t configured on this server.' : "The explanation didn't load. Try again.")}</p>`;
    }
  }

  function toggleFlag(btn, companyId) {
    const slot = slotOf(btn);
    if (!slot.hidden && slot.dataset.mode === 'flag') { slot.hidden = true; return; }
    slot.dataset.mode = 'flag'; slot.hidden = false;
    const name = btn.dataset.name || `grant #${btn.dataset.flag}`;
    slot.innerHTML = `<form class="co-flag">
      <label>Why is ${esc(name)} a bad match for this company? <span class="cc-muted">(optional)</span>
        <textarea rows="2" maxlength="4000" placeholder="e.g. Ontario only, and they're in Alberta"></textarea></label>
      <div class="co-flag-actions"><button type="submit" class="co-btn co-btn-primary">⚑ Flag as bad match</button><button type="button" class="co-btn" data-cancel>Cancel</button></div>
      <p class="co-flag-result" role="status"></p></form>`;
    const form = slot.querySelector('form');
    slot.querySelector('[data-cancel]').addEventListener('click', () => { slot.hidden = true; });
    slot.querySelector('textarea').focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const note = form.querySelector('textarea').value.trim();
      try {
        const r = await ctx.send('POST', '/api/control-centre/review/flag', {
          kind: 'match', company_id: companyId, grant_root_id: Number(btn.dataset.flag), ...(note ? { comment: note } : {})
        });
        const id = Number(r.item?.id);
        form.querySelector('.co-flag-result').innerHTML = `${r.created ? 'Filed' : r.reopened ? 'Reopened' : 'Added to'} — <a href="#review/${id}" data-card="${id}">review card #${id}</a>`;
        form.querySelector('[data-card]').addEventListener('click', (ev) => { ev.preventDefault(); ctx.goReview(id); });
        form.querySelector('textarea').disabled = true;
        feedCache.delete(companyId);
      } catch (err) {
        form.querySelector('.co-flag-result').textContent = err.message && err.status === 400 ? err.message : "That didn't file. Try again.";
        submit.disabled = false;
      }
    });
  }

  async function openChat(panel, conversationId, companyId, data) {
    const li = panel.querySelector(`.co-chats li[data-chat="${conversationId}"]`);
    if (!li) return;
    li.scrollIntoView({ block: 'nearest', behavior: ctx.reduceMotion ? 'auto' : 'smooth' });
    const box = li.querySelector('.co-transcript');
    const btn = li.querySelector('[data-open-chat]');
    if (!box.hidden) { box.hidden = true; btn.textContent = 'Open'; return; }
    box.hidden = false; box.innerHTML = '<p class="cc-muted">Loading the conversation…</p>';
    try {
      const r = await ctx.api(`${API}/${companyId}/chats/${conversationId}`);
      box.innerHTML = `<ol class="rq-chat">${r.turns.map((t) => `<li><div class="rq-msg rq-msg-client"><span class="rq-who">Client · message ${t.turn_index + 1}</span><p>${esc(t.client)}</p></div>
        ${t.assistant ? `<div class="rq-msg rq-msg-ai"><span class="rq-who">Assistant${t.tools_used?.length ? ` · used ${esc(t.tools_used.map((x) => x.replace(/_/g, ' ')).join(', '))}` : ''}</span><p>${esc(t.assistant)}</p></div>` : ''}</li>`).join('')}</ol>`;
      li.querySelector('.co-viewed').innerHTML = viewedBy(r.viewed_by);
      const c = data.chats.find((x) => x.conversation_id === conversationId);
      if (c) c.viewed_by = r.viewed_by;
      btn.textContent = 'Close';
    } catch (err) {
      box.innerHTML = `<p class="cc-error">${esc(err.status === 503 ? "The chat history can't be reached from here." : "The conversation didn't load.")}</p>`;
    }
  }

  window.CCCompanies = {
    render,
    clearCache: () => { listCache.clear(); pageCache.clear(); feedCache.clear(); },
    // "Why matched?" and "Flag as bad match" for another tab's rows (the Grants
    // tab): the button carries the grant (data-why / data-flag), the caller the company.
    toggleWhy: (btn, companyId, helpers) => { ctx = ctx || helpers; return toggleWhy(btn, companyId); },
    toggleFlag: (btn, companyId, helpers) => { ctx = ctx || helpers; return toggleFlag(btn, companyId); }
  };
})();

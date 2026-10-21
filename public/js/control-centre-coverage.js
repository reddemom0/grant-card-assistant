/**
 * Control Centre — Coverage & changes tab.
 *
 *   #coverage                          industry table (main industries, each
 *                                      expandable into its specific ones), then
 *                                      province / goal type / grant vs loan, then
 *                                      what changed in the catalogue
 *   #coverage?view=not_matching        the Not matching view of the industry table
 *   #coverage/industry/<name>          that main or specific industry expanded
 *
 * Coverage is today's catalogue; matches, AI-review cuts, goal-track gaps and
 * changes follow the range. Data: GET /api/control-centre/coverage?range= (both
 * variants — client-only and with internal accounts — so the switch needs no
 * refetch) and /coverage/changes?range=. Loaded before control-centre.js, which
 * calls CCCoverage.render(panel, ctx). Docs: docs/control-centre.md.
 */
(function () {
  'use strict';

  const API = '/api/control-centre/coverage';
  const VIEWS = [
    { key: 'all', label: 'All industries' },
    { key: 'not_matching', label: 'Not matching' }
  ];
  const STATUS_WORDS = { inactive: 'inactive', archived: 'archived', hide: 'hidden', draft: 'back to draft', waitlisting: 'waitlisting', coming_soon: 'coming soon', editing: 'editing' };
  const LEVEL_WORDS = { umbrella: 'restricted (broad)', specific: 'restricted (specific)', agnostic: 'open to every industry' };

  let ctx = null;
  const covCache = new Map();
  const chgCache = new Map();
  let seq = 0;
  let cutsOpen = null;   // industry whose cut list is open

  const esc = (v) => ctx.esc(v);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}${y !== new Date().getFullYear() ? `, ${y}` : ''}`;
  };
  const when = (iso) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' });
  const internalTag = (on) => (on ? ' <span class="cc-tag-internal">Internal</span>' : '');
  const variantKey = () => (ctx.includeInternal() ? 'all_variant' : 'clients_variant');
  const viewOf = () => (new URLSearchParams(ctx.state().vq || '').get('view') === 'not_matching' ? 'not_matching' : 'all');
  const rangeWords = (d) => ctx.rangeWords(d.range);

  // ---------------------------------------------------------------- render
  async function render(panel, helpers) {
    ctx = helpers;
    const my = ++seq;
    const range = ctx.state().range;
    if (!panel.querySelector('.cv')) panel.innerHTML = '<div class="cc-card"><div class="cc-skel" style="width:30%"></div><div class="cc-skel" style="width:80%"></div><div class="cc-skel" style="width:70%"></div></div>';
    panel.classList.add('cc-loading');
    let cov = covCache.get(range);
    let chg = chgCache.get(range);
    try {
      [cov, chg] = await Promise.all([
        cov ?? ctx.api(`${API}?range=${range}`).then((d) => { covCache.set(range, d); return d; }),
        chg ?? ctx.api(`${API}/changes?range=${range}`).then((d) => { chgCache.set(range, d); return d; })
      ]);
    } catch (err) {
      if (my !== seq) return;
      panel.classList.remove('cc-loading');
      panel.innerHTML = `<div class="cc-error">${esc(err.status === 503 ? "Coverage can't reach its databases right now." : "Coverage didn't load. Refresh the page to try again.")}</div>`;
      return;
    }
    if (my !== seq || ctx.state().tab !== 'coverage') return;
    panel.classList.remove('cc-loading');
    paint(panel, cov, chg);
  }

  function paint(panel, cov, chg) {
    const first = !panel.querySelector('.cv');
    const scrollY = window.scrollY;
    panel.innerHTML = `<div class="cv${first && !ctx.reduceMotion ? ' co-enter' : ''}">
      ${industryHtml(cov)}
      <div class="cv-grid">${provinceHtml(cov)}${goalHtml(cov)}</div>
      ${fundingHtml(cov)}
      ${changesHtml(chg)}
    </div>`;
    bind(panel, cov, chg);
    const target = ctx.state().industry;
    if (first && target) {
      const row = [...panel.querySelectorAll('[data-industry]')].find((r) => r.dataset.industry === target);
      if (row) row.scrollIntoView({ block: 'center' });
    } else if (!first) window.scrollTo({ top: scrollY });
  }

  // ---------------------------------------------------------------- industry table
  const grantLinkHtml = (cov, id) => {
    const g = cov.grants[id];
    return `<a href="#grants/${id}" data-grant="${id}">${esc(g?.title || `Grant #${id}`)}</a> <span class="cc-muted co-id">#${id}</span>`;
  };
  const clientLinkHtml = (cov, id) => {
    const c = cov.clients[id];
    return `<a href="#companies/${id}" data-company="${id}">${esc(c?.name || `Company #${id}`)}</a>${internalTag(c?.internal)}`;
  };
  const num = (n, hot = false) => `<td class="num${hot && n > 0 ? ' gr-hot' : ''}${n === 0 ? ' gr-zero' : ''}">${n == null ? '—' : ctx.fmt(n)}</td>`;
  const avgCell = (r) => `<td class="num${r.avg_matches == null ? ' gr-zero' : ''}">${r.avg_matches == null ? '—' : esc(r.avg_matches)}</td>`;

  function industryHtml(cov) {
    const v = cov[variantKey()];
    const view = viewOf();
    const internal = ctx.includeInternal();
    const cat = cov.catalogue;
    const head = `<div class="co-list-head">
        <div><h2>Coverage by industry</h2>
          <p class="cc-sub">Today's catalogue: ${ctx.plural(cat.live_grants, 'live grant')} — ${ctx.fmt(cat.restricted)} restricted to an industry, ${ctx.fmt(cat.open_to_all)} open to every industry${cat.not_in_hub_copy.length ? `, ${ctx.fmt(cat.not_in_hub_copy.length)} not in the Hub's copy of the grant data yet` : ''}. Grant matches and AI-review cuts are ${esc(rangeWords(cov))}.</p></div>
        <div class="co-tools">
          <label class="cc-switch"><input type="checkbox" role="switch" ${internal ? 'checked' : ''}><span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label>
        </div>
      </div>
      <div class="gr-views" role="tablist" aria-label="Industry views">${VIEWS.map((x) => `<button type="button" role="tab" class="gr-view" data-view="${x.key}" aria-selected="${x.key === view}">${esc(x.label)}</button>`).join('')}</div>
      <p class="cv-note" role="note">${esc(cov.note)}</p>`;
    const body = view === 'not_matching' ? notMatchingHtml(cov, v) : allHtml(cov, v);
    return `<section class="cc-card co-list cv-ind">${head}${body}
      <p class="cc-muted co-note">Clients are companies whose profile industry maps to the row, as of today. The average counts grant matches per client who ran matching ${esc(rangeWords(cov))}. <b>Thin</b>: at least ${cov.definitions.thin_min_clients} clients ran matching and the average is under ${cov.definitions.thin_max_avg}. Wrong-industry cuts are the grants the AI review removed from these clients' lists for "wrong industry" (one per client and grant); AI-review data starts ${esc(day(cov.definitions.cuts_from))}. The engine judges industry by main industry, so specific rows are a finer view of the same grants.</p>
    </section>`;
  }

  const COLS = `<thead><tr><th scope="col">Industry</th><th scope="col" class="num" title="Live grants restricted to this industry">Restricted grants</th>
    <th scope="col" class="num" title="Live grants open to every industry (the same for every row)">Open to every industry</th>
    <th scope="col" class="num">Clients</th><th scope="col" class="num" title="Clients who ran matching in the range">Ran matching</th>
    <th scope="col" class="num" title="Grant matches per client who ran matching">Avg grant matches</th>
    <th scope="col" class="num" title="Grants the AI review removed for wrong industry, one per client and grant">Wrong-industry cuts</th></tr></thead>`;

  function rowHtml(r, { sub = false, open = false, showMain = false } = {}) {
    const name = r.industry;
    return `<tr class="cv-row${sub ? ' cv-sub' : ''}${open ? ' is-open' : ''}" tabindex="0" data-industry="${esc(name)}" aria-expanded="${open}">
      <td><span class="cv-caret" aria-hidden="true">${open ? '▾' : '▸'}</span><span class="${sub ? '' : 'co-name'}">${esc(name)}</span>${showMain && r.main ? ` <span class="cc-muted cv-level">in ${esc(r.main)}</span>` : ''}${r.thin ? ' <span class="cv-thin">Thin</span>' : ''}</td>
      ${num(r.restricted)}${num(r.open_to_all)}${num(r.clients)}${num(r.ran_matching)}${avgCell(r)}
      <td class="num">${r.wrong_industry_cuts ? `<button type="button" class="cv-cuts" data-cuts="${esc(name)}">${ctx.fmt(r.wrong_industry_cuts)}</button>` : '<span class="gr-zero">0</span>'}</td>
    </tr>`;
  }

  function detailHtml(cov, r) {
    const restricted = [...r.restricted_ids].sort((a, b) => String(cov.grants[a]?.title).localeCompare(String(cov.grants[b]?.title)));
    const openIds = cov.open_to_all_ids;
    const clients = r.client_ids;
    const cuts = r.cut_grants;
    return `<tr class="cv-detail"><td colspan="7"><div class="cv-detail-grid">
      <div><h3>Grants restricted to ${esc(r.industry)} <span class="cc-muted">${ctx.fmt(restricted.length)}</span></h3>
        ${restricted.length ? `<ul class="cv-grants">${restricted.map((id) => `<li>${grantLinkHtml(cov, id)} <span class="cc-muted cv-level">${esc(LEVEL_WORDS[cov.grants[id]?.level] || '')}</span></li>`).join('')}</ul>`
    : `<p class="co-gap">${r.restricted == null ? 'Clients picked the main industry itself, so there is no single tag to count grants by.' : 'No live grant is restricted to this industry.'}</p>`}
        <details class="cv-open"><summary>${ctx.plural(openIds.length, 'grant')} open to every industry</summary>
          <ul class="cv-grants">${openIds.map((id) => `<li>${grantLinkHtml(cov, id)}</li>`).join('')}</ul></details>
      </div>
      <div><h3>Clients <span class="cc-muted">${ctx.fmt(clients.length)}</span></h3>
        ${clients.length ? `<ul class="cv-clients">${clients.map((id) => `<li>${clientLinkHtml(cov, id)}</li>`).join('')}</ul>` : '<p class="cc-muted">No client has this industry on their profile yet.</p>'}
        <div class="cv-cutlist${cutsOpen === r.industry ? ' is-focus' : ''}" data-cutlist="${esc(r.industry)}"><h3>Wrong-industry cuts <span class="cc-muted">${ctx.fmt(r.wrong_industry_cuts)}</span></h3>
        ${cuts.length ? `<ul class="cv-grants">${cuts.map((c) => `<li>${grantLinkHtml(cov, c.grant_id)} <span class="cc-muted">· cut for ${ctx.plural(c.clients, 'client')}</span></li>`).join('')}</ul>` : `<p class="cc-muted">None ${esc(rangeWords(cov))}.</p>`}</div>
      </div>
    </div></td></tr>`;
  }

  function allHtml(cov, v) {
    const target = ctx.state().industry;
    const rows = [...v.industries];
    if (v.not_mapped.clients) rows.push(v.not_mapped);
    const body = rows.map((r) => {
      const subOpen = r.specifics.some((s) => s.industry === target);
      const open = target === r.industry || subOpen;
      let html = rowHtml(r, { open });
      if (open) {
        if (target === r.industry) html += detailHtml(cov, r);
        html += r.specifics.map((s) => rowHtml(s, { sub: true, open: s.industry === target }) + (s.industry === target ? detailHtml(cov, s) : '')).join('');
      }
      return html;
    }).join('');
    return `<div class="co-scroll"><table class="cc-table co-table gr-table cv-table">${COLS}<tbody>${body}</tbody></table></div>`;
  }

  function notMatchingHtml(cov, v) {
    const nm = notMatching(v);
    const b = nm.no_restricted;
    const target = ctx.state().industry;
    // Flat lists, worst first: a specific industry names its main rather than sitting under one.
    const table = (rows) => `<div class="co-scroll"><table class="cc-table co-table gr-table cv-table">${COLS}<tbody>${rows.map((r) => rowHtml(r, { showMain: r.level === 'specific', open: r.industry === target })
      + (r.industry === target ? detailHtml(cov, r) : '')).join('')}</tbody></table></div>`;
    return `<h3 class="cv-h">Ran matching, got zero matches <span class="cv-thin">Coverage gap</span> <span class="cc-muted">${ctx.plural(nm.ran_zero.length, 'industry', 'industries')} ${esc(rangeWords(cov))}, most clients who ran matching first</span></h3>
      ${nm.ran_zero.length ? table(nm.ran_zero)
    : `<p class="cc-muted cv-none-note">Every industry whose clients ran matching ${esc(rangeWords(cov))} got at least one grant match.</p>`}
      <h3 class="cv-h">Haven't run matching yet <span class="cc-muted">${ctx.plural(nm.not_run.length, 'industry', 'industries')} with clients but no matching run ${esc(rangeWords(cov))} — not a coverage gap; most clients first</span></h3>
      ${nm.not_run.length ? table(nm.not_run)
    : `<p class="cc-muted cv-none-note">Every industry with clients had a matching run ${esc(rangeWords(cov))}.</p>`}
      <h3 class="cv-h">No restricted grants — only grants open to every industry <span class="cc-muted">shown whether or not they have clients yet</span></h3>
      ${b.length ? `<ul class="cv-none">${b.map((x) => `<li><div class="cv-none-main">${x.main_has_none ? `<button type="button" class="cv-link" data-goto="${esc(x.row.industry)}">${esc(x.row.industry)}</button> <span class="cv-thin">No restricted grants</span>` : `<span class="co-name">${esc(x.row.industry)}</span> <span class="cc-muted">has ${ctx.plural(x.row.restricted, 'restricted grant')}; these specific industries have none:</span>`}</div>
        ${x.specifics.length ? `<div class="cv-chips">${x.specifics.map((s) => `<button type="button" class="cv-chip" data-goto="${esc(s.industry)}">${esc(s.industry)}${s.clients ? ` <b>${ctx.plural(s.clients, 'client')}</b>` : ''}</button>`).join('')}</div>` : ''}</li>`).join('')}</ul>`
    : '<p class="cc-muted cv-none-note">Every industry has at least one restricted grant.</p>'}`;
  }

  /** The server's applyCoverageView, on the variant already loaded (no refetch for the switch). */
  function notMatching(v) {
    const flat = v.industries.flatMap((r) => [r, ...r.specifics]);
    const byRan = (x, y) => y.ran_matching - x.ran_matching || y.clients - x.clients || x.industry.localeCompare(y.industry);
    const byClients = (x, y) => y.clients - x.clients || x.industry.localeCompare(y.industry);
    return {
      ran_zero: flat.filter((r) => r.ran_matching > 0 && r.grant_matches === 0).sort(byRan),
      not_run: flat.filter((r) => r.clients > 0 && r.ran_matching === 0).sort(byClients),
      no_restricted: v.industries.map((r) => ({ main_has_none: r.restricted === 0, row: r, specifics: r.specifics.filter((s) => s.restricted === 0) }))
        .filter((x) => x.main_has_none || x.specifics.length)
    };
  }

  // ---------------------------------------------------------------- breakdowns
  const section = (title, sub, body, cls = '') => `<section class="cc-card co-sec ${cls}"><div class="co-sec-head"><h2>${title}</h2>${sub ? `<span class="cc-muted">${sub}</span>` : ''}</div>${body}</section>`;

  function gapsHtml(cov, gaps) {
    if (!gaps.length) return '';
    return `<details class="cv-gaps"><summary>${ctx.plural(gaps.length, 'goal track')} with few or no grants</summary><ul>${gaps.map((g) => `<li>
      ${clientLinkHtml(cov, g.company_id)} · <span>${esc(g.section === 'funding_matches' ? 'All goals' : g.section)}</span> ·
      <span class="${g.gap === 'empty' ? 'cv-empty' : 'cv-few'}">${g.gap === 'empty' ? 'saw nothing' : `saw ${ctx.plural(g.shown, 'grant')}`}</span>
      ${g.card ? ` · <a href="#review/${g.card.id}" data-card="${g.card.id}">Empty-track card #${g.card.id}</a>` : g.gap === 'empty' ? ' · <span class="cc-muted">no card yet — flag it on the company page</span>' : ''}
    </li>`).join('')}</ul></details>`;
  }
  const gapCells = (r) => `<td class="num${r.empty_tracks ? ' gr-hot' : ' gr-zero'}">${ctx.fmt(r.empty_tracks)}</td><td class="num${r.few_tracks ? ' gr-hot' : ' gr-zero'}">${ctx.fmt(r.few_tracks)}</td>`;

  function provinceHtml(cov) {
    const rows = cov[variantKey()].breakdowns.province;
    const national = rows[0]?.national ?? 0;
    return section('By province', `${ctx.fmt(national)} live grants are open across Canada and count everywhere`,
      `<table class="cc-table co-table cv-small"><thead><tr><th scope="col">Province</th><th scope="col" class="num" title="Live grants limited to regions in this province">Province only</th>
        <th scope="col" class="num">Clients</th><th scope="col" class="num" title="Grant matches per client who ran matching">Avg matches</th>
        <th scope="col" class="num" title="Goal tracks that showed nothing in the client's latest run in the range">Empty</th><th scope="col" class="num" title="Goal tracks that showed 1 or 2 grants">Few</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="cv-static"><td><span class="co-name">${esc(r.province)}</span>${r.thin ? ' <span class="cv-thin">Thin</span>' : ''}${gapsHtml(cov, r.gaps)}</td>${num(r.restricted)}${num(r.clients)}${avgCell(r)}${gapCells(r)}</tr>`).join('')}</tbody></table>
      <p class="cc-muted co-note">A client's province is their profile's (sub-regions roll up; a Canada-wide client counts in every province). Gaps are from each client's latest matching run ${esc(rangeWords(cov))}.</p>`, 'cv-prov');
  }

  function goalHtml(cov) {
    const b = cov[variantKey()].breakdowns;
    const tracks = b.goal_tracks;
    return section('By goal type', `goal tracks ${esc(rangeWords(cov))}, then the catalogue's grant types`,
      `${tracks.length ? `<table class="cc-table co-table cv-small"><thead><tr><th scope="col">Goal track</th><th scope="col" class="num" title="Distinct live grants the engine showed on this goal track in the range">Grants shown</th>
        <th scope="col" class="num" title="Clients whose latest run in the range had this goal track">Clients</th><th scope="col" class="num" title="Average grants shown on this track in clients' latest run">Avg shown</th>
        <th scope="col" class="num">Empty</th><th scope="col" class="num">Few</th></tr></thead>
        <tbody>${tracks.map((r) => `<tr class="cv-static"><td><span class="co-name">${esc(r.label)}</span>${gapsHtml(cov, r.gaps)}</td>${num(r.grants_shown_on_track)}${num(r.clients)}<td class="num">${esc(r.avg_shown_latest_run)}</td>${gapCells(r)}</tr>`).join('')}</tbody></table>`
    : `<p class="cc-muted">No client ran matching ${esc(rangeWords(cov))}.</p>`}
      <h3 class="cv-h">Live grants by grant type</h3>
      <ul class="cv-bars">${b.grant_types.map((t) => barHtml(t.type, t.live_grants, cov.catalogue.in_hub_copy, t.untagged)).join('')}</ul>
      <p class="cc-muted co-note">Grant types are the catalogue's own labels; a grant can carry several. Which grant types feed which goal track is decided by the matching engine, so the two lists aren't joined here.</p>`, 'cv-goal');
  }

  const barHtml = (label, n, total, muted = false) => `<li><span>${esc(label)}</span><span class="cv-bar${muted ? ' is-muted' : ''}"><i style="--w:${total ? Math.max(2, (n / total) * 100) : 0}%"></i></span><b>${ctx.fmt(n)}</b></li>`;

  function fundingHtml(cov) {
    const f = cov[variantKey()].breakdowns.funding;
    const total = cov.catalogue.in_hub_copy;
    return section('Grant vs loan', 'live grants, by funding structure',
      `<ul class="cv-bars cv-bars-wide">${barHtml('Grants', f.grant, total)}${barHtml('Loans only', f.loan, total)}${barHtml('Grant and loan', f.both, total)}${barHtml('Not tagged', f.untagged, total, true)}</ul>
      <p class="cc-muted co-note">From the grant type label "Loan". No goal track asks for a loan, so there's no client signal to mark gaps with here.</p>`, 'cv-fund');
  }

  // ---------------------------------------------------------------- changes
  function changesHtml(chg) {
    const list = (rows, meta, empty) => (rows.length ? `<ul class="cv-changes">${rows.map((r) => `<li><a href="#grants/${r.grant_id}" data-grant="${r.grant_id}" class="${r.live ? '' : 'is-gone'}">${esc(r.title)}</a> <span class="cc-muted co-id">#${r.grant_id}</span>${meta(r)}</li>`).join('')}</ul>` : `<p class="cc-muted">${empty}</p>`);
    const editMeta = (r) => `<div class="cc-muted cv-meta">${ctx.plural(r.edits, 'edit')}: ${r.kinds.slice(0, 3).map((k) => `${esc(k.what.toLowerCase())}${k.n > 1 ? ` ×${k.n}` : ''}`).join(', ')}${r.kinds.length > 3 ? '…' : ''} · last ${esc(when(r.last_at))} by app user #${esc(r.last_by.user_id)}${r.last_by.email ? ` (${esc(r.last_by.email)})` : ''}</div>`;
    const words = rangeWords(chg);
    return `<section class="cc-card co-sec cv-chg"><div class="co-sec-head"><h2>Changes in the catalogue</h2><span class="cc-muted">${esc(day(chg.current.from))} – ${esc(day(chg.current.to))}</span></div>
      <div class="cv-chg-grid">
        <div><h3>Added <span class="cc-muted">${ctx.fmt(chg.added.length)}</span></h3>${list(chg.added, (r) => ` <span class="cc-muted">· went live ${esc(day(r.at))}</span>`, `No grant went live ${esc(words)}.`)}</div>
        <div><h3>Closed or removed <span class="cc-muted">${ctx.fmt(chg.closed.length + chg.removed.length)}</span></h3>${list([...chg.closed, ...chg.removed.map((r) => ({ ...r, status: 'removed' }))], (r) => ` <span class="cc-muted">· ${esc(r.status === 'removed' ? 'removed' : `now ${STATUS_WORDS[r.status] || r.status}`)} ${esc(day(r.at))}</span>`, `No grant closed or was removed ${esc(words)}.`)}</div>
        <div class="cv-flag"><h3>Deadline passed, still live <span class="cv-thin">${ctx.fmt(chg.deadline_passed.length)}</span></h3>${list(chg.deadline_passed, (r) => ` <span class="cc-muted">· ${esc(r.deadline_text)}</span>`, 'No live grant has a deadline in the past.')}
          <p class="cc-muted co-note">Flagged only; no review card is filed. ${ctx.fmt(chg.definitions.deadlines_without_a_date)} live grants have no date as a deadline ("Open until filled" and similar).</p></div>
        <div><h3>Deadlines in the next ${chg.definitions.due_soon_days} days <span class="cc-muted">${ctx.fmt(chg.due_soon.length)}</span></h3>${list(chg.due_soon, (r) => ` <span class="cc-muted">· ${esc(day(r.deadline))}</span>`, 'None.')}</div>
      </div>
      <details class="cv-edited"${chg.edited.length <= 8 ? ' open' : ''}><summary><h3>Edited <span class="cc-muted">${ctx.plural(chg.edited.length, 'grant')}, most recent first</span></h3></summary>${list(chg.edited, editMeta, `No edits ${esc(words)}.`)}</details>
      <p class="cc-muted co-note">Drafts that weren't published aren't counted as edits. The app doesn't store editors' names, so edits show the app user number. Edit history starts ${esc(day(chg.definitions.audit_from))}; publishing history starts ${esc(day(chg.definitions.publishes_from))}.</p>
    </section>`;
  }

  // ---------------------------------------------------------------- events
  function bind(panel, cov, chg) {
    panel.querySelector('.cv-ind .cc-switch input').addEventListener('change', (e) => { ctx.setIncludeInternal(e.target.checked); paint(panel, cov, chg); });
    panel.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      ctx.go({ vq: b.dataset.view === 'all' ? '' : `view=${b.dataset.view}`, industry: null }, { push: false });
    }));
    if (panel._cvClick) panel.removeEventListener('click', panel._cvClick);
    panel._cvClick = (e) => {
      if (!e.target.closest('.cv')) return;
      const grant = e.target.closest('[data-grant]');
      const company = e.target.closest('[data-company]');
      const card = e.target.closest('[data-card]');
      const cuts = e.target.closest('[data-cuts]');
      const goto = e.target.closest('[data-goto]');
      const row = e.target.closest('tr.cv-row');
      if (grant) { e.preventDefault(); ctx.goGrant(Number(grant.dataset.grant)); return; }
      if (company) { e.preventDefault(); ctx.goCompany(Number(company.dataset.company)); return; }
      if (card) { e.preventDefault(); ctx.goReview(Number(card.dataset.card)); return; }
      // From the Not matching lists: open that industry in the full table.
      if (goto) { e.preventDefault(); ctx.go({ vq: '', industry: goto.dataset.goto }, { push: false }); return; }
      if (cuts) { e.preventDefault(); e.stopPropagation(); cutsOpen = cuts.dataset.cuts; toggle(cuts.dataset.cuts, { force: true }); return; }
      if (row) toggle(row.dataset.industry);
    };
    panel.addEventListener('click', panel._cvClick);
    panel.querySelectorAll('tr.cv-row').forEach((tr) => tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggle(tr.dataset.industry); }));
    const focus = panel.querySelector('.cv-cutlist.is-focus');
    if (focus) { focus.scrollIntoView({ block: 'nearest' }); cutsOpen = null; }
  }

  function toggle(name, { force = false } = {}) {
    const open = ctx.state().industry === name && !force ? null : name;
    ctx.go({ industry: open }, { push: false });
  }

  window.CCCoverage = {
    render,
    clearCache: () => { covCache.clear(); chgCache.clear(); }
  };
})();

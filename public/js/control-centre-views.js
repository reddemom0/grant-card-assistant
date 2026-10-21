/**
 * Control Centre — Department views, the landing page.
 *
 *   #views                       the last department this browser picked
 *   #views?dept=research|consulting|marketing
 *
 * With no range in the link and none picked, the page opens here on Month
 * (control-centre.js readUrl). Each department is a few items: a one-line question, a headline count, at
 * most five rows and a See all link into the tab (and filter) that holds the
 * detail. The department is remembered in localStorage['cc.department'] (in
 * try/catch; Research when there's none). Data: GET /api/control-centre/views?range=
 * (both variants, so the internal-accounts switch needs no refetch). Loaded
 * before control-centre.js, which calls CCViews.render(panel, ctx).
 * Docs: docs/control-centre.md.
 */
(function () {
  'use strict';

  const API = '/api/control-centre/views';
  const DEPTS = [
    { key: 'research', label: 'Research' },
    { key: 'consulting', label: 'Consulting/Sales' },
    { key: 'marketing', label: 'Marketing' }
  ];
  const STORE_KEY = 'cc.department';
  const ERROR_WORDS = {
    not_configured: "Can't load: this server can't reach one of the databases it reads.",
    migration_missing: "Can't load: a table it reads isn't set up on this server yet.",
    error: "Didn't load. Refresh the page to try again."
  };

  let ctx = null;
  const cache = new Map();
  let seq = 0;

  const esc = (v) => ctx.esc(v);
  function storeGet() { try { return window.localStorage.getItem(STORE_KEY); } catch { return null; } }
  function storeSet(v) { try { window.localStorage.setItem(STORE_KEY, v); } catch { /* private mode etc. */ } }
  const isDept = (v) => DEPTS.some((d) => d.key === v);

  /** The department: the hash's, else the stored one, else Research. */
  function deptOf() {
    const fromHash = new URLSearchParams(ctx.state().dq || '').get('dept');
    if (isDept(fromHash)) return fromHash;
    const stored = storeGet();
    return isDept(stored) ? stored : 'research';
  }

  // ---------------------------------------------------------------- render
  async function render(panel, helpers) {
    ctx = helpers;
    const my = ++seq;
    const range = ctx.state().range;
    const dept = deptOf();
    storeSet(dept);
    if (!panel.querySelector('.dv')) panel.innerHTML = '<div class="cc-card"><div class="cc-skel" style="width:30%"></div><div class="cc-skel" style="width:80%"></div><div class="cc-skel" style="width:70%"></div></div>';
    panel.classList.add('cc-loading');
    let data = cache.get(range);
    try {
      data = data ?? await ctx.api(`${API}?range=${range}`).then((d) => { cache.set(range, d); return d; });
    } catch (err) {
      if (my !== seq) return;
      panel.classList.remove('cc-loading');
      panel.innerHTML = `<div class="cc-error">${esc(err.status === 401 ? 'Your session has expired. Sign in again to see the Control Centre.' : "Department views didn't load. Refresh the page to try again.")}</div>`;
      return;
    }
    if (my !== seq || ctx.state().tab !== 'views') return;
    panel.classList.remove('cc-loading');
    paint(panel, data, dept);
  }

  function paint(panel, data, dept) {
    const scrollY = window.scrollY;
    const first = !panel.querySelector('.dv');
    const internal = ctx.includeInternal();
    const items = data.departments[dept] || [];
    panel.innerHTML = `<div class="dv${first && !ctx.reduceMotion ? ' co-enter' : ''}">
      <div class="dv-head">
        <div class="gr-views dv-depts" role="tablist" aria-label="Department">${DEPTS.map((d) => `<button type="button" role="tab" class="gr-view" data-dept="${d.key}" aria-selected="${d.key === dept}">${esc(d.label)}</button>`).join('')}</div>
        <label class="cc-switch"><input type="checkbox" role="switch" ${internal ? 'checked' : ''}><span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label>
      </div>
      <div class="dv-grid">${items.map((it) => itemHtml(it, data.range, internal)).join('')}</div>
    </div>`;
    bind(panel, data);
    if (!first) window.scrollTo({ top: scrollY });
  }

  // ---------------------------------------------------------------- items
  // A custom range goes in the link as ?from=&to=, the way the page writes it.
  const href = (hash, range) => {
    const c = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(range);
    return `${window.location.pathname}?${c ? `from=${c[1]}&to=${c[2]}` : `range=${encodeURIComponent(range)}`}${hash}`;
  };

  function itemHtml(it, range, internal) {
    const head = `<p class="dv-q">${esc(it.label)}</p>`;
    if (it.error) {
      return `<section class="cc-card dv-item dv-${esc(it.key)}">${head}<p class="dv-err">${esc(ERROR_WORDS[it.error] || ERROR_WORDS.error)}</p></section>`;
    }
    const b = it[internal ? 'all' : 'clients'];
    const counts = b.counts.length
      ? `<ul class="dv-counts">${b.counts.map((c) => `<li><b>${ctx.fmt(c.n)}</b> ${esc(c.words)}</li>`).join('')}</ul>` : '';
    const groups = b.line ? `<p class="dv-line">${esc(b.line)}</p>`
      : b.groups.map((g) => `<div class="dv-group">
          <h3>${esc(g.title)}</h3>
          ${g.rows.length ? `<ul class="dv-rows">${g.rows.map((r) => `<li><a href="${esc(href(r.hash, range))}" data-go>${esc(r.title)}</a>
            <span class="dv-meta">${esc(r.meta)}</span>${r.detail ? `<span class="dv-detail">${esc(r.detail)}</span>` : ''}</li>`).join('')}</ul>`
            : '<p class="dv-none">None right now.</p>'}
        </div>`).join('');
    const seeAll = [...new Map(b.groups.map((g) => [g.see_all.hash + (g.see_all.range || ''), g.see_all])).values()]
      .map((s) => `<a class="dv-all" href="${esc(href(s.hash, s.range || range))}" data-go>See all: ${esc(s.label)} →</a>`).join('');
    return `<section class="cc-card dv-item dv-${esc(it.key)}">
      ${head}
      <p class="dv-headline"><b>${ctx.fmt(b.headline.n)}</b> <span>${esc(b.headline.words)}</span></p>
      ${counts}
      ${b.sub ? `<p class="dv-sub">${esc(b.sub)}</p>` : ''}
      ${groups}
      ${it.note ? `<p class="dv-note">${esc(it.note)}</p>` : ''}
      <div class="dv-links">${seeAll}</div>
    </section>`;
  }

  // ---------------------------------------------------------------- events
  function bind(panel, data) {
    panel.querySelectorAll('[data-dept]').forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-selected') === 'true') return;
      storeSet(b.dataset.dept);
      ctx.go({ dq: `dept=${b.dataset.dept}` });
    }));
    panel.querySelector('.dv-head .cc-switch input').addEventListener('change', (e) => {
      ctx.setIncludeInternal(e.target.checked);
      paint(panel, data, deptOf());
      panel.querySelector('.dv-head .cc-switch input')?.focus();
    });
    // Rows and See all links are plain links (open in a new tab works); a
    // normal click moves within the page so the back button comes here.
    panel.querySelectorAll('a[data-go]').forEach((a) => a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      ctx.goUrl(a.getAttribute('href'));
    }));
  }

  window.CCViews = { render, clearCache: () => cache.clear() };
})();

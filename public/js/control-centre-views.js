/**
 * Control Centre — Department views, the landing page.
 *
 *   #views                       the last department this browser picked
 *   #views?dept=research|consulting|marketing
 *
 * With no range in the link and none picked, the page opens here on Month
 * (control-centre.js readUrl). Each department is a set of data panels — a
 * neutral title, then a short table, bars, a sign-up series or a row of tiles —
 * with no questions or advice on screen. An empty panel shows one line,
 * "Nothing this period". Every row links to the company, grant, card, chat or
 * industry it names. The department is remembered in localStorage['cc.department']
 * (in try/catch; Research when there's none). Data: GET /api/control-centre/views?range=
 * (both variants, so the internal-accounts switch needs no refetch). Loaded
 * before control-centre.js, which calls CCViews.render(panel, ctx).
 *
 * Payload (views.js): { range, current, previous, today, departments: { research:
 * [panel], consulting: [panel], marketing: [panel] } }. A panel is { key, title,
 * kind: table | bars | series | tiles, wide?, note?, see_all?, error? | clients, all }.
 * Docs: docs/control-centre.md, Department views.
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
  const EMPTY_WORDS = 'Nothing this period';
  const ERROR_WORDS = {
    not_configured: "Can't load: this server can't reach one of the databases it reads.",
    migration_missing: "Can't load: a table it reads isn't set up on this server yet.",
    error: "Didn't load. Refresh the page to try again."
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let ctx = null;
  const cache = new Map();
  let seq = 0;
  let todayYear = String(new Date().getFullYear());

  const esc = (v) => ctx.esc(v);
  const fmt = (v) => ctx.fmt(v);
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
    if (data.today) todayYear = String(data.today).slice(0, 4);
    const panels = data.departments?.[dept] || [];
    panel.innerHTML = `<div class="dv${first && !ctx.reduceMotion ? ' co-enter' : ''}">
      <div class="dv-head">
        <div class="gr-views dv-depts" role="tablist" aria-label="Department">${DEPTS.map((d) => `<button type="button" role="tab" class="gr-view" data-dept="${d.key}" aria-selected="${d.key === dept}">${esc(d.label)}</button>`).join('')}</div>
        <label class="cc-switch"><input type="checkbox" role="switch" ${internal ? 'checked' : ''}><span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label>
      </div>
      <div class="dv-grid">${panels.map((p) => panelHtml(p, data.range, internal)).join('')}</div>
    </div>`;
    mountSparklines(panel, panels, internal);
    bind(panel, data);
    if (!first) window.scrollTo({ top: scrollY });
  }

  // ---------------------------------------------------------------- formatting
  // A custom range goes in the link as ?from=&to=, the way the page writes it.
  const href = (hash, range) => {
    const c = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(range);
    return `${window.location.pathname}?${c ? `from=${c[1]}&to=${c[2]}` : `range=${encodeURIComponent(range)}`}${hash}`;
  };

  /** '2026-10-03' → 'Oct 3' this year, 'Oct 3, 2025' otherwise. */
  function dateWords(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
    if (!m) return v == null || v === '' ? '—' : String(v);
    const d = `${MONTHS[+m[2] - 1]} ${+m[3]}`;
    return m[1] === todayYear ? d : `${d}, ${m[1]}`;
  }

  /** 120000 → '$120k', 1250000 → '$1.3M', 850 → '$850'. */
  function money(v) {
    const n = Number(v);
    if (v == null || v === '' || !Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (a >= 1e6) return `${sign}$${String(Math.round((a / 1e6) * 10) / 10).replace(/\.0$/, '')}M`;
    if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
    return `${sign}$${fmt(a)}`;
  }

  /** A signed change as a chip: +3 / −2 / 0. */
  function deltaHtml(v) {
    const n = Number(v);
    if (v == null || !Number.isFinite(n)) return '<span class="dv-delta">—</span>';
    if (n === 0) return '<span class="dv-delta">0</span>';
    return `<span class="dv-delta ${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}</span>`;
  }

  /** Signed days: negative = past ("3 days over"), positive = ahead ("in 12 days"), 0 = today. */
  function daysWords(v) {
    const n = Number(v);
    if (v == null || !Number.isFinite(n)) return '—';
    if (n === 0) return 'today';
    const a = Math.abs(n);
    return n < 0 ? `${fmt(a)} ${a === 1 ? 'day' : 'days'} over` : `in ${fmt(a)} ${a === 1 ? 'day' : 'days'}`;
  }

  const NUMERIC = new Set(['num', 'money', 'delta']);

  /** One table cell's inner HTML, by column kind. */
  function cellHtml(col, value, range) {
    switch (col.kind) {
      case 'num': return value == null || value === '' ? '—' : esc(fmt(value));
      case 'money': return esc(money(value));
      case 'date': return esc(dateWords(value));
      case 'delta': return deltaHtml(value);
      case 'days': return esc(daysWords(value));
      case 'badge': return value == null || value === '' ? '' : `<span class="dv-badge">${esc(value)}</span>`;
      case 'link': {
        if (!value) return '—';
        if (typeof value === 'string') return esc(value);
        return value.hash ? `<a href="${esc(href(value.hash, range))}" data-go>${esc(value.text ?? value.hash)}</a>` : esc(value.text ?? '');
      }
      default: return value == null || value === '' ? '—' : esc(value);
    }
  }

  // ---------------------------------------------------------------- panels
  function variantOf(p, internal) {
    return p[internal ? 'all' : 'clients'] ?? p.clients ?? p.all ?? null;
  }

  function isEmpty(p, v) {
    if (!v) return true;
    if (p.kind === 'table' || p.kind === 'bars') return !(v.rows && v.rows.length);
    if (p.kind === 'series') return !(Number(v.total) || Number(v.previous_total) || (v.current || []).some((x) => Number(x.value)));
    if (p.kind === 'tiles') return !(v.tiles && v.tiles.some((t) => t.n != null && t.n !== '' && t.n !== 0 && t.n !== '—'));
    return true;
  }

  function panelHtml(p, range, internal) {
    const head = `<h2 class="dv-title">${esc(p.title)}</h2>`;
    const cls = `cc-card dv-item dv-${esc(p.key)} dv-kind-${esc(p.kind)}${p.wide ? ' dv-wide' : ''}`;
    if (p.error) {
      return `<section class="${cls}">${head}<p class="dv-err">${esc(ERROR_WORDS[p.error] || ERROR_WORDS.error)}</p></section>`;
    }
    const v = variantOf(p, internal);
    const body = isEmpty(p, v) ? `<p class="dv-none">${EMPTY_WORDS}</p>`
      : p.kind === 'table' ? tableHtml(v, range)
        : p.kind === 'bars' ? barsHtml(v, range)
          : p.kind === 'series' ? seriesHtml(v, p.key)
            : p.kind === 'tiles' ? tilesHtml(v, range)
              : `<p class="dv-none">${EMPTY_WORDS}</p>`;
    const seeAll = p.see_all?.hash
      ? `<div class="dv-links"><a class="dv-all" href="${esc(href(p.see_all.hash, p.see_all.range || range))}" data-go>See all: ${esc(p.see_all.label || 'more')} →</a></div>` : '';
    return `<section class="${cls}">
      ${head}
      ${body}
      ${p.note ? `<p class="dv-note">${esc(p.note)}</p>` : ''}
      ${seeAll}
    </section>`;
  }

  function tableHtml(v, range) {
    const cols = v.columns || [];
    const colClass = (c) => (NUMERIC.has(c.kind) ? 'n' : 't');
    const head = cols.map((c) => `<th class="${colClass(c)}" scope="col">${esc(c.label)}</th>`).join('');
    const rows = (v.rows || []).map((r) => {
      const cells = r.cells || {};
      const tds = cols.map((c, i) => {
        let inner = cellHtml(c, cells[c.key], range);
        if (i === 0 && r.href && c.kind !== 'link') inner = `<a href="${esc(href(r.href, range))}" data-go>${inner}</a>`;
        return `<td class="${colClass(c)}">${inner}</td>`;
      }).join('');
      const flag = r.flag ? ` is-${esc(r.flag)}` : '';
      return r.href
        ? `<tr class="is-link${flag}" data-href="${esc(href(r.href, range))}" tabindex="0">${tds}</tr>`
        : `<tr class="is-plain${flag}">${tds}</tr>`;
    }).join('');
    return `<div class="dv-scroll"><table class="cc-table dv-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function barsHtml(v, range) {
    const rows = v.rows || [];
    const max = Math.max(1, ...rows.map((r) => Math.max(Number(r.value) || 0, Number(r.previous) || 0)));
    const pct = (n) => `${Math.round(((Number(n) || 0) / max) * 1000) / 10}%`;
    const hasPrev = rows.some((r) => r.previous != null);
    const items = rows.map((r) => {
      const label = r.href ? `<a href="${esc(href(r.href, range))}" data-go>${esc(r.label)}</a>` : `<span>${esc(r.label)}</span>`;
      return `<li>${label}
        <span class="dv-bar" aria-hidden="true"><i class="cur" style="--w:${pct(r.value)}"></i>${r.previous != null ? `<i class="prev" style="--w:${pct(r.previous)}"></i>` : ''}</span>
        <b>${esc(fmt(r.value))}${r.previous != null ? `<small class="cc-muted"> · ${esc(fmt(r.previous))} before</small>` : ''}</b></li>`;
    }).join('');
    return `<ul class="dv-bars${hasPrev ? ' has-prev' : ''}" aria-label="${esc(v.unit || '')}">${items}</ul>${v.unit ? `<p class="dv-unit">${esc(v.unit)}${hasPrev ? ' · the thin bar is the window before' : ''}</p>` : ''}`;
  }

  function seriesHtml(v, key) {
    const delta = Number(v.delta);
    const chip = Number.isFinite(delta) && v.previous_total != null
      ? `<span class="cc-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '+' : delta < 0 ? '−' : ''}${esc(fmt(Math.abs(delta)))}</span><span class="cc-muted"> vs ${esc(fmt(v.previous_total))} before</span>` : '';
    return `<p class="dv-series-head"><b>${esc(fmt(v.total))}</b> <span>${esc(v.label || '')}</span> ${chip}</p>
      <div class="dv-spark" data-spark="${esc(key)}"></div>`;
  }

  function tilesHtml(v, range) {
    const tiles = (v.tiles || []).map((t) => {
      const n = t.n == null || t.n === '' ? '—' : typeof t.n === 'number' ? fmt(t.n) : String(t.n);
      const inner = `<b>${esc(n)}</b><span>${esc(t.label)}</span>${t.words ? `<small>${esc(t.words)}</small>` : ''}`;
      return t.href ? `<a class="dv-tile" href="${esc(href(t.href, range))}" data-go>${inner}</a>` : `<div class="dv-tile">${inner}</div>`;
    }).join('');
    return `<div class="dv-tiles">${tiles}</div>`;
  }

  /** The sign-up series needs a DOM node from the page's sparkline, so it lands after innerHTML. */
  function mountSparklines(panel, panels, internal) {
    if (typeof ctx.sparkline !== 'function') return;
    panel.querySelectorAll('[data-spark]').forEach((holder) => {
      const p = panels.find((x) => x.key === holder.dataset.spark);
      const v = p && variantOf(p, internal);
      if (!v) return;
      try {
        holder.appendChild(ctx.sparkline(v.current || [], v.previous || [], v.label || p.title));
      } catch { /* a chart that can't draw leaves the headline */ }
    });
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
    // A linked row is clickable anywhere outside its own links; Enter does the same.
    panel.querySelectorAll('tr[data-href]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        ctx.goUrl(tr.dataset.href);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target === tr) ctx.goUrl(tr.dataset.href);
      });
    });
  }

  window.CCViews = { render, clearCache: () => cache.clear() };
})();

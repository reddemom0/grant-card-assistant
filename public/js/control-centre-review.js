/**
 * Control Centre — Review queue tab (step 5c+9, Part B).
 *
 *   #review                 the board: New → Diagnosed → In progress → Closed
 *   #review/<id>            the board with that card open in the side panel
 *   #review?owner=&type=    filters (combinable), kept in the hash
 *
 * Board data: GET /api/control-centre/review (summaries, no evidence). The
 * panel loads one card in full: GET /api/control-centre/review/:id, and for a
 * chat card, on request, GET /:id/conversation. Actions: PATCH /:id/status,
 * PATCH /:id/owner, POST /:id/close, POST /:id/comment — each recorded by the
 * server against the signed-in staff member.
 *
 * Loaded before control-centre.js, which calls CCReview.render(panel, ctx)
 * with its helpers (escaping, formatting, fetch, navigation, the
 * internal-accounts switch). Docs: docs/control-centre.md.
 */
(function () {
  'use strict';

  const API = '/api/control-centre/review';
  const COLUMNS = [
    { status: 'new', label: 'New', empty: 'Nothing new. Fresh flags land here.' },
    { status: 'diagnosed', label: 'Diagnosed', empty: 'No diagnosed cards waiting.' },
    { status: 'in_progress', label: 'In progress', empty: 'Nothing being worked on.' },
    { status: 'closed', label: 'Closed', empty: 'Nothing closed yet.' }
  ];
  const CLOSED_SHOWN = 30;
  const OWNERS = [['client', 'Client'], ['research', 'Research'], ['chris', 'Chris'], ['jason', 'Jason'], ['none', 'Unassigned']];
  const OWNER_WORDS = { client: 'Client', research: 'Research', chris: 'Chris', jason: 'Jason' };
  const OWNER_FIXES = { client: 'company profile', research: 'grant data and card text', chris: 'tagger, engine and chat answers', jason: 'the app' };
  const TYPES = [['match', 'Match'], ['grant_pattern', 'Grant pattern'], ['chat', 'Chat']];
  const TYPE_WORDS = Object.fromEntries(TYPES);
  const STATUS_WORDS = { new: 'New', diagnosed: 'Diagnosed', in_progress: 'In progress', closed: 'Closed' };
  const VERDICT_WORDS = {
    tag_missed_restriction: 'Tag missed a restriction',
    card_missing_restriction: 'Card is missing a restriction',
    region_list_wrong: 'Region list is wrong',
    profile_incomplete: 'Profile is incomplete',
    ranked_on_genre: 'Ranked on topic, no rule against it',
    looks_correct: 'Looks correct',
    bad_record: 'Grant missing from the data',
    chat_wrong_grant_facts: 'Chat gave wrong grant facts',
    chat_answer_problem: 'Chat answer problem',
    unclear: 'Cause unclear',
    could_not_diagnose: "Couldn't diagnose"
  };
  const SOURCE_WORDS = {
    client_thumbs_down: 'a client 👎',
    staff_flag: 'a staff flag',
    ai_review_cut: 'an AI review cut',
    oracle_detected: "Oracle's chat review"
  };
  const CHECK_WORDS = {
    province: 'Location', industry: 'Industry', business_type: 'Business type', ownership: 'Ownership',
    size: 'Company size', employee_count: 'Employees', revenue: 'Revenue', annual_revenue: 'Revenue',
    years_in_business: 'Years in business', stage: 'Stage', status: 'Grant status'
  };
  const REASON_WORDS = { wrong_industry: 'wrong industry', wrong_region: 'wrong region', ineligible: 'not eligible', off_goal: "not the client's goals", other: 'other reason' };
  const CHAT_FIELDS = [
    ['client_asked', 'What the client asked'],
    ['assistant_replied', 'What the assistant replied'],
    ['what_was_wrong', 'What was wrong'],
    ['good_answer', 'What a good answer says'],
    ['suggested_fix', 'Suggested fix']
  ];

  let ctx = null;
  let list = null;          // last loaded summaries
  let listSeq = 0;
  let detail = null;        // { id, data }
  let drawerFocusReturn = null;

  const words = (s) => String(s ?? '').replace(/_/g, ' ');
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  const age = (iso) => { const d = daysSince(iso); return d === 0 ? 'today' : `${d}d`; };
  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' });
  };
  const clipText = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

  // ---------------------------------------------------------------- filters (hash query)
  function readFilters() {
    const q = new URLSearchParams(ctx.state().rq || '');
    const pick = (k, allowed) => (q.get(k) || '').split(',').filter((v) => allowed.includes(v));
    return { owner: pick('owner', OWNERS.map((o) => o[0])), type: pick('type', TYPES.map((t) => t[0])) };
  }
  function filtersQuery(f) {
    const q = new URLSearchParams();
    if (f.owner.length) q.set('owner', f.owner.join(','));
    if (f.type.length) q.set('type', f.type.join(','));
    return q.toString();
  }
  function visible(items, f) {
    const internal = ctx.includeInternal();
    return items.filter((i) => (!f.owner.length || f.owner.includes(i.owner ?? 'none'))
      && (!f.type.length || f.type.includes(i.kind))
      && (internal || i.kind === 'grant_pattern' || !i.company_internal));
  }

  // ---------------------------------------------------------------- board
  async function render(panel, helpers) {
    ctx = helpers;
    // Opening a card or changing a filter reuses the loaded board; arriving
    // on the tab loads it.
    if (list && panel.querySelector('.rq')) {
      paint(panel);
      const id = ctx.state().card;
      if (id) openCard(id); else closeDrawer();
      return;
    }
    const seq = ++listSeq;
    if (!panel.querySelector('.rq')) {
      panel.innerHTML = '';
      panel.classList.add('cc-loading');
    }
    try {
      const r = await ctx.api(API);
      if (seq !== listSeq) return;
      list = r.items || [];
    } catch (err) {
      if (seq !== listSeq) return;
      panel.classList.remove('cc-loading');
      panel.innerHTML = `<div class="cc-error">${ctx.esc(err.status === 503
        ? "The review queue can't reach its databases right now."
        : err.status === 401 ? 'Your session has expired. Sign in again to see the review queue.'
          : "The review queue didn't load. Refresh the page to try again.")}</div>`;
      return;
    }
    panel.classList.remove('cc-loading');
    paint(panel);
    const id = ctx.state().card;
    if (id) openCard(id); else closeDrawer({ silent: true });
  }

  /** The Review queue tab's badge: open cards, from the list just loaded (fresher than the Overview's 5-minute cache). */
  function setBadge() {
    const b = document.querySelector('.cc-tab[data-tab="review"] [data-badge]');
    if (!b || !list) return;
    const open = list.filter((i) => i.status !== 'closed').length;
    b.hidden = open === 0;
    b.textContent = ctx.fmt(open);
  }

  function paint(panel) {
    setBadge();
    const f = readFilters();
    const shown = visible(list, f);
    const first = !panel.querySelector('.rq');
    const internalCount = list.filter((i) => i.kind !== 'grant_pattern' && i.company_internal).length;
    const chip = (group, value, label, on) => `<button type="button" class="rq-chip" data-group="${group}" data-value="${value}" aria-pressed="${on}">${ctx.esc(label)}</button>`;

    panel.innerHTML = `<section class="cc-card rq">
      <div class="rq-head">
        <div>
          <h2>Review queue</h2>
          <p class="rq-intro">Every flagged grant match, grant pattern and chat answer. Each card gets a cause and an owner — the hourly sweep writes the first diagnosis. Drag a card to move it; open it for the evidence.</p>
        </div>
      </div>
      <div class="rq-filters">
        <div class="rq-chips" role="group" aria-label="Owner">
          <span class="rq-chips-label">Owner</span>
          ${chip('owner', '', 'All', !f.owner.length)}${OWNERS.map(([v, l]) => chip('owner', v, l, f.owner.includes(v))).join('')}
        </div>
        <div class="rq-chips" role="group" aria-label="Type">
          <span class="rq-chips-label">Type</span>
          ${chip('type', '', 'All', !f.type.length)}${TYPES.map(([v, l]) => chip('type', v, l, f.type.includes(v))).join('')}
        </div>
        <label class="cc-switch rq-internal"><input type="checkbox" role="switch" ${ctx.includeInternal() ? 'checked' : ''}>
          <span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label>
        <span class="rq-count">${ctx.plural(shown.length, 'card')}${!ctx.includeInternal() && internalCount ? ` · ${ctx.fmt(internalCount)} from internal accounts hidden` : ''}</span>
      </div>
      <div class="rq-board">${COLUMNS.map((c) => column(c, shown)).join('')}</div>
    </section>`;
    if (first && !ctx.reduceMotion) panel.querySelector('.rq').classList.add('rq-enter');
    bindBoard(panel, f);
  }

  function column(c, items) {
    let cards = items.filter((i) => i.status === c.status);
    const total = cards.length;
    if (c.status === 'closed') {
      cards = cards.sort((a, b) => new Date(b.closed_at || b.updated_at) - new Date(a.closed_at || a.updated_at)).slice(0, CLOSED_SHOWN);
    }
    return `<div class="rq-col" data-status="${c.status}" aria-label="${c.label}, ${total}">
      <div class="rq-col-head"><span>${c.label}</span><b>${ctx.fmt(total)}</b></div>
      <div class="rq-col-body">${cards.length ? cards.map(card).join('') : `<p class="rq-empty">${ctx.esc(c.empty)}</p>`}
      ${c.status === 'closed' && total > CLOSED_SHOWN ? `<p class="rq-more">Showing the ${CLOSED_SHOWN} most recent of ${ctx.fmt(total)}.</p>` : ''}</div>
    </div>`;
  }

  function card(i) {
    const stuckDays = i.stuck ? i.idle_days : null;
    const selected = ctx.state().card === i.id;
    return `<article class="rq-card${i.stuck ? ' is-stuck' : ''}${selected ? ' is-open' : ''}" data-id="${i.id}" data-kind="${i.kind}" tabindex="0" draggable="true"
      aria-label="${ctx.esc(i.title)}">
      <div class="rq-card-top">
        <span class="rq-type rq-type-${i.kind}">${TYPE_WORDS[i.kind] || ctx.esc(i.kind)}</span>
        ${stuckDays != null ? `<span class="rq-stuck" title="Open with no change or comment for ${stuckDays} days">Stuck ${stuckDays}d</span>` : ''}
        <span class="rq-age" title="Flagged ${ctx.esc(when(i.created_at))}">${age(i.created_at)}</span>
      </div>
      <h3>${ctx.esc(i.kind === 'grant_pattern' && i.grant_name ? i.grant_name : i.title)}${i.company_internal ? ' <span class="cc-tag-internal">Internal</span>' : ''}</h3>
      ${i.kind === 'grant_pattern' ? `<p class="rq-reason">Cut for several companies: ${ctx.esc(REASON_WORDS[i.pattern_category] || words(i.pattern_category))}</p>` : ''}
      <p class="rq-meta">${i.owner ? `<span class="rq-owner rq-owner-${i.owner}">${OWNER_WORDS[i.owner]}</span>` : '<span class="rq-owner">Unassigned</span>'}${i.verdict ? `<span>${ctx.esc(VERDICT_WORDS[i.verdict] || cap(words(i.verdict)))}</span>` : ''}</p>
      <p class="rq-foot"><span>${ctx.plural(i.flag_count, 'flag')}</span>${i.flagged_again ? '<span class="rq-again">Flagged again</span>' : ''}${i.expected_match ? `<span>${i.expected_match === 'should' ? 'Should match' : "Shouldn't match"}</span>` : ''}</p>
    </article>`;
  }

  function bindBoard(panel, f) {
    panel.querySelectorAll('.rq-chip').forEach((b) => b.addEventListener('click', () => {
      const g = b.dataset.group; const v = b.dataset.value;
      const next = { ...f, [g]: v === '' ? [] : f[g].includes(v) ? f[g].filter((x) => x !== v) : [...f[g], v] };
      ctx.go({ rq: filtersQuery(next) }, { push: false });
    }));
    panel.querySelector('.rq-internal input').addEventListener('change', (e) => {
      ctx.setIncludeInternal(e.target.checked);
      paint(panel);
      panel.querySelector('.rq-internal input')?.focus();
    });
    panel.querySelectorAll('.rq-card').forEach((el) => {
      el.addEventListener('click', () => ctx.go({ card: Number(el.dataset.id) }));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.go({ card: Number(el.dataset.id) }); } });
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', el.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('is-dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    });
    panel.querySelectorAll('.rq-col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('is-over'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('is-over'); });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('is-over');
        const id = Number(e.dataTransfer.getData('text/plain'));
        const item = list.find((x) => x.id === id);
        if (!item || item.status === col.dataset.status) return;
        await moveTo(item, col.dataset.status, panel);
      });
    });
  }

  /** Drag result: optimistic move, then the server; Closed goes through the close dialog. */
  async function moveTo(item, status, panel) {
    if (status === 'closed') {
      const answer = await closeDialog(item);
      if (!answer) return;
      await act(() => ctx.send('POST', `${API}/${item.id}/close`, answer), 'closed');
      return;
    }
    const before = item.status;
    item.status = status;
    paint(panel);
    try {
      await ctx.send('PATCH', `${API}/${item.id}/status`, { to: status });
      toast(`Moved to ${STATUS_WORDS[status]}`);
      await refresh();
    } catch (err) {
      item.status = before;
      paint(panel);
      toast(actionError(err), true);
    }
  }

  async function refresh() {
    const panel = document.getElementById('cc-panel');
    try {
      const r = await ctx.api(API);
      list = r.items || [];
      if (ctx.state().tab === 'review') paint(panel);
    } catch { /* the board keeps what it has */ }
    if (detail && ctx.state().card === detail.id) await openCard(detail.id, { keepScroll: true });
  }

  async function act(fn, done) {
    try {
      await fn();
      toast(cap(done));
      await refresh();
      return true;
    } catch (err) {
      toast(actionError(err), true);
      return false;
    }
  }

  function actionError(err) {
    if (err.status === 409) return 'That card is already closed.';
    if (err.status === 401) return 'Your session has expired. Sign in again.';
    if (err.status === 400 && err.message) return err.message;
    return "That didn't save. Try again.";
  }

  // ---------------------------------------------------------------- drawer
  function drawerEl() {
    let d = document.getElementById('rq-drawer');
    if (!d) {
      d = document.createElement('div');
      d.id = 'rq-drawer';
      d.className = 'rq-drawer-wrap';
      d.innerHTML = '<div class="rq-scrim" data-close></div><aside class="rq-drawer" role="dialog" aria-modal="true" aria-labelledby="rq-d-title" tabindex="-1"></aside>';
      document.querySelector('.cc').appendChild(d);
      d.querySelector('[data-close]').addEventListener('click', () => ctx.go({ card: null }));
      d.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.querySelector('.rq-dialog[open]')) { e.preventDefault(); ctx.go({ card: null }); }
        if (e.key === 'Tab') trapFocus(e, d.querySelector('.rq-drawer'));
      });
    }
    return d;
  }

  function trapFocus(e, root) {
    const f = [...root.querySelectorAll('button, [href], select, textarea, input, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  }

  function closeDrawer({ silent = false } = {}) {
    const d = document.getElementById('rq-drawer');
    detail = null;
    if (!d || !d.classList.contains('on')) return;
    d.classList.remove('on');
    document.querySelectorAll('.rq-card.is-open').forEach((c) => c.classList.remove('is-open'));
    if (!silent && drawerFocusReturn) drawerFocusReturn.focus?.();
  }

  async function openCard(id, { keepScroll = false } = {}) {
    const d = drawerEl();
    const aside = d.querySelector('.rq-drawer');
    const wasOn = d.classList.contains('on');
    if (!wasOn) drawerFocusReturn = document.activeElement;
    const scroll = keepScroll ? aside.scrollTop : 0;
    if (!keepScroll) aside.innerHTML = '<div class="rq-d-loading"><div class="cc-skel" style="width:70%"></div><div class="cc-skel" style="width:90%"></div><div class="cc-skel" style="width:55%"></div></div>';
    d.classList.add('on');
    document.querySelectorAll('.rq-card').forEach((c) => c.classList.toggle('is-open', Number(c.dataset.id) === id));
    let data;
    try {
      data = await ctx.api(`${API}/${id}`);
    } catch (err) {
      if (ctx.state().card !== id) return;
      aside.innerHTML = `<div class="rq-d-body"><button type="button" class="rq-x" data-x aria-label="Close">×</button><div class="cc-error">${ctx.esc(err.status === 404 ? `There's no review card #${id}.` : "This card didn't load. Try again.")}</div></div>`;
      aside.querySelector('[data-x]').addEventListener('click', () => ctx.go({ card: null }));
      return;
    }
    if (ctx.state().card !== id) return;
    detail = { id, data };
    aside.innerHTML = drawerHtml(data);
    bindDrawer(aside, data);
    aside.scrollTop = scroll;
    if (!wasOn) aside.focus({ preventScroll: true });
  }

  const actorName = (data, a) => {
    if (!a) return 'someone';
    const n = data.names?.actors?.[a];
    if (n?.kind === 'system') return n.name;
    if (n?.kind === 'staff') return n.name || a;
    if (n?.kind === 'client') return `${n.name || 'a client'}${n.internal ? ' (internal account)' : ''}`;
    return a.startsWith('user_') ? 'a client' : a;
  };

  function drawerHtml(data) {
    const it = data.item;
    const esc = ctx.esc;
    const d = it.diagnosis && typeof it.diagnosis === 'object' ? it.diagnosis : null;
    const verdict = d?.verdict;
    const closed = it.status === 'closed';
    const statusOptions = ['new', 'diagnosed', 'in_progress'].map((s) => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${STATUS_WORDS[s]}</option>`).join('');
    const ownerOptions = ['client', 'research', 'chris', 'jason'].map((o) => `<option value="${o}" ${it.owner === o ? 'selected' : ''} title="${OWNER_FIXES[o]}">${OWNER_WORDS[o]}</option>`).join('');

    return `<div class="rq-d-head">
        <div class="rq-d-tags">
          <span class="rq-type rq-type-${it.kind}">${TYPE_WORDS[it.kind] || esc(it.kind)}</span>
          <span class="rq-status rq-status-${it.status}">${STATUS_WORDS[it.status]}</span>
          ${it.company_internal ? '<span class="cc-tag-internal">Internal</span>' : ''}
          ${it.flagged_again ? '<span class="rq-again">Flagged again</span>' : ''}
          <span class="rq-d-id">#${it.id}</span>
        </div>
        <button type="button" class="rq-x" data-x aria-label="Close the card">×</button>
        <h2 id="rq-d-title">${esc(it.title)}</h2>
        <p class="rq-d-sub">${it.owner ? `Owner <b>${OWNER_WORDS[it.owner]}</b> (${OWNER_FIXES[it.owner]})` : 'No owner yet'}${verdict ? ` · ${esc(VERDICT_WORDS[verdict] || cap(words(verdict)))}` : ''} · ${ctx.plural(it.flag_count, 'flag')} · flagged ${esc(when(it.created_at))}</p>
      </div>
      <div class="rq-d-actions">
        <label>Owner <select data-owner><option value="" ${it.owner ? '' : 'selected'} disabled>Choose…</option>${ownerOptions}</select></label>
        <label>Move to <select data-status>${closed ? '<option value="" selected disabled>Closed — reopen as…</option>' : ''}${statusOptions}</select></label>
        ${closed ? '' : '<button type="button" class="rq-btn rq-btn-primary" data-close-card>Close card</button>'}
      </div>
      <div class="rq-d-body">
        ${closed ? `<div class="rq-closed-note">Closed by ${esc(actorName(data, it.closed_by))}, ${esc(when(it.closed_at))}${it.expected_match ? ` · ${it.expected_match === 'should' ? 'this should have matched' : "this shouldn't have matched"}` : ''}${it.close_note ? `<br>${esc(it.close_note)}` : ''}</div>` : ''}
        ${section('What happened', it.narrative ? `<p class="rq-narrative">${esc(it.narrative)}</p>` : `<p class="cc-muted">${it.status === 'new'
    ? `Not diagnosed yet — the hourly sweep takes the evidence and writes this.${it.diagnosis_attempts ? ` ${ctx.plural(it.diagnosis_attempts, 'attempt')} so far.` : ''}`
    : 'No explanation recorded.'}</p>`)}
        ${it.owner === 'client' && it.client_notice ? `<div class="rq-notice"><p>${esc(it.client_notice)}</p><button type="button" class="rq-btn" data-copy>Copy</button></div>` : ''}
        ${evidenceHtml(it, data)}
        ${data.links?.length ? section('Linked cards', `<ul class="rq-links">${data.links.map((l) => `<li><a href="#review/${l.id}" data-card="${l.id}"><span class="rq-type rq-type-${l.kind}">${TYPE_WORDS[l.kind]}</span> ${esc(l.title)}${l.company_internal ? ' <span class="cc-tag-internal">Internal</span>' : ''}</a> <span class="cc-muted">${STATUS_WORDS[l.status]}</span></li>`).join('')}</ul>`) : ''}
        ${section('Comments', `${(data.comments || []).length ? `<ol class="rq-comments">${data.comments.map((c) => `<li><b>${esc(actorName(data, c.actor))}</b> <span class="cc-muted">${esc(when(c.created_at))}</span><p>${esc(commentText(c))}</p></li>`).join('')}</ol>` : '<p class="cc-muted">No comments yet.</p>'}
          <form class="rq-comment-form"><label class="sr-only" for="rq-comment">Add a comment</label><textarea id="rq-comment" rows="2" maxlength="4000" placeholder="Add a comment for the team"></textarea><button type="submit" class="rq-btn">Comment</button></form>`)}
        ${section('History', historyHtml(data))}
      </div>`;
  }

  const commentText = (e) => { const d = typeof e.detail === 'string' ? safeJson(e.detail) : e.detail; return d?.text ?? ''; };
  function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
  const section = (title, body) => `<section class="rq-d-sec"><h3>${title}</h3>${body}</section>`;

  // ---------------------------------------------------------------- evidence
  function evidenceHtml(it, data) {
    const s = it.snapshot;
    if (!s) {
      const flags = (data.flags || []).slice(-10);
      return section('Evidence', `<p class="cc-muted">No evidence frozen yet — it's taken at the first diagnosis.</p>${flags.length ? `<ul class="rq-flaglist">${flags.map((f) => `<li>${esc2(SOURCE_WORDS[f.source] || words(f.source))} · ${esc2(actorName(data, f.actor))} · ${esc2(when(f.source_created_at || f.created_at))}${f.comment ? `<br><span>${esc2(clipText(f.comment, 300))}</span>` : ''}</li>`).join('')}</ul>` : ''}`);
    }
    if (it.kind === 'match') return matchEvidence(s.response || {});
    if (it.kind === 'grant_pattern') return patternEvidence(s);
    return chatEvidence(s, it);
  }
  const esc2 = (v) => ctx.esc(v);

  function matchEvidence(r) {
    const axes = r.axes || [];
    const reviews = (r.review_log || []).slice(0, 8);
    const sh = r.recorded?.shown_history;
    const value = (v) => {
      const raw = typeof v === 'string' ? v : JSON.stringify(v ?? '—');
      const t = plainValue(raw);
      return `<span title="${esc2(t)}">${esc2(clipText(t, 90))}</span>`;
    };
    const rows = axes.map((a) => `<tr class="${a.blamed_by_review ? 'is-blamed' : ''}">
      <th>${esc2(CHECK_WORDS[a.axis] || cap(words(a.axis)))}</th>
      <td><span class="rq-pass rq-pass-${a.lenient ? 'loose' : a.verdict === 'mismatch' ? 'fail' : 'ok'}">${esc2(cap(words(a.verdict)))}</span>${a.blamed_by_review ? '<span class="rq-disputed">Disputed by review</span>' : ''}</td>
      <td>${esc2(cap(words(a.reason_code)))}</td>
      <td>${value(a.grant_constraint)}</td><td>${value(a.profile_value)}</td></tr>`).join('');
    return section('Why it matched', `${r.candidate_cause?.cause ? `<p class="rq-cause">Likely cause: <b>${esc2(cap(words(r.candidate_cause.cause).toLowerCase()))}</b></p>` : ''}
      ${axes.length ? `<div class="rq-scroll"><table class="rq-table"><thead><tr><th>Check</th><th>Result</th><th>How</th><th>Grant requires</th><th>Client has</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="cc-muted">No eligibility checks recorded.</p>'}`)
      + (reviews.length ? section('What the AI review said', `<ul class="rq-quotes">${reviews.map((q) => `<li><blockquote>${esc2(q.reason)}</blockquote><span class="cc-muted">${esc2(cap(words(q.action)))} · ${esc2(words(q.category))} · ${esc2(q.track || '')} · ${esc2(when(q.occurred_at))}</span></li>`).join('')}</ul>`) : '')
      + (sh ? section('Shown history', `<p>Shown ${ctx.plural(sh.times_shown || 0, 'time')} in ${ctx.plural(sh.runs || 0, 'recorded run')}${sh.last_shown_at ? `, last ${esc2(when(sh.last_shown_at))}` : ''}${sh.sections_shown_in?.length ? ` — in ${esc2(sh.sections_shown_in.join(', '))}` : ''}.</p>`) : '');
  }

  /** match-explain's constraint strings in words: JSON lists as lists, [] as "none", key= prefixes dropped. */
  function plainValue(raw) {
    const one = (part) => {
      const t = part.trim().replace(/^[a-z_]+=/, '');
      try {
        const j = JSON.parse(t);
        if (Array.isArray(j)) return j.length ? j.join(', ') : 'none';
        if (j === null) return '—';
        if (typeof j !== 'object') return String(j);
      } catch { /* not JSON */ }
      return t;
    };
    // "agnostic, industries=[]" → "agnostic, none"; a JSON list is one part.
    const parts = raw.trim().startsWith('[') ? [raw] : raw.split(/,\s(?=[a-z_]+=)/);
    return parts.map(one).join(' · ');
  }

  function patternEvidence(s) {
    const byCompany = new Map();
    for (const c of s.cuts || []) {
      const key = c.company_id ?? `none:${c.ai_review_id}`;
      if (!byCompany.has(key)) byCompany.set(key, { name: c.company_name || 'No company linked', internal: c.company_internal, cuts: [] });
      byCompany.get(key).cuts.push(c);
    }
    const g = s.grant;
    const companies = [...byCompany.values()].map((c) => `<li><div class="rq-co"><b>${esc2(c.name)}</b>${c.internal ? ' <span class="cc-tag-internal">Internal</span>' : ''}<span class="cc-muted">${ctx.plural(c.cuts.length, 'cut')}</span></div>
      <ul>${c.cuts.map((x) => `<li>${esc2(x.reason || '')} <span class="cc-muted">${esc2(x.date)} · ${esc2(x.section || '')}</span></li>`).join('')}</ul></li>`).join('');
    const list2 = (arr) => (arr?.length ? `<ul class="rq-tags">${arr.map((t) => `<li>${esc2(t)}</li>`).join('')}</ul>` : '<p class="cc-muted">None recorded.</p>');
    return section(`Companies cut (${ctx.fmt(s.companies ?? byCompany.size)}${s.internal_companies ? `, ${ctx.fmt(s.internal_companies)} internal` : ''})`, `<ul class="rq-companies">${companies}</ul>`)
      + section('Tags now vs card text', g ? `<div class="rq-vs">
          <div><h4>Tags now</h4>
            <p class="rq-vs-k">Industries</p>${list2(g.industries)}
            <p class="rq-vs-k">Regions</p>${list2(g.regions)}
            <p class="rq-vs-k">Recorded eligibility</p>${list2(g.eligibility_tags)}</div>
          <div><h4>Card text</h4>${(g.card || []).map((c) => `<p class="rq-vs-k">${esc2(c.section)}</p><p class="rq-cardtext">${esc2(clipText(c.text, 900))}</p>`).join('') || '<p class="cc-muted">The card has no text.</p>'}</div>
        </div>` : '<p class="cc-muted">This grant is missing from the grant data.</p>');
  }

  function chatEvidence(s, it) {
    const d = it.diagnosis?.chat;
    const turns = (s.turns || []).map((t) => turnHtml(t)).join('');
    return section('The conversation', `<p class="cc-muted">The flagged message, the turns before it and the assistant's reply, as they were when the card was filed.</p><ol class="rq-chat">${turns}</ol>
        <button type="button" class="rq-btn rq-btn-link" data-full-conv>Show the full conversation</button><div data-full></div>`)
      + (d ? section('Diagnosis', `<dl class="rq-fields">${CHAT_FIELDS.map(([k, l]) => (d[k] ? `<dt>${l}</dt><dd>${esc2(d[k])}</dd>` : '')).join('')}</dl>`) : '');
  }

  function turnHtml(t, flaggedIndex = null) {
    const flagged = t.flagged || (flaggedIndex != null && t.turn_index === flaggedIndex);
    return `<li class="${flagged ? 'is-flagged' : 'is-context'}">
      <div class="rq-msg rq-msg-client"><span class="rq-who">Client · message ${t.turn_index + 1}${flagged ? ' · <b>flagged</b>' : ''}</span><p>${esc2(t.client)}</p></div>
      ${t.assistant ? `<div class="rq-msg rq-msg-ai"><span class="rq-who">Assistant${t.tools_used?.length ? ` · used ${esc2(t.tools_used.map(words).join(', '))}` : ''}</span><p>${esc2(t.assistant)}</p></div>` : '<div class="rq-msg rq-msg-ai is-empty"><span class="rq-who">Assistant</span><p>No reply recorded.</p></div>'}
    </li>`;
  }

  // ---------------------------------------------------------------- history
  const ACTION_WORDS = {
    created: (e, d) => `Card created from ${SOURCE_WORDS[d?.source] || 'a flag'}`,
    flagged: (e, d) => `Flagged — ${SOURCE_WORDS[d?.source] || 'a flag'}${d?.late_evidence ? ' (older evidence, card stays closed)' : ''}`,
    reopened: () => 'Reopened by a new flag',
    diagnosed: (e, d) => `Diagnosed${d?.owner ? ` → ${OWNER_WORDS[d.owner] || d.owner}` : ''}${d?.verdict ? `, ${VERDICT_WORDS[d.verdict] || words(d.verdict)}` : ''}`,
    diagnosis_failed: (e, d) => `Diagnosis attempt ${d?.attempt ?? ''} failed`,
    status: (e) => `Moved ${STATUS_WORDS[e.from_status] || e.from_status} → ${STATUS_WORDS[e.to_status] || e.to_status}`,
    owner: (e, d) => `Reassigned ${d?.from ? OWNER_WORDS[d.from] : 'no owner'} → ${d?.to ? OWNER_WORDS[d.to] : 'no owner'}`,
    closed: (e, d) => `Closed${d?.expected_match ? ` — ${d.expected_match === 'should' ? 'should have matched' : "shouldn't have matched"}` : ''}${d?.close_note ? `: “${d.close_note}”` : ''}`,
    comment: () => 'Commented',
    recheck: (e, d) => `Re-check: pattern #${d?.pattern_id} was fixed`
  };

  function historyHtml(data) {
    const rows = [];
    for (const e of data.events || []) {
      const d = typeof e.detail === 'string' ? safeJson(e.detail) : e.detail;
      const text = (ACTION_WORDS[e.action] || (() => cap(words(e.action))))(e, d);
      const who = actorName(data, e.actor);
      const last = rows.at(-1);
      // Runs of the same flag source (e.g. 17 AI review cuts) read as one line.
      if (last && e.action === 'flagged' && last.action === 'flagged' && last.text === text) {
        last.n += 1; last.to = e.created_at; last.whos.add(who); continue;
      }
      rows.push({ action: e.action, text, who, whos: new Set([who]), at: e.created_at, to: null, n: 1 });
    }
    if (!rows.length) return '<p class="cc-muted">No history yet.</p>';
    return `<ol class="rq-history">${rows.reverse().map((r) => `<li class="rq-h-${r.action}"><span class="rq-h-text">${esc2(r.n > 1 ? `${r.text} ×${r.n}` : r.text)}</span>
      <span class="cc-muted">${esc2(r.whos.size > 1 ? `${r.whos.size} different flaggers` : r.who)} · ${esc2(r.to && when(r.to) !== when(r.at) ? `${when(r.at)} – ${when(r.to)}` : when(r.at))}</span></li>`).join('')}</ol>`;
  }

  /** A clamped context message that fits needs no "Show all". */
  function unclampShort(root) {
    root.querySelectorAll('.is-context .rq-msg:not(.is-expanded)').forEach((m) => {
      const p = m.querySelector('p');
      if (p && p.scrollHeight <= p.clientHeight + 2) m.classList.add('is-expanded', 'is-short');
    });
  }

  // ---------------------------------------------------------------- drawer actions
  function bindDrawer(aside, data) {
    const it = data.item;
    requestAnimationFrame(() => unclampShort(aside));
    aside.querySelector('[data-x]').addEventListener('click', () => ctx.go({ card: null }));
    aside.querySelectorAll('[data-card]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.go({ card: Number(a.dataset.card) }); }));
    aside.querySelector('[data-owner]').addEventListener('change', (e) => {
      const to = e.target.value;
      act(() => ctx.send('PATCH', `${API}/${it.id}/owner`, { owner: to }), `reassigned to ${OWNER_WORDS[to]}`);
    });
    aside.querySelector('[data-status]').addEventListener('change', (e) => {
      const to = e.target.value;
      act(() => ctx.send('PATCH', `${API}/${it.id}/status`, { to }), `moved to ${STATUS_WORDS[to]}`);
    });
    aside.querySelector('[data-close-card]')?.addEventListener('click', async () => {
      const answer = await closeDialog(it);
      if (answer) await act(() => ctx.send('POST', `${API}/${it.id}/close`, answer), 'closed');
    });
    aside.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(it.client_notice); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select and copy'; }
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1800);
    });
    aside.querySelector('.rq-comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const box = e.target.querySelector('textarea');
      const text = box.value.trim();
      if (!text) { box.focus(); return; }
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      const ok = await act(() => ctx.send('POST', `${API}/${it.id}/comment`, { text }), 'comment added');
      btn.disabled = false;
      if (ok) box.value = '';
    });
    // Context turns are clamped; a click shows the whole message.
    aside.addEventListener('click', (e) => {
      const msg = e.target.closest('.is-context .rq-msg');
      if (msg && !msg.classList.contains('is-short')) msg.classList.toggle('is-expanded');
    });
    aside.querySelector('[data-full-conv]')?.addEventListener('click', async (e) => {
      const holder = aside.querySelector('[data-full]');
      const btn = e.target;
      if (holder.innerHTML) { holder.innerHTML = ''; btn.textContent = 'Show the full conversation'; return; }
      btn.disabled = true; btn.textContent = 'Loading…';
      try {
        const conv = await ctx.api(`${API}/${it.id}/conversation`);
        const flaggedIndex = it.snapshot?.flagged_turn_index ?? null;
        holder.innerHTML = `<p class="cc-muted">Conversation #${conv.conversation_id}, ${ctx.plural(conv.turns.length, 'client message')}.</p><ol class="rq-chat rq-chat-full">${conv.turns.map((t) => turnHtml(t, flaggedIndex)).join('')}</ol>`;
        btn.textContent = 'Hide the full conversation';
        unclampShort(holder);
      } catch (err) {
        holder.innerHTML = `<p class="cc-error">${esc2(err.status === 503 ? "The chat history can't be reached from here." : "The conversation didn't load.")}</p>`;
        btn.textContent = 'Show the full conversation';
      }
      btn.disabled = false;
    });
  }

  /** The close dialog. Resolves {expected_match?, close_note?} or null when cancelled. */
  function closeDialog(item) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'rq-dialog';
      const isMatch = item.kind === 'match';
      dlg.innerHTML = `<form method="dialog">
        <h3>Close “${esc2(item.title)}”</h3>
        ${isMatch ? `<fieldset><legend>Should this grant have matched this company?</legend>
          <label><input type="radio" name="em" value="should"> Yes, it should have matched</label>
          <label><input type="radio" name="em" value="shouldnt"> No, it shouldn't have</label></fieldset>` : ''}
        ${item.kind === 'grant_pattern' ? '<p class="cc-muted">Each match card linked to this pattern gets a "re-check" note. They stay where they are.</p>' : ''}
        <label class="rq-note">Note <span class="cc-muted">(optional)</span><textarea name="note" rows="3" maxlength="4000" placeholder="What was fixed, or why it's fine"></textarea></label>
        <p class="rq-dialog-err" role="alert"></p>
        <div class="rq-dialog-actions"><button type="button" class="rq-btn" value="cancel">Cancel</button><button type="submit" class="rq-btn rq-btn-primary" value="ok">Close card</button></div>
      </form>`;
      document.querySelector('.cc').appendChild(dlg);
      const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      dlg.querySelector('[value="cancel"]').addEventListener('click', () => done(null));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
      dlg.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const em = dlg.querySelector('input[name="em"]:checked')?.value ?? null;
        if (isMatch && !em) { dlg.querySelector('.rq-dialog-err').textContent = 'Choose whether it should have matched.'; return; }
        const note = dlg.querySelector('textarea').value.trim();
        done({ ...(em ? { expected_match: em } : {}), ...(note ? { close_note: note } : {}) });
      });
      dlg.showModal();
      (dlg.querySelector('input[name="em"]') || dlg.querySelector('textarea')).focus();
    });
  }

  // ---------------------------------------------------------------- toast
  function toast(text, isError = false) {
    let t = document.getElementById('rq-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rq-toast';
      t.className = 'rq-toast';
      t.setAttribute('role', 'status');
      document.querySelector('.cc').appendChild(t);
    }
    t.textContent = text;
    t.classList.toggle('is-error', isError);
    t.classList.add('on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('on'), 2600);
  }

  window.CCReview = { render, closeDrawer: () => closeDrawer() };
})();

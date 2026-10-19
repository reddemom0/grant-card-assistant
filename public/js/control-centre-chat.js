/**
 * Control Centre — Chat themes tab.
 *
 *   #chat                       seven sections: themes (clients only), unanswered
 *                               questions, unmet needs, grants discussed in chat,
 *                               chat health, chat outcomes, chat search
 *   #chat?q=loan&company=&from=&to=&cards=shown&sort=left_after
 *                               the search (and the unanswered sort) in the URL
 *   #chat/<conversation id>     one chat, verbatim, each reply with its grant cards
 *                               (opening it is logged)
 *
 * Data: GET /api/control-centre/chat?range= (both variants, client-only and
 * with internal accounts, so the switch needs no refetch), /chat/search and
 * /chat/:id. Loaded before control-centre.js, which calls
 * CCChat.render(panel, ctx). Docs: docs/control-centre.md (Chat themes tab).
 */
(function () {
  'use strict';

  const API = '/api/control-centre/chat';
  const RANGE_WORDS = { day: 'today', week: 'in the last 7 days', month: 'in the last 30 days', year: 'in the last year' };
  const ISSUE_WORDS = { no_cards_for_funding_ask: 'Funding ask, no grant cards', card_for_rejected_grant: 'Card for a grant the reply ruled out' };
  const VERDICT_WORDS = { chat_did_not_search: "didn't search", chat_search_found_nothing: 'searched, found nothing',
    chat_results_not_shown: 'found grants, showed no cards', chat_carded_rejected_grant: 'card for a ruled-out grant' };
  const STATUS_WORDS = { new: 'New', diagnosed: 'Diagnosed', in_progress: 'In progress', closed: 'Closed' };
  const ANSWER_WORDS = { answered: 'answered', partly: 'partly answered', not_answered: 'not answered' };

  let ctx = null;
  const cache = new Map();
  let seq = 0;

  const esc = (v) => ctx.esc(v);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}${y !== new Date().getFullYear() ? `, ${y}` : ''}`;
  };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' }) : '');
  const internalTag = (on) => (on ? ' <span class="cc-tag-internal">Internal</span>' : '');
  const variantKey = () => (ctx.includeInternal() ? 'all_variant' : 'clients_variant');
  const rangeWords = (d) => RANGE_WORDS[d.range] || 'in the range';
  const query = () => new URLSearchParams(ctx.state().hq || '');
  const section = (title, sub, body, cls = '') => `<section class="cc-card co-sec ch-sec ${cls}"><div class="co-sec-head"><h2>${title}</h2>${sub ? `<span class="cc-muted">${sub}</span>` : ''}</div>${body}</section>`;

  const company = (d, id, fallback = 'A client with no company') => {
    if (id == null) return `<span>${esc(fallback)}</span>`;
    const c = d.companies?.[id];
    return `<a href="#companies/${id}" data-company="${id}">${esc(c?.name || `Company #${id}`)}</a>${internalTag(c?.internal)}`;
  };
  const chatLink = (id, label) => `<a href="#chat/${id}" data-chat="${id}">${esc(label ?? `Chat #${id}`)}</a>`;
  const grantChip = (d, id) => `<a class="ch-chip" href="#grants/${id}" data-grant="${id}">${esc(d.grants?.[id] || `Grant #${id}`)}</a>`;

  // ---------------------------------------------------------------- render
  async function render(panel, helpers) {
    ctx = helpers;
    const id = ctx.state().chat;
    if (id) return renderTranscript(panel, id);
    const my = ++seq;
    const range = ctx.state().range;
    if (!panel.querySelector('.ch')) panel.innerHTML = '<div class="cc-card"><div class="cc-skel" style="width:30%"></div><div class="cc-skel" style="width:80%"></div><div class="cc-skel" style="width:70%"></div></div>';
    panel.classList.add('cc-loading');
    let data = cache.get(range);
    if (!data) {
      try {
        data = await ctx.api(`${API}?range=${range}`);
        cache.set(range, data);
      } catch (err) {
        if (my !== seq) return;
        panel.classList.remove('cc-loading');
        panel.innerHTML = `<div class="cc-error">${esc(err.status === 503 ? "Chat themes can't reach their databases right now." : "Chat themes didn't load. Refresh the page to try again.")}</div>`;
        return;
      }
    }
    if (my !== seq || ctx.state().tab !== 'themes' || ctx.state().chat) return;
    panel.classList.remove('cc-loading');
    paint(panel, data);
  }

  function paint(panel, d) {
    const first = !panel.querySelector('.ch');
    const y = window.scrollY;
    const internal = ctx.includeInternal();
    const v = d[variantKey()];
    panel.innerHTML = `<div class="ch${first && !ctx.reduceMotion ? ' co-enter' : ''}">
      <div class="ch-head cc-card">
        <div><h2>Chat themes</h2><p class="cc-sub">What clients ask GetGranted's assistant ${esc(rangeWords(d))}, what went unanswered, and what happened next.
          ${d.store.ok ? (d.store.last_run_day ? `Themes, unanswered questions and unmet needs come from the nightly chat review, last run on ${esc(day(d.store.last_run_day))}.` : 'The nightly chat review hasn\'t stored a day yet.') : 'The nightly chat review isn\'t set up here yet (its table is missing), so the first three sections are empty.'}</p></div>
        <label class="cc-switch"><input type="checkbox" role="switch" ${internal ? 'checked' : ''}><span class="cc-switch-track" aria-hidden="true"></span><span>Include internal accounts</span></label>
      </div>
      ${themesHtml(d)}
      <div class="ch-grid">${unansweredHtml(d, v)}${unmetHtml(d, v)}</div>
      <div class="ch-grid">${healthHtml(d, v)}${outcomesHtml(d, v)}</div>
      ${grantsHtml(d, v)}
      ${searchHtml()}
    </div>`;
    bind(panel, d);
    if (!first) window.scrollTo({ top: y });
    if (query().get('q')) runSearch(panel, d);
  }

  // ---------------------------------------------------------------- 1. themes
  function themesHtml(d) {
    if (!d.store.ok || !d.themes.length) {
      return section('Themes', 'clients only', `<p class="cc-muted ch-empty">${d.store.ok ? `No client questions stored ${esc(rangeWords(d))}.` : 'Nothing stored yet.'}</p>`);
    }
    const max = Math.max(1, ...d.themes.flatMap((t) => t.weeks.map((w) => w.n)));
    const delta = (t) => (t.delta > 0 ? `<span class="cc-delta up">+${ctx.fmt(t.delta)}</span>` : t.delta < 0 ? `<span class="cc-delta">−${ctx.fmt(-t.delta)}</span>` : '<span class="cc-delta">0</span>');
    return section('Themes', `clients only · questions ${esc(rangeWords(d))} vs the window before · weekly, last ${d.definitions.trend_weeks} weeks`,
      `<table class="cc-table co-table ch-table"><thead><tr><th scope="col">Theme</th><th scope="col" class="num">Questions</th><th scope="col" class="num">Change</th>
        <th scope="col">Week by week</th><th scope="col">For example</th></tr></thead><tbody>
        ${d.themes.map((t) => `<tr class="ch-static"><td><span class="co-name">${esc(t.theme)}</span></td><td class="num">${ctx.fmt(t.current)}</td><td class="num">${delta(t)}</td>
          <td><span class="ch-spark" title="${esc(t.weeks.map((w) => `Week of ${day(w.week)}: ${w.n}`).join('\n'))}">${t.weeks.map((w) => `<i style="--h:${(w.n / max) * 100}%" class="${w.n ? '' : 'is-zero'}"></i>`).join('')}</span></td>
          <td class="ch-examples">${t.examples.map((e) => `<div>“${esc(e.question)}” <span class="cc-muted">· ${chatLink(e.conversation_id, `chat #${e.conversation_id}`)}</span></div>`).join('')}</td></tr>`).join('')}
      </tbody></table>
      <p class="cc-muted co-note">Questions are rewritten without names or details by the nightly review; the client's own words stay in the chat. Internal accounts are never counted here.</p>`, 'ch-themes');
  }

  // ---------------------------------------------------------------- 2. unanswered
  function unansweredHtml(d, v) {
    const sort = query().get('sort') === 'left_after' ? 'left_after' : 'count';
    const groups = [...v.unanswered].sort((a, b) => (sort === 'left_after' ? b.left_after - a.left_after || b.count - a.count : b.count - a.count || b.left_after - a.left_after));
    const total = groups.reduce((n, g) => n + g.count, 0);
    const tools = `<div class="gr-views ch-sort" role="tablist" aria-label="Sort">${[['count', 'Most questions'], ['left_after', 'Most left after']].map(([k, l]) => `<button type="button" class="gr-view" data-sort="${k}" aria-selected="${k === sort}">${l}</button>`).join('')}</div>`;
    const body = !d.store.ok ? '<p class="cc-muted ch-empty">Nothing stored yet.</p>'
      : !groups.length ? `<p class="cc-muted ch-empty">No unanswered questions ${esc(rangeWords(d))}.</p>`
        : `${tools}<ul class="ch-groups">${groups.map((g) => `<li><details><summary><b>${esc(g.theme)}</b> <span class="ch-count">${ctx.fmt(g.count)}</span>${g.left_after ? ` <span class="cv-thin">${ctx.fmt(g.left_after)} left after</span>` : ''}
          <span class="cc-muted">${Object.entries(g.by_reason).map(([k, n]) => `${n} ${esc(d.definitions.unanswered[k])}`).join(' · ')}</span></summary>
          <ul class="ch-chats">${g.chats.map((c) => `<li>${company(d, c.company_id)} · ${chatLink(c.conversation_id, `chat #${c.conversation_id}`)} <span class="cc-muted">· ${esc(day(c.day))}</span>
            ${c.questions.map((q) => `<div class="ch-q">“${esc(q.question)}” <span class="ch-reason">${esc(d.definitions.unanswered[q.reason])}</span></div>`).join('')}</li>`).join('')}</ul>
          ${g.grants.length ? `<div class="ch-chips"><span class="cc-muted">Grants involved:</span> ${g.grants.map((id) => grantChip(d, id)).join('')}</div>` : ''}
        </details></li>`).join('')}</ul>`;
    return section('Unanswered questions', `${ctx.plural(total, 'question')} ${esc(rangeWords(d))}, by theme`, `${body}
      <p class="cc-muted co-note">Unanswered: the reply didn't answer (or the chat failed), the client asked for a person, or the client left after a reply that only partly answered or that the morning review flagged.</p>`, 'ch-unanswered');
  }

  // ---------------------------------------------------------------- 3. unmet needs
  function unmetHtml(d, v) {
    const groups = v.unmet_needs;
    const body = !d.store.ok ? '<p class="cc-muted ch-empty">Nothing stored yet.</p>'
      : !groups.length ? `<p class="cc-muted ch-empty">No unmet needs ${esc(rangeWords(d))}.</p>`
        : `<ul class="ch-needs">${groups.map((g) => `<li><div class="ch-need-top"><b>${esc(g.need)}</b><span class="ch-count">${ctx.fmt(g.count)}</span><span class="cc-muted">${ctx.plural(g.chats, 'chat')}</span></div>
          ${g.examples.map((e) => `<div class="ch-q">“${esc(e.question)}” <span class="cc-muted">· ${chatLink(e.conversation_id, `chat #${e.conversation_id}`)}</span></div>`).join('')}</li>`).join('')}</ul>`;
    return section('Unmet needs', 'things clients asked for that GetGranted doesn\'t offer', body, 'ch-unmet');
  }

  // ---------------------------------------------------------------- 4. grants discussed
  function grantsHtml(d, v) {
    const rows = v.grants_discussed.slice(0, 40);
    const body = rows.length ? `<table class="cc-table co-table ch-table ch-grants"><thead><tr><th scope="col">Grant</th><th scope="col" class="num" title="Replies that showed it as a grant card">Shown as a card</th>
        <th scope="col" class="num" title="Replies that named it without a card">Only mentioned</th><th scope="col" class="num">Chats</th></tr></thead><tbody>
        ${rows.map((g) => `<tr tabindex="0" data-grant="${g.grant_id}"><td><span class="co-name">${esc(d.grants?.[g.grant_id] || `Grant #${g.grant_id}`)}</span> <span class="cc-muted co-id">#${g.grant_id}</span></td>
          <td class="num${g.carded ? '' : ' gr-zero'}">${ctx.fmt(g.carded)}</td><td class="num${g.mentioned_only ? ' gr-hot' : ' gr-zero'}">${ctx.fmt(g.mentioned_only)}</td><td class="num">${ctx.fmt(g.chats)}</td></tr>`).join('')}
      </tbody></table>${v.grants_discussed.length > rows.length ? `<p class="cc-muted co-note">The 40 most discussed of ${ctx.fmt(v.grants_discussed.length)}.</p>` : ''}`
      : `<p class="cc-muted ch-empty">No grant came up in chat ${esc(rangeWords(d))}.</p>`;
    return section('Grants discussed in chat', `${esc(rangeWords(d))}, most discussed first`, `${body}
      <p class="cc-muted co-note">"Only mentioned": the reply named a grant its search returned without showing it as a card.</p>`, 'ch-grants-sec');
  }

  // ---------------------------------------------------------------- 5. health
  function healthHtml(d, v) {
    const h = v.health;
    const tile = (n, label, hot = false) => `<div class="co-tile${hot ? ' gr-tile-hot' : ''}"><b>${n}</b><span>${label}</span></div>`;
    const cards = v.rule_cards;
    return section('Chat health', esc(rangeWords(d)), `<div class="co-tiles ch-tiles">
        ${tile(ctx.fmt(h.chats), 'chats')}${tile(ctx.fmt(h.client_messages), 'client messages')}${tile(h.cards_per_chat ?? '—', 'grant cards per chat')}
        ${tile(ctx.fmt(h.failed_turns), 'failed replies', h.failed_turns > 0)}
        ${tile(ctx.fmt(h.no_cards_for_funding_ask), 'funding asks, no cards', h.no_cards_for_funding_ask > 0)}${tile(ctx.fmt(h.card_for_rejected_grant), 'cards for ruled-out grants', h.card_for_rejected_grant > 0)}
      </div>
      ${cards.length ? `<ul class="co-cards ch-rule-cards">${cards.map((c) => `<li><a href="#review/${c.id}" data-card="${c.id}"><span class="rq-type rq-type-chat">${esc(ISSUE_WORDS[c.issue] || c.issue)}</span> ${esc(c.company_name || (c.company_id ? `Company #${c.company_id}` : 'A client'))}${c.internal ? ' <span class="cc-tag-internal">Internal</span>' : ''} · chat #${c.conversation_id}</a>
        <span class="cc-muted">${STATUS_WORDS[c.status] || esc(c.status)}${c.verdict ? ` · ${esc(VERDICT_WORDS[c.verdict] || c.verdict)}` : ''} · ${ctx.plural(c.flag_count, 'flag')}</span></li>`).join('')}</ul>` : '<p class="cc-muted ch-empty">No cards of the two new kinds were flagged in this range.</p>'}`, 'ch-health');
  }

  // ---------------------------------------------------------------- 6. outcomes
  function outcomesHtml(d, v) {
    const o = v.outcomes;
    const bar = (label, n, share) => `<li><span>${label}</span><span class="cv-bar"><i style="--w:${share ?? 0}%"></i></span><b>${share == null ? '—' : `${share}%`}</b><span class="cc-muted">${ctx.fmt(n)}</span></li>`;
    return section('Chat outcomes', `what clients did within ${d.definitions.outcome_hours} hours of a chat`, `
      <ul class="cv-bars ch-outcomes">
        ${bar('Opened a grant card', o.card_opened, o.share.card_opened)}${bar('…from chat', o.card_opened_from_chat, o.share.card_opened_from_chat)}
        ${bar('Saved to a watchlist', o.watchlist_save, o.share.watchlist_save)}${bar('Created a goal', o.goal_created, o.share.goal_created)}
        ${bar('Any of these', o.any, o.share.any)}
      </ul>
      <p class="cc-muted co-note">Of ${ctx.plural(o.linked_chats, 'chat')} whose client has a company${o.chats > o.linked_chats ? ` (${ctx.fmt(o.chats - o.linked_chats)} more couldn't be linked)` : ''}. Counted from the chat's first message to ${d.definitions.outcome_hours} hours after its last.</p>`, 'ch-outcomes-sec');
  }

  // ---------------------------------------------------------------- 7. search
  function searchHtml() {
    const q = query();
    const val = (k) => esc(q.get(k) || '');
    return section('Chat search', 'any word, in what clients wrote or what the assistant replied', `<form class="ch-search" autocomplete="off">
        <input type="search" name="q" placeholder="Search chats (e.g. loan)" value="${val('q')}" aria-label="Word to search for">
        <input type="text" name="company" placeholder="Company name or ID" value="${val('company')}" aria-label="Company">
        <label>From <input type="date" name="from" value="${val('from')}"></label><label>To <input type="date" name="to" value="${val('to')}"></label>
        <select name="cards" aria-label="Grant cards">${[['any', 'Cards shown or not'], ['shown', 'Cards shown'], ['none', 'No cards shown']].map(([k, l]) => `<option value="${k}"${(q.get('cards') || 'any') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button type="submit" class="co-btn">Search</button>
      </form>
      <div class="ch-results" aria-live="polite"><p class="cc-muted">Dates default to the last 30 days. Internal accounts follow the switch at the top.</p></div>`, 'ch-search-sec');
  }

  async function runSearch(panel) {
    const q = query();
    const box = panel.querySelector('.ch-results');
    if (!box || !q.get('q')) return;
    const p = new URLSearchParams();
    for (const k of ['q', 'company', 'from', 'to', 'cards']) if (q.get(k)) p.set(k, q.get(k));
    if (ctx.includeInternal()) p.set('internal', '1');
    box.innerHTML = '<div class="cc-skel" style="width:60%"></div>';
    try {
      const r = await ctx.api(`${API}/search?${p}`);
      box.innerHTML = `<p class="co-count">${ctx.plural(r.results.length, 'chat')} with “${esc(r.q)}”, ${esc(day(r.from))} – ${esc(day(r.to))}${r.note ? ` · ${esc(r.note)}` : ''}</p>
        ${r.results.length ? `<ul class="ch-hits">${r.results.map((h) => `<li><div class="ch-hit-top">${h.company_id != null ? `<a href="#companies/${h.company_id}" data-company="${h.company_id}">${esc(h.company_name || `Company #${h.company_id}`)}</a>` : '<span>A client with no company</span>'}${internalTag(h.internal)}
            · ${chatLink(h.conversation_id, `Open chat #${h.conversation_id}`)} <span class="cc-muted">· ${esc(when(h.last_active))} · ${h.cards_shown ? 'grant cards shown' : 'no grant cards'}</span></div>
            ${h.client_snippet ? `<div class="ch-snip"><span class="ch-who">Client</span> ${esc(h.client_snippet)}</div>` : ''}${h.assistant_snippet ? `<div class="ch-snip"><span class="ch-who ch-who-a">Assistant</span> ${esc(h.assistant_snippet)}</div>` : ''}</li>`).join('')}</ul>`
        : '<p class="cc-muted">No chat matches.</p>'}`;
    } catch (err) {
      box.innerHTML = `<p class="cc-error">${esc(err.status === 400 ? 'Search for a word of at least 2 letters, with a valid date range.' : "The search didn't run. Try again.")}</p>`;
    }
  }

  // ---------------------------------------------------------------- transcript
  async function renderTranscript(panel, id) {
    const my = ++seq;
    panel.classList.add('cc-loading');
    panel.innerHTML = '<div class="cc-card"><div class="cc-skel" style="width:45%"></div><div class="cc-skel" style="width:75%"></div></div>';
    let t;
    try {
      t = await ctx.api(`${API}/${id}`);
    } catch (err) {
      if (my !== seq) return;
      panel.classList.remove('cc-loading');
      panel.innerHTML = `<p><a href="#chat" class="co-back">← Chat themes</a></p><div class="cc-error">${esc(err.status === 404 ? `Chat #${id} isn't a client conversation.` : "This chat didn't load. Try again.")}</div>`;
      bindTranscript(panel);
      return;
    }
    if (my !== seq || ctx.state().chat !== id) return;
    panel.classList.remove('cc-loading');
    panel.innerHTML = `<div class="ch ch-page">
      <p><a href="#chat" class="co-back">← Chat themes</a></p>
      <header class="cc-card co-head"><p class="co-eyebrow">Chat #${t.conversation_id}</p>
        <h1>${t.company_id != null ? `<a href="#companies/${t.company_id}" data-company="${t.company_id}">${esc(t.company_name || `Company #${t.company_id}`)}</a>` : 'A client with no company'}${internalTag(t.internal)}</h1>
        <p class="cc-muted">Started ${esc(when(t.started))} · last message ${esc(when(t.last_active))} · ${ctx.plural(t.turns.length, 'client message')}</p>
        <p class="cc-muted co-note">Opening a chat is logged.${t.viewed_by.length ? ` Viewed by ${t.viewed_by.map((v) => `${esc(v.viewer)} (${v.views}×)`).join(', ')}.` : ''}</p></header>
      <ol class="ch-turns">${t.turns.map((x) => `<li>
        <div class="ch-turn-client"><span class="ch-who">Client · message ${x.turn_index + 1}${x.at ? ` · ${esc(when(x.at))}` : ''}</span><p>${esc(x.client)}</p></div>
        <div class="ch-turn-reply"><span class="ch-who ch-who-a">Assistant${x.outcome && x.outcome !== 'completed' ? ` · <b class="cv-empty">${esc(x.outcome.replace(/_/g, ' '))}</b>` : ''}</span><p>${esc(x.assistant) || '<span class="cc-muted">(no reply text)</span>'}</p>
          <div class="ch-cards"><span class="cc-muted">Grant cards:</span> ${!x.cards_recorded ? '<span class="cc-muted">not recorded</span>' : x.card_names.length ? x.card_names.map((c) => `<a class="ch-chip" href="#grants/${c.grant_id}" data-grant="${c.grant_id}">${esc(c.name)}</a>`).join('') : '<b>none</b>'}</div>
          ${x.analysis ? `<div class="ch-analysis cc-muted">${esc(x.analysis.theme)} · ${esc(ANSWER_WORDS[x.analysis.answer] || x.analysis.answer)}${x.analysis.funding_ask ? ' · funding ask' : ''}${x.analysis.unanswered ? ` · <b class="cv-empty">${esc(x.analysis.unanswered)}</b>` : ''}${x.analysis.unmet_need ? ` · unmet need: ${esc(x.analysis.unmet_need)}` : ''}</div>` : ''}
        </div></li>`).join('')}</ol></div>`;
    bindTranscript(panel);
    window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------- events
  function delegate(panel) {
    if (panel._chClick) panel.removeEventListener('click', panel._chClick);
    panel._chClick = (e) => {
      if (!e.target.closest('.ch')) return;
      const g = e.target.closest('[data-grant]'); const c = e.target.closest('[data-company]');
      const r = e.target.closest('[data-card]'); const ch = e.target.closest('[data-chat]');
      if (g) { e.preventDefault(); ctx.goGrant(Number(g.dataset.grant)); }
      else if (c) { e.preventDefault(); ctx.goCompany(Number(c.dataset.company)); }
      else if (r) { e.preventDefault(); ctx.goReview(Number(r.dataset.card)); }
      else if (ch) { e.preventDefault(); ctx.go({ chat: Number(ch.dataset.chat) }); }
    };
    panel.addEventListener('click', panel._chClick);
  }

  function bind(panel, d) {
    delegate(panel);
    panel.querySelector('.ch-head .cc-switch input').addEventListener('change', (e) => { ctx.setIncludeInternal(e.target.checked); paint(panel, d); });
    panel.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const q = query();
      if (b.dataset.sort === 'left_after') q.set('sort', 'left_after'); else q.delete('sort');
      ctx.go({ hq: q.toString() }, { push: false });
    }));
    panel.querySelector('.ch-search').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const q = query();
      for (const k of ['q', 'company', 'from', 'to', 'cards']) {
        const v = String(f.get(k) || '').trim();
        if (v && !(k === 'cards' && v === 'any')) q.set(k, v); else q.delete(k);
      }
      ctx.go({ hq: q.toString() }, { push: false });
    });
  }

  function bindTranscript(panel) {
    delegate(panel);
    panel.querySelectorAll('.co-back').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.go({ chat: null }); }));
  }

  window.CCChat = { render, clearCache: () => cache.clear() };
})();

/**
 * Ruk's pre-call briefings (design: "Ruk pre-call briefings", settled 1, 14 and
 * 19 Oct 2026; docs/oracle.md "Pre-call briefings").
 *
 * At 08:00 Vancouver each business day it reads the owner's calendar for the
 * NEXT business day (Friday's run covers Monday; weekends are the only
 * non-business days — no holiday calendar in v1), keeps the discovery calls
 * and quarterly check-ins with an outside attendee HubSpot knows, and for each:
 *   claim → gather → match → write (Sonnet 5.5) → Doc in Granted Files › Pre-Call
 *   Briefings › Ruk (as the owner) → DM the owner a 2–3 line summary + link.
 *
 * NEVER writes to HubSpot or to a calendar event (guests would see it). The
 * only writes are the claim row (pre_call_briefings, migration 049), the Doc,
 * the DM and api_cost_events.
 *
 * ONCE PER MEETING: the claim is `INSERT … ON CONFLICT DO NOTHING` keyed by the
 * calendar event id, so a second run or a second server copy skips it. A failed
 * build is re-claimed after 30 minutes and a crashed one after 2 hours, in the
 * same statement. node-cron's noOverlap covers overlapping runs in one process.
 *
 * OFF unless RUK_BRIEFINGS_ENABLED=true. scripts/ruk-briefing-dryrun.mjs builds
 * one briefing without claiming, filing or sending (unless told to deliver).
 *
 * Logs counts and codes only — never a company, a name or an address.
 */

import { calculateRequestCost } from '../config/cost-settings.js';
import {
  defaultGatherDeps, gatherDiscovery, gatherCheckIn, closedWonSource, matchGrants, toPreviewProfile, NO_RELIABLE_MATCHES_LINE
} from './briefing-gather.js';
import { createBriefingDoc, markdownToHtml } from './briefing-drive.js';
import { recordBriefingPost } from './briefing-posts.js';

export const BRIEFING_MODEL = 'claude-sonnet-5-5';
export const COST_SOURCE = 'ruk-briefing';
export const DEFAULT_OWNER_EMAIL = 'rukshaar@granted.ca';
export const FOLDER_PARTS = ['Pre-Call Briefings', 'Ruk'];
export const SCHEDULE = '0 8 * * 1-5';
const TZ = 'America/Vancouver';
const MODEL_TIMEOUT_MS = 120_000;
const MAX_EVENTS = 50;

// ---------------------------------------------------------------------------
// Dates — same arithmetic as pulse-roundup's localDate and pulse-digest's
// addDays / vancouverMidnight, copied rather than imported so this job does not
// load the Pulse modules (and their ops-DB pool).
// ---------------------------------------------------------------------------

/** YYYY-MM-DD in Vancouver. */
export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Calendar arithmetic on YYYY-MM-DD (no time zone involved). */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The instant Vancouver's day `ymd` starts (midnight is never inside a DST change). */
export function vancouverMidnight(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const pstGuess = Date.UTC(y, m - 1, d, 8);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(pstGuess)));
  return new Date(pstGuess - hour * 3600000);
}

/** The next business day after `ymd` (weekends skipped; no holidays in v1). */
export function nextBusinessDay(ymd) {
  let d = addDays(ymd, 1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}

// ---------------------------------------------------------------------------
// Which meetings
// ---------------------------------------------------------------------------

/** 'discovery' | 'check_in' | 'skip' (renewals) | null (title doesn't say). */
export function classifyTitle(title) {
  const t = String(title || '');
  if (/renewal/i.test(t)) return 'skip';
  if (/discovery/i.test(t)) return 'discovery';
  if (/quarterly|check[\s-]?in/i.test(t)) return 'check_in';
  return null;
}

/** "Grant Discovery Call - Elmwood Groups" → "Elmwood Groups". */
export function companyHintFromTitle(title) {
  const m = String(title || '').match(/\s[-–—:|]\s*(.+)$/);
  return m ? m[1].trim() : null;
}

const domainOf = (email) => String(email || '').split('@')[1]?.toLowerCase() || null;
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|protonmail|shaw|telus)\./i;

/** Attendees outside granted.ca who are not the owner. */
export function outsideAttendees(event, ownerEmail) {
  const owner = String(ownerEmail).toLowerCase();
  return (event.attendees || [])
    .map(a => String(a.email || '').toLowerCase())
    .filter(e => e && e !== owner && !e.endsWith('@granted.ca') && !e.endsWith('.calendar.google.com'));
}

/**
 * The owner's meetings on `date` that need a briefing, each matched to HubSpot.
 * @returns {Promise<{meetings: Array, skipped: Object<string, number>}>}
 */
export async function findMeetings({ ownerUserId, ownerEmail, date }, deps) {
  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  const res = await deps.listEvents(ownerUserId, {
    time_min: vancouverMidnight(date).toISOString(),
    time_max: vancouverMidnight(addDays(date, 1)).toISOString(),
    max_results: MAX_EVENTS
  });
  if (!res?.success) {
    const err = new Error('calendar_unavailable');
    err.code = 'calendar_unavailable';
    throw err;
  }

  const meetings = [];
  for (const event of res.events || []) {
    if (event.status === 'cancelled') { skip('cancelled'); continue; }
    if (event.all_day) { skip('all_day'); continue; }
    const titleType = classifyTitle(event.title);
    if (titleType === 'skip') { skip('renewal'); continue; }
    const outside = outsideAttendees(event, ownerEmail);
    if (outside.length === 0) { skip('no_outside_attendee'); continue; }

    let crm = null;
    let attendeeEmail = null;
    for (const email of outside) {
      const domain = FREE_MAIL.test(domainOf(email) || '') ? null : domainOf(email);
      const snap = await deps.crmSnapshot({ email, domain });
      if (snap?.contact || snap?.company) { crm = snap; attendeeEmail = email; break; }
    }
    if (!crm) {
      const hint = companyHintFromTitle(event.title);
      const snap = hint ? await deps.crmSnapshot({ company: hint }) : null;
      if (snap?.company) { crm = snap; attendeeEmail = outside[0]; }
    }
    if (!crm) { skip('not_in_hubspot'); continue; }

    // Title first; else a closed-won deal on the contact OR the matched company
    // makes it a check-in (a client's won deals usually sit on the company).
    let type = titleType;
    let typeFrom = 'title';
    if (!type) {
      const won = await closedWonSource(crm, deps);
      type = won ? 'check_in' : 'discovery';
      typeFrom = won || 'hubspot_no_won_deal';
    }
    meetings.push({ event, type, typeFrom, crm, attendeeEmail, date });
  }
  return { meetings, skipped };
}

// ---------------------------------------------------------------------------
// Claim (migration 049)
// ---------------------------------------------------------------------------

export const CLAIM_SQL = `
  INSERT INTO pre_call_briefings (event_id, owner_email, meeting_date, meeting_type, company_name, hubspot_company_id)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (event_id) DO UPDATE
     SET status = 'building', claimed_at = NOW(), error_code = NULL,
         meeting_type = EXCLUDED.meeting_type, company_name = EXCLUDED.company_name,
         hubspot_company_id = EXCLUDED.hubspot_company_id
   WHERE (pre_call_briefings.status = 'failed'   AND pre_call_briefings.claimed_at < NOW() - INTERVAL '30 minutes')
      OR (pre_call_briefings.status = 'building' AND pre_call_briefings.claimed_at < NOW() - INTERVAL '2 hours')
  RETURNING event_id`;

export const COMPLETE_SQL = `
  UPDATE pre_call_briefings
     SET status = 'done', doc_url = $2, match_source = $3, cost_usd = $4, error_code = $5,
         space_name = $6, thread_name = $7, message_name = $8, completed_at = NOW()
   WHERE event_id = $1`;

export const FAIL_SQL = `
  UPDATE pre_call_briefings
     SET status = 'failed', error_code = $2, cost_usd = $3, completed_at = NOW()
   WHERE event_id = $1`;

/** True when this run now owns the meeting. */
export async function claimMeeting(m, ownerEmail, query, companyName) {
  const r = await query(CLAIM_SQL, [m.event.id, ownerEmail, m.date, m.type, companyName ?? null, m.crm.company?.id ?? null]);
  return r.rows.length === 1;
}

// ---------------------------------------------------------------------------
// Writing the briefing
// ---------------------------------------------------------------------------

export const BRIEFING_TOOL = {
  name: 'write_briefing',
  description: 'Return the finished pre-call briefing.',
  input_schema: {
    type: 'object',
    properties: {
      dm: {
        type: 'object',
        description: 'The short Chat DM that points Ruk at the briefing. Plain text, no markdown. See "THE CHAT DM" in the instructions.',
        properties: {
          who: { type: 'string', description: 'One line: contact name · role · city, province. Write "role not on file" for a missing role.' },
          what_we_know: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          ask_first: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          grants_to_raise: {
            type: 'array', maxItems: 3,
            items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] }
          },
          open_deals_action: { type: 'array', items: { type: 'string' }, maxItems: 3 }
        },
        required: ['who', 'what_we_know', 'ask_first']
      },
      markdown: { type: 'string', description: 'The whole briefing, in the markdown subset described in the instructions.' }
    },
    required: ['dm', 'markdown']
  }
};

const COMMON_RULES = `You write pre-call briefings for Ruk, a grant consultant at Granted Consulting, the night before her call. She reads it in a Google Doc in the minutes before the call, so be brief and scannable.

RULES — every one matters:
- Use ONLY the facts in the <facts> JSON. Never invent, infer or round up a fact. If something is not in the facts, it is a gap.
- Pre-fill each question with what is known, and say where it came from in brackets: (calculator), (HubSpot), (website), (HubSpot note, 2026-09-14). Prefer the calculator, then HubSpot, then the website.
- Mark every gap with **ASK** followed by the question Ruk should ask, e.g. "**ASK** — how many people do they plan to hire this year?". Gaps are the point: they are what she spends the call on.
- Grants: "matches" are in the matching engine's order. First LEAVE OUT any grant a known fact already rules out — a location, service-area, province, ownership or sector requirement that the facts contradict (e.g. a service area that excludes the company's known city). Then show the first 5 that remain, in the given order: the grant name in bold, then ONE line on why it fits this company, written from the facts (the matching engine gives no reason for most of them, so you write it). Under it at most ONE sub-bullet "**ASK** — …": the single "couldnt_check" requirement that most decides whether the grant applies, as a question for the client. If none remain, the grant section is ONLY the line "${NO_RELIABLE_MATCHES_LINE}".
- If "match_note" is set, put it in italics directly under the grant heading, word for word.
- If "no_reliable_matches" is true, the grant section is ONLY this one line, word for word: "${NO_RELIABLE_MATCHES_LINE}"
- If "match_source" is "search" (keyword search, not the matching engine): leave out every grant you would call a weak, possible or conditional fit — keep only grants that plainly fit this company on the facts. If fewer than 2 remain, the grant section is ONLY the one line "${NO_RELIABLE_MATCHES_LINE}" (and no match_note).
- If "calculator" is null, there is no calculator session: do not mention the calculator or any calculator field at all.
- "calculator.derived_not_asked" was NOT answered by the client — Granted's form filled it in (non_profit from the industry chosen; existed_a_year from revenue and headcount). Never present it as their answer; non_profit false just means the form assumed for-profit.
- "industry" says where the industry came from ("hubspot" or "website"); cite it.
- "location" says where the company's province came from (HubSpot address or website). Use it for the province and cite it.
- No preamble, no sign-off, no advice to Ruk about how to run a call.
- Markdown subset only: "#", "##", "###" headings, "- " bullets (two spaces before "- " for a sub-bullet), "1. " numbered items, **bold**, *italic*. No tables, no code, no horizontal rules.
- You MUST respond by calling the write_briefing tool exactly once. Do not answer in plain text.

THE CHAT DM ("dm" in the tool call) — a few seconds' read on a phone, taken from the briefing you wrote, plain text (no markdown, no brackets for sources):
- who: "Name · role · City, Province" (write "role not on file" when there is none).
- what_we_know: at most 3 bullets, each one short clause — the facts that matter most for this call.
- ask_first: the 3 most important **ASK** questions from the briefing, as short questions.
- grants_to_raise: at most 3 of the grants you kept in the briefing, in the briefing's order, each with a reason of a few words. Empty if the briefing shows "No reliable matches".
- open_deals_action (check-in only): at most 3 open deals that need action, each "deal — what's needed" (use "unclear — ask <owner>" exactly as in the briefing). Empty if none.
- Each item under ~120 characters.`;

export const DISCOVERY_PROMPT = `${COMMON_RULES}

THIS IS A DISCOVERY CALL. Structure it exactly like this:

# <Company> — Discovery call, <meeting date>
One line: who she is meeting (name, title) and how they reached us (calculator / HubSpot lead), from the facts.

## 1. Business overview
What they do, years in business, employees, revenue.

## 2. Growth plans
12–24 month priorities, major projects/investments, hiring/training, new/international markets.

## 3. Funding experience
Past grants and who managed them, budget and timing.

## 4. Fit and next steps
Challenges, support wanted, who decides.

## Grant matches
The grants in "matches", as described in the rules.`;

export const CHECK_IN_PROMPT = `${COMMON_RULES}

THIS IS A QUARTERLY CHECK-IN with an existing client. Structure it exactly like this:

# <Company> — Quarterly check-in, <meeting date>

## Internal prep
- **Plan from the strategy meeting** — from "strategy_call" (the call logged in HubSpot): the plan that was agreed, with its date. If there is none, **ASK**.
- **Applied / approved / open-pending** — exactly three parts, already grouped for you:
  - **Open-pending** — every deal in "deals_open_pending" (its stage says whether it is applied, in review, etc.): name, stage, amount if known, owner. If empty, "None open."
  - **Approved (last 12 months)** — every deal in "deals_approved_last_12_months": name, amount if known, close date. If empty, "None in the last 12 months."
  - Then "deals_older_summary" as one plain line, word for word, if it is set.
  Lost and abandoned deals are deliberately not in these lists — do not mention them.
- **Open deals — what's needed** — for EACH deal in "deals_open_pending": do we need anything from the client, or are we waiting on the government? Decide ONLY from that deal's stage, its notes and its emails. If they do not make it clear, write exactly "unclear — ask <the deal's owner name>". Never guess. If the owner is unknown, write "unclear — owner not set in HubSpot".

## Client questions
Pre-fill each from the facts, **ASK** where unknown:
- Business updates
- 3–6 month priorities
- Planned projects
- Budget and timing
- Grant activity
- Support needed

## New grant matches
The grants in "matches", as described in the rules. These already exclude programs the client has a deal for.`;

/** Drop "_"-prefixed keys (internal: raw lower bounds, the full deal list) before the writer sees the facts. */
export function withoutInternal(v) {
  if (Array.isArray(v)) return v.map(withoutInternal);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, withoutInternal(x)]));
}

let anthropic = null;
async function defaultCreateMessage(params, opts) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic.messages.create(params, opts);
}

/**
 * One Sonnet 5.5 call. No temperature (5.5 rejects it), tool_choice auto (5.5
 * rejects a forced tool) — the prompt requires the call and a reply without
 * one is an error (`bad_model_output`). Cost is always computed; it is only
 * logged to api_cost_events when `logCost` is given (the dry run passes none).
 */
export async function writeBriefing({ type, facts, matches, meetingDate }, { createMessage = defaultCreateMessage, logCost } = {}) {
  const payload = {
    meeting_date: meetingDate,
    ...withoutInternal(facts),
    match_source: matches.source,
    match_note: matches.note,
    no_reliable_matches: Boolean(matches.noReliableMatches),
    matches: matches.grants
  };
  const response = await createMessage({
    model: BRIEFING_MODEL,
    max_tokens: 8000,
    system: type === 'check_in' ? CHECK_IN_PROMPT : DISCOVERY_PROMPT,
    tools: [BRIEFING_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `<facts>\n${JSON.stringify(payload, null, 1)}\n</facts>\n\nCall write_briefing.` }]
  }, { timeout: MODEL_TIMEOUT_MS, maxRetries: 1 });
  const usage = response?.usage ?? null;
  const cost = usage ? calculateRequestCost(usage, BRIEFING_MODEL) : 0;
  if (usage && logCost) logCost({ usage, model: BRIEFING_MODEL, source: COST_SOURCE });
  const block = (response?.content || []).find(b => b.type === 'tool_use' && b.name === BRIEFING_TOOL.name);
  const input = block?.input;
  if (!input || typeof input.markdown !== 'string' || !input.markdown.trim()) {
    const err = new Error('bad_model_output');
    err.code = 'bad_model_output';
    err.costUsd = cost;
    throw err;
  }
  return { markdown: input.markdown.trim(), dm: cleanDm(input.dm), costUsd: cost, usage };
}

// ---------------------------------------------------------------------------
// One briefing, end to end (no claim, no delivery — shared with the dry run)
// ---------------------------------------------------------------------------

/** Build one briefing for a matched meeting. Paid (match + Sonnet); writes nothing but cost logs. */
export async function buildBriefing(meeting, deps) {
  const facts = meeting.type === 'check_in'
    ? await gatherCheckIn({ crm: meeting.crm, meetingDate: meeting.date }, deps)
    : await gatherDiscovery({ crm: meeting.crm, attendeeEmail: meeting.attendeeEmail }, deps);
  const companyName = facts.company_name || companyHintFromTitle(meeting.event.title) || 'Unknown company';
  facts.company_name = companyName;
  const profile = toPreviewProfile(facts);
  const matches = await matchGrants(profile, { excludeDeals: meeting.type === 'check_in' ? facts._deals : [], meetingDate: meeting.date }, deps);
  const written = await writeBriefing({ type: meeting.type, facts, matches, meetingDate: meeting.date },
    { createMessage: deps.createMessage, logCost: deps.logCost });
  return {
    companyName,
    docName: docName(meeting.date, companyName, meeting.type),
    facts,
    profile,
    matches,
    markdown: written.markdown,
    dm: written.dm,
    costUsd: matches.costUsd + written.costUsd,
    costs: { matching: matches.costUsd, writing: written.costUsd }
  };
}

/** "YYYY-MM-DD – Company – Discovery|Check-in" (Drive names may not contain "/"). */
export function docName(date, company, type) {
  const clean = String(company).replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${date} – ${clean} – ${type === 'check_in' ? 'Check-in' : 'Discovery'}`;
}

// ---------------------------------------------------------------------------
// The Chat DM — short, bulleted, its own thread per meeting
// ---------------------------------------------------------------------------

const DM_ITEM_CHARS = 140;
const list = (v, n) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x.trim() : x)).filter(Boolean).slice(0, n);

/** The model's dm block, bounded: at most 3 of each, strings only. */
export function cleanDm(dm = {}) {
  return {
    who: typeof dm?.who === 'string' ? dm.who.trim() : '',
    what_we_know: list(dm?.what_we_know, 3).map(String),
    ask_first: list(dm?.ask_first, 3).map(String),
    grants_to_raise: list(dm?.grants_to_raise, 3)
      .filter(g => g && typeof g.name === 'string' && g.name.trim())
      .map(g => ({ name: g.name.trim(), reason: String(g.reason || '').trim() })),
    open_deals_action: list(dm?.open_deals_action, 3).map(String)
  };
}

/**
 * One bullet line, clipped so the whole message stays short. The DM uses Chat's
 * own formatting, where * _ ~ toggle styles and <…> is a link, so those are
 * taken out of the model's text (and a leading "ASK —").
 */
const clip = (s, n = DM_ITEM_CHARS) => {
  const t = String(s).replace(/\s+/g, ' ').trim()
    .replace(/^\**ASK\**\s*[—-]\s*/i, '')
    .replace(/[*_~`]/g, '').replace(/[<>]/g, '');
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** "Tue 20 Oct, 13:15" in Vancouver time, from the calendar event start. */
export function meetingWhen(start) {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  const part = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(d);
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}, ${part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
}

export const DM_MAX_LINES = 15;

/**
 * The DM, in Chat's OWN text formatting (posted without MARKUP_SYNTAX_MARKDOWN,
 * so every "\n" is a line break): *bold*, _italic_, <url|label>.
 *
 *   *Company — Discovery, Tue 20 Oct, 13:15*
 *   who
 *
 *   *What we know*        ≤3 "• " bullets
 *
 *   *Ask first*           ≤3
 *
 *   *Grants to raise*     ≤3 (a check-in with open deals needing action shows
 *                         *Open deals needing action* instead)
 *
 *   <doc url|Open full briefing>
 *   _Reply here with any question about this client._
 *
 * Blank lines separate sections. At most DM_MAX_LINES non-blank lines: over
 * budget drops the last "what we know" bullet (keeping one), then the last
 * grant/deal. Empty sections are left out.
 */
export function dmText(briefing, url, meeting) {
  const dm = { ...(briefing.dm || cleanDm({})) };
  const action = meeting?.type === 'check_in' && dm.open_deals_action?.length ? 'open_deals_action' : 'grants_to_raise';
  const count = () => 3 + (dm.who ? 1 : 0)
    + ['what_we_know', 'ask_first', action].reduce((n, k) => n + (dm[k]?.length ? dm[k].length + 1 : 0), 0);
  dm.what_we_know = [...(dm.what_we_know || [])];
  dm[action] = [...(dm[action] || [])];
  while (count() > DM_MAX_LINES && dm.what_we_know.length > 1) dm.what_we_know.pop();
  while (count() > DM_MAX_LINES && dm[action].length > 1) dm[action].pop();

  const type = meeting?.type === 'check_in' ? 'Check-in' : 'Discovery';
  const when = meetingWhen(meeting?.event?.start);
  const company = clip(briefing.companyName, 80);
  const blocks = [[`*${company} — ${type}${when ? `, ${when}` : ''}*`, ...(dm.who ? [clip(dm.who)] : [])]];
  const section = (title, items) => {
    if (items.length) blocks.push([`*${title}*`, ...items.map(it => `• ${clip(it)}`)]);
  };
  section('What we know', dm.what_we_know);
  section('Ask first', dm.ask_first);
  if (action === 'open_deals_action') section('Open deals needing action', dm.open_deals_action);
  else section('Grants to raise', dm.grants_to_raise.map(g => (g.reason ? `${g.name} — ${g.reason}` : g.name)));
  blocks.push([`<${url}|Open full briefing>`, '_Reply here with any question about this client._']);
  return blocks.map(b => b.join('\n')).join('\n\n');
}

/**
 * File the Doc as the owner, then DM as a NEW THREAD and record where it landed
 * (briefing_posts) so a reply in that thread gets this briefing as context.
 * The Doc failing means no DM. `isTest` marks a --dm-to send.
 * @returns {Promise<{doc, dm: 'sent'|'no_dm_space'|'dm_failed', text: string, post: {spaceName, messageName, threadName}|null}>}
 */
export async function deliverBriefing(briefing, { ownerEmail, dmChatUserId, meeting, recipientEmail = null, isTest = false }, deps) {
  const doc = await deps.createDoc({ ownerEmail, folderParts: FOLDER_PARTS, name: briefing.docName, html: markdownToHtml(briefing.markdown) });
  const text = dmText(briefing, doc.url, meeting);
  let dm = 'sent';
  let post = null;
  try {
    const space = dmChatUserId ? await deps.findDm(dmChatUserId) : null;
    if (!space) {
      dm = 'no_dm_space';
      console.warn('⚠️  Briefing DM skipped — the recipient has no DM with Oracle yet (they need to message Oracle once)');
    } else {
      const landed = await deps.postThread(space, text);
      if (!landed?.messageName) {
        dm = 'dm_failed';
      } else {
        post = { spaceName: space, messageName: landed.messageName, threadName: landed.threadName || null };
        await deps.recordPost({
          eventId: meeting?.event?.id, meetingDate: meeting?.date, meetingType: meeting?.type, companyName: briefing.companyName,
          isTest, recipientEmail, ...post, docUrl: doc.url, markdown: briefing.markdown, facts: withoutInternal(briefing.facts)
        });
      }
    }
  } catch (err) {
    dm = 'dm_failed';
    console.warn(`⚠️  Briefing DM failed — code: ${err?.code || err?.name || 'unknown'}`);
  }
  return { doc, dm, text, post };
}

// ---------------------------------------------------------------------------
// The daily run
// ---------------------------------------------------------------------------

export function defaultDeps() {
  return {
    ...defaultGatherDeps,
    listEvents: async (...a) => (await import('../tools/google-calendar.js')).listCalendarEvents(...a),
    query: async (...a) => (await import('../database/connection.js')).query(...a),
    createDoc: (args) => createBriefingDoc(args),
    findDm: async (id) => (await import('../cards/chat-api.js')).findDmSpace(id),
    // A new thread per briefing, in Chat's own formatting (markdown: false — under
    // Markdown the line breaks collapse); returns {messageName, threadName}.
    postThread: async (space, text) => (await import('../cards/chat-api.js'))
      .postMessageWithThread({ spaceName: space, text, markdown: false }),
    recordPost: (row) => recordBriefingPost(row),
    createMessage: defaultCreateMessage,
    logCost: (args) => import('../utils/cost-logger.js').then(m => m.logAPICost(args)).catch(() => undefined)
  };
}

/** users row for a staff email: id (for Calendar), chat_user_id (for the DM). */
export async function staffUser(email, query) {
  const r = await query(
    `SELECT id, email, chat_user_id FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true LIMIT 1`, [email]);
  return r.rows[0] || null;
}

let warnedNoTable = false;

/** One daily run. Returns a summary of counts and codes for the log. */
export async function runRukBriefings({ now = new Date(), env = process.env, deps = defaultDeps() } = {}) {
  const ownerEmail = env.RUK_BRIEFINGS_OWNER_EMAIL || DEFAULT_OWNER_EMAIL;
  const date = nextBusinessDay(localDate(now));
  const owner = await staffUser(ownerEmail, deps.query);
  if (!owner) return { date, status: 'no_owner' };

  const { meetings, skipped } = await findMeetings({ ownerUserId: owner.id, ownerEmail, date }, deps);
  const out = { date, found: meetings.length, skipped, built: 0, already: 0, failed: 0, dm: {}, costUsd: 0 };

  for (const m of meetings) {
    let claimed;
    try {
      claimed = await claimMeeting(m, ownerEmail, deps.query, m.crm.company?.name ?? null);
    } catch (err) {
      if (err?.code === '42P01') {
        if (!warnedNoTable) console.warn('⚠️  Ruk briefings: pre_call_briefings missing — apply migration 049. Skipping.');
        warnedNoTable = true;
        return { ...out, status: 'no_state_table' };
      }
      throw err;
    }
    if (!claimed) { out.already += 1; continue; }

    let cost = 0;
    try {
      const b = await buildBriefing(m, deps);
      cost = b.costUsd;
      const { doc, dm, post } = await deliverBriefing(b, { ownerEmail, dmChatUserId: owner.chat_user_id, meeting: m, recipientEmail: ownerEmail }, deps);
      await deps.query(COMPLETE_SQL, [m.event.id, doc.url, b.matches.source, cost.toFixed(4), dm === 'sent' ? null : dm,
        post?.spaceName ?? null, post?.threadName ?? null, post?.messageName ?? null]);
      out.built += 1;
      out.dm[dm] = (out.dm[dm] || 0) + 1;
    } catch (err) {
      const code = String(err?.code || err?.name || 'error').slice(0, 60);
      cost = cost || Number(err?.costUsd) || 0;
      console.error(`❌ Ruk briefing failed — code: ${code}`);
      await deps.query(FAIL_SQL, [m.event.id, code, cost.toFixed(4)]).catch(() => {});
      out.failed += 1;
    }
    out.costUsd += cost;
  }
  return { ...out, status: 'ok' };
}

/** Schedule the daily run. Off unless RUK_BRIEFINGS_ENABLED=true. */
export function startRukBriefings(cron, env = process.env) {
  if (env.RUK_BRIEFINGS_ENABLED !== 'true') {
    console.log('⏸️  Ruk pre-call briefings off (RUK_BRIEFINGS_ENABLED is not "true")');
    return false;
  }
  const run = async () => {
    try {
      const r = await runRukBriefings({ env });
      console.log(`📋 Ruk briefings ${r.date}: ${r.status} — found ${r.found ?? 0}, built ${r.built ?? 0}, already ${r.already ?? 0}, failed ${r.failed ?? 0}, $${(r.costUsd ?? 0).toFixed(2)}`);
    } catch (err) {
      console.error(`❌ Ruk briefings run failed — code: ${err?.code || err?.name || 'unknown'}`);
    }
  };
  cron.schedule(SCHEDULE, run, { name: 'ruk-briefings', timezone: TZ, noOverlap: true });
  console.log('✅ Ruk pre-call briefings scheduled (08:00 America/Vancouver, Mon–Fri)');
  return true;
}

/** Test-only. */
export function _resetRukBriefingsForTests() {
  warnedNoTable = false;
}

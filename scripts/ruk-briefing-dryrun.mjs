#!/usr/bin/env node
/**
 * Dry run of Ruk's pre-call briefing for ONE meeting.
 *
 *   node scripts/ruk-briefing-dryrun.mjs ["<event title>"] [--company "<name>"] [--date YYYY-MM-DD]
 *       finds the event on Ruk's calendar whose title contains <event title>
 *       (case-insensitive) on that date — default: the next business day,
 *       as the 08:00 run would pick — matches it to HubSpot, gathers, runs the
 *       matching engine (gg3-ai-service match-preview) and writes the briefing
 *       with Sonnet 5.5. Prints what it found, the match source, the full
 *       briefing and the cost. Files nothing, sends nothing.
 *       --company picks the meeting by the HubSpot company it matched
 *       (case-insensitive contains) — for HubSpot booking-link meetings, whose
 *       titles ("30 min meeting with Rukshaar Ali") are all alike. Give a
 *       title, a company, or both (both must match).
 *
 *   … --deliver --dm-to <user>
 *       also creates the Doc in Granted Files › Pre-Call Briefings › Ruk (as
 *       Ruk, through delegation — exactly the daily run's path) and DMs the
 *       summary + link to <user>: an email local part ("chris") or a name, which
 *       must resolve to exactly one active Oracle user with a Chat DM. --deliver
 *       refuses without --dm-to, so a test cannot DM Ruk by accident; pass
 *       "--dm-to rukshaar" to send her the real DM.
 *
 * Never claims the meeting in pre_call_briefings, so the daily run still builds
 * it. Never writes HubSpot or the calendar. The Sonnet cost is priced and
 * printed, not logged; the website read's Haiku call logs its own small cost to
 * api_cost_events (source lead-gen-extraction), as it does for lead-gen.
 *
 * Loads .env (production Oracle DB, HubSpot, Google). Needs GG3_AI_SERVICE_URL +
 * GG3_REVIEW_FEED_TOKEN for engine matches; without them it falls back to
 * keyword search and the briefing says so. Paid: ~20–35¢ per run.
 * Implementation: src/services/ruk-briefings.js.
 */

import 'dotenv/config';
import {
  defaultDeps, findMeetings, buildBriefing, deliverBriefing, nextBusinessDay, localDate, staffUser, withoutInternal,
  DEFAULT_OWNER_EMAIL, FOLDER_PARTS
} from '../src/services/ruk-briefings.js';
import { getPool } from '../src/database/connection.js';

function parseArgs(argv) {
  const out = { title: null, company: null, date: null, deliver: false, dmTo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') out.date = argv[++i];
    else if (a === '--deliver') out.deliver = true;
    else if (a === '--dm-to') out.dmTo = argv[++i];
    else if (a === '--company') out.company = argv[++i];
    else if (!a.startsWith('--') && out.title === null) out.title = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.title && !out.company) throw new Error('Usage: node scripts/ruk-briefing-dryrun.mjs ["<event title>"] [--company "<name>"] [--date YYYY-MM-DD] [--deliver --dm-to <user>]');
  if (out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error('--date must be YYYY-MM-DD');
  if (out.deliver && !out.dmTo) throw new Error('--deliver needs --dm-to <user> (use "--dm-to rukshaar" to DM Ruk herself)');
  if (out.dmTo && !out.deliver) throw new Error('--dm-to only applies with --deliver');
  return out;
}

/** "chris" → the one active user whose email local part or name matches. */
async function resolveDmUser(spec, query) {
  const s = String(spec).trim().toLowerCase();
  const r = await query(
    `SELECT id, email, name, chat_user_id FROM users
      WHERE is_active = true
        AND (LOWER(split_part(email, '@', 1)) = $1 OR LOWER(email) = $1 OR LOWER(name) = $1 OR LOWER(name) LIKE $1 || ' %')`,
    [s]);
  // An exact email always wins. A name or local part that matches several
  // accounts narrows to the ones Oracle can actually DM (one person with a
  // second, Chat-less account is the usual case); still ambiguous → refuse.
  const exact = r.rows.filter(u => u.email.toLowerCase() === s);
  const local = r.rows.filter(u => u.email.toLowerCase().split('@')[0] === s);
  let rows = exact.length ? exact : local.length ? local : r.rows;
  if (rows.length > 1) rows = rows.filter(u => u.chat_user_id);
  if (rows.length !== 1) throw new Error(`--dm-to "${spec}" matched ${rows.length} active users; be more specific (an email works)`);
  if (!rows[0].chat_user_id) throw new Error(`--dm-to "${spec}" has no Chat user id yet (they need to message Oracle once)`);
  return rows[0];
}

const hr = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deps = defaultDeps();
  deps.logCost = undefined; // price, print, never log the Sonnet call
  const ownerEmail = process.env.RUK_BRIEFINGS_OWNER_EMAIL || DEFAULT_OWNER_EMAIL;
  const date = args.date || nextBusinessDay(localDate());
  const owner = await staffUser(ownerEmail, deps.query);
  if (!owner) throw new Error(`No active Oracle user for ${ownerEmail}`);
  const dmUser = args.deliver ? await resolveDmUser(args.dmTo, deps.query) : null;

  const want = [args.title && `title "${args.title}"`, args.company && `company "${args.company}"`].filter(Boolean).join(' + ');
  console.log(`Ruk briefing dry run — ${want} on ${date}${args.deliver ? ` — DELIVER (Doc as ${ownerEmail}, DM to ${dmUser.email})` : ' — print only'}`);

  const { meetings, skipped } = await findMeetings({ ownerUserId: owner.id, ownerEmail, date }, deps);
  const companyOf = (x) => String(x.crm.company?.name || x.crm.contact?.company || '');
  const hits = meetings.filter(x =>
    (!args.title || String(x.event.title || '').toLowerCase().includes(args.title.toLowerCase()))
    && (!args.company || companyOf(x).toLowerCase().includes(args.company.toLowerCase())));
  const list = () => meetings.map(x => `"${x.event.title}" → ${companyOf(x) || '?'} (${String(x.event.start).slice(11, 16)})`).join('; ') || 'none';
  if (hits.length !== 1) {
    console.log(`\n${hits.length === 0 ? 'No' : hits.length} briefable meeting${hits.length === 1 ? '' : 's'} on ${date} match ${want}${hits.length > 1 ? ' — narrow it with --company or the title' : ''}.`);
    console.log(`Briefable that day: ${list()}`);
    console.log(`Skipped: ${JSON.stringify(skipped)}`);
    process.exitCode = 1;
    return;
  }
  const m = hits[0];

  hr('Meeting');
  console.log(`${m.event.title} — ${m.event.start}`);
  console.log(`type: ${m.type} (from ${m.typeFrom})`);
  const outside = (m.event.attendees || []).filter(a => !String(a.email).toLowerCase().endsWith('@granted.ca')).map(a => a.email);
  console.log(`outside attendees: ${outside.join(', ')}`);
  console.log(`matched via attendee ${m.attendeeEmail}:`);
  console.log(`  contact: ${m.crm.contact ? `${m.crm.contact.name ?? '(no name)'} — HubSpot contact ${m.crm.contact.id}, found by ${m.crm.foundBy}` : 'none'}`);
  console.log(`  company: ${m.crm.company ? `${m.crm.company.name} (domain ${m.crm.company.domain ?? 'none'}) — HubSpot company ${m.crm.company.id}, found by ${m.crm.companyFoundBy}` : 'none'}`);
  console.log(`  deals: ${m.crm.deals?.length ?? 0}`);

  const b = await buildBriefing(m, deps);

  hr('Gathered');
  const f = b.facts;
  const counts = m.type === 'check_in'
    ? { deals: f._deals.length, open_pending: f.deals_open_pending.length, approved_12m: f.deals_approved_last_12_months.length,
        older: f.deals_older_summary, logged_calls: f.logged_calls.length,
        strategy_call: f.strategy_call ? f.strategy_call.date : null, company_notes: f.company_notes.length, company_emails: f.company_emails.length }
    : { calculator_answers: f.calculator ? Object.values(f.calculator).filter(v => v != null && typeof v !== 'object').length : 'ignored (no session)',
        calculator_session: Boolean(f.calculator), notes: f.notes.length, deals: f.deals.length, website: Boolean(f.website) };
  console.log(JSON.stringify(counts));
  console.log(`gaps: ${f.gaps.join(', ') || 'none'}`);
  if (f.calculator) {
    const { session, ...answers } = withoutInternal(f.calculator);
    console.log(`calculator (decoded): ${JSON.stringify(answers)}`);
  }
  const loc = f.location || {};
  console.log(`province: ${loc.provinces?.length ? `${loc.provinces.join(', ')} (from ${loc.source})` : 'not found'} — checked ${loc.checked?.join(' → ') || 'nothing'}${loc.pagesRead != null ? `, ${loc.pagesRead} website page(s) read` : ''}`);
  const ind = f.industry || {};
  console.log(`industry: ${ind.canonical?.length ? ind.canonical.join(', ') : 'none'} (from ${ind.source ?? '-'})${ind.labels?.length ? ` — HubSpot labels: ${ind.labels.join(', ')}` : ''}`);
  if (m.crm.company) console.log(`  HubSpot address fields: state=${JSON.stringify(m.crm.company.province)} city=${JSON.stringify(m.crm.company.city)} address=${JSON.stringify(m.crm.company.address)} postal=${JSON.stringify(m.crm.company.postalCode)} country=${JSON.stringify(m.crm.company.country)}`);
  console.log(`match profile: ${JSON.stringify(b.profile)}`);

  hr(`Matches — ${b.matches.source}`);
  if (b.matches.note) console.log(b.matches.note);
  if (b.matches.noReliableMatches) console.log(`no reliable keyword matches (${b.matches.dropped ?? 0} dropped by deadline / unconfirmed province)`);
  for (const g of b.matches.grants) console.log(`- ${g.name} (${g.provider ?? '?'})${g.couldnt_check?.length ? ` — ${g.couldnt_check.length} to check` : ''}`);

  hr(`Briefing — ${b.docName}`);
  console.log(b.markdown);

  hr('DM summary');
  console.log(b.summaryLines.join('\n'));

  hr('Cost');
  console.log(`matching $${b.costs.matching.toFixed(4)} + writing $${b.costs.writing.toFixed(4)} = $${b.costUsd.toFixed(4)}  (website Haiku read logged separately)`);

  if (args.deliver) {
    hr('Deliver');
    const { doc, dm } = await deliverBriefing(b, { ownerEmail, dmChatUserId: dmUser.chat_user_id }, deps);
    console.log(`Doc: ${doc.url}  (Granted Files › ${FOLDER_PARTS.join(' › ')}; ${doc.createdFolders} folder(s) created)`);
    console.log(`DM to ${dmUser.email}: ${dm}`);
  }
}

main()
  .catch((err) => {
    console.error(`\n❌ ${err?.code ? `${err.code}: ` : ''}${err?.message || err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await getPool()?.end(); } catch { /* already closed */ }
  });

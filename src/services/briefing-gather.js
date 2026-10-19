/**
 * Pre-call briefing inputs: what is known about a company before a call, read
 * from HubSpot, the lead-gen calculator, the company website and the
 * GetGranted matching engine. Used by src/services/ruk-briefings.js.
 *
 * READ-ONLY toward everything it touches — no HubSpot write, no calendar
 * write. The one paid read is the match (gg3-ai-service match-preview, which
 * persists nothing on its side either) plus the website extraction's Haiku call.
 *
 * Every reader is injected (`deps`) so the job and the dry run share one path
 * and the tests run with fakes. A part that fails is recorded by kind in
 * `gaps` and the briefing says so; nothing here throws for a missing part.
 *
 * Logs counts and codes only — never a name, an address or a note body.
 */

import { leadCrmSnapshot, getHubSpotNotes, getDealsForCompany, getDealStageLabels, getLoggedCalls,
  getLoggedEmails, listHubSpotOwners } from '../tools/hubspot.js';
import { latestLeadGenSession } from '../database/lead-gen-reads.js';
import { extractCompanyBackgroundFromWebsite } from '../api/lead-gen-init.js';
import { searchGrantData } from '../tools/grant-data.js';

export const MATCH_TIMEOUT_MS = 180_000;
const NOTE_LIMIT = 10;
const DEAL_DETAIL_LIMIT = 8;
const BODY_CLIP = 1500;

export const defaultGatherDeps = {
  crmSnapshot: leadCrmSnapshot,
  notes: getHubSpotNotes,
  dealsForCompany: getDealsForCompany,
  stageLabels: getDealStageLabels,
  calls: getLoggedCalls,
  emails: getLoggedEmails,
  owners: listHubSpotOwners,
  leadGenSession: latestLeadGenSession,
  website: (url) => extractCompanyBackgroundFromWebsite(url, 'pre-call-briefing'),
  grantSearch: searchGrantData,
  fetch: (...args) => fetch(...args),
  fetchPage: fetchPageText,
  env: process.env
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** HubSpot bodies are HTML; the model reads plain text. */
export function plainText(html, max = BODY_CLIP) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
    .slice(0, max);
}

/** HubSpot fills an unanswered number with 0; only a positive number is an answer. */
const positiveOrNull = (v) => (Number(v) > 0 ? Number(v) : null);

const day = (ts) => (ts ? String(new Date(ts).toISOString()).slice(0, 10) : null);

/**
 * A website URL safe to fetch from the server: http(s) only, a dotted public
 * hostname, no IP literal, no localhost, no port. Returns null otherwise.
 */
export function safeWebsiteUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.port || url.username) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return null; // IPv4 / IPv6 literal
  return `${url.protocol}//${host}${url.pathname === '/' ? '' : url.pathname}`;
}

const PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island',
  QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon'
};
const PROVINCE_NAMES = Object.values(PROVINCES);

/** "BC", "B.C.", "british columbia", "Vancouver, BC" → "British Columbia"; else null. */
export function provinceOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const folded = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const byName = PROVINCE_NAMES.find(n => folded.includes(n.toLowerCase()));
  if (byName) return byName;
  if (/\bpei\b/i.test(s)) return 'Prince Edward Island';
  const codes = s.toUpperCase().replace(/\./g, '').match(/\b[A-Z]{2}\b/g) || [];
  for (const c of codes.reverse()) if (PROVINCES[c]) return PROVINCES[c];
  return null;
}

/** Canadian postal code's first letter → province (X is NT or NU, so unusable). */
const POSTAL_FIRST = { A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC', K: 'ON', L: 'ON', M: 'ON',
  N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC', Y: 'YT' };
const POSTAL = /\b([ABCEGHJ-NPRSTVXY])\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi;

/** "V2S 1A1" → "British Columbia"; else null. */
export function provinceOfPostal(raw) {
  POSTAL.lastIndex = 0;
  const m = POSTAL.exec(String(raw || '').toUpperCase());
  return m && POSTAL_FIRST[m[1]] ? PROVINCES[POSTAL_FIRST[m[1]]] : null;
}

/**
 * Provinces named in a page's text, most-mentioned first. Counts full names,
 * "City, BC"-style abbreviations and postal codes; keeps those mentioned at
 * least half as often as the top one (a head office plus real locations, not
 * a passing "we ship to Ontario"), at most 3.
 */
export function provincesInText(text) {
  const t = String(text || '');
  const counts = {};
  const add = (name) => { if (name) counts[name] = (counts[name] || 0) + 1; };
  const folded = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const name of PROVINCE_NAMES) {
    const n = (folded.match(new RegExp(`\\b${name}\\b`, 'gi')) || []).length;
    for (let i = 0; i < n; i++) add(name);
  }
  for (const m of t.matchAll(/,\s*(A\.?B|B\.?C|M\.?B|N\.?B|N\.?L|N\.?S|N\.?T|N\.?U|O\.?N|P\.?E|Q\.?C|S\.?K|Y\.?T)\.?\b/g)) {
    add(PROVINCES[m[1].replace(/\./g, '').toUpperCase()]);
  }
  POSTAL.lastIndex = 0;
  for (const m of t.toUpperCase().matchAll(POSTAL)) add(POSTAL_FIRST[m[1]] ? PROVINCES[POSTAL_FIRST[m[1]]] : null);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [];
  const top = ranked[0][1];
  return ranked.filter(([, n]) => n * 2 >= top).slice(0, 3).map(([name]) => name);
}

const PAGE_TIMEOUT_MS = 5000;
const PAGE_MAX_CHARS = 60_000;
/** The site pages a company lists its address or locations on. */
export const SITE_PATHS = ['', '/contact', '/contact-us', '/locations', '/about', '/about-us'];

/** One public page as plain text, or null. Never logs the URL. */
export async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: 'follow',
      headers: { 'User-Agent': 'GrantedConsultingBot/1.0 (pre-call briefing)' }
    });
    if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) return null;
    const html = (await res.text()).slice(0, PAGE_MAX_CHARS * 4);
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').slice(0, PAGE_MAX_CHARS);
  } catch {
    return null;
  }
}

/**
 * Where the company is: HubSpot's company address fields first (state, city,
 * street address, postal code), then the website's home, contact, locations and
 * about pages. Returns the provinces and which source gave them.
 * @returns {Promise<{provinces: string[], source: string|null, checked: string[]}>}
 */
export async function locateCompany({ company, websiteUrl }, deps = defaultGatherDeps) {
  const checked = [];
  if (company) {
    checked.push('hubspot_address');
    const fromHubspot = provinceOf(company.province) || provinceOfPostal(company.postalCode)
      || provinceOf(company.address) || provinceOf(company.city);
    if (fromHubspot) return { provinces: [fromHubspot], source: 'hubspot_address', checked };
  }
  if (websiteUrl) {
    checked.push('website');
    const pages = await Promise.all(SITE_PATHS.map(p => deps.fetchPage(`${websiteUrl.replace(/\/$/, '')}${p}`)));
    const found = provincesInText(pages.filter(Boolean).join(' \n '));
    if (found.length) return { provinces: found, source: 'website', checked, pagesRead: pages.filter(Boolean).length };
    return { provinces: [], source: null, checked, pagesRead: pages.filter(Boolean).length };
  }
  return { provinces: [], source: null, checked };
}

/** HubSpot industry enum ("MANUFACTURING_FOOD_BEVERAGE") → ["Manufacturing", "Manufacturing Food Beverage"]. */
export function industriesOf(...raws) {
  const out = [];
  for (const raw of raws) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const words = s.replace(/[_/]+/g, ' ').toLowerCase().split(/\s+/).filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1));
    if (words.length === 0) continue;
    for (const v of [words[0], words.join(' ')]) if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Calculator "what do you spend it on" + budgets → the engine's canonical goal labels. */
export function goalsOf({ spendOn, trainingBudget, expansionBudget, extraText = '' } = {}) {
  const text = `${spendOn || ''} ${extraText || ''}`.toLowerCase();
  const goals = [];
  const add = (g) => { if (!goals.includes(g)) goals.push(g); };
  if (/hir|train|staff|employ|wage|intern|student|upskill/.test(text) || Number(trainingBudget) > 0) add('Hire or Train People');
  if (/export|international|overseas|global|trade show/.test(text)) add('International Growth');
  if (/market|expan|new (market|province|location)|sales|grow/.test(text) || Number(expansionBudget) > 0) add('Domestic Growth');
  if (/equipment|machin|facilit|renovat|upgrade/.test(text)) add('Buy Equipment or Upgrade Facilities');
  if (/software|digital|\bai\b|automat|tech adoption|crm|erp/.test(text)) add('Adopt Software or AI');
  if (/r&d|research|prototype|product develop|innovat/.test(text)) add('Build Something New');
  if (/sustainab|energy|green|emission|clean/.test(text)) add('Improve Sustainability');
  if (/productiv|efficien|lean|process/.test(text)) add('Improve Productivity');
  return goals;
}

const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** True when a grant name and a deal name/program plainly refer to the same program. */
export function sameProgram(grantName, dealText) {
  const g = normName(grantName);
  const d = normName(dealText);
  return Boolean(g && d && g.length >= 6 && (d.includes(g) || g.includes(d)));
}

// ---------------------------------------------------------------------------
// HubSpot facts
// ---------------------------------------------------------------------------

async function ownerNames(deps) {
  const r = await deps.owners().catch(() => null);
  const map = new Map();
  for (const o of r?.owners || []) map.set(String(o.id), o.fullName || o.email || null);
  return map;
}

function describeDeal(d, stages, owners) {
  const st = stages[d.stage] || null;
  return {
    id: d.id,
    name: d.name,
    program: d.program,
    stage: st?.label ?? null,
    pipeline: st?.pipeline ?? null,
    closed: st ? st.closed : !d.open,
    won: st ? st.won : d.won,
    amount: d.amount,
    close_date: d.closeDate,
    last_modified: day(d.lastModified),
    owner: owners.get(String(d.ownerId)) ?? null,
    lost_reason: d.lostReason
  };
}

const noteRows = (r) => (r?.success ? r.notes : []).map(n => ({ date: day(n.timestamp), text: plainText(n.body) }));
const callRows = (r, owners) => (r?.success ? r.calls : []).map(c => ({
  date: day(c.timestamp), title: c.title, notes: plainText(c.body), outcome: c.disposition, by: owners.get(String(c.ownerId)) ?? null
}));
const emailRows = (r) => (r?.success ? r.emails : []).map(e => ({
  date: day(e.timestamp), subject: e.subject, direction: e.direction, text: plainText(e.text, 800)
}));

/** Is any of these deals closed-won? Used when the calendar title does not say the meeting type. */
export async function hasClosedWonDeal(deals, deps) {
  if (!deals?.length) return false;
  const { stages = {} } = await deps.stageLabels();
  return deals.some(d => (stages[d.stage] ? stages[d.stage].won : d.won));
}

/**
 * Everything for a discovery briefing. `crm` is the leadCrmSnapshot the
 * meeting was matched on; `attendeeEmail` the outside attendee it came from.
 */
export async function gatherDiscovery({ crm, attendeeEmail }, deps = defaultGatherDeps) {
  const gaps = [];
  const contact = crm.contact;
  const company = crm.company;
  const [leadGen, stagesR, owners, companyNotes, contactNotes] = await Promise.all([
    deps.leadGenSession(contact?.email || attendeeEmail).catch(() => null),
    deps.stageLabels(),
    ownerNames(deps),
    company ? deps.notes('companies', company.id, NOTE_LIMIT) : null,
    contact ? deps.notes('contacts', contact.id, NOTE_LIMIT) : null
  ]);
  // The calculator's HubSpot fields are only answers when a calculator session
  // exists: HubSpot fills an unanswered field with 0 or blank, which must not
  // reach the briefing as "the calculator says 0 employees".
  if (!leadGen) gaps.push('no_calculator_session');

  const url = safeWebsiteUrl(contact?.website || company?.domain);
  const [website, location] = await Promise.all([
    url ? deps.website(url).catch(() => null) : null,
    locateCompany({ company, websiteUrl: url }, deps)
  ]);
  if (!website) gaps.push(url ? 'website_unreadable' : 'no_website');
  if (!location.provinces.length) gaps.push('no_province');

  const stages = stagesR?.stages || {};
  return {
    type: 'discovery',
    company_name: company?.name || contact?.company || null,
    hubspot_company_id: company?.id || null,
    calculator: leadGen ? {
      ...(contact?.calculator || {}),
      session: {
        date: day(leadGen.at), tier: leadGen.tier, estimate: leadGen.estimate,
        programs: (leadGen.programs || []).slice(0, 8).map(p => (typeof p === 'string' ? p : p?.name || p?.program_name || null)).filter(Boolean),
        prospect: pickProspect(leadGen.prospect)
      }
    } : null,
    location,
    contact: contact ? { name: contact.name, job_title: contact.jobTitle, lifecycle: contact.lifecycleStage,
      lead_status: contact.leadStatus, owner: owners.get(String(contact.ownerId)) ?? null, first_seen: day(contact.createDate) } : null,
    company: company ? { name: company.name, domain: company.domain, industry: company.industry, employees: positiveOrNull(company.employees),
      revenue: positiveOrNull(company.revenue), city: company.city, province: company.province, address: company.address,
      postal_code: company.postalCode, lifecycle: company.lifecycleStage, owner: owners.get(String(company.ownerId)) ?? null } : null,
    deals: (crm.deals || []).map(d => describeDeal(d, stages, owners)),
    notes: [...noteRows(companyNotes), ...noteRows(contactNotes)].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, NOTE_LIMIT),
    website: website ? { url, ...website } : null,
    gaps
  };
}

/** The prospect_data fields a briefing can use — never contact details. */
function pickProspect(p = {}) {
  const keep = ['company_description', 'industry', 'revenue_bucket', 'employee_bucket', 'province', 'location',
    'activities', 'goals', 'funding_estimate', 'best_fit_product', 'service_tier', 'years_in_business', 'challenges'];
  const out = {};
  for (const k of keep) if (p?.[k] != null && p[k] !== '') out[k] = p[k];
  return out;
}

/** Everything for a quarterly check-in briefing. */
export async function gatherCheckIn({ crm }, deps = defaultGatherDeps) {
  const gaps = [];
  const company = crm.company;
  const contact = crm.contact;
  const [stagesR, owners, dealsR, location] = await Promise.all([
    deps.stageLabels(),
    ownerNames(deps),
    company ? deps.dealsForCompany(company.id) : null,
    locateCompany({ company, websiteUrl: safeWebsiteUrl(contact?.website || company?.domain) }, deps)
  ]);
  if (!location.provinces.length) gaps.push('no_province');
  if (!stagesR?.success) gaps.push('stage_labels_unavailable');
  const stages = stagesR?.stages || {};
  const rawDeals = dealsR?.success && dealsR.deals.length ? dealsR.deals : (crm.deals || []);
  if (!dealsR?.success && company) gaps.push('company_deals_unavailable');
  const deals = rawDeals.map(d => describeDeal(d, stages, owners));

  // Open deals first, then the most recently touched; detail reads are capped.
  const detailed = [...deals].sort((a, b) => Number(a.closed) - Number(b.closed) || String(b.last_modified).localeCompare(String(a.last_modified)))
    .slice(0, DEAL_DETAIL_LIMIT);
  const perDeal = await Promise.all(detailed.map(async d => {
    const [n, e, c] = await Promise.all([deps.notes('deals', d.id, 5), deps.emails('deals', d.id, 5), deps.calls('deals', d.id, 5)]);
    return { id: d.id, notes: noteRows(n), emails: emailRows(e), calls: callRows(c, owners) };
  }));
  const byId = new Map(perDeal.map(p => [p.id, p]));

  const [companyNotes, companyCalls, companyEmails, contactCalls] = await Promise.all([
    company ? deps.notes('companies', company.id, NOTE_LIMIT) : null,
    company ? deps.calls('companies', company.id, 10) : null,
    company ? deps.emails('companies', company.id, 10) : null,
    contact ? deps.calls('contacts', contact.id, 10) : null
  ]);
  const calls = dedupeById([...callRows(companyCalls, owners), ...callRows(contactCalls, owners), ...perDeal.flatMap(p => p.calls)])
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (calls.length === 0) gaps.push('no_logged_calls');

  return {
    type: 'check_in',
    company_name: company?.name || contact?.company || null,
    hubspot_company_id: company?.id || null,
    location,
    company: company ? { name: company.name, domain: company.domain, industry: company.industry, employees: positiveOrNull(company.employees),
      revenue: positiveOrNull(company.revenue), city: company.city, province: company.province, owner: owners.get(String(company.ownerId)) ?? null } : null,
    contact: contact ? { name: contact.name, job_title: contact.jobTitle } : null,
    // The strategy meeting: the logged call that says so, else the newest call.
    strategy_call: calls.find(c => /strateg/i.test(`${c.title} ${c.notes}`)) || calls[0] || null,
    logged_calls: calls.slice(0, 6),
    deals: deals.map(d => ({ ...d, ...(byId.has(d.id) ? { notes: byId.get(d.id).notes, emails: byId.get(d.id).emails } : {}) })),
    company_notes: noteRows(companyNotes),
    company_emails: emailRows(companyEmails),
    gaps
  };
}

function dedupeById(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const k = `${r.date}|${r.title}|${r.notes?.slice(0, 40)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** The match-preview profile (gg3-ai-service simulated_profile shape) from what was gathered. */
export function toPreviewProfile(facts) {
  // No calculator session → no calculator fields (gatherDiscovery sets null).
  const calc = facts.calculator || {};
  const prospect = calc.session?.prospect || {};
  const provinces = facts.location?.provinces?.length
    ? facts.location.provinces
    : [provinceOf(prospect.province) || provinceOf(prospect.location) || provinceOf(facts.website?.location)].filter(Boolean);
  const industries = industriesOf(calc.industry, facts.company?.industry, facts.website?.industry);
  // HubSpot stores an unanswered number as 0, so only a positive value counts —
  // a calculator "0" must not override the company record's real headcount.
  const positive = (v) => (Number(v) > 0 ? Number(v) : null);
  const employees = positive(calc.employees) ?? positive(facts.company?.employees);
  const revenue = (calc.revenue && !/^\s*0\s*$/.test(String(calc.revenue)) ? calc.revenue : null)
    ?? (positive(facts.company?.revenue) != null ? String(positive(facts.company.revenue)) : null);
  const profile = {
    company_name: facts.company_name || undefined,
    description: facts.website?.description || prospect.company_description || undefined,
    regions: provinces,
    industries,
    employee_count: employees != null ? String(employees) : undefined,
    annual_revenue: revenue ?? undefined,
    business_goals: goalsOf({
      spendOn: calc.spendOn,
      trainingBudget: calc.trainingBudget,
      expansionBudget: calc.expansionBudget,
      extraText: [prospect.activities, prospect.goals].flat().filter(Boolean).join(' ')
    })
  };
  for (const k of Object.keys(profile)) if (profile[k] === undefined) delete profile[k];
  return profile;
}

/** Fewer keyword matches than this surviving the filters → "No reliable matches yet". */
export const MIN_FALLBACK_MATCHES = 2;
export const NO_RELIABLE_MATCHES_LINE = 'No reliable matches yet — confirm location and plans on the call.';

/** A deadline that is plainly a date, as YYYY-MM-DD; null for "open until filled" and the like. */
export function deadlineDay(raw) {
  const s = String(raw || '').trim();
  if (!s || !/\d{4}/.test(s)) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/**
 * Keyword-search results worth showing: deadline not passed by the meeting,
 * and either open across Canada or restricted to a province we have confirmed
 * the company is in. A province-restricted grant with no confirmed province is
 * dropped — that is exactly the Ontario grant offered to a company of unknown
 * location.
 */
export function reliableFallback(results, { meetingDate, provinces }) {
  const today = meetingDate || new Date().toISOString().slice(0, 10);
  return results.filter(g => {
    const due = deadlineDay(g.deadline);
    if (due && due < today) return false;
    const regions = Array.isArray(g.regions) ? g.regions : [];
    const national = regions.length === 0 || regions.some(r => /all of canada|canada-wide|national/i.test(r));
    if (national) return true;
    return provinces.some(p => regions.some(r => r.toLowerCase() === p.toLowerCase()));
  });
}

/**
 * Grant matches for the briefing: the real engine + AI review when the profile
 * has regions and industries, else Oracle's keyword search, with the reason.
 * @returns {Promise<{source: 'engine'|'search'|'none', note: string|null, grants: Array, costUsd: number}>}
 */
export async function matchGrants(profile, { excludeDeals = [], meetingDate = null } = {}, deps = defaultGatherDeps) {
  const base = String(deps.env.GG3_AI_SERVICE_URL || '').replace(/\/+$/, '');
  const token = deps.env.GG3_REVIEW_FEED_TOKEN;
  const thin = [!profile.regions?.length && 'province', !profile.industries?.length && 'industry'].filter(Boolean);
  const keep = (name) => !excludeDeals.some(d => sameProgram(name, d.name) || sameProgram(name, d.program));

  let reason;
  if (thin.length) reason = `the profile has no ${thin.join(' or ')}`;
  else if (!base || !token) reason = 'the matching service is not configured here';
  else {
    try {
      const res = await deps.fetch(`${base}/api/v1/ai/internal/match-preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ profile }),
        signal: AbortSignal.timeout(MATCH_TIMEOUT_MS)
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        const seen = new Set();
        const grants = [];
        for (const t of body.tracks || []) {
          for (const s of t.selected || []) {
            if (seen.has(s.grant_id) || !keep(s.name)) continue;
            seen.add(s.grant_id);
            grants.push({
              name: s.name, provider: s.provider, goal: t.goal, match_strength: s.match_strength,
              eligibility: s.eligibility, reviewed: t.review_status === 'ready',
              reviewer_reason: s.reason || null,
              couldnt_check: (s.requirement_notes || []).map(n => n.text)
            });
          }
        }
        return { source: 'engine', note: null, grants: grants.slice(0, 8), costUsd: (Number(body.cost?.total_cents) || 0) / 100 };
      }
      reason = `the matching service answered ${res.status}`;
      console.warn(`⚠️  Briefing match-preview failed — status: ${res.status}`);
    } catch (err) {
      reason = 'the matching service did not answer';
      console.warn(`⚠️  Briefing match-preview failed — code: ${err?.name || err?.code || 'unknown'}`);
    }
  }

  // Fallback: Oracle's own keyword search over its GG3 copy, kept only where it
  // is reliable — a keyword hit is not a match, so the bar is "would not
  // embarrass Ruk on the call".
  try {
    const q = [profile.industries?.[0], ...(profile.business_goals || [])].filter(Boolean).join(' ').slice(0, 120);
    const r = q ? await deps.grantSearch({ query: q, regions: profile.regions, limit: 15 }) : null;
    const survivors = reliableFallback(r?.results || [], { meetingDate, provinces: profile.regions || [] }).filter(g => keep(g.name));
    if (survivors.length < MIN_FALLBACK_MATCHES) {
      return { source: 'none', note: null, noReliableMatches: true, grants: [], costUsd: 0,
        dropped: (r?.results || []).length - survivors.length };
    }
    const grants = survivors.slice(0, 5).map(g => ({
      name: g.name, provider: g.funder, amount: g.amount, deadline: g.deadline, regions: g.regions,
      summary: plainText(g.summary, 400), couldnt_check: []
    }));
    return { source: 'search', note: `Matched by keyword search, not the matching engine — ${reason}.`, grants, costUsd: 0 };
  } catch (err) {
    console.warn(`⚠️  Briefing grant search failed — code: ${err?.code || err?.name || 'unknown'}`);
    return { source: 'none', note: null, noReliableMatches: true, grants: [], costUsd: 0 };
  }
}

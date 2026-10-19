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
import { EMPLOYEE_COUNT_MAP, BUDGET_RANGE_MAP, WIDGET_TO_HUBSPOT_INDUSTRY } from '../api/hubspot-form-mappings.js';

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
export async function locateCompany({ company, websiteUrl, pages = null }, deps = defaultGatherDeps) {
  const checked = [];
  if (company) {
    checked.push('hubspot_address');
    const fromHubspot = provinceOf(company.province) || provinceOfPostal(company.postalCode)
      || provinceOf(company.address) || provinceOf(company.city);
    if (fromHubspot) return { provinces: [fromHubspot], source: 'hubspot_address', checked };
  }
  if (websiteUrl) {
    checked.push('website');
    const read = await (pages || sitePages(websiteUrl, deps))();
    const found = provincesInText(read.join(' \n '));
    if (found.length) return { provinces: found, source: 'website', checked, pagesRead: read.length };
    return { provinces: [], source: null, checked, pagesRead: read.length };
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

// ---------------------------------------------------------------------------
// Calculator answers as HubSpot stores them (property definitions read
// 2026-10-19). Several are codes or lower bounds, not answers:
//   revenue      enum code 1–6                     → the band's label
//   employees    the chosen band's LOWER bound     → the band (EMPLOYEE_COUNT_MAP)
//   budgets      the band's lower bound; the form writes 0 when unanswered
//   industry     enum code(s), ";"-separated       → the widget label
//   for/non-profit  "is it non-profit?" yes/no, DERIVED from industry, never asked
//   existed a year  a proxy from revenue + headcount, never asked
// ---------------------------------------------------------------------------

/** HubSpot revenue enum → [label, engine band]. Labels as the calculator shows them. */
export const REVENUE_CODES = {
  1: ['Pre-revenue', 'Pre-revenue'],
  2: ['$0 to $500K', 'Under $500K'],
  3: ['$500K to $2.5 million', '$500K-$2.5M'],
  4: ['$2.5 million to $5 million', '$2.5M-$5M'],
  5: ['$5 million to $10 million', '$5M-$10M'],
  6: ['$10 million+', '$10M+']
};
const invert = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [String(v), k]));
const EMPLOYEE_BANDS = invert(EMPLOYEE_COUNT_MAP);            // '20' → '20 – 49'
const BUDGET_BANDS = invert(BUDGET_RANGE_MAP);                // '5000' → 'Under $10K'
const INDUSTRY_LABELS = (() => {                              // 'ACCOUNTING' → 'Accounting' (first label wins)
  const out = {};
  for (const [label, code] of Object.entries(WIDGET_TO_HUBSPOT_INDUSTRY)) if (!(code in out)) out[code] = label;
  return out;
})();
const bandForEngine = (band) => String(band).replace(/\s*–\s*/g, '-').replace(/^Just me$/, '1');

/** One revenue answer → { label, band } (code, or a label string from older records); null if unanswered. */
export function decodeRevenue(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === '0') return null;
  if (REVENUE_CODES[s]) return { label: REVENUE_CODES[s][0], band: REVENUE_CODES[s][1] };
  const hit = Object.values(REVENUE_CODES).find(([label]) => label.toLowerCase() === s.toLowerCase());
  return hit ? { label: hit[0], band: hit[1] } : { label: s, band: s };
}

/**
 * The calculator's HubSpot fields decoded into what the client actually said,
 * with the two derived fields marked as such. Unanswered → null, never 0.
 */
export function decodeCalculator(c = {}) {
  const revenue = decodeRevenue(c.revenue);
  const empKey = Number(c.employees) > 0 ? String(Number(c.employees)) : null;
  const empBand = empKey ? (EMPLOYEE_BANDS[empKey] ?? null) : null;
  const budget = (v) => (Number(v) > 0 ? (BUDGET_BANDS[String(Number(v))] ?? `$${Number(v).toLocaleString('en-CA')}`) : null);
  const industries = String(c.industry || '').split(';').map(x => x.trim()).filter(Boolean)
    .map(code => INDUSTRY_LABELS[code] || code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()));
  const yesNo = (v) => (v === 'yes' ? true : v === 'no' ? false : null);
  return {
    revenue: revenue?.label ?? null,
    revenue_band: revenue?.band ?? null,
    employees: empBand ?? (empKey ? Number(empKey) : null),
    employees_band: empBand ? bandForEngine(empBand) : (empKey ?? null),
    training_budget: budget(c.trainingBudget),
    expansion_budget: budget(c.expansionBudget),
    industry: industries,
    spend_on: c.spendOn || null,
    best_fit: c.bestFit || null,
    derived_not_asked: {
      non_profit: yesNo(c.forProfit),        // the property asks "non-profit?"; "no" = for-profit
      existed_a_year: yesNo(c.existedAYear)
    },
    // Raw lower bounds, for goal inference only (never shown).
    _trainingBudgetMin: Number(c.trainingBudget) > 0 ? Number(c.trainingBudget) : null,
    _expansionBudgetMin: Number(c.expansionBudget) > 0 ? Number(c.expansionBudget) : null
  };
}

/** The engine's 12 canonical industries (gg3-ai-service vocabulary.ts) and the words that signal each. */
export const INDUSTRY_SIGNALS = {
  Construction: /construct|contractor|renovat|home ?build|civil works|roofing|framing|concrete|excavat/g,
  Manufacturing: /manufactur|fabricat|food processing|machin(e|ing)|factory|production line|metal ?work/g,
  Agriculture: /agricultur|farm|crop|livestock|dairy|orchard|vineyard|greenhouse|ranch/g,
  'Clean Technology': /clean ?tech|renewable|solar|wind power|carbon capture|emissions? reduc/g,
  'Digital Media': /digital media|video game|animation|film production|interactive media|post-production/g,
  Education: /education|tutoring|\bschool\b|e-?learning provider/g,
  Energy: /oil and gas|\benergy (company|sector|services)|utility|electricity generation|pipeline/g,
  Finance: /financial services|\bbank(ing)?\b|insurance|wealth management|investment firm|lending/g,
  Health: /health ?care|clinic|medical|dental|physio|pharma|wellness|therap/g,
  'Professional Services': /consult(ing|ancy)|marketing agency|advertis|law firm|legal services|accounting|bookkeep|engineering services|architect/g,
  Retail: /retail|e-?commerce|online store|boutique|storefront/g,
  Software: /software|\bsaas\b|app development|\bit services|cloud platform/g
};

/**
 * Canonical industries signalled by some text. Short HubSpot labels count on
 * one hit; website text needs `minHits` (default 3) and keeps the top one, plus
 * a second only if it has at least half the top's hits.
 */
export function canonicalIndustries(text, { minHits = 1, max = 2 } = {}) {
  const t = String(text || '').toLowerCase();
  const scored = Object.entries(INDUSTRY_SIGNALS)
    .map(([name, re]) => [name, (t.match(re) || []).length])
    .filter(([, n]) => n >= minHits)
    .sort((a, b) => b[1] - a[1]);
  if (!scored.length) return [];
  return scored.filter(([, n], i) => i === 0 || n * 2 >= scored[0][1]).slice(0, max).map(([name]) => name);
}

/** The site's pages (SITE_PATHS) fetched once per briefing and shared by the province and industry lookups. */
export function sitePages(websiteUrl, deps) {
  let promise = null;
  return () => {
    if (!websiteUrl) return Promise.resolve([]);
    promise ??= Promise.all(SITE_PATHS.map(p => deps.fetchPage(`${websiteUrl.replace(/\/$/, '')}${p}`)))
      .then(pages => pages.filter(Boolean));
    return promise;
  };
}

/**
 * The company's industry: HubSpot (calculator labels, company industry) first;
 * only when HubSpot has none, the website's pages. Returns canonical names for
 * the engine plus the HubSpot labels, and where they came from.
 */
export async function industryFor({ calculatorLabels = [], companyIndustry = null, pages }) {
  // HubSpot's company industry is often its own enum ("FOOD_PRODUCTION"); show it as words.
  const humanize = (x) => (/^[A-Z0-9_]+$/.test(x) ? x.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : x);
  const labels = [...new Set([...calculatorLabels, companyIndustry].filter(Boolean).map(String).map(humanize))];
  if (labels.length) {
    const canonical = [...new Set(labels.flatMap(l => canonicalIndustries(l)))];
    return { industries: [...new Set([...canonical, ...labels])], canonical, labels, source: 'hubspot' };
  }
  const text = (await pages()).join(' \n ');
  const canonical = canonicalIndustries(text, { minHits: 3 });
  return { industries: canonical, canonical, labels: [], source: canonical.length ? 'website' : 'none' };
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
 * When the title doesn't say the type: a closed-won deal on the contact OR on
 * the matched company makes it a check-in. Returns where the won deal was.
 * @returns {Promise<'hubspot_contact'|'hubspot_company'|null>}
 */
export async function closedWonSource(crm, deps) {
  if (await hasClosedWonDeal(crm.deals, deps)) return 'hubspot_contact';
  if (!crm.company?.id) return null;
  const r = await deps.dealsForCompany(crm.company.id).catch(() => null);
  return (await hasClosedWonDeal(r?.deals, deps)) ? 'hubspot_company' : null;
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
  const pages = sitePages(url, deps);
  const calculator = leadGen ? decodeCalculator(contact?.calculator || {}) : null;
  const [website, location, industry] = await Promise.all([
    url ? deps.website(url).catch(() => null) : null,
    locateCompany({ company, websiteUrl: url, pages }, deps),
    industryFor({ calculatorLabels: calculator?.industry || [], companyIndustry: company?.industry, pages })
  ]);
  if (!website) gaps.push(url ? 'website_unreadable' : 'no_website');
  if (!location.provinces.length) gaps.push('no_province');
  if (industry.source === 'none') gaps.push('no_industry');

  const stages = stagesR?.stages || {};
  return {
    type: 'discovery',
    company_name: company?.name || contact?.company || null,
    hubspot_company_id: company?.id || null,
    calculator: calculator ? {
      ...calculator,
      session: {
        date: day(leadGen.at), tier: leadGen.tier, estimate: leadGen.estimate,
        programs: (leadGen.programs || []).slice(0, 8).map(p => (typeof p === 'string' ? p : p?.name || p?.program_name || null)).filter(Boolean),
        prospect: pickProspect(leadGen.prospect)
      }
    } : null,
    location,
    industry,
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
export async function gatherCheckIn({ crm, meetingDate = null }, deps = defaultGatherDeps) {
  const gaps = [];
  const company = crm.company;
  const contact = crm.contact;
  const pages = sitePages(safeWebsiteUrl(contact?.website || company?.domain), deps);
  const [stagesR, owners, dealsR, location, industry] = await Promise.all([
    deps.stageLabels(),
    ownerNames(deps),
    company ? deps.dealsForCompany(company.id) : null,
    locateCompany({ company, websiteUrl: safeWebsiteUrl(contact?.website || company?.domain), pages }, deps),
    industryFor({ companyIndustry: company?.industry, pages })
  ]);
  if (!location.provinces.length) gaps.push('no_province');
  if (industry.source === 'none') gaps.push('no_industry');
  if (!stagesR?.success) gaps.push('stage_labels_unavailable');
  const stages = stagesR?.stages || {};
  const rawDeals = dealsR?.success && dealsR.deals.length ? dealsR.deals : (crm.deals || []);
  if (!dealsR?.success && company) gaps.push('company_deals_unavailable');
  const deals = rawDeals.map(d => describeDeal(d, stages, owners));
  const groups = groupDeals(deals, meetingDate);

  // Detail reads: every open deal first, then the recent approvals; capped.
  const detailed = [...groups.open_pending, ...groups.approved_last_12_months].slice(0, DEAL_DETAIL_LIMIT);
  const perDeal = await Promise.all(detailed.map(async d => {
    const [n, e, c] = await Promise.all([deps.notes('deals', d.id, 5), deps.emails('deals', d.id, 5), deps.calls('deals', d.id, 5)]);
    return { id: d.id, notes: noteRows(n), emails: emailRows(e), calls: callRows(c, owners) };
  }));
  const byId = new Map(perDeal.map(p => [p.id, p]));
  const withDetail = (d) => ({ ...d, ...(byId.has(d.id) ? { notes: byId.get(d.id).notes, emails: byId.get(d.id).emails } : {}) });

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
    industry,
    company: company ? { name: company.name, domain: company.domain, industry: company.industry, employees: positiveOrNull(company.employees),
      revenue: positiveOrNull(company.revenue), city: company.city, province: company.province, owner: owners.get(String(company.ownerId)) ?? null } : null,
    contact: contact ? { name: contact.name, job_title: contact.jobTitle } : null,
    // The strategy meeting: the logged call that says so, else the newest call.
    strategy_call: calls.find(c => /strateg/i.test(`${c.title} ${c.notes}`)) || calls[0] || null,
    logged_calls: calls.slice(0, 6),
    // Grouped in code (groupDeals), so the briefing cannot file a lost deal as
    // "applied": open → open_pending; won in the last 12 months → approved;
    // lost/abandoned are left out; everything older is one counted line.
    deals_open_pending: groups.open_pending.map(withDetail),
    deals_approved_last_12_months: groups.approved_last_12_months.map(withDetail),
    deals_older_summary: groups.older_summary,
    // Every deal, for leaving existing programs out of "new" matches. Not sent to the writer.
    _deals: deals,
    company_notes: noteRows(companyNotes),
    company_emails: emailRows(companyEmails),
    gaps
  };
}

/** How a closed deal ended: approved (won), abandoned, or lost (any other closed stage). */
const outcomeOf = (d) => (d.won ? 'approved' : /abandon/i.test(d.stage || '') ? 'abandoned' : 'lost');

/**
 * Check-in deal lists, relative to the meeting date:
 *   open_pending              every open deal
 *   approved_last_12_months   won, closed within the 12 months before the meeting
 *   older_summary             one line counting closed deals older than that, by outcome
 * Closed-lost and abandoned deals from the last 12 months are not listed at all.
 * A closed deal's date is its close date, else its last modification; one with
 * neither counts as older.
 */
export function groupDeals(deals, meetingDate) {
  const meeting = meetingDate || new Date().toISOString().slice(0, 10);
  const cutoff = (() => { const d = new Date(`${meeting}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const open_pending = [];
  const approved_last_12_months = [];
  const older = { approved: 0, lost: 0, abandoned: 0 };
  for (const d of deals) {
    if (!d.closed) { open_pending.push(d); continue; }
    const when = String(d.close_date || d.last_modified || '').slice(0, 10);
    const recent = when && when >= cutoff;
    if (recent) { if (d.won) approved_last_12_months.push(d); continue; }
    older[outcomeOf(d)] += 1;
  }
  const parts = [older.approved && `${older.approved} approved`, older.lost && `${older.lost} lost`,
    older.abandoned && `${older.abandoned} abandoned`].filter(Boolean);
  return {
    open_pending,
    approved_last_12_months,
    older_summary: parts.length ? `Older than 12 months: ${parts.join(', ')}.` : null
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
  // No calculator session → no calculator fields (gatherDiscovery sets null);
  // with one, the fields are already decoded (decodeCalculator).
  const calc = facts.calculator || {};
  const prospect = calc.session?.prospect || {};
  const provinces = facts.location?.provinces?.length
    ? facts.location.provinces
    : [provinceOf(prospect.province) || provinceOf(prospect.location) || provinceOf(facts.website?.location)].filter(Boolean);
  const industries = facts.industry?.industries?.length
    ? facts.industry.industries
    : canonicalIndustries(facts.website?.industry || '');
  const employees = calc.employees_band ?? (positiveOrNull(facts.company?.employees) != null ? String(positiveOrNull(facts.company.employees)) : null);
  const revenue = calc.revenue_band ?? (positiveOrNull(facts.company?.revenue) != null ? String(positiveOrNull(facts.company.revenue)) : null);
  const profile = {
    company_name: facts.company_name || undefined,
    description: facts.website?.description || prospect.company_description || undefined,
    regions: provinces,
    industries,
    employee_count: employees ?? undefined,
    annual_revenue: revenue ?? undefined,
    business_goals: goalsOf({
      spendOn: calc.spend_on,
      trainingBudget: calc._trainingBudgetMin,
      expansionBudget: calc._expansionBudgetMin,
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

/** Candidates handed to the writer; it drops the ones a known fact rules out and shows at most 5. */
export const ENGINE_CANDIDATES = 8;

/**
 * The engine's picks in AI-review order, round-robin across goal tracks: each
 * track's #1 (tracks in priority order), then each #2, … — so the briefing
 * follows the review's ranking without one goal filling every slot.
 */
export function rankEngineGrants(tracks, keep = () => true) {
  const seen = new Set();
  const out = [];
  const depth = Math.max(0, ...tracks.map(t => (t.selected || []).length));
  for (let rank = 0; rank < depth && out.length < ENGINE_CANDIDATES; rank++) {
    for (const t of tracks) {
      const s = (t.selected || [])[rank];
      if (!s || seen.has(s.grant_id) || !keep(s.name)) continue;
      seen.add(s.grant_id);
      out.push({
        name: s.name, provider: s.provider, goal: t.goal, review_rank: rank + 1, match_strength: s.match_strength,
        eligibility: s.eligibility, reviewed: t.review_status === 'ready',
        reviewer_reason: s.reason || null,
        couldnt_check: (s.requirement_notes || []).map(n => n.text)
      });
      if (out.length >= ENGINE_CANDIDATES) break;
    }
  }
  return out;
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
        return { source: 'engine', note: null, grants: rankEngineGrants(body.tracks || [], keep), costUsd: (Number(body.cost?.total_cents) || 0) / 100 };
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

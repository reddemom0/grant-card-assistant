/**
 * Lead triage — everything the card knows about a lead, gathered once.
 *
 * Three sources, in this order:
 *   1. HubSpot, through leadCrmSnapshot() — the quiet reads in src/tools/hubspot.js
 *      (the ordinary lookups there log the address, the domain and the company
 *      name, which this card must not do).
 *   2. Our own lead-gen session for that email address, which is the only place
 *      the calculator's dollar estimate and tier exist.
 *   3. Our grants table, for up to three programs worth mentioning.
 *
 * Nothing here writes. Nothing here logs a name, an address, a phone number or
 * a company name: every log line is a code or a count. The programs search is
 * given industry words only, never the company name, because that search logs
 * its own query.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { leadCrmSnapshot, listHubSpotOwners } from '../tools/hubspot.js';
import { latestLeadGenSession } from '../database/lead-gen-reads.js';
import { funnelTier, hardStop, phoneDigits } from './lead-parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazily read once per process, like data/chat/space-intros.json.
let owners = null;

function loadOwners() {
  if (owners) return owners;
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, '../../data/cards/lead-owners.json'), 'utf8'));
    owners = {
      calculatorUrl: raw.calculatorUrl || null,
      synonyms: raw.synonyms && typeof raw.synonyms === 'object' ? raw.synonyms : {},
      ignoredTerms: new Set((Array.isArray(raw.ignoredTerms) ? raw.ignoredTerms : []).map(t => String(t).toLowerCase())),
      emails: raw.owners && typeof raw.owners === 'object' ? raw.owners : {}
    };
  } catch (err) {
    console.warn(`⚠️  Lead card settings unreadable — code: ${err?.code || err?.name || 'unknown'}`);
    owners = { calculatorUrl: null, synonyms: {}, ignoredTerms: new Set(), emails: {} };
  }
  return owners;
}

/**
 * The people, which HubSpot industries each covers, and the words that stand
 * for those industries — all derived from data/rates/consultant-routing.json,
 * the file the lead-gen booking links already route through. Nothing about who
 * covers what is written down twice, so the name on a card cannot disagree with
 * the booking link the same lead is sent.
 *
 * Read here rather than through assignConsultant() in
 * src/services/grant-categorization.js: that function falls back to the default
 * consultant for an unknown industry, which on a card would read as a claim
 * about who covers this lead. A suggestion must be silent when it doesn't know.
 */
let consultants = null;

/** Words inside an industry name that could stand for it in a sentence. */
function termsOf(industry, ignored) {
  const lower = String(industry).trim().toLowerCase();
  const words = lower.split(/[^a-z]+/).filter(w => w.length >= 4 && !ignored.has(w));
  return [lower, ...words];
}

function loadConsultants() {
  if (consultants) return consultants;
  const { synonyms, ignoredTerms } = loadOwners();
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, '../../data/rates/consultant-routing.json'), 'utf8'));
    const byKey = new Map();
    const byIndustry = new Map();
    // term → { consultants: Set, industries: [] }, before the ambiguous ones go.
    const draft = new Map();

    for (const [key, person] of Object.entries(raw.consultants || {})) {
      byKey.set(key, { key, name: person.name || null, bookingLink: person.booking_link || null });
      for (const industry of person.industries || []) {
        const name = String(industry).trim();
        byIndustry.set(name.toLowerCase(), key);
        for (const term of termsOf(name, ignoredTerms)) {
          if (!draft.has(term)) draft.set(term, { consultants: new Set(), industries: [] });
          const entry = draft.get(term);
          entry.consultants.add(key);
          if (!entry.industries.includes(name)) entry.industries.push(name);
        }
      }
    }

    // A word two people's industries share cannot decide between them, so it
    // decides nothing ("healthcare" is Healthcare - Dental and
    // Healthcare - Manufacturing, which are different people).
    const terms = new Map();
    let dropped = 0;
    for (const [term, entry] of draft) {
      if (entry.consultants.size !== 1) {
        dropped++;
        continue;
      }
      const [key] = [...entry.consultants];
      // The label reads best as the industry itself when a term means exactly
      // one, and as the word itself when it stands for several.
      const industries = [...entry.industries].sort((a, b) => a.length - b.length);
      terms.set(term, {
        consultant: key,
        industry: industries[0],
        label: entry.industries.length === 1 || industries[0].toLowerCase() === term ? industries[0] : `“${term}” work`
      });
    }

    // Synonyms point at an industry, so they inherit that industry's person and
    // can never introduce a disagreement.
    let unknown = 0;
    for (const [word, industry] of Object.entries(synonyms)) {
      const key = byIndustry.get(String(industry).trim().toLowerCase());
      if (!key) {
        unknown++;
        continue;
      }
      terms.set(String(word).toLowerCase(), { consultant: key, industry: String(industry).trim(), label: String(industry).trim() });
    }

    // Longest first: "clean energy" must be tried before "energy".
    const ordered = [...terms.keys()].sort((a, b) => b.length - a.length);
    consultants = { byKey, byIndustry, terms, ordered };
    console.log(`🧭 Lead consultant terms — industries: ${byIndustry.size}, terms: ${terms.size}, shared and dropped: ${dropped}, synonyms without an industry: ${unknown}`);
  } catch (err) {
    console.warn(`⚠️  Consultant routing file unreadable — code: ${err?.code || err?.name || 'unknown'}`);
    consultants = { byKey: new Map(), byIndustry: new Map(), terms: new Map(), ordered: [] };
  }
  return consultants;
}

/** One consultant's details, by their key in the routing file. */
function consultantByKey(key) {
  const found = key ? loadConsultants().byKey.get(key) : null;
  return found || { key: key || null, name: null, bookingLink: null };
}

/** The public calculator link the card offers, from the data file. */
export function calculatorUrl() {
  return loadOwners().calculatorUrl;
}

/**
 * Who should probably call this lead. A hint, never an assignment.
 *
 * Both paths end at the same file the booking links use, so the card can only
 * ever name the person that lead would be sent to:
 *   1. the lead's HubSpot industry, matched exactly;
 *   2. failing that, a word in the industry's name (or a synonym for one) found
 *      in the industry we hold, the company's name or the message itself.
 * A word that belongs to two people's industries decides nothing.
 *
 * @returns {{label: string|null, industry: string|null, consultant: string|null,
 *   name: string|null, bookingLink: string|null, owner: string|null, matched: boolean,
 *   source: 'routing'|'text'|'none'}}
 */
export function sectorHint({ industry = null, company = null, text = '' } = {}) {
  const { emails } = loadOwners();
  const { byIndustry, terms, ordered } = loadConsultants();
  const found = (key, label, industryName, source) => {
    const person = consultantByKey(key);
    return {
      label,
      industry: industryName,
      consultant: key,
      name: person.name,
      bookingLink: person.bookingLink,
      owner: emails[key] || null,
      matched: Boolean(key),
      source
    };
  };

  // 1. The industry we hold, matched exactly against the routing file.
  const exact = industry ? byIndustry.get(String(industry).trim().toLowerCase()) : null;
  if (exact) return found(exact, String(industry).trim(), String(industry).trim(), 'routing');

  // 2. Otherwise the words we have — with addresses and links taken out first,
  //    so a sector is never read off an email domain ("…@acme-foods.test").
  const prose = String(text || '')
    .replace(/\b[\w.+-]+@[\w.-]+\b/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  const haystack = [industry, company, prose].filter(Boolean).join(' ').toLowerCase();
  if (haystack.trim()) {
    for (const term of ordered) {
      if (!haystack.includes(term)) continue;
      const hit = terms.get(term);
      return found(hit.consultant, hit.label, hit.industry, 'text');
    }
  }

  return found(null, null, null, 'none');
}

/** A HubSpot owner id → that person's name, without logging any of them. */
async function ownerName(ownerId) {
  if (!ownerId) return null;
  const list = await listHubSpotOwners();
  if (!list.success) return null;
  const hit = (list.owners || []).find(o => String(o.id) === String(ownerId));
  return hit ? (hit.fullName || hit.email || null) : null;
}

const FEE_WORDS = /\b(?:too expensive|expensive|fee|fees|price|pricing|cost too|budget too|cheaper|can'?t afford)\b/i;

/**
 * What HubSpot knows, as facts the card can print. Dates stay ISO here; the
 * card formats them.
 */
export async function crmFacts(lead = {}, { text = '' } = {}) {
  const snapshot = await leadCrmSnapshot({
    email: lead.email || null,
    phone: lead.phone || null,
    company: lead.company || null,
    domain: domainOf(lead)
  });

  const contact = snapshot.contact || null;
  const company = snapshot.company || null;
  const deals = snapshot.deals || [];
  const open = deals.filter(d => d.open);
  const lost = deals.filter(d => !d.open && !d.won);
  const won = deals.filter(d => d.won);

  const ownerId = contact?.ownerId || company?.ownerId || null;
  const notFit = lost.find(d => d.lostReason) || null;
  const feeObjection = [notFit?.lostReason, text].some(v => v && FEE_WORDS.test(v));

  return {
    found: Boolean(contact || company),
    foundBy: snapshot.foundBy,
    phoneMatches: snapshot.phoneMatches || 0,
    failed: snapshot.failed || [],
    contact,
    company,
    deals,
    openDeals: open,
    exClient: won.length > 0,
    firstSeen: contact?.createDate || company?.createDate || null,
    lastWon: won[0]?.closeDate || null,
    notFit: notFit ? { reason: notFit.lostReason, program: notFit.program, ownerId: notFit.ownerId } : null,
    feeObjection,
    ownerId,
    ownerName: await ownerName(ownerId)
  };
}

/** The lead's email domain, ignoring the free providers a form fills in. */
const FREE_MAIL = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com',
  'live.com', 'me.com', 'aol.com', 'protonmail.com', 'shaw.ca', 'telus.net']);

export function domainOf(lead = {}) {
  const fromSite = String(lead.website || '').toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
  if (fromSite.includes('.')) return fromSite;
  const at = String(lead.email || '').split('@')[1];
  const domain = at ? at.trim().toLowerCase() : '';
  return domain && !FREE_MAIL.has(domain) ? domain : null;
}

const SOURCE_WORDS = {
  lead_gen: 'from their calculator session',
  hubspot: 'from their calculator answers in HubSpot',
  message: 'from what the message says',
  none: null
};

/**
 * Which tier this lead looks like, and where that came from.
 *
 * The calculator's own session wins, because it is the only source that carries
 * the dollar estimate. Otherwise the contact's calculator answers go through the
 * same funnel rules. A hard stop in the message text beats both.
 *
 * @returns {Promise<{tier: string, reason: string, source: string, sourceWords: string|null,
 *   estimate: number|string|null, revenue: string|number|null, programs: Array}>}
 */
export async function likelyFit(lead = {}, { text = '', contact = null } = {}) {
  const stop = hardStop(text);
  if (stop) {
    return {
      tier: 'not_a_fit', reason: stop.reason, source: 'message',
      sourceWords: SOURCE_WORDS.message, estimate: null, revenue: null, programs: []
    };
  }

  const session = lead.email ? await latestLeadGenSession(lead.email) : null;
  if (session) {
    const prospect = session.prospect || {};
    const facts = {
      revenue: prospect.annual_revenue ?? prospect.revenue ?? prospect.revenue_range ?? null,
      estimate: session.estimate,
      employees: numberOf(prospect.employee_count ?? prospect.employees),
      nonProfit: nonProfitFlag(prospect.industry, prospect.business_type),
      incorporatedOverAYear: yearFlag(prospect.business_age ?? prospect.years_in_business)
    };
    const funnel = funnelTier(facts);
    // The session's own tier is what the widget told the prospect, so it wins
    // over a recomputation from the same answers.
    const tier = session.tier && ['pro', 'starter', 'getgranted', 'not_a_fit'].includes(session.tier)
      ? session.tier
      : funnel.tier;
    return {
      tier,
      reason: tier === funnel.tier ? funnel.reason : 'tier recorded in their calculator session',
      source: 'lead_gen',
      sourceWords: SOURCE_WORDS.lead_gen,
      estimate: session.estimate,
      revenue: facts.revenue,
      programs: (session.programs || []).slice(0, 3).map(programName).filter(Boolean),
      at: session.at || null
    };
  }

  const answers = contact?.calculator;
  if (answers && (answers.revenue || answers.employees)) {
    const funnel = funnelTier({
      revenue: answers.revenue,
      // HubSpot never receives the estimate, so above $500K the funnel lands on
      // "no estimate on file" — which is the honest answer.
      estimate: null,
      employees: answers.employees,
      nonProfit: /non[\s-]?profit/i.test(String(answers.forProfit || '')),
      incorporatedOverAYear: yesNo(answers.existedAYear)
    });
    return {
      tier: funnel.tier, reason: funnel.reason, source: 'hubspot',
      sourceWords: SOURCE_WORDS.hubspot, estimate: null, revenue: answers.revenue, programs: []
    };
  }

  return {
    tier: 'unknown', reason: 'nothing on file', source: 'none',
    sourceWords: null, estimate: null, revenue: null, programs: []
  };
}

const numberOf = (value) => {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const yesNo = (value) => {
  const t = String(value ?? '').trim().toLowerCase();
  if (t === 'yes' || t === 'true') return true;
  if (t === 'no' || t === 'false') return false;
  return undefined;
};

const nonProfitFlag = (industry, businessType) =>
  /non[\s-]?profit|charity|society/i.test(`${industry || ''} ${businessType || ''}`) || undefined;

const yearFlag = (age) => {
  const t = String(age ?? '').toLowerCase();
  if (!t) return undefined;
  if (/less than a year|under a year|<\s*1|months/.test(t)) return false;
  if (/\b(?:1|2|3|4|5|6|7|8|9|\d{2,})\+?\s*(?:years|yrs)\b|more than a year|over a year/.test(t)) return true;
  return undefined;
};

const programName = (p) => {
  if (!p) return null;
  if (typeof p === 'string') return p.slice(0, 80);
  return (p.grant_name || p.name || p.program || null)?.slice(0, 80) || null;
};

/**
 * Up to three programs worth mentioning on the call. Searched on industry and
 * province words only — the search logs its own query, so the company name and
 * the contact's details never reach it.
 */
export async function programsToMention({ industry = null, province = null, activities = null } = {}) {
  const words = [industry, activities].filter(Boolean).join(' ').trim();
  if (!words) return [];
  try {
    // Imported here, not at the top: that module opens a Redis client as it
    // loads, and every process that renders a card would pay for it.
    const { searchGetGranted } = await import('../tools/getgranted-search.js');
    const res = await searchGetGranted({
      query: words.slice(0, 120),
      regions: province ? [province] : [],
      limit: 3,
      open_intakes_only: false
    });
    if (!res?.success) return [];
    return (res.grants || []).slice(0, 3).map(g => ({
      name: g.grant_name || null,
      amount: g.grant_amount || null,
      deadline: g.deadline || null,
      url: g.url || null,
      accepting: g.currently_accepting !== false
    })).filter(g => g.name);
  } catch (err) {
    console.warn(`⚠️  Lead programs search failed — code: ${err?.code || err?.name || 'unknown'}`);
    return [];
  }
}

/**
 * One call for the whole card: CRM facts, likely fit, programs and the owner
 * hint. Every part fails soft — a lead card with gaps beats no card.
 *
 * @param {Object} lead - extractLead() result, plus an optional website
 * @param {Object} opts
 * @param {string} [opts.text] - the message the lead came in on
 */
export async function lookupLead(lead = {}, { text = '' } = {}) {
  const crm = await crmFacts(lead, { text });
  const fit = await likelyFit(lead, { text, contact: crm.contact });

  const industry = crm.contact?.calculator?.industry || crm.company?.industry || null;
  const province = crm.company?.province || null;
  const programs = fit.programs.length
    ? fit.programs.map(name => ({ name, amount: null, deadline: null, url: null, accepting: true }))
    : await programsToMention({ industry, province, activities: crm.contact?.calculator?.spendOn });

  // Whoever already owns this contact in HubSpot beats any suggestion of ours.
  const hint = crm.ownerName
    ? { label: 'HubSpot owner', consultant: null, name: crm.ownerName, bookingLink: null, owner: null, matched: true, source: 'hubspot' }
    : sectorHint({ industry, company: lead.company, text });

  console.log(`🧭 Lead lookup — crm: ${crm.found ? 'hit' : 'miss'}, fit: ${fit.tier}, source: ${fit.source}, programs: ${programs.length}, owner: ${hint.source}`);

  return {
    lead: { ...lead, digits: phoneDigits(lead.phone), domain: domainOf(lead) },
    crm,
    fit,
    programs,
    ownerHint: hint,
    industry,
    calculatorUrl: calculatorUrl()
  };
}

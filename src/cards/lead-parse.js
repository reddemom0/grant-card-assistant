/**
 * Lead triage — reading an inbound lead from a message, and the funnel rules.
 * Pure functions, no I/O, no model.
 *
 * Nothing here logs: the input is message text, and a lead's text carries a
 * name, an email address and a phone number.
 */

// ============================================================================
// TRIGGER
// ============================================================================

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/;
// North American shapes: (604) 555-1212, 604-555-1212, 6045551212, +1 604 555 1212.
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const CUES = /\b(?:called in|called us|call(?:ed)? back|voicemail|left a (?:message|vm)|lead from|new lead|inbound(?: lead)?|reached out|got in touch|enquir(?:y|ies)|inquir(?:y|ies)|filled (?:in|out) (?:the )?(?:form|calculator)|contact form|referral from|wants a quote)\b/i;
const QUESTION = /\?\s*$/;
// Being asked outright. The details may be in the message before this one — in
// a DM they usually are — so this counts on its own.
const ASKED = /\btriage\b|\b(?:look at|check|qualify) (?:this|that|the) (?:lead|enquiry|inquiry|prospect)\b/i;

/**
 * Does this @Oracle message look like an inbound lead?
 * @returns {'lead'|'maybe'|null} null → answer normally
 */
export function leadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const details = EMAIL.test(t) || PHONE.test(t);
  const cues = CUES.test(t);
  if (ASKED.test(t)) return 'lead';
  if (details && cues) return 'lead';
  if ((details || cues) && !QUESTION.test(t)) return 'maybe';
  return null;
}

const LABEL = (name) => new RegExp(`(?:^|\\n|[;,·|:])\\s*${name}\\s*[:\\-–]\\s*([^\\n;|·]+)`, 'i');
const NAME_BEFORE_CUE = /\b([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})\s+(?:called|phoned|emailed|reached out|left a)/u;
// A company name after "from"/"at"/"with". Words carry no full stop, so the
// name cannot run past a sentence end ("… from Acme Foods Inc. Reach her at …").
const CO_WORD = "[A-Z][\\w&'\u2019-]*";
const CO_SUFFIX = 'Inc|Ltd|LLC|Corp|Co|Limited|Holdings|Group|Technologies|Foods|Metalworks';
const COMPANY_AFTER = new RegExp(
  `\\b(?:from|at|with)\\s+(${CO_WORD}(?:\\s+(?:${CO_WORD}|of|and|the))*(?:\\s+(?:${CO_SUFFIX}))?\\.?)`
);

const clean = (v, max = 120) => {
  const s = String(v || '').replace(/\s+/g, ' ').trim().replace(/[.,;]$/, '');
  return s ? s.slice(0, max) : null;
};

/**
 * The contact details a lead message carries. Labelled fields win, then the
 * email and phone patterns, then a name next to a cue and a company after
 * "from"/"at".
 * @returns {{name: string|null, email: string|null, phone: string|null, company: string|null}}
 */
export function extractLead(text) {
  const t = String(text || '');
  const labelled = (name) => clean(LABEL(name).exec(t)?.[1]);
  const email = labelled('email') || clean(EMAIL.exec(t)?.[0], 200);
  const phone = labelled('phone') || labelled('tel') || clean(PHONE.exec(t)?.[0], 40);
  const name = labelled('name') || labelled('contact') || clean(NAME_BEFORE_CUE.exec(t)?.[1]);
  const company = labelled('company') || labelled('business') || clean(COMPANY_AFTER.exec(t)?.[1]);
  return { name, email, phone, company };
}

/** Digits only, for matching a phone number against a CRM. */
export function phoneDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

const TYPED = [
  { kind: 'assign', re: /^\s*assign\b/i },
  { kind: 'called', re: /^\s*called\s*[:—-]\s*([\s\S]+)$/i },
  { kind: 'outcome', re: /^\s*outcome\s*[:—-]\s*([\s\S]+)$/i },
  // Chat clients turn "I'll" into "I’ll", so both apostrophes count.
  { kind: 'callback', re: /^\s*(?:i(?:['’]ll| will)? call(?: them)? back|calling back|my callback)\b/i }
];

/**
 * A typed stand-in for one of the card's pickers.
 * @returns {{kind: 'assign'|'called'|'outcome'|'callback', text?: string}|null}
 */
export function typedLeadCommand(text) {
  for (const { kind, re } of TYPED) {
    const m = re.exec(String(text || ''));
    if (!m) continue;
    const rest = clean(m[1], 200);
    if ((kind === 'called' || kind === 'outcome') && !rest) return null;
    return rest ? { kind, text: rest } : { kind };
  }
  return null;
}

/** The four outcomes the card offers, from a typed phrase. */
export const OUTCOMES = {
  booked: { key: 'booked', label: 'Booked discovery' },
  calculator: { key: 'calculator', label: 'Sent calculator' },
  not_a_fit: { key: 'not_a_fit', label: 'Not a fit' },
  no_answer: { key: 'no_answer', label: 'No answer' }
};

export function outcomeFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/\bbook(?:ed|ing)?\b|\bdiscovery\b|\bmeeting\b/.test(t)) return OUTCOMES.booked;
  if (/\bcalculator\b|\bestimate\b|\blink\b/.test(t)) return OUTCOMES.calculator;
  if (/\bnot a fit\b|\bnot fit\b|\bno fit\b|\bdecline/.test(t)) return OUTCOMES.not_a_fit;
  if (/\bno answer\b|\bvoicemail\b|\bno reply\b|\bmissed\b/.test(t)) return OUTCOMES.no_answer;
  return null;
}

// ============================================================================
// FIT
// ============================================================================

const HARD_STOPS = [
  { key: 'sole_proprietor', reason: 'sole proprietor', re: /\bsole[\s-]?prop(?:rietor|rietorship)?\b|\bself[\s-]employed\b|\bno incorporation\b/i },
  { key: 'pre_revenue', reason: 'pre-revenue', re: /\bpre[\s-]?revenue\b|\bno revenue (?:yet|so far)\b|\bnot earning yet\b/i },
  { key: 'non_profit', reason: 'non-profit', re: /\bnon[\s-]?profit\b|\bnot[\s-]for[\s-]profit\b|\bcharity\b|\bsociety\b/i },
  { key: 'too_new', reason: 'incorporated less than a year', re: /\b(?:incorporated|registered|started)\s+(?:last month|this month|a few months ago|in the last year)\b|\bless than a year old\b|\bjust incorporated\b/i }
];

/**
 * A reason this lead is very unlikely to fit, read from the message.
 * "Startup" on its own is not one — plenty of clients call themselves that.
 * @returns {{key: string, reason: string}|null}
 */
export function hardStop(text) {
  for (const stop of HARD_STOPS) {
    if (stop.re.test(String(text || ''))) return { key: stop.key, reason: stop.reason };
  }
  return null;
}

const MILLION = 1_000_000;

/** A revenue band or amount, in dollars, from HubSpot's or the widget's wording. */
export function revenueAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const t = String(value).toLowerCase().replace(/,/g, '');
  if (/pre[\s-]?revenue/.test(t)) return 0;
  const numbers = [...t.matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m|million|thousand)?/g)].map(m => {
    const n = Number(m[1]);
    const unit = m[2] || '';
    if (/^k|thousand/.test(unit)) return n * 1_000;
    if (/^m|million/.test(unit)) return n * MILLION;
    return n;
  }).filter(n => Number.isFinite(n) && n > 0);
  if (!numbers.length) return 0;
  // A band ("$500K to $2.5 million") is judged by its lower bound.
  return Math.min(...numbers);
}

/** An estimate in dollars, from "$18,000", "18k", or a number. */
export function estimateAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const amount = revenueAmount(value);
  return amount === 0 && !/0/.test(String(value)) ? null : amount;
}

/**
 * Your funnel, exactly as briefed. Needs revenue and (above $500K) an estimate.
 *
 * @param {Object} facts
 * @param {number|string} [facts.revenue]
 * @param {number|string} [facts.estimate]
 * @param {number} [facts.employees]
 * @param {boolean} [facts.nonProfit]
 * @param {boolean} [facts.incorporatedOverAYear]
 * @returns {{tier: 'pro'|'starter'|'getgranted'|'not_a_fit'|'unknown', reason: string}}
 */
export function funnelTier(facts = {}) {
  const revenue = revenueAmount(facts.revenue);
  const estimate = estimateAmount(facts.estimate);
  const employees = Number.isFinite(facts.employees) ? facts.employees : null;

  if (facts.nonProfit) return { tier: 'not_a_fit', reason: 'non-profit' };
  if (facts.incorporatedOverAYear === false) return { tier: 'not_a_fit', reason: 'incorporated less than a year' };
  if (employees !== null && employees < 2) return { tier: 'not_a_fit', reason: 'under two employees' };
  if (revenue === 0) return { tier: 'not_a_fit', reason: 'pre-revenue' };
  if (revenue === null) return { tier: 'unknown', reason: 'no revenue on file' };

  if (revenue >= 5 * MILLION) return { tier: 'pro', reason: '$5M+ revenue' };
  if (estimate === null) return { tier: 'unknown', reason: 'no estimate on file' };

  if (revenue >= 2.5 * MILLION) {
    if (estimate >= 30_000) return { tier: 'pro', reason: '$2.5M–$5M revenue, estimate $30K+' };
    if (estimate >= 15_000) return { tier: 'starter', reason: '$2.5M–$5M revenue, estimate $15K–$29K' };
    return { tier: 'getgranted', reason: '$2.5M–$5M revenue, estimate under $15K' };
  }
  // Both bands below $2.5M split at the same figure, and a band is read by its
  // lower bound, so the two cannot be told apart from the amount alone — the
  // reason says what is certain.
  return estimate >= 15_000
    ? { tier: 'starter', reason: 'under $2.5M revenue, estimate $15K+' }
    : { tier: 'getgranted', reason: 'under $2.5M revenue, estimate under $15K' };
}

export const TIER_WORDS = {
  pro: 'Pro',
  starter: 'Starter',
  getgranted: 'Get Granted',
  not_a_fit: 'Not a fit',
  unknown: 'Tier unknown'
};

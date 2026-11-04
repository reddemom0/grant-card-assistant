/**
 * Booking-link routing for lead-gen finalization.
 *
 * Resolves prospect-facing booking links based on best_fit_product (the AI's
 * computed routing decision) and industry (for Pro/Waitlist consultant routing).
 *
 * Routing matrix (authoritative — see CONSULTANT-ROUTING-JSON-REWRITE / Apr 2026):
 *   Granted Pro      → industry-routed via consultant-routing.json (Ruk or Steph)
 *   Waitlist         → industry-routed (same as Pro)
 *   Granted Pro Lite → NATALIE_INTRO_LINK
 *   Unknown          → NATALIE_INTRO_LINK
 *   Granted Starter  → null (strip CTA)
 *   Nonprofit        → null (strip CTA)
 *   Get Granted      → null (strip CTA)
 *   Not a Fit        → null (strip CTA)
 *
 * Two surfaces consume this module:
 *   - getBookingLink()       — resolution only (returns {link, source, consultantName}).
 *   - substituteBookingLink() — applied to LLM-generated content (chat or email).
 *     Replaces the {{BOOKING_LINK}} sentinel with the routed URL, or strips the
 *     surrounding CTA for null-link tiers. Hard-fails on missing routing data
 *     instead of silently falling back, so wrong-consultant routing is loud.
 */

import { assignConsultant } from '../services/grant-categorization.js';
import { BOOKING_HOST_PATTERN, BOOKING_URL_PATTERN } from '../utils/booking-urls.js';

export const NATALIE_INTRO_LINK = 'https://meetings.hubspot.com/natalie392/15min-intro-to-granted';

export const BOOKING_LINK_SENTINEL = '{{BOOKING_LINK}}';

/**
 * Thrown when substituteBookingLink cannot resolve a routed URL but the input
 * text requires one (sentinel present, or pre-sentinel hardcoded URL present
 * in an industry-routed tier with no industry on the lead).
 *
 * Hard-fail is intentional: routing the wrong consultant or shipping a literal
 * placeholder both have real commercial cost; loud failure is preferable to
 * a silent fallback to Natalie.
 */
export class BookingLinkRoutingError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'BookingLinkRoutingError';
    this.context = context;
  }
}

// 'Granted Starter' is here by product policy, not by accident: Starter is a
// self-serve tier and must never be offered a call. Prospects are directed to
// granted.ca/granted-starter instead. Enforcing it here rather than in the
// prompt alone means a model slip is stripped rather than delivered — the
// prompt is advisory, this is not.
//
// 'Nonprofit' is here by product decision (2026-11-04): non-profits are never
// offered a call, which is what the prompt has always told them.
const NO_LINK_PRODUCTS = new Set(['Get Granted', 'Not a Fit', 'Granted Starter', 'Nonprofit']);
// Note: 'Waitlist' is included for completeness. computeBestFitProduct
// never returns it — Waitlist is set via HubSpot manual edit or workflows
// only. This branch fires when those external sources route a lead through
// the email-send path with an externally-set best_fit_product.
const INDUSTRY_ROUTED_PRODUCTS = new Set(['Granted Pro', 'Waitlist']);

/**
 * @param {Object} args
 * @param {string} args.best_fit_product - One of: Granted Pro | Granted Pro Lite |
 *        Granted Starter | Get Granted | Nonprofit | Unknown | Not a Fit | Waitlist
 * @param {string} [args.industry] - Widget industry label (only used for Pro/Waitlist).
 *        Must be the raw widget label (e.g. "Manufacturing", "Restaurants/Cafes"),
 *        not a transformed HubSpot enum value.
 * @returns {{link: string|null, consultantName: string|null,
 *            source: 'industry-routed'|'natalie-intro'|'no-link'}}
 */
export function getBookingLink({ best_fit_product, industry } = {}) {
  if (NO_LINK_PRODUCTS.has(best_fit_product)) {
    return { link: null, consultantName: null, source: 'no-link' };
  }

  if (INDUSTRY_ROUTED_PRODUCTS.has(best_fit_product)) {
    if (industry) {
      const consultant = assignConsultant(industry);
      return {
        link: consultant.booking_link,
        consultantName: consultant.name,
        source: 'industry-routed'
      };
    }
    // Pro/Waitlist with missing industry → safest fallback is Natalie intro,
    // not the consultant-routing default. Avoids silently routing to default
    // consultant when we have no signal.
    return { link: NATALIE_INTRO_LINK, consultantName: null, source: 'natalie-intro' };
  }

  // Granted Pro Lite, Unknown, anything unrecognized
  return { link: NATALIE_INTRO_LINK, consultantName: null, source: 'natalie-intro' };
}

const SENTINEL_RE = /\{\{BOOKING_LINK\}\}/g;
// Any booking URL the model wrote against instruction: HubSpot meetings plus
// the other booking hosts in src/utils/booking-urls.js (Calendly, cal.com, …).
const MEETINGS_URL_RE = new RegExp(BOOKING_URL_PATTERN, 'gi');
// Email-mode strip: a single <p>…</p> that contains the sentinel or a booking
// URL. The negative-lookahead `(?:(?!</p>)[\s\S])*?` prevents the non-greedy
// quantifier from greedily crossing a </p> boundary when the matched paragraph
// is preceded by an unrelated <p> block (a naive `[\s\S]*?` would gobble both).
const CTA_PARAGRAPH_RE = new RegExp(
  `<p\\b[^>]*>(?:(?!<\\/p>)[\\s\\S])*?(?:\\{\\{BOOKING_LINK\\}\\}|${BOOKING_HOST_PATTERN})(?:(?!<\\/p>)[\\s\\S])*?<\\/p>\\s*`,
  'gi'
);

// Chat-mode strip for null-link tiers. A link, plus whatever wraps it: a
// markdown link `[text](link)`, an `<a href="link">…</a>`, or `<link>`.
const LINK_ATOM = `(?:\\{\\{BOOKING_LINK\\}\\}|${BOOKING_URL_PATTERN})`;
const WRAPPED_LINK_RE = new RegExp(
  `\\[[^\\]\\n]*\\]\\(\\s*${LINK_ATOM}\\s*\\)` +
  `|<a\\b[^>]*href=["']?${LINK_ATOM}["']?[^>]*>[\\s\\S]*?<\\/a>` +
  `|<${LINK_ATOM}>` +
  `|${LINK_ATOM}`,
  'gi'
);
const LINK_MARK = '\u0000';

/**
 * Remove each booking link from chat text together with the sentence that
 * introduced it, so a no-call tier never shows "book a call here:" with
 * nothing after it.
 *
 * - The sentence holding the link is dropped; others on the line stay.
 *   Sentences end at `.`, `!` or `?` followed by a space.
 * - A line left with no words (a bare bullet, an arrow) is dropped.
 * - If the link stood alone on its line (not as a bullet), a directly
 *   preceding line ending in `:` ("Book a call here:") is dropped too. A list
 *   intro above a bullet that held the link is kept: the other bullets still
 *   belong to it.
 */
function stripLinkSentencesForChat(text) {
  const marked = text.replace(WRAPPED_LINK_RE, LINK_MARK);
  if (!marked.includes(LINK_MARK)) return text;

  const out = [];
  for (const line of marked.split('\n')) {
    if (!line.includes(LINK_MARK)) { out.push(line); continue; }

    const isBullet = /^\s*(?:[-*+•]|\d+[.)])\s/.test(line);
    const linkOnly = !/[\p{L}\p{N}]/u.test(line.split(LINK_MARK).join(''));
    if (linkOnly && !isBullet) {
      // Drop an intro line directly above ("…here:"), skipping blank lines.
      let i = out.length - 1;
      while (i >= 0 && out[i].trim() === '') i--;
      if (i >= 0 && /:\s*$/.test(out[i])) out.splice(i);
      continue;
    }

    const kept = line.split(/(?<=[.!?])\s+/).filter(sentence => !sentence.includes(LINK_MARK)).join(' ');
    if (/[\p{L}\p{N}]/u.test(kept.replace(/^\s*(?:[-*+•]|\d+[.)])\s*/, ''))) {
      out.push(kept.replace(/\s+$/, ''));
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

/**
 * Substitute the {{BOOKING_LINK}} sentinel (and defensively rewrite any
 * hardcoded meetings.hubspot.com URLs the model emitted against instruction)
 * in LLM-generated content with the routed URL for this lead.
 *
 * Sentinel-driven contract:
 *   - text contains sentinel + routing resolves a link → substitute everywhere
 *   - text contains sentinel + routing resolves null (Get Granted / Not a Fit)
 *       → email mode: strip any <p> containing the sentinel or a meetings URL
 *       → chat mode:  strip the sentinel inline, leaving surrounding prose
 *   - text contains sentinel + routing data missing/unresolved for an
 *     industry-routed tier (Pro/Waitlist with no industry) → throw
 *     BookingLinkRoutingError. Hard-fail is intentional.
 *   - text contains no sentinel → fall back to legacy URL-rewrite behavior
 *     (rewrite hardcoded meetings.hubspot.com URLs to the routed link for
 *     non-null tiers; strip CTA paragraphs for null-link tiers). This keeps
 *     pre-sentinel content (Starter emails, in-flight sessions) working.
 *
 * @param {string} text - HTML or plain text emitted by the model
 * @param {Object} routing - { best_fit_product, industry }
 * @param {Object} [opts] - { mode: 'chat' | 'email' }
 * @returns {string} text with sentinel substituted / stripped
 * @throws {BookingLinkRoutingError} when routing data is required but missing
 */
export function substituteBookingLink(text, { best_fit_product, industry } = {}, { mode = 'email' } = {}) {
  if (typeof text !== 'string') return text;

  const hasSentinel = SENTINEL_RE.test(text);
  // Reset regex state — .test() advances lastIndex for /g regexes.
  SENTINEL_RE.lastIndex = 0;

  // Hard-fail: industry-routed tier with missing industry, when the model
  // committed to a sentinel. Returning text-with-sentinel-intact would ship
  // the literal "{{BOOKING_LINK}}" string to the prospect — worse than failure.
  const isIndustryRoutedTier = best_fit_product === 'Granted Pro' || best_fit_product === 'Waitlist';
  if (hasSentinel && isIndustryRoutedTier && !industry) {
    throw new BookingLinkRoutingError(
      `Cannot resolve booking link: best_fit_product="${best_fit_product}" requires industry, but industry is missing`,
      { best_fit_product, industry, mode, reason: 'missing_industry' }
    );
  }

  // Hard-fail: sentinel present but best_fit_product missing entirely. The
  // model emitted the sentinel before the system knew which tier this lead
  // is — also a misbehavior we want loud.
  if (hasSentinel && !best_fit_product) {
    throw new BookingLinkRoutingError(
      `Cannot resolve booking link: best_fit_product is missing`,
      { best_fit_product, industry, mode, reason: 'missing_best_fit_product' }
    );
  }

  const routed = getBookingLink({ best_fit_product, industry });

  if (routed.link) {
    // Non-null tier: substitute sentinel everywhere, and defensively rewrite
    // any hardcoded meetings.hubspot.com URLs that don't match the routed
    // link (covers cases where the prompt was disregarded).
    let out = text.replace(SENTINEL_RE, routed.link);
    if (MEETINGS_URL_RE.test(out)) {
      MEETINGS_URL_RE.lastIndex = 0;
      out = out.replace(MEETINGS_URL_RE, routed.link);
    }
    MEETINGS_URL_RE.lastIndex = 0;
    return out;
  }

  // Null tier (Get Granted / Not a Fit): strip the CTA entirely.
  if (mode === 'email') {
    // Email mode: paragraph-level strip — removes the whole <p>…</p> block
    // containing the sentinel or any hardcoded meetings URL.
    return text.replace(CTA_PARAGRAPH_RE, '');
  }

  // Chat mode: remove each sentinel or booking URL with the sentence that
  // introduced it, leaving the rest of the prose. Chat output isn't reliably
  // wrapped in <p> tags, so paragraph-level stripping isn't safe here.
  return stripLinkSentencesForChat(text);
}

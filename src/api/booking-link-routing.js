/**
 * Booking-link routing for lead-gen finalization.
 *
 * Resolves prospect-facing booking links based on best_fit_product (the AI's
 * computed routing decision) and industry (for Pro/Waitlist consultant routing).
 *
 * Routing matrix (authoritative — see CONSULTANT-ROUTING-JSON-REWRITE / Apr 2026):
 *   Granted Pro      → industry-routed via consultant-routing.json (Ruk or Steph)
 *   Waitlist         → industry-routed (same as Pro)
 *   Granted Starter  → NATALIE_INTRO_LINK
 *   Granted Pro Lite → NATALIE_INTRO_LINK
 *   Nonprofit        → NATALIE_INTRO_LINK
 *   Unknown          → NATALIE_INTRO_LINK
 *   Get Granted      → null (strip CTA from email body)
 *   Not a Fit        → null (strip CTA from email body)
 *
 * Two surfaces consume this module:
 *   - getBookingLink()       — resolution only (returns {link, source, consultantName}).
 *   - substituteBookingLink() — applied to LLM-generated content (chat or email).
 *     Replaces the {{BOOKING_LINK}} sentinel with the routed URL, or strips the
 *     surrounding CTA for null-link tiers. Hard-fails on missing routing data
 *     instead of silently falling back, so wrong-consultant routing is loud.
 */

import { assignConsultant } from '../services/grant-categorization.js';

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

const NO_LINK_PRODUCTS = new Set(['Get Granted', 'Not a Fit']);
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

  // Granted Starter, Granted Pro Lite, Nonprofit, Unknown, anything unrecognized
  return { link: NATALIE_INTRO_LINK, consultantName: null, source: 'natalie-intro' };
}

const SENTINEL_RE = /\{\{BOOKING_LINK\}\}/g;
const MEETINGS_URL_RE = /https:\/\/meetings\.hubspot\.com\/[^\s"'<>]+/g;
// Email-mode strip: a single <p>…</p> that contains the sentinel or a meetings
// URL. The negative-lookahead `(?:(?!</p>)[\s\S])*?` prevents the non-greedy
// quantifier from greedily crossing a </p> boundary when the matched paragraph
// is preceded by an unrelated <p> block (a naive `[\s\S]*?` would gobble both).
const CTA_PARAGRAPH_RE = /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?(?:\{\{BOOKING_LINK\}\}|meetings\.hubspot\.com)(?:(?!<\/p>)[\s\S])*?<\/p>\s*/gi;

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

  // Chat mode: surgical inline strip — remove the sentinel and any hardcoded
  // meetings URL, leaving surrounding prose. Chat output isn't reliably
  // wrapped in <p> tags, so paragraph-level stripping isn't safe here.
  let out = text.replace(SENTINEL_RE, '');
  if (MEETINGS_URL_RE.test(out)) {
    MEETINGS_URL_RE.lastIndex = 0;
    out = out.replace(MEETINGS_URL_RE, '');
  }
  MEETINGS_URL_RE.lastIndex = 0;
  return out;
}

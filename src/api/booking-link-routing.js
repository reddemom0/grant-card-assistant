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
 */

import { assignConsultant } from '../services/grant-categorization.js';

export const NATALIE_INTRO_LINK = 'https://meetings.hubspot.com/natalie392/15min-intro-to-granted';

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

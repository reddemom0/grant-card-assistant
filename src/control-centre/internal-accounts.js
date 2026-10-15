/**
 * Internal accounts (companies.id): Granted staff and test companies,
 * confirmed by Chris. Their data is KEPT everywhere — this list only labels it.
 *
 *   - Usage tiles count them, with a sub-line saying how much came from them.
 *   - Anywhere a company is named, it carries an "Internal" tag.
 *   - Grant lists and trends (movers, most matched, most popular, shifting
 *     trends) leave them out by default; the page's "Include internal
 *     accounts" toggle puts them back. A staff member re-editing a test
 *     profile all week makes grants "move" for no client reason.
 *
 * Add an id only after Chris confirms it. The evidence for each is in
 * docs/control-centre.md ("Internal accounts").
 */

// Confirmed by Chris 2026-10-15. Names are as on that day, for reading only.
export const INTERNAL_COMPANY_IDS = Object.freeze([
  1, //   Med tech in AB — staff (sysadm/staff sessions), very high activity
  5, //   Cedar Labs 2 — staff (sysadm sessions), very high activity
  7, //   Granted
  8, //   Research Test Company
  9, //   Testing Strategy
  10, //  Granted Consulting
  11, //  Example123
  13, //  Test123
  15, //  Granted Consulting
  18, //  Nats Test Company
  20, //  Research Test1
  23, //  Research Test2
  24, //  Nats Test Company — staff (sysadm sessions)
  25, //  This is Natalie's Beta 1 Test
  27, //  Research Test3
  33, //  Test Company
  34, //  Test Company
  35, //  Test Company
  48, //  Small Point Consulting — staff sessions, very high activity
  50, //  Research Test12
  51, //  Fadi's company — staff sessions
  58, //  Nats big test
  71, //  CL Test
  73, //  Jades Testing Company
  81, //  Maximizer — staff test account; profile re-edited repeatedly (2026-10)
  82, //  Erics Antique Treasures — very high activity, created with Maximizer
  85, //  CL Test
  126 //  LouLouFry Testing
]);

const INTERNAL = new Set(INTERNAL_COMPANY_IDS);

export function internalCompanySet(ids = INTERNAL_COMPANY_IDS) {
  return new Set(ids.map(Number));
}

/** True for a confirmed internal account. Accepts a number or a digit string. */
export function isInternalCompany(companyId) {
  return companyId != null && INTERNAL.has(Number(companyId));
}

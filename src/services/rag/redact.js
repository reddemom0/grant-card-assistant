/**
 * Granted Files RAG — ID-number stripping (regex only, before chunking)
 *
 * Replaces Social Insurance Numbers, payment card numbers and labelled bank
 * account / transit / institution numbers with [REDACTED-SIN], [REDACTED-CARD]
 * and [REDACTED-BANK]. Names, roles and amounts stay. Returns counts only:
 * callers must never log the matched values.
 *
 * Deliberately narrow, so numeric spreadsheets aren't shredded:
 * - a bare 9-digit number is a SIN only if Luhn-valid, standing alone, and not a
 *   CRA Business Number (BNs are 9 digits too, can pass Luhn, and are useful text);
 * - a card number counts only when separator-formatted (4-4-4-4, Amex 4-6-5) or
 *   labelled, never as an ungrouped 13–19 digit run;
 * - bank numbers count only when labelled, and account numbers need 5+ digits
 *   so 4-digit general-ledger codes ("Account 4000 – Revenue") survive.
 */

export const SIN_TOKEN = '[REDACTED-SIN]';
export const CARD_TOKEN = '[REDACTED-CARD]';
export const BANK_TOKEN = '[REDACTED-BANK]';

/** Luhn checksum over a string of digits. */
export function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const digitsOf = (s) => s.replace(/\D/g, '');

// A number standing alone: no digit, decimal point, digit-comma or digit-hyphen
// joined to it ("1,123456789", "123456789.50", "1-123456789" don't qualify). A
// comma alone is a CSV cell boundary, so "Name,046454286,Manager" still counts.
const ALONE_BEFORE = '(?<![\\d.]|\\d[,-])';
const ALONE_AFTER = '(?!\\d|\\.\\d|-\\d)';

// Labelled values: "SIN: 123 456 789", "Social Insurance No. 123-456-789".
const SIN_LABEL = /\b(?:S\.?I\.?N\.?|Social\s+Insurance\s+(?:Number|No\.?|#))(?:\s*(?:#|No\.?|Number))?\s*[:#,]?\s*(\d{3}[ -]?\d{3}[ -]?\d{3})(?!\d)/gi;

// Bare SIN candidates: 9 digits, ungrouped or grouped 3-3-3 with one consistent separator.
const SIN_BARE = new RegExp(`${ALONE_BEFORE}\\b(\\d{3}([ -]?)\\d{3}\\2\\d{3})\\b${ALONE_AFTER}(?![A-Za-z])`, 'g');

// BN context: a program-account suffix right after ("123456789 RT0001") or a BN label just before.
const BN_SUFFIX = /^\s*(?:RT|RC|RP|RR|RZ|RM)\s*\d{4}/i;
const BN_LABEL = /\b(?:BN|B\.N\.|Business\s+(?:Number|No\.?|#)|CRA\s+(?:Number|No\.?|#))\W{0,3}[^\n]{0,20}$/i;

// Cards: formatted groups (same separator throughout), or a label followed by 13–19 digits.
const CARD_FORMATTED = new RegExp(`${ALONE_BEFORE}\\b(\\d{4}([ -])\\d{4}\\2\\d{4}\\2\\d{4}|\\d{4}([ -])\\d{6}\\3\\d{5})\\b${ALONE_AFTER}`, 'g');
const CARD_LABEL = /\b(?:card\s*(?:number|no\.?|#)|credit\s+card|debit\s+card|visa|master\s?card|amex|american\s+express)\b[^\d\n]{0,15}((?:\d[ -]?){12,18}\d)(?!\d)/gi;

// Bank: labelled only. Transit 5 digits, institution 3, account 5–17.
const TRANSIT_LABEL = /\b(transit)(?:\s*(?:#|no\.?|number))?\s*[:#,]?\s*(\d{5})(?!\d)/gi;
const INSTITUTION_LABEL = /\b(institution|inst\.?)(?:\s*(?:#|no\.?|number))?\s*[:#,]?\s*(\d{3})(?!\d)/gi;
const ACCOUNT_LABEL = /\b((?:bank\s+)?account\s*(?:#|no\.?|number)|acct\.?\s*(?:#|no\.?|number)?|bank\s+account)\s*[:#,]?\s*(\d(?:[ -]?\d){4,16})(?![\d])/gi;

/**
 * Strip ID numbers from text.
 * @param {string} text
 * @returns {{text: string, counts: {sin: number, card: number, bank: number}}}
 */
export function redact(text) {
  const counts = { sin: 0, card: 0, bank: 0 };
  if (!text) return { text: text || '', counts };
  let out = String(text);

  // Labelled first, so a labelled value is never re-examined by the bare rules.
  out = out.replace(SIN_LABEL, (m, value) => { counts.sin++; return m.slice(0, m.length - value.length) + SIN_TOKEN; });
  out = out.replace(CARD_LABEL, (m, value) => { counts.card++; return m.slice(0, m.length - value.length) + CARD_TOKEN; });
  for (const re of [TRANSIT_LABEL, INSTITUTION_LABEL, ACCOUNT_LABEL]) {
    out = out.replace(re, (m, _label, value) => { counts.bank++; return m.slice(0, m.length - value.length) + BANK_TOKEN; });
  }

  out = out.replace(CARD_FORMATTED, (m) => {
    if (!luhn(digitsOf(m))) return m;
    counts.card++;
    return CARD_TOKEN;
  });

  out = out.replace(SIN_BARE, (m, _v, _sep, offset, whole) => {
    const digits = digitsOf(m);
    if (!luhn(digits)) return m;
    if (BN_SUFFIX.test(whole.slice(offset + m.length, offset + m.length + 12))) return m;
    if (BN_LABEL.test(whole.slice(Math.max(0, offset - 30), offset))) return m;
    counts.sin++;
    return SIN_TOKEN;
  });

  return { text: out, counts };
}

/** Add one counts object into another (for per-file totals). */
export function addCounts(total, more) {
  total.sin += more.sin;
  total.card += more.card;
  total.bank += more.bank;
  return total;
}

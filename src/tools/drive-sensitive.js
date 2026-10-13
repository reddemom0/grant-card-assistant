/**
 * Granted's own HR / finance / legal material — the one shared list.
 *
 * Used by the Drive move/rename tool (src/tools/drive-actions.js) to refuse any
 * file whose name, new name, or current folder path looks like Granted's own
 * sensitive material, and any file owned by the finance accounts. Generic terms
 * only: no file names, IDs or people's names.
 *
 * Strict by decision (DECISIONS.md, 2026-10-13): a client's "Financial
 * Statement-…" matches too and is moved by hand.
 */

export const SENSITIVE_TERMS = Object.freeze([
  'Finance', 'Financial', 'Financial Statements', 'Accounting', 'Bookkeeping',
  'Payroll', 'HR', 'Human Resources', 'Recruitment', 'Legal', 'Compensation',
  'P&L', 'Profit and Loss', 'T4', 'PD4', 'CPP', 'EI', 'tax deduction', 'Salary',
  'Offer Letter', 'Performance Review', 'Remote Work Request', 'Payslip'
]);

/** Accounts whose files are never moved (local part, @granted.ca). */
export const EXCLUDED_OWNERS = Object.freeze(['tomliao', 'payment']);

// Lowercase, and treat - _ . / & and any other punctuation as word breaks.
// "P&L" therefore becomes "p l", matched as the two words in sequence.
const words = (text) => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const TERM_WORDS = SENSITIVE_TERMS.map(term => ({ term, words: words(term) }));

/**
 * The first sensitive term found as whole words in `text`, or null.
 * "HR" matches "HR Policies" and "2026-HR-plan" but not "Three".
 */
export function matchSensitive(text) {
  const w = words(text);
  for (const { term, words: tw } of TERM_WORDS) {
    for (let i = 0; i + tw.length <= w.length; i++) {
      if (tw.every((t, j) => w[i + j] === t)) return term;
    }
  }
  return null;
}

/** Is this email one of the excluded finance accounts? */
export function isExcludedOwner(email) {
  const m = /^([^@\s]+)@granted\.ca$/i.exec(String(email || '').trim());
  return Boolean(m && EXCLUDED_OWNERS.includes(m[1].toLowerCase()));
}

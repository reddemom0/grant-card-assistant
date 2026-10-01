/**
 * GetGranted Pulse: the errors sheet — one row per issue, kept by the morning
 * roundup (pulse-roundup.js) and edited by people.
 *
 *   A Issue | B First seen | C Last seen | D Count | E Example clients |
 *   F Likely owner | G Status | H Notes | I Source        (row 1 is the header)
 *
 * The sheet is created by hand; its id is PULSE_ERRORS_SHEET_ID. Oracle writes
 * as PULSE_SHEET_OWNER_EMAIL's stored Google login (the Hub sign-in grants the
 * spreadsheets scope), resolved like the HubSpot webhook user: an active users
 * row, or nothing — there is no fallback account.
 *
 * Status (G) and Notes (H) belong to people: a matched row has only C–E
 * written (Last seen, Count added to, Example clients); a new issue is
 * appended with Status "new" and Source "Oracle-detected".
 *
 * Logs carry codes and counts only.
 */

export const SHEET_ENV = 'PULSE_ERRORS_SHEET_ID';
export const OWNER_ENV = 'PULSE_SHEET_OWNER_EMAIL';
export const MAX_EXAMPLE_CLIENTS = 5;
const TZ = 'America/Vancouver';

export const sheetUrl = (sheetId) => `https://docs.google.com/spreadsheets/d/${sheetId}`;

/** YYYY-MM-DD in Vancouver. */
export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * The person whose Google login writes the sheet.
 * @returns {Promise<{ok: true, userId: number}|{ok: false, code: string}>}
 */
export async function resolveSheetOwner(env = process.env, runQuery) {
  const email = String(env[OWNER_ENV] || '').trim();
  if (!email) return { ok: false, code: 'owner_not_configured' };
  const r = await runQuery(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true AND google_refresh_token IS NOT NULL',
    [email]
  );
  return r.rows[0] ? { ok: true, userId: r.rows[0].id } : { ok: false, code: 'owner_not_found' };
}

const cell = (row, i) => String(row?.[i] ?? '').trim();

/** "a, b, c" → ['a', 'b', 'c'] */
const splitClients = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

/**
 * Existing issue rows, with their sheet row numbers.
 * @param {(userId, args) => Promise<{success: boolean, data?: {values: any[][]}}>} read - readSheetRange
 * @returns {Promise<{ok: true, rows: Object[]}|{ok: false, code: string}>}
 */
export async function readIssueRows({ sheetId, userId, read }) {
  const r = await read(userId, { spreadsheet_id: sheetId, range: 'A2:I' });
  if (!r?.success) return { ok: false, code: 'read_failed' };
  const rows = [];
  (r.data?.values || []).forEach((v, i) => {
    const name = cell(v, 0);
    if (!name) return;
    rows.push({
      row: i + 2,
      name,
      firstSeen: cell(v, 1),
      lastSeen: cell(v, 2),
      count: Number(cell(v, 3)) || 0,
      clients: splitClients(cell(v, 4)),
      owner: cell(v, 5),
      status: cell(v, 6),
      notes: cell(v, 7),
      source: cell(v, 8)
    });
  });
  return { ok: true, rows };
}

/** Text Sheets would read as a formula (=, +, -, @) is written as plain text. */
export const safeText = (s) => (/^[=+\-@]/.test(String(s ?? '')) ? `'${s}` : String(s ?? ''));

export function mergeClients(existing = [], added = [], cap = MAX_EXAMPLE_CLIENTS) {
  const out = [];
  for (const c of [...existing, ...added]) if (c && !out.includes(c) && out.length < cap) out.push(c);
  return out;
}

export const isBeingFixed = (status) => /being fixed/i.test(String(status || ''));

/**
 * Write today's issues. Each issue: {name, count, clients: string[], owner, existingRow?}.
 * Two issues matched to the same row are added to it together.
 *
 * @returns {Promise<{updated: number, appended: number, failed: number, issues: Object[]}>}
 *   issues come back with seenBefore / beingFixed set from the row they matched
 */
export async function writeIssues({ issues, rows, sheetId, userId, today, update, append }) {
  const byRow = new Map(rows.map(r => [r.row, r]));
  const touched = new Map();          // row number → { count, clients }
  const fresh = [];
  const out = issues.map(issue => {
    const row = issue.existingRow ? byRow.get(issue.existingRow) : null;
    if (!row) {
      fresh.push(issue);
      return { ...issue, existingRow: null, seenBefore: false, beingFixed: false };
    }
    const t = touched.get(row.row) || { count: 0, clients: [] };
    t.count += issue.count;
    t.clients = mergeClients(t.clients, issue.clients, Infinity);
    touched.set(row.row, t);
    return { ...issue, seenBefore: true, beingFixed: isBeingFixed(row.status) };
  });

  let updated = 0;
  let failed = 0;
  for (const [rowNumber, t] of touched) {
    const row = byRow.get(rowNumber);
    // C–E only: Status and Notes are never written.
    const r = await update(userId, {
      spreadsheet_id: sheetId,
      range: `C${rowNumber}:E${rowNumber}`,
      values: [[today, row.count + t.count, safeText(mergeClients(row.clients, t.clients).join(', '))]]
    });
    if (r?.success) updated += 1; else failed += 1;
  }

  let appended = 0;
  if (fresh.length) {
    const r = await append(userId, {
      spreadsheet_id: sheetId,
      range: 'A:I',
      values: fresh.map(i => [
        safeText(i.name), today, today, i.count, safeText(mergeClients([], i.clients).join(', ')), safeText(i.owner),
        'new', '', 'Oracle-detected'
      ])
    });
    if (r?.success) appended = fresh.length; else failed += 1;
  }
  return { updated, appended, failed, issues: out };
}

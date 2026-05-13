/**
 * check_marketing_calendar tool
 *
 * Wraps read_sheet_range against the Marketing/Ops Calendar Sheet so Oracle
 * can answer "is X on the calendar?" without inferring Sheet ID, tab names,
 * A1 ranges, and prefix-parsing logic from prose. Same fix-shape rationale
 * as check_blog_coverage (May 12 build): wrapped tools fire reliably where
 * inference-heavy raw tools get skipped.
 *
 * Schema lives in src/tools/definitions.js (ORACLE_TOOLS); this file is
 * implementation only — no orphan schema export.
 *
 * Auth: per-user OAuth via getSheetsClient (matches read_sheet_range path).
 */

import { google } from 'googleapis';
import { getUserOAuth2Client } from './google-docs.js';

const SHEET_ID = '1QdnkahdfEx18HCBj6Ky1Eb-akB-KAlEwFVcsYOsMshQ';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const PREFIXES = ['Webinar', 'Blog', 'Email', 'Linkedin'];

function defaultMonths(today = new Date()) {
  const i = today.getMonth();
  return [MONTHS[i], MONTHS[(i + 1) % 12]];
}

function resolveMonths(monthArg) {
  if (!monthArg) return defaultMonths();
  if (monthArg === 'all') return [...MONTHS];
  // Accept any case; map to canonical capitalized month name.
  const canonical = MONTHS.find(m => m.toLowerCase() === String(monthArg).toLowerCase());
  if (!canonical) return null;
  return [canonical];
}

function parseEntries(values, tabName, contentTypeFilter, topicFilter) {
  // values is a 2D array of cells from the Sheet API.
  // Scan every cell; match those starting with one of the four type prefixes.
  const out = [];
  if (!Array.isArray(values)) return out;

  const topicLower = topicFilter ? topicFilter.toLowerCase() : null;

  for (let row = 0; row < values.length; row++) {
    const cells = values[row];
    if (!Array.isArray(cells)) continue;
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];
      if (typeof cell !== 'string') continue;
      const trimmed = cell.trim();
      if (!trimmed) continue;

      // Match against each known prefix.
      for (const prefix of PREFIXES) {
        const marker = `${prefix}:`;
        // Allow leading whitespace inside the cell and case variation on the prefix.
        const idx = trimmed.toLowerCase().indexOf(marker.toLowerCase());
        if (idx === -1) continue;
        // Treat as a match only if the prefix starts at position 0 (a real entry,
        // not a passing mention inside a longer paragraph).
        if (idx !== 0) continue;

        if (contentTypeFilter && contentTypeFilter !== prefix) continue;

        const entryText = trimmed.slice(marker.length).trim();
        if (topicLower && !entryText.toLowerCase().includes(topicLower)) continue;

        out.push({
          month: tabName,
          content_type: prefix,
          entry: entryText,
          cell: a1Cell(row, col)
        });
        break; // one prefix match per cell
      }
    }
  }
  return out;
}

function a1Cell(rowIdx, colIdx) {
  // Convert zero-indexed (row, col) to A1 notation. Columns: 0 → A, 25 → Z, 26 → AA.
  let col = '';
  let n = colIdx;
  while (true) {
    col = String.fromCharCode(65 + (n % 26)) + col;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return `${col}${rowIdx + 1}`;
}

async function getSheetsClient(userId) {
  const auth = await getUserOAuth2Client(userId);
  return google.sheets({ version: 'v4', auth });
}

export async function checkMarketingCalendar(userId, { topic, content_type, month } = {}) {
  if (content_type && !PREFIXES.includes(content_type)) {
    return {
      success: false,
      error: `content_type must be one of ${PREFIXES.join(', ')}; got "${content_type}"`
    };
  }

  const monthsToScan = resolveMonths(month);
  if (!monthsToScan) {
    return {
      success: false,
      error: `month must be a full month name (e.g., "May"), "all", or omitted; got "${month}"`
    };
  }

  if (!userId) {
    return {
      success: false,
      error: 'userId required for Marketing/Ops Calendar Sheet read (per-user OAuth).'
    };
  }

  let sheets;
  try {
    sheets = await getSheetsClient(userId);
  } catch (err) {
    console.error('❌ check_marketing_calendar auth error:', err.message);
    return { success: false, error: `Google Sheets auth failed: ${err.message}` };
  }

  const entries = [];
  const tabsScanned = [];
  const tabsFailed = [];

  for (const tab of monthsToScan) {
    const range = `${tab}!A:Z`;
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range,
        valueRenderOption: 'FORMATTED_VALUE'
      });
      const values = resp.data.values || [];
      const found = parseEntries(values, tab, content_type, topic);
      entries.push(...found);
      tabsScanned.push(tab);
      console.log(`   📅 check_marketing_calendar: ${tab} → ${found.length} match(es)`);
    } catch (err) {
      tabsFailed.push({ tab, error: err.message });
      console.warn(`   ⚠️ check_marketing_calendar: ${tab} read failed — ${err.message}`);
      // Continue with other tabs; partial results per spec.
    }
  }

  return {
    success: true,
    count: entries.length,
    query: { topic, content_type, month },
    tabs_scanned: tabsScanned,
    ...(tabsFailed.length > 0 ? { tabs_failed: tabsFailed } : {}),
    entries
  };
}

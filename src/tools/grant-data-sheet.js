/**
 * grant_data results sheet
 *
 * Writes a long grant_data result to a NEW Google Sheet in the asker's own
 * Drive, with their own OAuth token (getUserOAuth2Client). One
 * spreadsheets.create call carries everything: an "About" tab first (what was
 * asked, filters, data as of, notes), then one tab per table with a bold,
 * frozen header row.
 *
 * Every cell is a typed value (string or number), so card text is never read
 * as a formula; only link columns are written as HYPERLINK formulas. Nothing
 * here opens or edits an existing file. New private files are deliberately
 * outside the confirmation gate (GATED_TOOLS in pending-actions.js).
 *
 * Failures throw with userMessage set to a plain sentence; runMode in
 * grant-data-modes.js returns it as sheet_error and still answers inline.
 */

import { google } from 'googleapis';
import { getUserOAuth2Client } from './google-docs.js';

const MAX_TAB_TITLE = 100;
const MAX_CELL_CHARS = 50000;

function failure(userMessage, cause) {
  const err = new Error(cause?.message ?? userMessage);
  err.userMessage = userMessage;
  return err;
}

function explain(err) {
  const msg = String(err?.message ?? '');
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.*scope/i.test(msg)) {
    return 'Google Sheets access not granted. Please log out and log in again to refresh your Google permissions, then ask again.';
  }
  if (/not authorized Google|invalid_grant|User not found/i.test(msg)) {
    return 'Your Google account is not connected to the Hub (or the sign-in has expired). Log out and log in again, then ask again.';
  }
  return `The results sheet could not be created (${msg || 'unknown error'}).`;
}

const text = (v) => ({ userEnteredValue: { stringValue: String(v).slice(0, MAX_CELL_CHARS) } });
const quoted = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** One cell. Links become HYPERLINK formulas; everything else a typed value. */
export function cellFor(value, type) {
  if (value == null || value === '') return {};
  if (type === 'link') return { userEnteredValue: { formulaValue: `=HYPERLINK(${quoted(value)},"Open")` } };
  if (typeof value === 'number' && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  if (Array.isArray(value)) return text(value.join(', '));
  return text(value);
}

const bold = (cell) => ({ ...cell, userEnteredFormat: { textFormat: { bold: true } } });

/** Sheet (tab) spec for one table: header row, then data rows. */
export function tabSpec({ title, columns, rows }, index) {
  const header = { values: columns.map(c => bold(text(c.label))) };
  const body = rows.map(row => ({ values: columns.map(c => cellFor(row[c.key], c.type)) }));
  return {
    properties: {
      title: String(title).slice(0, MAX_TAB_TITLE),
      index,
      gridProperties: { rowCount: Math.max(rows.length + 1, 2), columnCount: Math.max(columns.length, 1), frozenRowCount: 1 }
    },
    data: [{ startRow: 0, startColumn: 0, rowData: [header, ...body] }]
  };
}

/** The first tab: label / value pairs. */
export function aboutSpec(about) {
  return {
    properties: { title: 'About', index: 0, gridProperties: { rowCount: Math.max(about.length, 1), columnCount: 2 } },
    data: [{ startRow: 0, startColumn: 0, rowData: about.map(([label, value]) => ({ values: [bold(text(label)), text(value ?? '')] })) }]
  };
}

/**
 * Create the sheet.
 * @param {number|null} userId - the asker
 * @param {{title: string, about: Array<[string, string]>, tables: Array<{title, columns, rows}>}} content
 * @returns {Promise<{url: string, title: string, id: string}>}
 */
export async function writeResultSheet(userId, { title, about, tables }) {
  if (!userId) throw failure('No signed-in person is attached to this request, so no sheet could be created in their Drive.');
  let auth;
  try {
    auth = await getUserOAuth2Client(userId);
  } catch (err) {
    throw failure(explain(err), err);
  }
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const resp = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [aboutSpec(about), ...tables.map((t, i) => tabSpec(t, i + 1))]
      },
      fields: 'spreadsheetId,spreadsheetUrl'
    });
    return { url: resp.data.spreadsheetUrl, title, id: resp.data.spreadsheetId };
  } catch (err) {
    throw failure(explain(err), err);
  }
}

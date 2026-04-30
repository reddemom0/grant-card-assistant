/**
 * Google Sheets read/write tools.
 *
 * Reuses the OAuth2 client builder from google-docs.js so we have one
 * canonical token-fetch + refresh path for Google.
 *
 * Insufficient-scope errors (users who haven't re-auth'd since the
 * spreadsheets scope was added to src/api/auth.js) are caught here and
 * returned with a friendly "log out / log in" message rather than the
 * raw Google API error.
 *
 * Heavyweight spreadsheet creation lives in google-sheets-advanced.js
 * (createAdvancedBudgetTool); this file is the lightweight read/write
 * surface.
 */

import { google } from 'googleapis';
import { getUserOAuth2Client } from './google-docs.js';

const REAUTH_MESSAGE =
  'Google Sheets access not granted. Please log out and log in again to refresh your Google permissions.';

function isInsufficientScopeError(err) {
  // googleapis surfaces missing-scope as 403 with ACCESS_TOKEN_SCOPE_INSUFFICIENT
  // in the error message. Code can be a number (403) or a string ('403') depending
  // on the path; check both, plus regex on the message as a defensive fallback.
  const code = err?.code;
  const msg = String(err?.message ?? '');
  if (code === 403 || code === '403') {
    if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)) return true;
  }
  return /ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg);
}

function classifyError(err) {
  if (isInsufficientScopeError(err)) {
    return { success: false, error: REAUTH_MESSAGE };
  }
  return { success: false, error: err?.message ?? 'Google Sheets request failed' };
}

async function getSheetsClient(userId) {
  const auth = await getUserOAuth2Client(userId);
  return google.sheets({ version: 'v4', auth });
}

/**
 * Read cell values from an A1 range.
 * @param {number} userId
 * @param {{ spreadsheet_id: string, range: string, value_render_option?: 'FORMATTED_VALUE'|'UNFORMATTED_VALUE'|'FORMULA' }} args
 */
export async function readSheetRange(userId, args) {
  try {
    const sheets = await getSheetsClient(userId);
    const valueRenderOption = args.value_render_option || 'FORMATTED_VALUE';
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: args.spreadsheet_id,
      range: args.range,
      valueRenderOption
    });
    return {
      success: true,
      data: {
        range: resp.data.range,
        values: resp.data.values ?? [],
        value_render_option: valueRenderOption
      }
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Read spreadsheet metadata (title + per-tab properties).
 * @param {number} userId
 * @param {{ spreadsheet_id: string }} args
 */
export async function readSheetMetadata(userId, args) {
  try {
    const sheets = await getSheetsClient(userId);
    const resp = await sheets.spreadsheets.get({
      spreadsheetId: args.spreadsheet_id,
      fields:
        'spreadsheetId,properties.title,sheets.properties(sheetId,title,index,gridProperties.rowCount,gridProperties.columnCount)'
    });
    const tabs = (resp.data.sheets ?? []).map(s => ({
      sheet_id: s.properties?.sheetId,
      title: s.properties?.title,
      index: s.properties?.index,
      row_count: s.properties?.gridProperties?.rowCount,
      column_count: s.properties?.gridProperties?.columnCount
    }));
    return {
      success: true,
      data: {
        spreadsheet_id: resp.data.spreadsheetId,
        title: resp.data.properties?.title,
        sheets: tabs
      }
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Write a 2D array of values to an A1 range, overwriting existing content.
 * @param {number} userId
 * @param {{ spreadsheet_id: string, range: string, values: any[][], value_input_option?: 'USER_ENTERED'|'RAW' }} args
 */
export async function updateSheetRange(userId, args) {
  try {
    const sheets = await getSheetsClient(userId);
    const valueInputOption = args.value_input_option || 'USER_ENTERED';
    const resp = await sheets.spreadsheets.values.update({
      spreadsheetId: args.spreadsheet_id,
      range: args.range,
      valueInputOption,
      requestBody: { values: args.values }
    });
    return {
      success: true,
      data: {
        updated_range: resp.data.updatedRange,
        updated_rows: resp.data.updatedRows,
        updated_columns: resp.data.updatedColumns,
        updated_cells: resp.data.updatedCells
      }
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Append a row at the bottom of the table covering the given range.
 * @param {number} userId
 * @param {{ spreadsheet_id: string, range: string, values: any[][], value_input_option?: 'USER_ENTERED'|'RAW' }} args
 */
export async function appendSheetRow(userId, args) {
  try {
    const sheets = await getSheetsClient(userId);
    const valueInputOption = args.value_input_option || 'USER_ENTERED';
    const resp = await sheets.spreadsheets.values.append({
      spreadsheetId: args.spreadsheet_id,
      range: args.range,
      valueInputOption,
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: args.values }
    });
    return {
      success: true,
      data: {
        updated_range: resp.data.updates?.updatedRange,
        updates: {
          updated_rows: resp.data.updates?.updatedRows,
          updated_columns: resp.data.updates?.updatedColumns,
          updated_cells: resp.data.updates?.updatedCells
        }
      }
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Granted Files RAG — text extraction for indexing
 *
 * Separate from the chat-time extractor (extractFileText in src/tools/google-drive.js)
 * on purpose: that one is shared by Chat attachments and both chat paths, keeps
 * tight caps, and returns failures as bracketed notes. Indexing needs structured
 * output (pages, tabs, a scanned flag, truncation), larger caps, and thrown errors
 * so a file can be marked failed. Same parser libraries, plus word-extractor for .doc.
 *
 * Pure: bytes in, segments out. Fetching is drive-source.js; redaction and
 * chunking happen after this (prepare.js).
 */

import { PDFParse, VerbosityLevel } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import WordExtractor from 'word-extractor';

const GDOC = 'application/vnd.google-apps.document';
const GSHEET = 'application/vnd.google-apps.spreadsheet';

const KIND_BY_MIME = {
  [GDOC]: 'gdoc',
  [GSHEET]: 'gsheet',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-word.document.macroenabled.12': 'docx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsx'
};
// Only when the declared type is missing or generic.
const KIND_BY_EXTENSION = { pdf: 'pdf', docx: 'docx', docm: 'docx', doc: 'doc', xlsx: 'xlsx', xls: 'xlsx', xlsm: 'xlsx' };

/** Uploaded files above this are not downloaded for indexing (chat-time cap is 10 MB). */
export const INDEX_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
/** Safety bound on rows read per sheet; the token cap below decides what is kept. */
export const INDEX_MAX_SHEET_ROWS = 50000;
/** Spreadsheet cap per file (decision 6). */
export const SHEET_TOKEN_CAP = 20000;
/** Header rows kept for every tab, each at most this many characters. */
export const HEADER_ROWS = 2;
export const HEADER_ROW_MAX_CHARS = 1000;
/** A PDF yielding fewer characters per page than this is treated as scanned (decision 5). */
export const SCANNED_CHARS_PER_PAGE = 100;

/** Token estimate used throughout the RAG estimate: characters / 4. */
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);

/**
 * Which extractor a file needs, or null when the type is out of scope
 * (images, audio/video, Slides, shortcuts, folders, anything else).
 * @param {string} mimeType
 * @param {string} [name]
 * @returns {'gdoc'|'gsheet'|'pdf'|'docx'|'doc'|'xlsx'|null}
 */
export function ragKind(mimeType, name = '') {
  const type = String(mimeType || '').toLowerCase();
  if (KIND_BY_MIME[type]) return KIND_BY_MIME[type];
  if (!type || type === 'application/octet-stream') {
    const ext = String(name).split('.').pop().toLowerCase();
    return KIND_BY_EXTENSION[ext] || null;
  }
  return null;
}

const tidy = (text) => String(text || '')
  .replace(/^﻿/, '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t\f\v]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * Cap a workbook at SHEET_TOKEN_CAP: every tab keeps its header rows, the rest of
 * the budget is shared evenly across tabs (a tab's unused share goes to the others).
 * @param {{name: string, rows: string[]}[]} tabs - non-empty CSV rows per tab
 * @param {number} [capTokens]
 * @returns {{segments: {locator: string, header: string, text: string}[], truncated: boolean}}
 */
export function capWorkbook(tabs, capTokens = SHEET_TOKEN_CAP) {
  let budget = capTokens * 4;  // characters
  let truncated = false;

  const prepared = tabs.map(({ name, rows }) => {
    const headRows = rows.slice(0, HEADER_ROWS).map(r => {
      if (r.length > HEADER_ROW_MAX_CHARS) { truncated = true; return r.slice(0, HEADER_ROW_MAX_CHARS); }
      return r;
    });
    const header = headRows.join('\n');
    return { name, header, body: rows.slice(HEADER_ROWS), keep: [] };
  });

  // Headers first, in tab order, while they fit.
  const kept = [];
  for (const tab of prepared) {
    const cost = tab.header.length + 1;
    if (cost > budget) { truncated = true; continue; }
    budget -= cost;
    kept.push(tab);
  }
  if (kept.length < prepared.length) truncated = true;

  // Then body rows, shared evenly; smallest tabs first so their leftovers flow on.
  const bySize = [...kept].sort((a, b) => size(a.body) - size(b.body));
  let left = bySize.length;
  for (const tab of bySize) {
    const share = Math.floor(budget / left--);
    let used = 0;
    for (const row of tab.body) {
      if (used + row.length + 1 > share) break;
      tab.keep.push(row);
      used += row.length + 1;
    }
    if (tab.keep.length < tab.body.length) truncated = true;
    budget -= used;
  }

  const segments = kept.map(tab => ({ locator: `Sheet: ${tab.name}`, header: tab.header, text: tab.keep.join('\n') }));
  return { segments, truncated };
}

function size(rows) {
  return rows.reduce((n, r) => n + r.length + 1, 0);
}

/** Each tab's rows as CSV lines, blank rows and trailing empty cells dropped. */
function workbookTabs(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: INDEX_MAX_SHEET_ROWS });
  return workbook.SheetNames.map(name => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    const rows = csv.split('\n').map(r => r.replace(/,+$/, '').trim()).filter(r => r && /[^,\s"]/.test(r));
    return { name, rows };
  }).filter(tab => tab.rows.length > 0);
}

/**
 * Per-page PDF text and the scanned verdict. Exported for tests (stubbed pages).
 * @param {{num: number, text: string}[]} pages
 * @returns {{segments: {locator: string, text: string}[], pages: number, scanned: boolean}}
 */
export function pdfSegments(pages) {
  const segments = pages
    .map(p => ({ locator: `p. ${p.num}`, text: tidy(p.text) }))
    .filter(s => s.text);
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  const scanned = pages.length > 0 && chars / pages.length < SCANNED_CHARS_PER_PAGE;
  return { segments: scanned ? [] : segments, pages: pages.length, scanned };
}

/**
 * Extract a file's text for indexing. Throws on a parse failure.
 * @param {{kind: string, buffer: Buffer}} params - kind from ragKind; Google Docs
 *   come as exported text/plain bytes, Google Sheets as exported xlsx bytes
 * @returns {Promise<{segments: {locator: string|null, text: string, header?: string}[],
 *   pages: number|null, scanned: boolean, truncated: boolean, tokens: number}>}
 */
export async function extractForIndex({ kind, buffer }) {
  let segments = [];
  let pages = null;
  let scanned = false;
  let truncated = false;

  if (kind === 'pdf') {
    const parser = new PDFParse({ data: buffer, verbosity: VerbosityLevel.ERRORS });
    try {
      const result = await parser.getText();
      ({ segments, pages, scanned } = pdfSegments(result.pages || []));
    } finally {
      await parser.destroy?.();
    }
  } else if (kind === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    segments = [{ locator: null, text: tidy(value) }];
  } else if (kind === 'doc') {
    const doc = await new WordExtractor().extract(buffer);
    segments = [{ locator: null, text: tidy(doc.getBody()) }];
  } else if (kind === 'gdoc') {
    segments = [{ locator: null, text: tidy(buffer.toString('utf8')) }];
  } else if (kind === 'xlsx' || kind === 'gsheet') {
    ({ segments, truncated } = capWorkbook(workbookTabs(buffer)));
  } else {
    throw new Error(`unsupported kind: ${kind}`);
  }

  segments = segments.filter(s => s.text || s.header);
  const tokens = segments.reduce((n, s) => n + estimateTokens(s.text) + estimateTokens(s.header || ''), 0);
  return { segments, pages, scanned, truncated, tokens };
}

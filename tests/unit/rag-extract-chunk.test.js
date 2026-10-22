/**
 * Granted Files RAG — extraction (src/services/rag/extract.js), chunking
 * (chunk.js) and the per-file pipeline (prepare.js). Workbooks are built in
 * memory with SheetJS; PDF page logic is tested on stubbed pages. No network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/rag-extract-chunk.test.js
 */

import { jest } from '@jest/globals';
import * as XLSX from 'xlsx';
import {
  ragKind, extractForIndex, capWorkbook, pdfSegments, estimateTokens, SHEET_TOKEN_CAP
} from '../../src/services/rag/extract.js';
import { chunkSegments, windows } from '../../src/services/rag/chunk.js';
import { prepareFile } from '../../src/services/rag/prepare.js';

const workbook = (tabs, bookType = 'xlsx') => {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType }));
};
const para = (n, word = 'grant') => Array.from({ length: n }, (_, i) => `${word} sentence ${i} about eligibility and costs.`).join(' ');

describe('ragKind', () => {
  test.each([
    ['application/vnd.google-apps.document', '', 'gdoc'],
    ['application/vnd.google-apps.spreadsheet', '', 'gsheet'],
    ['application/pdf', '', 'pdf'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '', 'docx'],
    ['application/vnd.ms-word.document.macroEnabled.12', '', 'docx'],
    ['application/msword', '', 'doc'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '', 'xlsx'],
    ['application/vnd.ms-excel', '', 'xlsx'],
    ['application/vnd.ms-excel.sheet.macroEnabled.12', '', 'xlsx'],
    ['application/octet-stream', 'Budget.xlsm', 'xlsx'],
    ['', 'Old letter.doc', 'doc']
  ])('%s %s → %s', (mime, name, kind) => {
    expect(ragKind(mime, name)).toBe(kind);
  });

  test.each([
    'image/jpeg', 'video/mp4', 'audio/x-m4a', 'application/vnd.google-apps.presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.google-apps.shortcut', 'application/vnd.google-apps.folder', 'text/markdown', 'application/zip'
  ])('out of scope: %s', (mime) => {
    expect(ragKind(mime, 'x')).toBeNull();
  });
});

describe('PDF pages', () => {
  test('text pages become one segment each', () => {
    const out = pdfSegments([{ num: 1, text: 'A'.repeat(500) }, { num: 2, text: '' }, { num: 3, text: 'B'.repeat(300) }]);
    expect(out).toMatchObject({ pages: 3, scanned: false });
    expect(out.segments.map(s => s.locator)).toEqual(['p. 1', 'p. 3']);
  });

  test('under 100 characters per page is scanned: no segments', () => {
    const out = pdfSegments([{ num: 1, text: 'Page 1' }, { num: 2, text: 'x'.repeat(150) }, { num: 3, text: '' }]);
    expect(out).toEqual({ segments: [], pages: 3, scanned: true });
  });

  test('exactly 100 per page is text', () => {
    expect(pdfSegments([{ num: 1, text: 'x'.repeat(100) }]).scanned).toBe(false);
  });
});

describe('spreadsheets', () => {
  test('all tabs, blank rows and trailing empty cells dropped', async () => {
    const buffer = workbook({ Budget: [['Item', 'Cost'], [], ['Laptop', 1200, null, null]], Notes: [['Note'], ['Approved']] });
    const out = await extractForIndex({ kind: 'xlsx', buffer });
    expect(out.truncated).toBe(false);
    expect(out.segments).toEqual([
      { locator: 'Sheet: Budget', header: 'Item,Cost\nLaptop,1200', text: '' },
      { locator: 'Sheet: Notes', header: 'Note\nApproved', text: '' }
    ]);
  });

  test('legacy .xls reads the same way', async () => {
    const out = await extractForIndex({ kind: 'xlsx', buffer: workbook({ Sheet1: [['A', 'B'], [1, 2], [3, 4]] }, 'biff8') });
    expect(out.segments[0]).toEqual({ locator: 'Sheet: Sheet1', header: 'A,B\n1,2', text: '3,4' });
  });

  test('the cap keeps every tab header, shares the budget, and flags truncation', () => {
    const rows = (n, w) => Array.from({ length: n }, (_, i) => `${i},${'v'.repeat(w)}`);
    const tabs = [
      { name: 'Big', rows: ['Col A,Col B', 'Units,CAD', ...rows(5000, 60)] },
      { name: 'Small', rows: ['Name,Value', 'x,y', ...rows(10, 10)] },
      { name: 'Huge', rows: ['H1,H2', 'u1,u2', ...rows(8000, 80)] }
    ];
    const { segments, truncated } = capWorkbook(tabs);
    expect(truncated).toBe(true);
    expect(segments.map(s => s.header)).toEqual(['Col A,Col B\nUnits,CAD', 'Name,Value\nx,y', 'H1,H2\nu1,u2']);
    const small = segments.find(s => s.locator === 'Sheet: Small');
    expect(small.text.split('\n')).toHaveLength(10);  // fully kept; its leftover flows to the others
    const total = segments.reduce((n, s) => n + estimateTokens(s.header) + estimateTokens(s.text), 0);
    expect(total).toBeLessThanOrEqual(SHEET_TOKEN_CAP + segments.length);
    const big = segments.find(s => s.locator === 'Sheet: Big').text.length;
    const huge = segments.find(s => s.locator === 'Sheet: Huge').text.length;
    expect(Math.abs(big - huge)).toBeLessThan(200);   // even share
  });

  test('an overlong header row is cut and counts as truncation', () => {
    const { segments, truncated } = capWorkbook([{ name: 'T', rows: ['h'.repeat(5000)] }]);
    expect(truncated).toBe(true);
    expect(segments[0].header).toHaveLength(1000);
  });

  test('a small workbook is not truncated', () => {
    expect(capWorkbook([{ name: 'T', rows: ['a,b', '1,2', '3,4'] }]).truncated).toBe(false);
  });
});

describe('documents', () => {
  test('Google Doc export text is tidied into one segment', async () => {
    const out = await extractForIndex({ kind: 'gdoc', buffer: Buffer.from('﻿Title\r\n\r\n\r\n\r\nBody   text\t here') });
    expect(out.segments).toEqual([{ locator: null, text: 'Title\n\nBody text here' }]);
    expect(out.tokens).toBe(estimateTokens('Title\n\nBody text here'));
  });

  test('an unreadable Word file throws (the file is marked failed)', async () => {
    await expect(extractForIndex({ kind: 'docx', buffer: Buffer.from('not a zip') })).rejects.toThrow();
    await expect(extractForIndex({ kind: 'doc', buffer: Buffer.from('not a doc') })).rejects.toThrow();
  });
});

describe('chunking', () => {
  test('windows stay near the target and overlap', () => {
    const text = para(400);
    const spans = windows(text, 2000, 200);
    expect(spans.length).toBeGreaterThan(5);
    for (const [i, s] of spans.entries()) {
      expect(s.end - s.start).toBeLessThanOrEqual(2000);
      if (i < spans.length - 1) expect(s.end - s.start).toBeGreaterThanOrEqual(1200);
      if (i > 0) expect(s.start).toBeLessThan(spans[i - 1].end);   // overlap
    }
    expect(spans.at(-1).end).toBe(text.length);
  });

  test('cuts at a paragraph break when there is one', () => {
    const text = `${'a '.repeat(700)}\n\n${'b '.repeat(700)}`;
    const [first] = windows(text, 2000, 200);
    expect(text.slice(first.start, first.end).trim().endsWith('a')).toBe(true);
  });

  test('page locators, including spans across pages', () => {
    const chunks = chunkSegments([
      { locator: 'p. 1', text: para(30, 'one') },
      { locator: 'p. 2', text: para(30, 'two') },
      { locator: 'p. 3', text: para(5, 'three') }
    ]);
    expect(chunks[0].locator).toBe('p. 1');
    expect(chunks.some(c => /^pp\. \d–\d$/.test(c.locator))).toBe(true);
    expect(chunks.map(c => c.chunk_no)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.token_count).toBe(estimateTokens(c.text));
  });

  test('a document with no locator', () => {
    const chunks = chunkSegments([{ locator: null, text: 'Short memo.' }]);
    expect(chunks).toEqual([{ chunk_no: 0, locator: null, text: 'Short memo.', token_count: 3 }]);
  });

  test('sheet chunks never cross tabs and repeat the header', () => {
    const body = Array.from({ length: 300 }, (_, i) => `Row ${i},${i * 10},note`).join('\n');
    const chunks = chunkSegments([
      { locator: 'Sheet: A', header: 'Name,Amount,Note', text: body },
      { locator: 'Sheet: B', header: 'Only,Header', text: '' }
    ]);
    const a = chunks.filter(c => c.locator === 'Sheet: A');
    expect(a.length).toBeGreaterThan(1);
    for (const c of a) expect(c.text.startsWith('Name,Amount,Note\n')).toBe(true);
    expect(chunks.find(c => c.locator === 'Sheet: B').text).toBe('Only,Header');
  });
});

describe('prepareFile', () => {
  const file = (over = {}) => ({
    id: 'f1', name: 'Budget Sheet-Acme-CanEx', mimeType: 'application/vnd.google-apps.spreadsheet',
    path: ['Clients', 'Acme', 'CanExport', '2026'], md5Checksum: undefined, modifiedTime: '2026-10-01T00:00:00Z', ...over
  });

  test('excluded and skipped files are never fetched', async () => {
    const fetch = jest.fn();
    expect((await prepareFile(file({ path: ['Departments', 'HR'] }), fetch)).row).toMatchObject({ status: 'excluded', status_reason: 'area:Departments/HR' });
    expect((await prepareFile(file({ name: 'Payroll 2026' }), fetch)).row).toMatchObject({ status: 'excluded', status_reason: 'sensitive_name' });
    expect((await prepareFile(file({ mimeType: 'image/png', name: 'logo.png' }), fetch)).row).toMatchObject({ status: 'skipped', status_reason: 'type:image' });
    expect((await prepareFile(file({ mimeType: 'application/vnd.google-apps.shortcut' }), fetch)).row).toMatchObject({ status: 'skipped', status_reason: 'type:shortcut' });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a sheet is extracted, redacted and chunked, with counts only', async () => {
    const bytes = workbook({ Staff: [['Name', 'SIN', 'Role'], ['Jane Doe', '046 454 286', 'Manager'], ['Total', '', '$1,234,567']] });
    const { row, chunks } = await prepareFile(file(), async (f) => { expect(f.kind).toBe('gsheet'); return bytes; });
    expect(row).toMatchObject({
      status: 'indexed', area: 'Clients', client: 'Acme', year: 2026, path: 'Clients/Acme/CanExport/2026',
      redaction_counts: { sin: 1, card: 0, bank: 0 }, chunk_count: 1, truncated: false
    });
    expect(chunks[0]).toMatchObject({ file_id: 'f1', area: 'Clients', year: 2026, locator: 'Sheet: Staff' });
    expect(chunks[0].text).toContain('[REDACTED-SIN]');
    expect(chunks[0].text).toContain('Jane Doe');
    expect(chunks[0].text).toContain('$1,234,567');
    expect(JSON.stringify({ row, chunks })).not.toContain('046');
  });

  test('a parse failure is recorded as failed with a short code', async () => {
    const { row } = await prepareFile(file({ mimeType: 'application/pdf', name: 'x.pdf' }), async () => Buffer.from('not a pdf'));
    expect(row.status).toBe('failed');
    expect(row.status_reason).toMatch(/^pdf:/);
  });

  test('too large is skipped, not failed', async () => {
    const err = Object.assign(new Error('big'), { code: 'too_large' });
    const { row } = await prepareFile(file({ mimeType: 'application/pdf', name: 'x.pdf' }), async () => { throw err; });
    expect(row).toMatchObject({ status: 'skipped', status_reason: 'too_large' });
  });
});

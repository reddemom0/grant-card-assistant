/**
 * grant_data results sheet writer
 *
 * googleapis and the OAuth client are faked; the create request is recorded.
 * What must hold: one spreadsheets.create as the asker, "About" first, a bold
 * frozen header per table, typed cells so card text is never a formula, links
 * as HYPERLINK formulas, and plain-word failures (no user, no Google access).
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/grant-data-sheet.test.js
 */

import { jest } from '@jest/globals';

const created = [];
let createError = null;
let authError = null;
const authFor = jest.fn(async (userId) => { if (authError) throw authError; return { userId }; });

jest.unstable_mockModule('googleapis', () => ({
  google: {
    sheets: () => ({
      spreadsheets: {
        create: async (req) => {
          if (createError) throw createError;
          created.push(req);
          return { data: { spreadsheetId: 'sid', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sid' } };
        }
      }
    })
  }
}));
jest.unstable_mockModule('../../src/tools/google-docs.js', () => ({ getUserOAuth2Client: authFor }));

const { writeResultSheet, cellFor } = await import('../../src/tools/grant-data-sheet.js');

const table = {
  title: 'Results',
  columns: [{ key: 'id', label: 'GG3 id' }, { key: 'snippet', label: 'Text' }, { key: 'app_link', label: 'App link', type: 'link' }],
  rows: [{ id: 5, snippet: '=IMPORTXML("x")', app_link: 'https://app.getgranted.ai/grants/5' }]
};

beforeEach(() => { created.length = 0; createError = null; authError = null; authFor.mockClear(); });

test('one create call as the asker: About first, frozen bold header, typed cells, link formulas', async () => {
  const out = await writeResultSheet(4, { title: 'Oracle – Test – 2026-09-29', about: [['Filters', 'Status: active']], tables: [table] });
  expect(authFor).toHaveBeenCalledWith(4);
  expect(out).toEqual({ url: 'https://docs.google.com/spreadsheets/d/sid', title: 'Oracle – Test – 2026-09-29', id: 'sid' });
  expect(created).toHaveLength(1);
  const body = created[0].requestBody;
  expect(body.properties.title).toBe('Oracle – Test – 2026-09-29');
  expect(body.sheets.map(s => s.properties.title)).toEqual(['About', 'Results']);
  const results = body.sheets[1];
  expect(results.properties.gridProperties.frozenRowCount).toBe(1);
  const [header, row] = results.data[0].rowData;
  expect(header.values[0]).toEqual({ userEnteredValue: { stringValue: 'GG3 id' }, userEnteredFormat: { textFormat: { bold: true } } });
  expect(row.values[0]).toEqual({ userEnteredValue: { numberValue: 5 } });
  // Card text that looks like a formula stays text.
  expect(row.values[1]).toEqual({ userEnteredValue: { stringValue: '=IMPORTXML("x")' } });
  expect(row.values[2]).toEqual({ userEnteredValue: { formulaValue: '=HYPERLINK("https://app.getgranted.ai/grants/5","Open")' } });
});

test('empty cells stay empty; quotes in links are escaped', () => {
  expect(cellFor(null)).toEqual({});
  expect(cellFor('a"b', 'link')).toEqual({ userEnteredValue: { formulaValue: '=HYPERLINK("a""b","Open")' } });
});

test('no user: a plain reason, nothing created', async () => {
  await expect(writeResultSheet(null, { title: 't', about: [], tables: [table] }))
    .rejects.toMatchObject({ userMessage: expect.stringMatching(/No signed-in person/) });
  expect(created).toHaveLength(0);
});

test('no Google connection or missing scope: plain reasons', async () => {
  authError = new Error('User has not authorized Google Drive access. Please log out and log back in to grant permissions.');
  await expect(writeResultSheet(4, { title: 't', about: [], tables: [table] }))
    .rejects.toMatchObject({ userMessage: expect.stringMatching(/not connected/) });
  authError = null;
  createError = Object.assign(new Error('Request had insufficient authentication scopes. ACCESS_TOKEN_SCOPE_INSUFFICIENT'), { code: 403 });
  await expect(writeResultSheet(4, { title: 't', about: [], tables: [table] }))
    .rejects.toMatchObject({ userMessage: expect.stringMatching(/Sheets access not granted/) });
});

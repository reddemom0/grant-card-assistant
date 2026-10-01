/**
 * Pulse errors sheet: reading rows, matching, and never touching Status/Notes.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/pulse-errors-sheet.test.js
 */

import { jest } from '@jest/globals';
import {
  readIssueRows, writeIssues, resolveSheetOwner, mergeClients, localDate, safeText, isBeingFixed
} from '../../src/services/pulse-errors-sheet.js';

const SHEET = 'sheet123';
const ROWS = [
  ['Chat times out', '2026-09-20', '2026-09-28', '7', 'Acme, Birch', 'Chris (AI behaviour)', 'being fixed', 'Chris on it', 'Oracle-detected'],
  [],
  ['Wrong deadline on CDAP card', '2026-09-25', '2026-09-25', '1', 'Cedar', 'Research (grant card data)', 'new', '', 'reported by Steph']
];
const read = jest.fn(async () => ({ success: true, data: { values: ROWS } }));

test('rows come back with their sheet row numbers; blank rows are skipped', async () => {
  const r = await readIssueRows({ sheetId: SHEET, userId: 7, read });
  expect(read).toHaveBeenCalledWith(7, { spreadsheet_id: SHEET, range: 'A2:I' });
  expect(r.rows.map(x => [x.row, x.name, x.count, x.status])).toEqual([
    [2, 'Chat times out', 7, 'being fixed'],
    [4, 'Wrong deadline on CDAP card', 1, 'new']
  ]);
  expect(r.rows[0].clients).toEqual(['Acme', 'Birch']);
});

test('a read that fails is reported, not thrown', async () => {
  expect(await readIssueRows({ sheetId: SHEET, userId: 7, read: async () => ({ success: false }) })).toEqual({ ok: false, code: 'read_failed' });
});

test('a matched row: only Last seen, Count (added to) and Example clients are written — never Status or Notes', async () => {
  const { rows } = await readIssueRows({ sheetId: SHEET, userId: 7, read });
  const update = jest.fn(async () => ({ success: true }));
  const append = jest.fn(async () => ({ success: true }));

  const out = await writeIssues({
    issues: [
      { name: 'Timeouts', count: 3, clients: ['Dune', 'Acme'], owner: 'Chris (AI behaviour)', existingRow: 2 },
      { name: 'Timeouts again', count: 2, clients: ['Elm'], owner: 'Chris (AI behaviour)', existingRow: 2 }
    ],
    rows, sheetId: SHEET, userId: 7, today: '2026-10-01', update, append
  });

  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(7, { spreadsheet_id: SHEET, range: 'C2:E2', values: [['2026-10-01', 12, 'Acme, Birch, Dune, Elm']] });
  expect(append).not.toHaveBeenCalled();
  expect(out.issues.every(i => i.seenBefore && i.beingFixed)).toBe(true);
  expect(out).toMatchObject({ updated: 1, appended: 0, failed: 0 });
});

test('a new issue is appended with Status "new" and Source "Oracle-detected"', async () => {
  const update = jest.fn();
  const append = jest.fn(async () => ({ success: true }));
  const out = await writeIssues({
    issues: [{ name: 'Asks for a person', count: 2, clients: ['Fir', 'a client ·ab12'], owner: 'Client follow-up', existingRow: null }],
    rows: [], sheetId: SHEET, userId: 7, today: '2026-10-01', update, append
  });
  expect(update).not.toHaveBeenCalled();
  expect(append).toHaveBeenCalledWith(7, {
    spreadsheet_id: SHEET, range: 'A:I',
    values: [['Asks for a person', '2026-10-01', '2026-10-01', 2, 'Fir, a client ·ab12', 'Client follow-up', 'new', '', 'Oracle-detected']]
  });
  expect(out.issues[0]).toMatchObject({ seenBefore: false, beingFixed: false });
});

test('a reported issue carries its own Source and Notes on a new row; a matched row still gets C–E only', async () => {
  const update = jest.fn(async () => ({ success: true }));
  const append = jest.fn(async () => ({ success: true }));
  await writeIssues({
    issues: [
      { name: 'Region tag hides grant', count: 1, clients: ['Fir'], owner: 'Research (grant card data)', existingRow: null, source: 'reported by Steph', notes: '=fix the tag' },
      { name: 'Chat times out', count: 1, clients: ['Fir'], owner: 'Jason (app/UI)', existingRow: 2, source: 'reported by Steph', notes: 'ignored' }
    ],
    rows: (await readIssueRows({ sheetId: SHEET, userId: 7, read: jest.fn(async () => ({ success: true, data: { values: ROWS } })) })).rows,
    sheetId: SHEET, userId: 7, today: '2026-10-01', update, append
  });
  expect(append.mock.calls[0][1].values).toEqual([['Region tag hides grant', '2026-10-01', '2026-10-01', 1, 'Fir', 'Research (grant card data)', 'new', "'=fix the tag", 'reported by Steph']]);
  expect(update.mock.calls[0][1].range).toBe('C2:E2');
});

test('a row number that is not in the sheet is treated as new', async () => {
  const append = jest.fn(async () => ({ success: true }));
  await writeIssues({ issues: [{ name: 'X issue', count: 1, clients: [], owner: 'Jason (app/UI)', existingRow: 99 }], rows: [], sheetId: SHEET, userId: 7, today: '2026-10-01', update: jest.fn(), append });
  expect(append).toHaveBeenCalled();
});

test('example clients are capped at 5; text that would be a formula is written as text', () => {
  expect(mergeClients(['a', 'b', 'c'], ['c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(safeText('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
  expect(safeText('Chat times out')).toBe('Chat times out');
});

test('"being fixed" is read from Status whatever the case', () => {
  expect(isBeingFixed('Being fixed')).toBe(true);
  expect(isBeingFixed('fixed')).toBe(false);
});

test('the sheet owner: an active user with a Google login, or nothing', async () => {
  const q = jest.fn(async () => ({ rows: [{ id: 3 }] }));
  expect(await resolveSheetOwner({ PULSE_SHEET_OWNER_EMAIL: 'Chris@granted.ca' }, q)).toEqual({ ok: true, userId: 3 });
  expect(q.mock.calls[0][1]).toEqual(['Chris@granted.ca']);
  expect(await resolveSheetOwner({ PULSE_SHEET_OWNER_EMAIL: 'x@granted.ca' }, async () => ({ rows: [] }))).toEqual({ ok: false, code: 'owner_not_found' });
  expect(await resolveSheetOwner({}, q)).toEqual({ ok: false, code: 'owner_not_configured' });
});

test('dates are Vancouver dates', () => {
  expect(localDate(new Date('2026-10-01T05:00:00Z'))).toBe('2026-09-30');
  expect(localDate(new Date('2026-10-01T15:00:00Z'))).toBe('2026-10-01');
});

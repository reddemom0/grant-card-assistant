// "Your moved files – <owner> – <date>": a Google Sheet in the admin account's My Drive listing what a run moved,
// shared with the owner only (viewer, no notification email).
// Column D, "Client access not restored", lists outside emails whose access to that file could not be put back
// (the share failed; no invitation email is sent, by design — approved 2026-10-14).
// CLI:    node scripts/migration/owner-sheet.mjs <owner>@ [--ledger <file>] [--since <ISO time>]
//         node scripts/migration/owner-sheet.mjs <owner>@ --add-access-column <sheet id> [--ledger <file>] [--since <ISO time>]
// Module: buildOwnerSheet({ owner, ledgerFile, since }) → { url, id, counts }; addTabsToOwnerSheet (a later run adds its
//         tab to the owner's existing sheet); addAccessColumn({ owner, sheetId, ledgerFile, since })
// Writes: creates one spreadsheet, writes its values/format, adds one reader permission for the owner. Nothing else.
//         --add-access-column only writes column D of an existing owner sheet's tabs (and removes the earlier
//         separate "Client access not restored" tab if present).
import fs from 'fs';
import { fileURLToPath } from 'url';
import { INV, CFG, ADMIN, emailOf, token, sheets, vanTime, loadCsv, loadJsonl } from './migration-log.mjs';

const parentPath = v => v ? (v.path.endsWith('/' + v.name) ? v.path.slice(0, -(v.name.length + 1)) : v.path) : '';
let INVENTORY = null;
const inventory = () => INVENTORY ||= new Map(loadCsv(CFG.files.inventory).map(r => [r.file_id, r]));

const ACCESS_COL = 'Client access not restored';
const OLD_ACCESS_TAB = 'Client access not restored';
const HEADER = ['File', 'Was in', 'Now in', ACCESS_COL];
const WIDTHS = [340, 380, 380, 280];
// file id → "a@x.com, b@y.com": failed share restores in this run, minus any later success for the same file + person
function accessByFile(ledger, since) {
  const last = new Map();
  for (const x of loadJsonl(ledger)) if (x.type === 'add-permission' && x.status !== 'intent' && (x.ts || '') >= since) last.set(`${x.id}|${(x.who || '').toLowerCase()}`, x);
  const m = new Map();
  for (const x of last.values()) if (x.status === 'failed') m.set(x.id, [...(m.get(x.id) || []), x.who]);
  return new Map([...m].map(([id, w]) => [id, [...new Set(w)].sort().join(', ')]));
}
const esc = s => String(s).replace(/"/g, '""');
const formatReqs = (id, n) => [
  { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.12, green: 0.23, blue: 0.37 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 1, endRowIndex: Math.max(n, 2) }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)' } },
  ...WIDTHS.map((px, i) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
  { setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: 0, endRowIndex: Math.max(n, 2), startColumnIndex: 0, endColumnIndex: WIDTHS.length } } } }
];

// Backfill column D into an owner sheet built before the column existed. Rows are matched by the file ID in column A's link.
export async function addAccessColumn({ owner, sheetId, ledgerFile, since = '' }) {
  const ledger = ledgerFile || `move-${owner.replace(/@$/, '')}-ledger.jsonl`;
  const access = accessByFile(ledger, since);
  const meta = await sheets('GET', `/${sheetId}?fields=sheets.properties`, null, 'spreadsheets.get (owner sheet)');
  const tabs = meta.sheets.map(s => s.properties).filter(p => p.title.startsWith('Moved to '));
  const data = [], reqs = []; let marked = 0;
  for (const t of tabs) {
    const v = await sheets('GET', `/${sheetId}/values/${encodeURIComponent(`'${t.title}'!A:A`)}?valueRenderOption=FORMULA`, null, 'values.get (owner sheet)');
    const col = (v.values || []).map((r, i) => { if (i === 0) return [ACCESS_COL]; const id = (String(r[0] || '').match(/open\?id=([\w-]+)/) || [])[1]; const w = access.get(id) || ''; if (w) marked++; return [w]; });
    data.push({ range: `'${t.title}'!D1`, values: col });
    reqs.push(...formatReqs(t.sheetId, col.length));
  }
  const old = meta.sheets.find(s => s.properties.title === OLD_ACCESS_TAB && !s.properties.title.startsWith('Moved to '));
  if (old) reqs.push({ deleteSheet: { sheetId: old.properties.sheetId } });
  await sheets('POST', `/${sheetId}/values:batchUpdate`, { valueInputOption: 'RAW', data }, 'values.batchUpdate (access column)');
  await sheets('POST', `/${sheetId}:batchUpdate`, { requests: reqs }, 'batchUpdate (access column format)');
  fs.appendFileSync(`${INV}/${ledger}`, JSON.stringify({ type: 'owner-sheet-access-column', status: 'done', id: sheetId, files: marked, removed_tab: !!old, ts: new Date().toISOString() }) + '\n');
  return { id: sheetId, filesMarked: marked, filesWithFailedRestores: access.size, people: [...new Set([...access.values()].flatMap(w => w.split(', ')))].sort(), removedOldTab: !!old };
}

// rows for the sheet: completed moves/shortcuts in this run, with the emails whose access was not restored
function runRows(ledger, since, drives) {
  const lines = loadJsonl(ledger).filter(x => (x.type === 'move' || x.type === 'shortcut') && x.status === 'done' && (x.ts || '') >= since && (!drives || drives.includes(x.drive)));
  const plan = new Map(loadCsv(CFG.files.v6).map(r => [r.file_id, r]));
  const inv = inventory();
  const access = accessByFile(ledger, since);
  const rows = lines.map(x => {
    const v = inv.get(x.id); const name = plan.get(x.id)?.name || v?.name || x.id;
    const was = (parentPath(v) || '').replace(/^My Drive$/, 'My Drive (top level)');
    const shortcut = x.type === 'shortcut';
    return { drive: x.drive, name, id: shortcut ? x.shortcut_id : x.id, was, now: shortcut ? `${x.drive}/${x.dest} (shortcut; the file itself stays where it was)` : `${x.drive}/${x.dest}`, lost: shortcut ? '' : access.get(x.id) || '' };
  });
  return { lines, rows };
}
const allTabs = drives => [[CFG.drives.sorted.name, `Moved to ${CFG.drives.sorted.name}`], [CFG.drives.archive.name, `Moved to ${CFG.drives.archive.name}`]].filter(([d]) => !drives || drives.includes(d));
const tabValues = (rows, drive) => rows.filter(r => r.drive === drive).sort((a, b) => a.now.localeCompare(b.now) || a.name.localeCompare(b.name)).map(r => [`=HYPERLINK("https://drive.google.com/open?id=${r.id}","${esc(r.name)}")`, r.was, r.now, r.lost]);
// the sheet an earlier run made for this owner (newest), if any
export const existingOwnerSheet = ledger => loadJsonl(ledger).filter(x => x.type === 'owner-sheet' && x.status === 'done').pop() || null;

// Add this run's moves to the owner's existing sheet: a new tab per drive (or rows appended to an existing tab).
export async function addTabsToOwnerSheet({ owner, sheetId, ledgerFile, since = '', drives = null }) {
  const ledger = ledgerFile || `move-${owner.replace(/@$/, '')}-ledger.jsonl`;
  const { rows } = runRows(ledger, since, drives);
  if (!rows.length) return { skipped: 'no completed moves in this run' };
  const meta = await sheets('GET', `/${sheetId}?fields=properties.title,sheets.properties`, null, 'spreadsheets.get (owner sheet)');
  const have = new Map(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const counts = {};
  for (const [drive, t] of allTabs(drives)) {
    const vals = tabValues(rows, drive); if (!vals.length) continue;
    counts[t] = vals.length;
    if (have.has(t)) { await sheets('POST', `/${sheetId}/values/${encodeURIComponent(`'${t}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: vals }, 'values.append (owner sheet)'); continue; }
    const add = await sheets('POST', `/${sheetId}:batchUpdate`, { requests: [{ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } }] }, 'addSheet (owner sheet)');
    const id = add.replies[0].addSheet.properties.sheetId;
    await sheets('POST', `/${sheetId}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data: [{ range: `'${t}'!A1`, values: [HEADER, ...vals] }] }, 'values.batchUpdate (owner sheet)');
    await sheets('POST', `/${sheetId}:batchUpdate`, { requests: formatReqs(id, vals.length + 1) }, 'batchUpdate (owner sheet format)');
  }
  const tok = await token(ADMIN);
  const v = await (await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}?fields=webViewLink`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  fs.appendFileSync(`${INV}/${ledger}`, JSON.stringify({ type: 'owner-sheet-tabs', status: 'done', id: sheetId, counts, ts: new Date().toISOString() }) + '\n');
  return { url: v.webViewLink, id: sheetId, title: meta.properties.title, counts, added: true };
}

export async function buildOwnerSheet({ owner, ledgerFile, since = '', drives = null }) {
  const ownerEmail = emailOf(owner), short = owner.replace(/@$/, '');
  const ledger = ledgerFile || `move-${short}-ledger.jsonl`;
  const { lines, rows } = runRows(ledger, since, drives);
  if (!lines.length) return { skipped: 'no completed moves in this run' };
  const tabs = allTabs(drives);
  const date = vanTime(lines[0].ts).slice(0, 10);
  const title = `Your moved files – ${owner} – ${date}`;
  const created = await sheets('POST', '', { properties: { title, timeZone: 'America/Vancouver' }, sheets: tabs.map(([, t]) => ({ properties: { title: t, gridProperties: { frozenRowCount: 1 } } })) }, 'spreadsheets.create (owner sheet)');
  const sid = created.spreadsheetId; const tabId = Object.fromEntries(created.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const data = tabs.map(([drive, t]) => ({ range: `'${t}'!A1`, values: [HEADER, ...tabValues(rows, drive)] }));
  await sheets('POST', `/${sid}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data }, 'values.batchUpdate (owner sheet)');
  const reqs = tabs.flatMap(([d, t]) => formatReqs(tabId[t], rows.filter(r => r.drive === d).length + 1));
  await sheets('POST', `/${sid}:batchUpdate`, { requests: reqs }, 'batchUpdate (owner sheet format)');
  // share with the owner only: viewer, no notification email
  const tok = await token(ADMIN);
  const p = await fetch(`https://www.googleapis.com/drive/v3/files/${sid}/permissions?sendNotificationEmail=false&fields=id,role,emailAddress`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: ownerEmail }) });
  const pj = await p.json(); if (!p.ok) throw new Error(`share ${p.status}: ${JSON.stringify(pj).slice(0, 200)}`);
  const v = await (await fetch(`https://www.googleapis.com/drive/v3/files/${sid}?fields=webViewLink,owners(emailAddress),permissions(emailAddress,role,type)`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  const counts = Object.fromEntries(tabs.map(([d, t]) => [t, rows.filter(r => r.drive === d).length]));
  counts[ACCESS_COL] = rows.filter(r => r.lost).length;
  fs.appendFileSync(`${INV}/${ledger}`, JSON.stringify({ type: 'owner-sheet', status: 'done', id: sid, title, shared_with: ownerEmail, role: 'reader', permission_id: pj.id, counts, ts: new Date().toISOString() }) + '\n');
  return { url: v.webViewLink, id: sid, title, counts, owners: v.owners, permissions: v.permissions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const owner = process.argv[2]; if (!owner?.endsWith('@')) { console.error('usage: owner-sheet.mjs <owner>@ [--add-access-column <sheet id>] [--ledger <file>] [--since <ISO>]'); process.exit(2); }
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const r = arg('--add-access-column')
    ? await addAccessColumn({ owner, sheetId: arg('--add-access-column'), ledgerFile: arg('--ledger'), since: arg('--since') || '' })
    : await buildOwnerSheet({ owner, ledgerFile: arg('--ledger'), since: arg('--since') || '' });
  console.log(JSON.stringify(r, null, 1));
}

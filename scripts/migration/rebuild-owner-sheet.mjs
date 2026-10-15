// Rebuild an owner's "Your moved files" sheet so its tabs match where files are NOW, read from live Drive by file ID
// (not from the ledgers):
//   "Moved to Granted Files"   — every file (and shortcut) now in Granted Files
//   "Moved to Granted Archive" — files now in Granted Archive, with Status (Held / Duplicate / Still in Archive)
//   "Returned to you"          — files now back in the owner's My Drive (only created when there are any)
// Columns: File, Was in (original My Drive path), Now in (live path), Client access not restored [, Status].
// Usage: node scripts/migration/rebuild-owner-sheet.mjs <owner>@ [--dry]
// Writes (unless --dry): only the owner's existing sheet (tab values, formatting, adding a tab); one ledger line.
// Reads Drive; never moves, renames or shares anything.
import fs from 'fs';
import { INV, CFG, ADMIN, emailOf, token, sheets, loadCsv, loadJsonl } from './migration-log.mjs';

const OWNER = process.argv[2], DRY = process.argv.includes('--dry');
if (!OWNER?.endsWith('@')) { console.error('usage: rebuild-owner-sheet.mjs <owner>@ [--dry]'); process.exit(2); }
const SHORT = OWNER.replace(/@$/, ''), OWNER_EMAIL = emailOf(OWNER);
const LNAME = `move-${SHORT}-ledger.jsonl`, GF = CFG.drives.sorted, GA = CFG.drives.archive;
const TAB_GF = `Moved to ${GF.name}`, TAB_GA = `Moved to ${GA.name}`, TAB_RET = 'Returned to you';
const lines = loadJsonl(LNAME);
const sheetLine = lines.filter(x => x.type === 'owner-sheet' && x.status === 'done').pop();
if (!sheetLine) { console.error(`STOP: ${OWNER} has no "Your moved files" sheet`); process.exit(3); }

// every item this owner's migration placed: moved files + shortcuts made
const items = [];
for (const x of lines) {
  if (x.status !== 'done') continue;
  if (x.type === 'move' && !items.some(i => i.id === x.id)) items.push({ id: x.id, kind: 'file' });
  if (x.type === 'shortcut') items.push({ id: x.shortcut_id, target: x.id, kind: 'shortcut' });
}
const inv = new Map(loadCsv(CFG.files.inventory).map(r => [r.file_id, r]));
const parentPath = v => v ? (v.path.endsWith('/' + v.name) ? v.path.slice(0, -(v.name.length + 1)) : v.path) : '';
const refile = fs.existsSync(`${INV}/${SHORT}-archive-refile.json`) ? new Map(JSON.parse(fs.readFileSync(`${INV}/${SHORT}-archive-refile.json`, 'utf8')).files.map(f => [f.id, f.decision])) : new Map();
// share restores that failed and were never later added
const lastAdd = new Map(); for (const x of lines) if (x.type === 'add-permission' && x.status !== 'intent') lastAdd.set(`${x.id}|${(x.who || '').toLowerCase()}`, x);
const lost = new Map(); for (const x of lastAdd.values()) if (x.status === 'failed') lost.set(x.id, [...new Set([...(lost.get(x.id) || []), x.who])]);

const get = async (sub, path) => {
  for (let a = 1; a <= 6; a++) {
    let r; try { r = await fetch(`https://www.googleapis.com/drive/v3${path}`, { headers: { Authorization: `Bearer ${await token(sub)}` }, signal: AbortSignal.timeout(60000) }); } catch { await new Promise(s => setTimeout(s, 1500 * a)); continue; }
    if (r.ok) return r.json(); if (r.status === 404) return null;
    const t = await r.text(); if (r.status === 429 || r.status >= 500 || (r.status === 403 && /rate|limit/i.test(t))) { await new Promise(s => setTimeout(s, 1500 * a * a)); continue; }
    throw new Error(`GET ${r.status}: ${t.slice(0, 160)}`);
  }
  throw new Error('GET: retries exhausted');
};
const folderPath = new Map(); let ownerRoot = null;
async function pathOf(id, sub) {   // full path of a folder, from the drive (or My Drive) root
  if (id === GF.id) return GF.name; if (id === GA.id) return GA.name; if (id === ownerRoot) return 'My Drive';
  if (folderPath.has(id)) return folderPath.get(id);
  const f = await get(sub, `/files/${id}?supportsAllDrives=true&fields=name,parents`);
  const p = !f ? '(unknown folder)' : f.parents?.length ? `${await pathOf(f.parents[0], sub)}/${f.name}` : f.name;
  folderPath.set(id, p); return p;
}
async function locate(it) {
  let sub = ADMIN, f = await get(ADMIN, `/files/${it.id}?supportsAllDrives=true&fields=id,name,parents,driveId,trashed`);
  // a file in the owner's My Drive: the admin may see it but not its folder, so ask as the owner
  if (!f || (!f.driveId && !f.parents?.length)) { sub = OWNER_EMAIL; f = await get(OWNER_EMAIL, `/files/${it.id}?supportsAllDrives=true&fields=id,name,parents,driveId,trashed`); }
  if (!f) return { ...it, where: 'missing' };
  if (sub === OWNER_EMAIL && !ownerRoot) ownerRoot = (await get(OWNER_EMAIL, '/files/root?fields=id')).id;
  const now = f.parents?.length ? await pathOf(f.parents[0], sub) : '(no folder)';
  const where = f.trashed ? 'trashed' : f.driveId === GF.id ? 'gf' : f.driveId === GA.id ? 'ga' : !f.driveId ? 'mydrive' : 'other';
  return { ...it, name: f.name, now, where };
}
// look everything up, 8 at a time
const found = []; let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (i < items.length) { const it = items[i++]; found.push(await locate(it)); } }));

const esc = s => String(s).replace(/"/g, '""');
const row = (r, status) => {
  const v = inv.get(r.kind === 'shortcut' ? r.target : r.id);
  const was = r.kind === 'shortcut' ? `(shortcut to a file that stays where it was: ${(parentPath(v) || '').replace(/^My Drive$/, 'My Drive (top level)')})` : (parentPath(v) || '').replace(/^My Drive$/, 'My Drive (top level)');
  const out = [`=HYPERLINK("https://drive.google.com/open?id=${r.id}","${esc(r.name)}")`, was, r.now, (lost.get(r.id) || []).sort().join(', ')];
  return status === undefined ? out : [...out, status];
};
const sortRows = a => a.sort((x, y) => x.now.localeCompare(y.now) || x.name.localeCompare(y.name));
const gf = sortRows(found.filter(r => r.where === 'gf')), ga = sortRows(found.filter(r => r.where === 'ga')), ret = sortRows(found.filter(r => r.where === 'mydrive'));
const odd = found.filter(r => !['gf', 'ga', 'mydrive'].includes(r.where));
const statusOf = r => ({ held: 'Held', duplicate: 'Duplicate' }[refile.get(r.id)] || 'Still in Archive');
const counts = { items: items.length, [TAB_GF]: gf.length, [TAB_GA]: ga.length, [TAB_RET]: ret.length, elsewhere: odd.map(r => `${r.name || r.id}: ${r.where}`) };
counts.archiveStatus = ga.reduce((m, r) => (m[statusOf(r)] = (m[statusOf(r)] || 0) + 1, m), {});
if (DRY) { console.log(JSON.stringify({ owner: OWNER, dry: true, ...counts }, null, 1)); process.exit(0); }

const HEAD = ['File', 'Was in', 'Now in', 'Client access not restored'];
const tabs = [[TAB_GF, [HEAD, ...gf.map(r => row(r))], [340, 380, 380, 280]], [TAB_GA, [[...HEAD, 'Status'], ...ga.map(r => row(r, statusOf(r)))], [340, 380, 380, 280, 140]]];
if (ret.length) tabs.push([TAB_RET, [HEAD, ...ret.map(r => row(r))], [340, 380, 380, 280]]);
const meta = await sheets('GET', `/${sheetLine.id}?fields=sheets.properties`, null, 'spreadsheets.get');
const have = new Map(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));
const add = tabs.filter(([t]) => !have.has(t)).map(([t]) => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } }));
if (add.length) { const r = await sheets('POST', `/${sheetLine.id}:batchUpdate`, { requests: add }, 'addSheet'); for (const x of r.replies) have.set(x.addSheet.properties.title, x.addSheet.properties.sheetId); }
// clear old values and filters, then write
await sheets('POST', `/${sheetLine.id}/values:batchClear`, { ranges: tabs.map(([t]) => `'${t}'`) }, 'values.batchClear');
await sheets('POST', `/${sheetLine.id}:batchUpdate`, { requests: tabs.map(([t]) => ({ clearBasicFilter: { sheetId: have.get(t) } })) }, 'clearBasicFilter');
await sheets('POST', `/${sheetLine.id}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data: tabs.map(([t, values]) => ({ range: `'${t}'!A1`, values })) }, 'values.batchUpdate');
const reqs = [];
for (const [t, values, widths] of tabs) {
  const id = have.get(t), n = Math.max(values.length, 2);
  reqs.push({ updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
  reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.12, green: 0.23, blue: 0.37 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
  reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 1, endRowIndex: n }, cell: { userEnteredFormat: { textFormat: { bold: false }, backgroundColor: { red: 1, green: 1, blue: 1 }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,wrapStrategy,verticalAlignment)' } });
  widths.forEach((px, k) => reqs.push({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: k, endIndex: k + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
  reqs.push({ setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: 0, endRowIndex: n, startColumnIndex: 0, endColumnIndex: widths.length } } } });
}
await sheets('POST', `/${sheetLine.id}:batchUpdate`, { requests: reqs }, 'batchUpdate (format)');
fs.appendFileSync(`${INV}/${LNAME}`, JSON.stringify({ type: 'owner-sheet-rebuild', status: 'done', id: sheetLine.id, counts: { [TAB_GF]: gf.length, [TAB_GA]: ga.length, [TAB_RET]: ret.length }, ts: new Date().toISOString() }) + '\n');
console.log(JSON.stringify({ owner: OWNER, sheet: sheetLine.id, ...counts }, null, 1));

// "Your moved files – <owner> – <date>": a Google Sheet in the admin account's My Drive listing what a run moved,
// shared with the owner only (viewer, no notification email).
// CLI:    node scripts/migration/owner-sheet.mjs <owner>@ [--ledger <file>] [--since <ISO time>]
// Module: buildOwnerSheet({ owner, ledgerFile, since }) → { url, id, counts }
// Writes: creates one spreadsheet, writes its values/format, adds one reader permission for the owner. Nothing else.
import fs from 'fs';
import { fileURLToPath } from 'url';
import { INV, CFG, ADMIN, emailOf, token, sheets, vanTime, loadCsv, loadJsonl } from './migration-log.mjs';

const parentPath = v => v ? (v.path.endsWith('/' + v.name) ? v.path.slice(0, -(v.name.length + 1)) : v.path) : '';
let INVENTORY = null;
const inventory = () => INVENTORY ||= new Map(loadCsv(CFG.files.inventory).map(r => [r.file_id, r]));

export async function buildOwnerSheet({ owner, ledgerFile, since = '' }) {
  const ownerEmail = emailOf(owner), short = owner.replace(/@$/, '');
  const ledger = ledgerFile || `move-${short}-ledger.jsonl`;
  const lines = loadJsonl(ledger).filter(x => x.type === 'move' && x.status === 'done' && (x.ts || '') >= since);
  if (!lines.length) return { skipped: 'no completed moves in this run' };
  const plan = new Map(loadCsv(CFG.files.v6).map(r => [r.file_id, r]));
  const inv = inventory();
  const rows = lines.map(x => {
    const v = inv.get(x.id); const name = plan.get(x.id)?.name || v?.name || x.id;
    const was = (parentPath(v) || '').replace(/^My Drive$/, 'My Drive (top level)');
    return { drive: x.drive, name, id: x.id, was, now: `${x.drive}/${x.dest}` };
  });
  const tabs = [[CFG.drives.sorted.name, `Moved to ${CFG.drives.sorted.name}`], [CFG.drives.archive.name, `Moved to ${CFG.drives.archive.name}`]];
  const date = vanTime(lines[0].ts).slice(0, 10);
  const title = `Your moved files – ${owner} – ${date}`;
  const created = await sheets('POST', '', { properties: { title, timeZone: 'America/Vancouver' }, sheets: tabs.map(([, t]) => ({ properties: { title: t, gridProperties: { frozenRowCount: 1 } } })) }, 'spreadsheets.create (owner sheet)');
  const sid = created.spreadsheetId; const tabId = Object.fromEntries(created.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const esc = s => String(s).replace(/"/g, '""');
  const data = tabs.map(([drive, t]) => ({ range: `'${t}'!A1`, values: [['File', 'Was in', 'Now in'], ...rows.filter(r => r.drive === drive).sort((a, b) => a.now.localeCompare(b.now) || a.name.localeCompare(b.name)).map(r => [`=HYPERLINK("https://drive.google.com/open?id=${r.id}","${esc(r.name)}")`, r.was, r.now])] }));
  await sheets('POST', `/${sid}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data }, 'values.batchUpdate (owner sheet)');
  const reqs = [];
  for (const [, t] of tabs) {
    const id = tabId[t], n = rows.filter(r => `Moved to ${r.drive}` === t).length + 1;
    reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.12, green: 0.23, blue: 0.37 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
    reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 1, endRowIndex: Math.max(n, 2) }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)' } });
    [340, 380, 380].forEach((px, i) => reqs.push({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
    reqs.push({ setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: 0, endRowIndex: Math.max(n, 2), startColumnIndex: 0, endColumnIndex: 3 } } } });
  }
  await sheets('POST', `/${sid}:batchUpdate`, { requests: reqs }, 'batchUpdate (owner sheet format)');
  // share with the owner only: viewer, no notification email
  const tok = await token(ADMIN);
  const p = await fetch(`https://www.googleapis.com/drive/v3/files/${sid}/permissions?sendNotificationEmail=false&fields=id,role,emailAddress`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: ownerEmail }) });
  const pj = await p.json(); if (!p.ok) throw new Error(`share ${p.status}: ${JSON.stringify(pj).slice(0, 200)}`);
  const v = await (await fetch(`https://www.googleapis.com/drive/v3/files/${sid}?fields=webViewLink,owners(emailAddress),permissions(emailAddress,role,type)`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  const counts = Object.fromEntries(tabs.map(([d, t]) => [t, rows.filter(r => r.drive === d).length]));
  fs.appendFileSync(`${INV}/${ledger}`, JSON.stringify({ type: 'owner-sheet', status: 'done', id: sid, title, shared_with: ownerEmail, role: 'reader', permission_id: pj.id, counts, ts: new Date().toISOString() }) + '\n');
  return { url: v.webViewLink, id: sid, title, counts, owners: v.owners, permissions: v.permissions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const owner = process.argv[2]; if (!owner?.endsWith('@')) { console.error('usage: owner-sheet.mjs <owner>@ [--ledger <file>] [--since <ISO>]'); process.exit(2); }
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const r = await buildOwnerSheet({ owner, ledgerFile: arg('--ledger'), since: arg('--since') || '' });
  console.log(JSON.stringify(r, null, 1));
}

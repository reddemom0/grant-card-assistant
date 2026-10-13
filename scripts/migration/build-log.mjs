// Build "Drive migration log" (+ "Dropbox migration log – Aug 2026") from the local ledgers.
// Drive/Sheets writes: create the two spreadsheets, write their values, format them. Nothing else.
import fs from 'fs';
import { INV, CONFIG, CFG, ADMIN, HEADER, RUNS_HEADER, SA_LABEL, token, sheets, tally, callTally, vanTime, link, toCells, countsText, parseCsv } from './migration-log.mjs';
const BL = CFG.buildLog, F = CFG.files;
const LG = kind => BL.ledgers.find(l => l.kind === kind);
const SORTED = CFG.drives.sorted.name;
const load = p => { const it = parseCsv(fs.readFileSync(`${INV}/${p}`, 'utf8')); const h = it.next().value; const o = []; for (const r of it) if (r.length > 1) o.push(Object.fromEntries(h.map((k, i) => [k, r[i]]))); return o; };
const jl = p => fs.readFileSync(`${INV}/${p}`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
if (fs.existsSync(CONFIG) && !process.argv.includes('--force')) { console.error(`ABORT: ${CONFIG} exists — the sheet was already built`); process.exit(2); }

// ---------------------------------------------------------------- lookups
const invNow = new Map(load(F.inventory).map(r => [r.file_id, r]));
const invSep = new Map(load(F.inventorySeptember).map(r => [r.file_id, r]));
const wPlan = new Map(load(F.writersPlan).map(r => [r.drive_file_id, r]));
const v6 = new Map(load(F.v6).map(r => [r.file_id, r]));
const fb = new Map(load(F.foldbackExecuted).map(r => [r.file_id, r]));
const parentPath = v => v ? (v.path.endsWith('/' + v.name) ? v.path.slice(0, -(v.name.length + 1)) : v.path) : '';
const nameOf = id => wPlan.get(id)?.file_name || v6.get(id)?.name || fb.get(id)?.file_name || invNow.get(id)?.name || invSep.get(id)?.name || '';

// ---------------------------------------------------------------- normalise
const rows = [], unfinished = [], doneCounts = {};
const done = (ledger) => { doneCounts[ledger] = (doneCounts[ledger] || 0) + 1; };
// 1. restructure ledger
{
  const C = LG('restructure'); const L = jl(C.file); const roots = new Map(L.filter(x => x.action === 'create-root').map(x => [x.id, x.name]));
  const A = { 'create-root': 'folder created', move: 'move', shortcut: 'shortcut', rename: 'rename', 'rename-root': 'rename', 'shortcut-relabel': 'shortcut relabelled', 'trash-empty-folder': 'empty folder trashed' };
  for (const x of L) {
    if (x.status !== 'ok') { unfinished.push({ ts: x.timestamp, run: C.run, what: `${x.action} "${x.name}"`, id: x.id, state: `failed: ${x.error || ''}`, ledger: C.file }); continue; }
    done(C.file);
    const to = x.action === 'move' ? `${SORTED}/${roots.get(x.newParent) || `folder ${x.newParent}`}/${x.name}` : x.action === 'shortcut' ? `shortcut "${x.name}" → ${x.target}` : x.newName ? x.newName : x.action === 'create-root' ? `${SORTED}/${x.name}` : '';
    const from = x.newName ? x.name : x.action === 'trash-empty-folder' ? `${SORTED}/${x.name}` : '';
    rows.push({ ts: x.timestamp, run: C.run, action: A[x.action] || x.action, name: x.action === 'trash-empty-folder' ? x.name.split('/').pop() : x.name, id: x.id, owner: 'shared drive', from, to, sharing: '', by: SA_LABEL, ledger: C.file });
  }
}
// 2. fold-back ledger
{ const C = LG('foldback');
for (const x of jl(C.file)) {
  if (x.status !== 'complete') { unfinished.push({ ts: x.ts, run: C.run, what: 'move', id: x.file_id, state: x.status, ledger: C.file }); continue; }
  done(C.file); const f = fb.get(x.file_id);
  rows.push({ ts: x.ts_done || x.ts, run: C.run, action: 'move', name: nameOf(x.file_id), id: x.file_id, owner: 'shared drive', from: f?.current_path ? parentPath({ path: f.current_path, name: f.file_name }) : parentPath(invSep.get(x.file_id)), to: f?.destination_path || parentPath(invNow.get(x.file_id)), sharing: '', by: SA_LABEL, ledger: C.file });
} }
// 3. already-moved owner ledger (moves, folders, Meet move-back)
function pairUnfinished(L, ledger, run) {
  const key = x => `${x.type}|${x.type === 'create-folder' ? x.path : x.id}`;
  const doneKeys = new Set(L.filter(x => x.status === 'done').map(key));
  for (const x of L) { if (x.status === 'intent' && !doneKeys.has(key(x))) unfinished.push({ ts: x.ts, run, what: x.type, id: x.id || '', state: 'intent with no done line', ledger }); if (x.status === 'failed') unfinished.push({ ts: x.ts, run, what: x.type, id: x.id || '', state: `failed: ${(x.reason || x.detail || '').slice(0, 120)}`, ledger }); }
}
{
  const C = LG('writers'); const L = jl(C.file); pairUnfinished(L, C.file, C.run);
  for (const x of L) {
    if (x.status !== 'done') continue; done(C.file);
    if (x.type === 'move') rows.push({ ts: x.ts, run: C.run, action: 'move', name: nameOf(x.id), id: x.id, owner: C.owner, from: (wPlan.get(x.id)?.source_path || '').replace(/\/[^/]*$/, ''), to: `${SORTED}/${x.dest}`, sharing: '', by: ADMIN, ledger: C.file });
    else if (x.type === 'create-folder') rows.push({ ts: x.ts, run: C.run, action: 'folder created', name: x.path.split('/').pop(), id: x.id, owner: 'shared drive', from: '', to: `${SORTED}/${x.path}`, sharing: '', by: ADMIN, ledger: C.file });
    else if (x.type === 'moveback') rows.push({ ts: x.ts, run: C.moveBackRun, action: 'move back', name: nameOf(x.id), id: x.id, owner: x.owner_now || C.owner, from: C.moveBackFrom, to: parentPath(invNow.get(x.id)) || '(original My Drive folder)', sharing: '', by: ADMIN, ledger: C.file });
  }
}
// 4. pilot owner ledger (+ the fix-up add logged in the same ledger)
{
  const C = LG('owner'); const L = jl(C.file); pairUnfinished(L, C.file, C.run);
  const locNow = id => { const p = v6.get(id); if (p && p.owner === C.ownerShort) return `${p.target_drive.replace(/ \(.*\)$/, '')}/${p.target_path}`; const w = wPlan.get(id); return w ? `${SORTED}/${w.destination}` : ''; };
  for (const x of L) {
    if (x.status !== 'done') continue; done(C.file);
    const isFix = x.type === 'add-permission' && v6.get(x.id)?.owner !== C.ownerShort;
    const run = isFix ? CFG.fixupRunLabel : C.run;
    if (x.type === 'move') rows.push({ ts: x.ts, run, action: 'move', name: nameOf(x.id), id: x.id, owner: C.owner, from: parentPath(invNow.get(x.id)), to: `${x.drive}/${x.dest}`, sharing: '', by: C.owner, ledger: C.file });
    else if (x.type === 'create-folder') rows.push({ ts: x.ts, run, action: 'folder created', name: x.path.split('/').pop(), id: x.id, owner: 'shared drive', from: '', to: x.path, sharing: '', by: ADMIN, ledger: C.file });
    else if (x.type === 'remove-permission' || x.type === 'add-permission') rows.push({ ts: x.ts, run, action: x.type === 'remove-permission' ? 'access removed' : 'access added', name: nameOf(x.id), id: x.id, owner: 'shared drive', from: '', to: locNow(x.id), sharing: `${x.who}, ${x.role}`, by: ADMIN, ledger: C.file });
  }
}
rows.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
const totalDone = Object.values(doneCounts).reduce((a, b) => a + b, 0);
if (rows.length !== totalDone) throw new Error(`row/done mismatch ${rows.length} vs ${totalDone}`);
if (process.argv.includes('--check')) { const c = {}; rows.forEach(r => { const k = `${r.run} | ${r.action}`; c[k] = (c[k] || 0) + 1; }); console.log(JSON.stringify({ rows: rows.length, totalDone, doneCounts, unfinished, byRunAction: c, noName: rows.filter(r => !r.name).length, noFrom: rows.filter(r => r.action === 'move' && !r.from).length, sample: rows.slice(0, 2).map(toCells) }, null, 1)); process.exit(0); }

// ---------------------------------------------------------------- Dropbox copy log (separate file, resumable CSV → Sheet upload)
const copy = jl(BL.copyLedger.file);
const cell = x => { const s = String(x ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const dbxCsv = [['Date-time (Vancouver)', 'Dropbox path', `Drive path (${SORTED})`, 'File ID', 'File link', 'Client', 'Route', 'Status', 'Size (bytes)'].join(','),
  ...copy.map(x => [vanTime(x.timestamp), x.source, x.destination, x.drive_file_id || '', x.drive_file_id ? `https://drive.google.com/open?id=${x.drive_file_id}` : '', x.client || '', (x.type || x.action) === 'shortcut' ? 'shortcut' : (x.route || ''), x.status, x.uploaded_size ?? x.source_size ?? ''].map(cell).join(','))].join('\n') + '\n';
const copyCounts = copy.reduce((m, x) => { const k = x.status === 'failed' ? 'failed' : (x.type || x.action) === 'shortcut' ? 'shortcuts' : 'copied'; m[k] = (m[k] || 0) + 1; return m; }, {});
async function uploadCsvAsSheet(name, csv) {
  const tok = await token();
  tally('POST drive files (resumable start)');
  const s = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'text/csv' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['root'] }) });
  if (!s.ok) throw new Error(`upload start ${s.status} ${await s.text()}`);
  const loc = s.headers.get('location');
  tally('PUT drive upload (csv bytes)');
  const p = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: Buffer.from(csv, 'utf8') });
  if (!p.ok) throw new Error(`upload ${p.status} ${(await p.text()).slice(0, 300)}`);
  return p.json();
}

// ---------------------------------------------------------------- create main sheet
const created = await sheets('POST', '', { properties: { title: BL.sheetName, timeZone: 'America/Vancouver' }, sheets: [{ properties: { title: 'Log', gridProperties: { frozenRowCount: 1 } } }, { properties: { title: 'Unfinished', gridProperties: { frozenRowCount: 1 } } }, { properties: { title: 'Runs', gridProperties: { frozenRowCount: 1 } } }] }, 'spreadsheets.create');
const SID = created.spreadsheetId; const tabId = Object.fromEntries(created.sheets.map(s => [s.properties.title, s.properties.sheetId]));
fs.writeFileSync(CONFIG, JSON.stringify({ spreadsheetId: SID, url: created.spreadsheetUrl, tabs: tabId, createdAt: new Date().toISOString() }, null, 1));
console.log('created', created.spreadsheetUrl);
// Dropbox log
const dbx = await uploadCsvAsSheet(BL.copyLedger.sheetName, dbxCsv);
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); cfg.dropbox = { id: dbx.id, url: dbx.webViewLink }; fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 1));
console.log('dropbox log', dbx.webViewLink);

// Runs
const runOrder = []; const REPORT = {};
for (const l of BL.ledgers) { runOrder.push(l.run); REPORT[l.run] = l.report; if (l.moveBackRun) { runOrder.push(l.moveBackRun); REPORT[l.moveBackRun] = l.moveBackReport; } if (l.fixupReport) { runOrder.push(CFG.fixupRunLabel); REPORT[CFG.fixupRunLabel] = l.fixupReport; } }
const runRows = [[vanTime(copy[0]?.timestamp).slice(0, 10), BL.copyLedger.run, `copied ${copyCounts.copied || 0} · shortcuts ${copyCounts.shortcuts || 0} · failed ${copyCounts.failed || 0}`, CFG.approver, BL.copyLedger.file, `=HYPERLINK("${dbx.webViewLink}","${BL.copyLedger.sheetName}")`],
  ...runOrder.map(run => { const rs = rows.filter(r => r.run === run); return [vanTime(rs[0]?.ts).slice(0, 10), run, countsText(rs), CFG.approver, REPORT[run], '']; })];
const unRows = unfinished.map(u => [vanTime(u.ts), u.run, u.what, nameOf(u.id), u.id, link(u.id), u.state, u.ledger]);
await sheets('POST', `/${SID}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data: [
  { range: 'Log!A1', values: [HEADER, ...rows.map(toCells)] },
  { range: 'Unfinished!A1', values: [['Date-time (Vancouver)', 'Run', 'What', 'File name', 'File ID', 'File link', 'State', 'Ledger file'], ...unRows] },
  { range: 'Runs!A1', values: [RUNS_HEADER, ...runRows] }] }, 'values.batchUpdate');
// formatting
const widths = { Log: [130, 190, 120, 280, 120, 60, 170, 340, 340, 220, 190, 190], Unfinished: [130, 190, 140, 280, 120, 60, 280, 190], Runs: [110, 240, 420, 100, 300, 260] };
const reqs = [];
for (const [t, ws] of Object.entries(widths)) {
  const sid = tabId[t]; const n = { Log: rows.length, Unfinished: unRows.length, Runs: runRows.length }[t] + 1;
  reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.12, green: 0.23, blue: 0.37 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)' } });
  reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 1, endRowIndex: n }, cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP', textFormat: { fontSize: 9 } } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat.fontSize)' } });
  ws.forEach((px, i) => reqs.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
  reqs.push({ setBasicFilter: { filter: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: Math.max(n, 2), startColumnIndex: 0, endColumnIndex: ws.length } } } });
}
await sheets('POST', `/${SID}:batchUpdate`, { requests: reqs }, 'batchUpdate (format)');
// Dropbox sheet formatting
const dmeta = await sheets('GET', `/${dbx.id}?fields=sheets.properties`, null, 'get (dropbox sheet)'); const dsid = dmeta.sheets[0].properties.sheetId;
await sheets('POST', `/${dbx.id}:batchUpdate`, { requests: [{ updateSheetProperties: { properties: { sheetId: dsid, title: 'Copies', gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } }, { repeatCell: { range: { sheetId: dsid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }, { setBasicFilter: { filter: { range: { sheetId: dsid, startRowIndex: 0, endRowIndex: copy.length + 1, startColumnIndex: 0, endColumnIndex: 9 } } } }, ...[130, 420, 420, 120, 230, 160, 90, 80, 90].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: dsid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }))] }, 'batchUpdate (dropbox format)');

// ---------------------------------------------------------------- verify (read back)
const back = await sheets('GET', `/${SID}/values/${encodeURIComponent('Log!A2:L')}?valueRenderOption=FORMATTED_VALUE`, null, 'values.get (Log)');
const vals = back.values || [];
const spot = ['foldback', 'writers', 'owner'].map(k => LG(k).file).map(lf => { const src = rows.find(r => r.ledger === lf && r.action === 'move'); const got = vals.find(v => v[4] === src.id && v[11] === lf); return { ledger: lf, id: src.id, ledgerTime: vanTime(src.ts), sheetTime: got?.[0], ledgerTo: src.to, sheetTo: got?.[8], action: got?.[2], match: !!got && got[0] === vanTime(src.ts) && got[8] === src.to && got[2] === src.action }; });
const dback = await sheets('GET', `/${dbx.id}?fields=sheets.properties.gridProperties`, null, 'get (dropbox rows)');
const out = { logRows: vals.length, doneLines: totalDone, doneByLedger: doneCounts, unfinished: unRows.length, runs: runRows.length, spot, dropbox: { rows: copy.length, gridRows: dback.sheets[0].properties.gridProperties.rowCount, counts: copyCounts }, sheet: created.spreadsheetUrl, dropboxUrl: dbx.webViewLink, calls: callTally() };
fs.writeFileSync(`${INV}/migration-log-build.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));

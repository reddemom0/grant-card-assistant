// Re-file reviewed files out of one owner's Granted Archive folder, from a decisions file
// (dist/inventory/<owner>-archive-refile.json: files[] with id, name, decision filed|returned|held|still, dest).
//   filed    → moved as the admin account into Granted Files/<dest> (folders created as needed)
//   returned → moved as the owner into "<returnFolder>" at the top of their My Drive (they own it again). The owner
//              is a Contributor on Granted Archive, which cannot move files out, so the run raises them to Content
//              manager first and sets them back to Contributor straight after (approved by Chris 2026-10-15).
//   duplicate → moved as the admin account to <dest> inside Granted Archive (e.g. a "Duplicate copy" subfolder).
//   held / still → not touched.
// Then updates the owner's sheet ("Moved to Granted Archive" tab): "Now in" + a "Status" column.
// Usage: node scripts/migration/refile-archive.mjs <owner>@ [--dry] [--return-role organizer|fileOrganizer]
// Writes (unless --dry): folder creates, file moves, two drive-role changes for the owner; ledger lines; migration log rows; owner sheet cells.
// Never deletes, trashes, renames or changes file sharing.
import fs from 'fs';
import { INV, CFG, ADMIN, emailOf, token, sheets, loadJsonl, vanTime, appendAfterRun, countsText } from './migration-log.mjs';

const OWNER = process.argv[2], DRY = process.argv.includes('--dry');
const RAISE_TO = (i => i > 0 ? process.argv[i + 1] : 'fileOrganizer')(process.argv.indexOf('--return-role'));   // Content manager can't move files out of a shared drive; Manager ('organizer') can
if (!OWNER?.endsWith('@')) { console.error('usage: refile-archive.mjs <owner>@ [--dry]'); process.exit(2); }
const SHORT = OWNER.replace(/@$/, ''), OWNER_EMAIL = emailOf(OWNER);
const DEC = JSON.parse(fs.readFileSync(`${INV}/${SHORT}-archive-refile.json`, 'utf8'));
const GF = CFG.drives.sorted, GA = CFG.drives.archive;
const LEDGER = `${INV}/move-${SHORT}-refile-ledger.jsonl`, LNAME = `move-${SHORT}-refile-ledger.jsonl`;
const RUN = DEC.run || `${OWNER} archive re-file`, RUN_START = new Date().toISOString();
const led = (o) => fs.appendFileSync(LEDGER, JSON.stringify({ ...o, ts: new Date().toISOString() }) + '\n');
const api = async (sub, method, path, body) => {
  for (let a = 1; a <= 6; a++) {
    let r; try { r = await fetch(`https://www.googleapis.com/drive/v3${path}`, { method, headers: { Authorization: `Bearer ${await token(sub)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) }); }
    catch { await new Promise(s => setTimeout(s, 1500 * a)); continue; }
    if (r.ok) return r.status === 204 ? {} : r.json();
    const t = await r.text();
    if (r.status === 429 || r.status >= 500 || (r.status === 403 && /rate|limit/i.test(t))) { await new Promise(s => setTimeout(s, 1500 * a * a)); continue; }
    throw new Error(`${method} ${r.status}: ${t.slice(0, 200)}`);
  }
  throw new Error(`${method}: retries exhausted`);
};
const q = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// ---- folder resolution in a shared drive (exact names; create the missing tail unless --dry)
const cache = new Map([[`${GF.id}|`, GF.id], [`${GA.id}|`, GA.id]]); const created = [];
async function folder(path, drive = GF) {
  const ck = `${drive.id}|${path}`; if (cache.has(ck)) return cache.get(ck);
  const segs = path.split('/'); const parentPath = segs.slice(0, -1).join('/'), name = segs.at(-1);
  const parent = await folder(parentPath, drive);
  const label = drive === GF ? path : `${drive.name}/${path}`;
  if (parent === null) { if (DRY) created.push(label); cache.set(ck, null); return null; }
  const r = await api(ADMIN, 'GET', `/files?q=${encodeURIComponent(`'${parent}' in parents and name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&corpora=drive&driveId=${drive.id}&includeItemsFromAllDrives=true&supportsAllDrives=true&fields=files(id,name)`);
  if (r.files.length > 1) throw new Error(`two folders named "${name}" in ${parentPath || drive.name}`);
  if (r.files[0]) { cache.set(ck, r.files[0].id); return r.files[0].id; }
  if (DRY) { created.push(label); cache.set(ck, null); return null; }
  led({ type: 'create-folder', status: 'intent', path: `${drive.name}/${path}` });
  const c = await api(ADMIN, 'POST', `/files?supportsAllDrives=true&fields=id`, { name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] });
  led({ type: 'create-folder', status: 'done', id: c.id, path: `${drive.name}/${path}` }); created.push(label); cache.set(ck, c.id); return c.id;
}

// ---- the owner's drive role on Granted Archive
async function ownerPerm() {
  const r = await api(ADMIN, 'GET', `/files/${GA.id}/permissions?supportsAllDrives=true&fields=permissions(id,emailAddress,role)`);
  return r.permissions.find(p => (p.emailAddress || '').toLowerCase() === OWNER_EMAIL);
}
async function setRole(role) {
  const p = await ownerPerm(); if (!p) throw new Error(`${OWNER_EMAIL} is not a member of ${GA.name}`);
  if (p.role === role) return { from: role, to: role };
  led({ type: 'drive-role', status: 'intent', drive: GA.name, who: OWNER_EMAIL, from: p.role, to: role });
  await api(ADMIN, 'PATCH', `/files/${GA.id}/permissions/${p.id}?supportsAllDrives=true&fields=id,role`, { role });
  const v = await ownerPerm(); if (v?.role !== role) throw new Error(`role not changed (now ${v?.role})`);
  led({ type: 'drive-role', status: 'done', drive: GA.name, who: OWNER_EMAIL, from: p.role, to: role }); return { from: p.role, to: role };
}

const res = { filed: 0, returned: 0, duplicate: 0, held: 0, still: 0, failed: [], notInArchive: [], foldersCreated: 0, roles: [] };
const plan = DEC.files;
const doneIds = new Set(fs.existsSync(LEDGER) ? loadJsonl(LNAME).filter(x => x.type === 'move' && x.status === 'done').map(x => x.id) : []);   // a re-run skips what is already done
const toMove = plan.filter(f => ['filed', 'returned', 'duplicate'].includes(f.decision) && !doneIds.has(f.id));
for (const f of plan) if (f.decision === 'held' || f.decision === 'still') res[f.decision]++;

// check every file to move is still in the owner's archive folder
const cur = new Map();
for (const f of toMove) {
  const v = await api(ADMIN, 'GET', `/files/${f.id}?supportsAllDrives=true&fields=id,name,parents,driveId,trashed`);
  if (v.trashed || v.driveId !== GA.id) res.notInArchive.push(`${f.name}: ${v.trashed ? 'trashed' : 'not in ' + GA.name}`); else cur.set(f.id, v.parents[0]);
}
if (DRY) {
  for (const f of toMove.filter(f => f.decision === 'filed')) await folder(f.dest);
  for (const f of toMove.filter(f => f.decision === 'duplicate')) await folder(f.dest, GA);
  console.log(JSON.stringify({ dry: true, toFile: toMove.filter(f => f.decision === 'filed').length, toDuplicate: toMove.filter(f => f.decision === 'duplicate').length, toReturn: toMove.filter(f => f.decision === 'returned').length, held: res.held, still: res.still, notInArchive: res.notInArchive, newFolders: created.length, newFolderList: created, ownerRole: (await ownerPerm())?.role }, null, 1));
  process.exit(0);
}
if (res.notInArchive.length) { console.error('STOP: files not where expected:\n' + res.notInArchive.join('\n')); process.exit(3); }

// 1. filed → Granted Files, as the admin account
for (const f of toMove.filter(f => f.decision === 'filed')) {
  try {
    const dest = await folder(f.dest), from = cur.get(f.id);
    led({ type: 'move', status: 'intent', id: f.id, kind: 'filed', from_parent: from, to_parent: dest, drive: GF.name, dest: f.dest });
    await api(ADMIN, 'PATCH', `/files/${f.id}?supportsAllDrives=true&addParents=${dest}&removeParents=${from}&fields=id`, {});
    const v = await api(ADMIN, 'GET', `/files/${f.id}?supportsAllDrives=true&fields=parents,driveId,name`);
    if (v.driveId !== GF.id || !v.parents.includes(dest) || v.name !== f.name) throw new Error('verify failed');
    led({ type: 'move', status: 'done', id: f.id, kind: 'filed', from_parent: from, to_parent: dest, drive: GF.name, dest: f.dest }); res.filed++;
  } catch (e) { res.failed.push(`${f.name}: ${e.message}`); led({ type: 'move', status: 'failed', id: f.id, kind: 'filed', detail: e.message }); }
}
// 1b. duplicate → a subfolder inside Granted Archive, as the admin account
for (const f of toMove.filter(f => f.decision === 'duplicate')) {
  try {
    const dest = await folder(f.dest, GA), from = cur.get(f.id);
    led({ type: 'move', status: 'intent', id: f.id, kind: 'duplicate', from_parent: from, to_parent: dest, drive: GA.name, dest: f.dest });
    await api(ADMIN, 'PATCH', `/files/${f.id}?supportsAllDrives=true&addParents=${dest}&removeParents=${from}&fields=id`, {});
    const v = await api(ADMIN, 'GET', `/files/${f.id}?supportsAllDrives=true&fields=parents,driveId,name`);
    if (v.driveId !== GA.id || !v.parents.includes(dest) || v.name !== f.name) throw new Error('verify failed');
    led({ type: 'move', status: 'done', id: f.id, kind: 'duplicate', from_parent: from, to_parent: dest, drive: GA.name, dest: f.dest }); res.duplicate++;
  } catch (e) { res.failed.push(`${f.name}: ${e.message}`); led({ type: 'move', status: 'failed', id: f.id, kind: 'duplicate', detail: e.message }); }
}
res.foldersCreated = created.length;

// 2. returned → the owner's My Drive, as the owner (role raised for the duration, then set back)
const ret = toMove.filter(f => f.decision === 'returned');
if (ret.length) {
  try {
    res.roles.push(await setRole(RAISE_TO));
    // a role change takes a while to reach the owner's files: wait until Google says they can move one out
    const t0 = Date.now(); let can = false;
    while (Date.now() - t0 < 15 * 60000) { const c = await api(OWNER_EMAIL, 'GET', `/files/${ret[0].id}?supportsAllDrives=true&fields=capabilities(canMoveItemOutOfDrive)`); if (c.capabilities?.canMoveItemOutOfDrive) { can = true; break; } await new Promise(s => setTimeout(s, 20000)); }
    res.waitedSeconds = Math.round((Date.now() - t0) / 1000);
    if (!can) throw new Error(`after ${res.waitedSeconds}s Google still does not let ${OWNER_EMAIL} move files out of ${GA.name}`);
    const root = (await api(OWNER_EMAIL, 'GET', `/files/root?fields=id`)).id;
    const found = await api(OWNER_EMAIL, 'GET', `/files?q=${encodeURIComponent(`'${root}' in parents and name = '${q(DEC.returnFolder)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&fields=files(id)`);
    let rf = found.files[0]?.id;
    if (!rf) { led({ type: 'create-folder', status: 'intent', path: `My Drive (${OWNER_EMAIL})/${DEC.returnFolder}` }); rf = (await api(OWNER_EMAIL, 'POST', `/files?fields=id`, { name: DEC.returnFolder, mimeType: 'application/vnd.google-apps.folder', parents: [root] })).id; led({ type: 'create-folder', status: 'done', id: rf, path: `My Drive (${OWNER_EMAIL})/${DEC.returnFolder}` }); res.foldersCreated++; }
    for (const f of ret) {
      try {
        const from = cur.get(f.id);
        led({ type: 'move', status: 'intent', id: f.id, kind: 'returned', from_parent: from, to_parent: rf, drive: 'My Drive', dest: DEC.returnFolder });
        await api(OWNER_EMAIL, 'PATCH', `/files/${f.id}?supportsAllDrives=true&addParents=${rf}&removeParents=${from}&fields=id`, {});
        const v = await api(OWNER_EMAIL, 'GET', `/files/${f.id}?supportsAllDrives=true&fields=parents,driveId,owners(emailAddress),name`);
        if (v.driveId || !v.parents.includes(rf) || v.name !== f.name) throw new Error('verify failed');
        led({ type: 'move', status: 'done', id: f.id, kind: 'returned', from_parent: from, to_parent: rf, drive: 'My Drive', dest: DEC.returnFolder, owner_now: v.owners?.[0]?.emailAddress || '' }); res.returned++;
      } catch (e) { res.failed.push(`${f.name}: ${e.message}`); led({ type: 'move', status: 'failed', id: f.id, kind: 'returned', detail: e.message }); }
    }
  } catch (e) { res.failed.push(e.message); } finally {
    try { res.roles.push(await setRole('writer')); } catch (e) { res.failed.push(`SET ROLE BACK FAILED — do it by hand: ${e.message}`); }
  }
}

// 3. migration log
const lines = loadJsonl(LNAME).filter(x => (x.ts || '') >= RUN_START && x.status === 'done');
const byId = new Map(plan.map(f => [f.id, f]));
const rows = lines.map(x => {
  const base = { ts: x.ts, run: RUN, ledger: LNAME };
  if (x.type === 'move') { const f = byId.get(x.id); return { ...base, action: 'move', name: f.name, id: x.id, owner: x.kind === 'returned' ? OWNER_EMAIL : 'shared drive', from: `${GA.name}/${f.from}`, to: x.kind === 'returned' ? `My Drive (${OWNER_EMAIL})/${x.dest}` : `${x.drive}/${x.dest}`, sharing: '', by: x.kind === 'returned' ? OWNER_EMAIL : ADMIN }; }
  if (x.type === 'create-folder') return { ...base, action: 'folder created', name: x.path.split('/').pop(), id: x.id, owner: '', from: '', to: x.path, sharing: '', by: x.path.startsWith('My Drive') ? OWNER_EMAIL : ADMIN };
  if (x.type === 'drive-role') return { ...base, action: 'drive role changed', name: x.drive, id: '', owner: '', from: '', to: '', sharing: `${x.who}: ${x.from} → ${x.to} (to return personal files; approved)`, by: ADMIN };
  return null;
}).filter(Boolean);
const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), RUN, countsText(rows) || 'no changes', CFG.approver, LNAME, '']);
res.log = lg.ok ? `appended ${rows.length} rows` : lg.warning;

// 4. owner sheet: "Moved to Granted Archive" tab → Now in + Status
const sheetLine = loadJsonl(`move-${SHORT}-ledger.jsonl`).filter(x => x.type === 'owner-sheet' && x.status === 'done').pop();
if (sheetLine) {
  const moved = new Map(loadJsonl(LNAME).filter(x => x.type === 'move' && x.status === 'done').map(x => [x.id, x]));
  const tab = `Moved to ${GA.name}`;
  const v = await sheets('GET', `/${sheetLine.id}/values/${encodeURIComponent(`'${tab}'!A:A`)}?valueRenderOption=FORMULA`, null, 'values.get (owner sheet)');
  const data = []; let counted = 0;
  (v.values || []).forEach((r, i) => {
    if (i === 0) { data.push({ range: `'${tab}'!E1`, values: [['Status']] }); return; }
    const id = (String(r[0] || '').match(/open\?id=([\w-]+)/) || [])[1]; const f = byId.get(id); if (!f) return;
    const m = moved.get(id);
    const status = m ? ({ returned: 'Returned to you', duplicate: 'Duplicate' }[m.kind] || 'Filed') : f.decision === 'held' ? 'Held' : 'Still in Archive';
    if (m) data.push({ range: `'${tab}'!C${i + 1}`, values: [[m.kind === 'returned' ? `My Drive/${m.dest}` : `${m.drive}/${m.dest}`]] });
    data.push({ range: `'${tab}'!E${i + 1}`, values: [[status]] }); counted++;
  });
  await sheets('POST', `/${sheetLine.id}/values:batchUpdate`, { valueInputOption: 'RAW', data }, 'values.batchUpdate (owner sheet re-file)');
  res.sheet = { id: sheetLine.id, rowsUpdated: counted };
}
console.log(JSON.stringify(res, null, 1));
process.exit(res.failed.length ? 1 : 0);

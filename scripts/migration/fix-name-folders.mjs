// Fix files that an earlier run put inside folders made from the file's own name (a name with "/" in it, e.g.
// "F/U Email 4.pdf" landed in ".../F"). Moves each such file up into the real parent folder and updates the
// "Now in" cell on the owner's sheet. The emptied folders are left in place (nothing is trashed).
// Only acts when (1) the destination's tail spells the file's own name, (2) those tail folders were created by
// this migration (create-folder lines in the ledger), and (3) the file is still in that folder.
// Usage: node scripts/migration/fix-name-folders.mjs <owner>@ [<owner>@ ...] [--dry]
// Writes (unless --dry): one files.update per file as the admin account; ledger lines; migration log rows; owner sheet cells.
import fs from 'fs';
import { INV, CFG, ADMIN, token, sheets, loadCsv, loadJsonl, vanTime, appendAfterRun, countsText } from './migration-log.mjs';

const args = process.argv.slice(2), DRY = args.includes('--dry'), owners = args.filter(a => a.endsWith('@'));
if (!owners.length) { console.error('usage: fix-name-folders.mjs <owner>@ [...] [--dry]'); process.exit(2); }
const inv = new Map(loadCsv(CFG.files.inventory).map(r => [r.file_id, r]));
const ledgerOf = o => fs.existsSync(`${INV}/move-${o.replace(/@$/, '')}-ledger.jsonl`) ? `move-${o.replace(/@$/, '')}-ledger.jsonl` : null;
// how many trailing folders of dest spell the start of the file name (0 = none)
const nameTail = (dest, name) => {
  if (!name.includes('/')) return 0;
  const parts = name.split('/').map(x => x.trim()), segs = dest.split('/').map(x => x.trim());
  for (let i = 1; i < segs.length; i++) { const t = segs.slice(i); if (t.length < parts.length && t.every((x, k) => x === parts[k])) return t.length; }
  return 0;
};
const api = async (method, path, body) => {
  for (let a = 1; a <= 5; a++) {
    const r = await fetch(`https://www.googleapis.com/drive/v3${path}`, { method, headers: { Authorization: `Bearer ${await token(ADMIN)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${method} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await new Promise(s => setTimeout(s, 1500 * a));
  }
  throw new Error(`${method}: retries exhausted`);
};

const out = {};
for (const owner of owners) {
  const ledger = ledgerOf(owner); if (!ledger) { out[owner] = { error: 'no ledger' }; continue; }
  const L = `${INV}/${ledger}`, RUN_START = new Date().toISOString(), lines = loadJsonl(ledger);
  const created = new Map(lines.filter(x => x.type === 'create-folder' && x.status === 'done').map(x => [x.path.replace(/^[^/]+\//, ''), x.id]));   // path inside the drive → folder id
  const lastMove = new Map(); for (const x of lines) if ((x.type === 'move' || x.type === 'name-folder-fix') && x.status === 'done') lastMove.set(x.id, x);
  const res = out[owner] = { candidates: 0, fixed: 0, skipped: [], failed: [], sheetCells: 0 };
  const fixes = [];
  for (const [id, x] of lastMove) {
    if (x.type !== 'move') continue;   // already fixed
    const name = inv.get(id)?.name || ''; const n = nameTail(x.dest, name); if (!n) continue;
    res.candidates++;
    const segs = x.dest.split('/'); const newDest = segs.slice(0, -n).join('/');
    const fake = created.get(x.dest), real = newDest.split('/').length ? (created.get(newDest) || null) : null;
    if (!fake) { res.skipped.push(`${name}: folder "${segs.slice(-n).join('/')}" was not created by this migration`); continue; }
    fixes.push({ id, name, drive: x.drive, from: x.dest, to: newDest, fakeId: fake, realId: real, n });
  }
  if (DRY) { res.plan = fixes.map(f => `${f.name}: ${f.from} → ${f.to}`); continue; }
  for (const f of fixes) {
    const base = { type: 'name-folder-fix', id: f.id, drive: f.drive, from: f.from, dest: f.to, remove_parent: f.fakeId };
    try {
      const file = await api('GET', `/files/${f.id}?supportsAllDrives=true&fields=parents,name,trashed`);
      if (file.trashed || !(file.parents || []).includes(f.fakeId)) { res.skipped.push(`${f.name}: no longer in the made-up folder`); continue; }
      let realId = f.realId, cur = f.fakeId;   // walk up n levels from the made-up folder when the parent id isn't in the ledger
      if (!realId) { for (let i = 0; i < f.n; i++) cur = (await api('GET', `/files/${cur}?supportsAllDrives=true&fields=parents`)).parents[0]; realId = cur; }
      fs.appendFileSync(L, JSON.stringify({ ...base, add_parent: realId, status: 'intent', ts: new Date().toISOString() }) + '\n');
      await api('PATCH', `/files/${f.id}?supportsAllDrives=true&addParents=${realId}&removeParents=${f.fakeId}&fields=id,parents`, {});
      const v = await api('GET', `/files/${f.id}?supportsAllDrives=true&fields=parents`);
      if (!(v.parents || []).includes(realId)) throw new Error('verify failed: not in the real parent');
      fs.appendFileSync(L, JSON.stringify({ ...base, add_parent: realId, status: 'done', ts: new Date().toISOString() }) + '\n');
      res.fixed++; f.done = true;
    } catch (e) { res.failed.push(`${f.name}: ${e.message}`); fs.appendFileSync(L, JSON.stringify({ ...base, status: 'failed', detail: e.message, ts: new Date().toISOString() }) + '\n'); }
  }
  const done = fixes.filter(f => f.done);
  // migration log
  const rows = done.map(f => ({ ts: new Date().toISOString(), run: `fix name-folders (${owner})`, ledger, action: 'move', name: f.name, id: f.id, owner: 'shared drive', from: `${f.drive}/${f.from}`, to: `${f.drive}/${f.to}`, sharing: '', by: ADMIN }));
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), `fix name-folders (${owner})`, countsText(rows) || 'no changes', CFG.approver, ledger, '']);
  res.log = lg.ok ? `appended ${rows.length} rows` : lg.warning;
  // owner sheet: rewrite "Now in" (column C) for the fixed files
  const sheet = lines.filter(x => x.type === 'owner-sheet' && x.status === 'done').pop();
  if (sheet && done.length) {
    const byId = new Map(done.map(f => [f.id, `${f.drive}/${f.to}`]));
    const meta = await sheets('GET', `/${sheet.id}?fields=sheets.properties.title`, null, 'spreadsheets.get (owner sheet)');
    const data = [];
    for (const t of meta.sheets.map(s => s.properties.title).filter(t => t.startsWith('Moved to '))) {
      const v = await sheets('GET', `/${sheet.id}/values/${encodeURIComponent(`'${t}'!A:A`)}?valueRenderOption=FORMULA`, null, 'values.get (owner sheet)');
      (v.values || []).forEach((r, i) => { const id = (String(r[0] || '').match(/open\?id=([\w-]+)/) || [])[1]; if (byId.has(id)) data.push({ range: `'${t}'!C${i + 1}`, values: [[byId.get(id)]] }); });
    }
    if (data.length) await sheets('POST', `/${sheet.id}/values:batchUpdate`, { valueInputOption: 'RAW', data }, 'values.batchUpdate (owner sheet fix)');
    res.sheetCells = data.length; res.sheet = sheet.id;
  }
}
console.log(JSON.stringify({ dry: DRY, owners: out }, null, 1));

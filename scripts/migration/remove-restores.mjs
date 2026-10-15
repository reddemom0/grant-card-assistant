// Take back share restores made to one address by earlier runs (the address is then on config.noRestoreAccounts,
// so build-v6 never plans a restore for it again). Reads the owners' ledgers; touches only permissions those
// ledgers record as added for that address.
// Usage: node scripts/migration/remove-restores.mjs <address> <owner>@ [<owner>@ ...] [--dry]
// Writes (unless --dry): one permissions.delete per restore, as the admin account; ledger lines; migration log rows.
import fs from 'fs';
import { INV, CFG, ADMIN, token, loadCsv, loadJsonl, vanTime, moveOwnerRows, appendAfterRun, countsText } from './migration-log.mjs';

const args = process.argv.slice(2), DRY = args.includes('--dry');
const who = (args[0] || '').toLowerCase(), owners = args.slice(1).filter(a => a.endsWith('@'));
if (!who.includes('@') || who.endsWith('@') || !owners.length) { console.error('usage: remove-restores.mjs <address> <owner>@ [...] [--dry]'); process.exit(2); }
if (!(CFG.noRestoreAccounts || []).map(x => x.toLowerCase()).includes(who)) { console.error(`STOP: ${who} is not on config.noRestoreAccounts`); process.exit(2); }

const plan = new Map(loadCsv(CFG.files.v6).map(r => [r.file_id, r]));
const RUN_START = new Date().toISOString(), runName = `remove restores: ${who}`;
const api = async (method, path) => {
  for (let a = 1; a <= 5; a++) {
    const r = await fetch(`https://www.googleapis.com/drive/v3${path}`, { method, headers: { Authorization: `Bearer ${await token(ADMIN)}` } });
    if (r.ok) return r.status === 204 ? {} : r.json();
    if (r.status === 404) return { notFound: true };
    if (r.status !== 429 && r.status < 500) throw new Error(`${method} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await new Promise(s => setTimeout(s, 1500 * a));
  }
  throw new Error(`${method}: retries exhausted`);
};
const out = {};
for (const owner of owners) {
  const ledger = `move-${owner.replace(/@$/, '')}-ledger.jsonl`, L = `${INV}/${ledger}`;
  const lines = loadJsonl(ledger);
  const gone = new Set(lines.filter(x => x.type === 'remove-permission' && x.status === 'done' && (x.who || '').toLowerCase() === who).map(x => x.id));
  const adds = lines.filter(x => x.type === 'add-permission' && x.status === 'done' && (x.who || '').toLowerCase() === who && !gone.has(x.id));
  const res = out[owner] = { found: adds.length, removed: 0, alreadyGone: 0, failed: [] };
  if (DRY) continue;
  for (const x of adds) {
    const line = { type: 'remove-permission', id: x.id, who: x.who, role: x.role, permission_id: x.permission_id, reason: `no restores for ${who}` };
    fs.appendFileSync(L, JSON.stringify({ ...line, status: 'intent', ts: new Date().toISOString() }) + '\n');
    try {
      const perms = await api('GET', `/files/${x.id}/permissions?supportsAllDrives=true&fields=permissions(id,emailAddress,permissionDetails)`);
      const p = (perms.permissions || []).find(q => q.id === x.permission_id || (q.emailAddress || '').toLowerCase() === who);
      if (!p) { res.alreadyGone++; fs.appendFileSync(L, JSON.stringify({ ...line, status: 'done', detail: 'already gone', ts: new Date().toISOString() }) + '\n'); continue; }
      await api('DELETE', `/files/${x.id}/permissions/${p.id}?supportsAllDrives=true`);
      const after = await api('GET', `/files/${x.id}/permissions?supportsAllDrives=true&fields=permissions(id,emailAddress)`);
      if ((after.permissions || []).some(q => (q.emailAddress || '').toLowerCase() === who)) throw new Error('still listed after delete');
      res.removed++; fs.appendFileSync(L, JSON.stringify({ ...line, status: 'done', ts: new Date().toISOString() }) + '\n');
    } catch (e) { res.failed.push(`${x.id}: ${e.message}`); fs.appendFileSync(L, JSON.stringify({ ...line, status: 'failed', detail: e.message, ts: new Date().toISOString() }) + '\n'); }
  }
  const done = loadJsonl(ledger).filter(x => (x.ts || '') >= RUN_START && x.type === 'remove-permission');
  const rows = moveOwnerRows(done, { run: runName, owner: owner, ownerEmail: ADMIN, ledger, names: id => plan.get(id)?.name || '', from: () => '', to: id => { const p = plan.get(id); return p ? `${p.target_drive.replace(/ \(.*\)$/, '')}/${p.target_path}` : ''; } });
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), `${runName} (${owner})`, countsText(rows) || 'no changes', CFG.approver, ledger, '']);
  res.log = lg.ok ? `appended ${rows.length} rows` : lg.warning;
}
console.log(JSON.stringify({ who, dry: DRY, owners: out }, null, 1));

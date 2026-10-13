// Live move for one owner from the v6 move plan + post-move sharing actions. Plus optional sharing fix-up adds.
// Writes: files.create (folders, as the admin account), files.update addParents/removeParents (as the owner),
//         permissions.delete (planned removes), permissions.create (planned restores, no notification email).
// Never: trash, delete files, rename, copy. Ledger line BEFORE every write.
// Usage: node scripts/migration/move-owner.mjs <owner>@ [--fixup] [--plan <csv>] [--tag <name>]   live run
//        node scripts/migration/move-owner.mjs <owner>@ --undo [--plan <csv>] [--tag <name>]                 reverse this owner's done actions (newest first)
// After every live run or undo, actions are appended to the "Drive migration log" sheet (failure = warning only).
import fs from 'fs';
import crypto from 'crypto';
import { moveOwnerRows, countsText, appendAfterRun, vanTime, ROOT, INV, CFG, ADMIN, DRIVES, emailOf, parseCsv } from './migration-log.mjs';
const D = INV;
const OWNER = process.argv[2], OWNER_EMAIL = emailOf(OWNER), SHORT = OWNER.replace(/@$/, '');
const argVal = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const TAG = argVal('--tag'), PLAN_FILE = argVal('--plan') || `${D}/${CFG.files.v6}`;   // --plan/--tag: for tests or one-off batches
const LTAG = TAG ? `${SHORT}-${TAG}` : SHORT;
const LEDGER = `${D}/move-${LTAG}-ledger.jsonl`, REPORT = `${D}/move-${LTAG}-report.md`;
const load = p => { const it = parseCsv(fs.readFileSync(p, 'utf8')); const h = it.next().value; const o = []; for (const r of it) if (r.length > 1) o.push(Object.fromEntries(h.map((k, i) => [k, r[i]]))); return o; };
const plan = (PLAN_FILE.startsWith('/') ? (() => { const it = parseCsv(fs.readFileSync(PLAN_FILE, 'utf8')); const h = it.next().value; const o = []; for (const r of it) if (r.length > 1) o.push(Object.fromEntries(h.map((k, i) => [k, r[i]]))); return o; })() : load(PLAN_FILE)).filter(r => r.owner === OWNER);
const RUN_START = new Date().toISOString();
const UNDO = process.argv.includes('--undo');
const srcFolder = new Map(load(`${D}/${CFG.files.v5}`).filter(r => r.owner === OWNER).map(r => [r.drive_file_id, r.source_folder]));
const wPlanNames = fs.existsSync(`${D}/${CFG.files.writersPlan}`) ? new Map(load(`${D}/${CFG.files.writersPlan}`).map(r => [r.drive_file_id, r])) : new Map();
const planById = new Map(plan.map(r => [r.file_id, r]));
const logCtx = { owner: `${OWNER_EMAIL}`, ownerEmail: OWNER_EMAIL, ledger: `move-${LTAG}-ledger.jsonl`,
  names: id => planById.get(id)?.name || wPlanNames.get(id)?.file_name || '',
  from: id => srcFolder.get(id) || '',
  to: id => { const p = planById.get(id); if (p) return `${p.target_drive.replace(/ \(.*\)$/, '')}/${p.target_path}`; const w = wPlanNames.get(id); return w ? `Granted Files/${w.destination}` : ''; },
  runFor: x => planById.has(x.id) ? null : CFG.fixupRunLabel };
async function logAfter(runName, report) {
  const lines = readLedger().filter(x => (x.ts || '') >= RUN_START);
  const rows = moveOwnerRows(lines, { ...logCtx, run: runName });
  const res = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), runName, countsText(rows) || 'no changes', CFG.approver, report, '']);
  if (res.ok) console.error(`migration log: appended ${rows.length} rows + 1 run row`); else console.error(`WARNING: ${res.warning}`);
}
const snap = new Map(fs.readFileSync(`${D}/${CFG.files.snapshot}`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.owner === OWNER).map(x => [x.id, x]));

const lines = fs.readFileSync(`${ROOT}/.env`, 'utf8').split('\n'); const ki = lines.findIndex(l => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY=')); let raw = lines[ki].slice(27); for (let j = ki + 1; j < lines.length; j++) { if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break; raw += '\n' + lines[j]; }
const KEY = JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
const calls = {}; const tally = k => { calls[k] = (calls[k] || 0) + 1; };
const toks = new Map();
async function token(sub) { const t = toks.get(sub); if (t && Date.now() < t.exp - 300000) return t.tok; const n = Math.floor(Date.now() / 1000), b = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const u = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iss: KEY.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', iat: n, exp: n + 3600, sub })}`; const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${u}.${crypto.createSign('RSA-SHA256').update(u).sign(KEY.private_key, 'base64url')}` }) }); tally('POST token'); const d = await r.json(); if (!r.ok) throw new Error(`token ${sub}: ${d.error_description}`); toks.set(sub, { tok: d.access_token, exp: Date.now() + d.expires_in * 1000 }); return d.access_token; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RATE = /userRateLimitExceeded|rateLimitExceeded|quotaExceeded|backendError/;
async function call(sub, method, path, label, body) {
  if (/\/trash|\/copy|alt=media|\/export/.test(path)) throw new Error(`refused ${method} ${path}`);
  if (method === 'DELETE' && !/\/permissions\/[^/?]+/.test(path)) throw new Error(`refused DELETE ${path}`);
  let delay = 1500;
  for (let a = 1; a <= 8; a++) {
    tally(`${method} ${label}`); let r;
    try { r = await fetch('https://www.googleapis.com/drive/v3' + path, { method, headers: { Authorization: `Bearer ${await token(sub)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) }); }
    catch (e) { console.error(`  transport ${e.cause?.code || e.name} (${label}, attempt ${a})`); await sleep(delay); delay *= 2; continue; }
    if (r.ok) return r.status === 204 ? {} : r.json();
    const t = await r.text();
    if (r.status === 429 || r.status >= 500 || (r.status === 403 && RATE.test(t))) { console.error(`  throttled ${r.status} (${label})`); await sleep(delay); delay = Math.min(delay * 2, 64000); continue; }
    return { __error: true, status: r.status, body: t.slice(0, 300) };
  }
  return { __error: true, status: 'retries exhausted' };
}
const ledger = o => fs.appendFileSync(LEDGER, JSON.stringify({ ...o, ts: new Date().toISOString() }) + '\n');
const readLedger = () => fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

// ---------------------------------------------------------------- folders (resolve live, create as the admin account)
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const kids = new Map(), resolved = new Map(), created = [];
async function children(driveId, pid) { const k = `${driveId}|${pid}`; if (kids.has(k)) return kids.get(k); const out = []; let pt; do { const q = new URLSearchParams({ corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', q: `'${pid}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: 'nextPageToken,files(id,name)', pageSize: '1000' }); if (pt) q.set('pageToken', pt); const d = await call(ADMIN, 'GET', `/files?${q}`, 'files.list (folders)'); if (d.__error) throw new Error(`list ${pid}: ${d.status}`); out.push(...(d.files || [])); pt = d.nextPageToken; } while (pt); kids.set(k, out); return out; }
async function resolveDest(driveName, path) {
  const driveId = DRIVES[driveName]; let cur = driveId, acc = driveName;
  for (const seg0 of path.split('/')) {
    const seg = seg0.replace(/∕/g, '/'); acc += '/' + seg; if (resolved.has(acc)) { cur = resolved.get(acc); continue; }
    const ch = await children(driveId, cur); const ex = ch.filter(x => x.name === seg), nm = ch.filter(x => norm(x.name) === norm(seg));
    if (ex.length) cur = ex[0].id; else if (nm.length === 1) cur = nm[0].id; else if (nm.length > 1) throw new Error(`ambiguous folder ${acc}`);
    else {
      ledger({ type: 'create-folder', status: 'intent', path: acc, parent: cur });
      const f = await call(ADMIN, 'POST', `/files?supportsAllDrives=true&fields=id,name`, 'files.create (folder)', { name: seg, mimeType: 'application/vnd.google-apps.folder', parents: [cur] });
      if (f.__error) { ledger({ type: 'create-folder', status: 'failed', path: acc, detail: f.body }); throw new Error(`create ${acc}: ${f.status}`); }
      ledger({ type: 'create-folder', status: 'done', path: acc, id: f.id, parent: cur }); created.push({ path: acc, id: f.id }); kids.get(`${driveId}|${cur}`)?.push({ id: f.id, name: seg }); cur = f.id;
    }
    resolved.set(acc, cur);
  }
  return cur;
}

// ---------------------------------------------------------------- sharing helpers (as the admin account, organizer of both drives)
async function removePerm(fileId, email) {
  const pl = await call(ADMIN, 'GET', `/files/${fileId}/permissions?supportsAllDrives=true&fields=permissions(id,emailAddress,role,permissionDetails)`, 'permissions.list');
  const p = (pl.permissions || []).find(x => (x.emailAddress || '').toLowerCase() === email.toLowerCase());
  if (!p) return { status: 'not present (nothing to remove)' };
  ledger({ type: 'remove-permission', status: 'intent', id: fileId, who: email, permission_id: p.id, role: p.role });
  const d = await call(ADMIN, 'DELETE', `/files/${fileId}/permissions/${p.id}?supportsAllDrives=true`, 'permissions.delete');
  const ok = !d.__error; ledger({ type: 'remove-permission', status: ok ? 'done' : 'failed', id: fileId, who: email, permission_id: p.id, role: p.role, detail: d.body || '' });
  return { status: ok ? 'removed' : `failed ${d.status}`, role: p.role };
}
async function addPerm(fileId, email, role) {
  const type = email.includes('@') ? 'user' : 'domain';
  ledger({ type: 'add-permission', status: 'intent', id: fileId, who: email, role });
  const d = await call(ADMIN, 'POST', `/files/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id,role`, 'permissions.create', type === 'user' ? { type, role, emailAddress: email } : { type, role, domain: email });
  const ok = !d.__error; ledger({ type: 'add-permission', status: ok ? 'done' : 'failed', id: fileId, who: email, role, permission_id: d.id || '', detail: d.body || '' });
  return { status: ok ? 'added' : `failed ${d.status} ${d.body || ''}` };
}

// ---------------------------------------------------------------- undo
if (UNDO) {
  const L = readLedger(); const undone = new Set(L.filter(x => x.type.startsWith('undo-') && x.status === 'done').map(x => `${x.type}|${x.id}|${x.who || ''}`));
  const steps = L.filter(x => x.status === 'done' && ['move', 'remove-permission', 'add-permission'].includes(x.type)).reverse();
  const out = { moves: 0, reAdded: 0, reRemoved: 0, failed: [] };
  for (const x of steps) {
    if (x.type === 'move') {
      if (undone.has(`undo-move|${x.id}|`)) continue;
      ledger({ type: 'undo-move', status: 'intent', id: x.id, from_parent: x.new_parent, to_parents: x.old_parents });
      let u;
      for (const sub of [OWNER_EMAIL, ADMIN]) { u = await call(sub, 'PATCH', `/files/${x.id}?addParents=${x.old_parents.join(',')}&removeParents=${x.new_parent}&supportsAllDrives=true&fields=id,parents`, 'files.update (undo move)', {}); if (!u.__error) { u.by = sub; break; } }
      const v = await call(ADMIN, 'GET', `/files/${x.id}?supportsAllDrives=true&fields=parents,driveId`, 'files.get (verify)');
      const ok = !u.__error && JSON.stringify((v.parents || []).sort()) === JSON.stringify([...x.old_parents].sort());
      ledger({ type: 'undo-move', status: ok ? 'done' : 'failed', id: x.id, from: `${x.drive}/${x.dest}`, by: u.by || '', detail: ok ? '' : (u.body || JSON.stringify(v)).slice(0, 300) });
      ok ? out.moves++ : out.failed.push(x.id);
    } else if (x.type === 'remove-permission') {
      if (undone.has(`undo-remove|${x.id}|${x.who}`)) continue;
      ledger({ type: 'undo-remove', status: 'intent', id: x.id, who: x.who, role: x.role });
      const d = await call(ADMIN, 'POST', `/files/${x.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id`, 'permissions.create (undo)', { type: 'user', role: x.role, emailAddress: x.who });
      ledger({ type: 'undo-remove', status: d.__error ? 'failed' : 'done', id: x.id, who: x.who, role: x.role, detail: d.body || '' }); d.__error ? out.failed.push(x.id) : out.reAdded++;
    } else if (x.type === 'add-permission') {
      if (undone.has(`undo-add|${x.id}|${x.who}`) || !x.permission_id) continue;
      ledger({ type: 'undo-add', status: 'intent', id: x.id, who: x.who, role: x.role, permission_id: x.permission_id });
      const d = await call(ADMIN, 'DELETE', `/files/${x.id}/permissions/${x.permission_id}?supportsAllDrives=true`, 'permissions.delete (undo)');
      ledger({ type: 'undo-add', status: d.__error ? 'failed' : 'done', id: x.id, who: x.who, role: x.role, detail: d.body || '' }); d.__error ? out.failed.push(x.id) : out.reRemoved++;
    }
  }
  console.log(JSON.stringify({ undo: out, calls }));
  await logAfter(`${OWNER} ${TAG ? TAG + ' ' : ''}undo`, `move-${LTAG}-ledger.jsonl (undo lines)`);
  process.exit(out.failed.length ? 1 : 0);
}

// ---------------------------------------------------------------- main
const already = new Set(readLedger().filter(x => x.type === 'move' && x.status === 'done').map(x => x.id));
const res = { moved: [], skipped: [], failed: [], sharing: [] }; let consecutive = 0;
for (const r of plan) {
  if (r.action !== 'move') { res.skipped.push({ r, reason: `action ${r.action} (not in this run)` }); continue; }
  if (already.has(r.file_id)) { res.skipped.push({ r, reason: 'already moved (ledger)' }); continue; }
  const f = await call(OWNER_EMAIL, 'GET', `/files/${r.file_id}?supportsAllDrives=true&fields=id,name,owners(emailAddress),parents,trashed,driveId,mimeType`, 'files.get (check)');
  const s = snap.get(r.file_id); const skip = reason => { res.skipped.push({ r, reason }); ledger({ type: 'skip', id: r.file_id, reason }); };
  if (f.__error) { skip(`cannot read (${f.status})`); continue; }
  if ((f.owners?.[0]?.emailAddress || '').toLowerCase() !== OWNER_EMAIL) { skip(`owner now ${f.owners?.[0]?.emailAddress || 'shared drive'}`); continue; }
  if (f.trashed) { skip('trashed'); continue; } if (f.driveId) { skip('already in a shared drive'); continue; }
  if (s?.parent_id && (f.parents || [])[0] !== s.parent_id) { skip('moved since the snapshot'); continue; }
  const driveName = r.target_drive.replace(/ \(.*\)$/, '');
  let dest; try { dest = await resolveDest(driveName, r.target_path); } catch (e) { res.failed.push({ r, reason: e.message }); ledger({ type: 'move', status: 'failed', id: r.file_id, reason: e.message }); if (++consecutive >= 10) break; continue; }
  ledger({ type: 'move', status: 'intent', id: r.file_id, old_parents: f.parents, new_parent: dest, drive: driveName, dest: r.target_path });
  const u = await call(OWNER_EMAIL, 'PATCH', `/files/${r.file_id}?addParents=${dest}&removeParents=${(f.parents || []).join(',')}&supportsAllDrives=true&fields=id,parents,driveId`, 'files.update (move)', {});
  const v = u.__error ? null : await call(ADMIN, 'GET', `/files/${r.file_id}?supportsAllDrives=true&fields=id,name,parents,driveId,webViewLink`, 'files.get (verify)');
  const ok = v && !v.__error && JSON.stringify(v.parents) === JSON.stringify([dest]) && v.driveId === DRIVES[driveName];
  if (!ok) { const reason = u.__error ? `update ${u.status} ${u.body}` : `verify mismatch ${JSON.stringify(v)}`; ledger({ type: 'move', status: 'failed', id: r.file_id, reason: reason.slice(0, 300) }); res.failed.push({ r, reason }); if (++consecutive >= 10) { console.error('STOP: 10 consecutive failures'); break; } continue; }
  ledger({ type: 'move', status: 'done', id: r.file_id, old_parents: f.parents, new_parent: dest, drive: driveName, dest: r.target_path });
  res.moved.push({ r, link: v.webViewLink, drive: driveName }); consecutive = 0;
  for (const a of (r.sharing_actions || '').split(';').filter(Boolean)) {
    const [kind, who, role] = a.split(':');
    const out = kind === 'remove' ? await removePerm(r.file_id, who) : await addPerm(r.file_id, who, role);
    res.sharing.push({ name: r.name, action: a, ...out });
  }
  await sleep(120);
}
// sharing fix-up adds (from the fix-up CSV)
const fixups = [];
if (process.argv.includes('--fixup') || process.argv.includes('--writers-fixup')) {
  const fx = load(`${D}/${CFG.files.writersFixup}`).filter(x => x.action === 'add');
  const done = new Set(readLedger().filter(x => x.type === 'add-permission' && x.status === 'done').map(x => `${x.id}|${x.who}`));
  for (const x of fx) { if (done.has(`${x.file_id}|${x.who}`)) { fixups.push({ ...x, status: 'already added (ledger)' }); continue; } const o = await addPerm(x.file_id, x.who, x.role); const v = await call(ADMIN, 'GET', `/files/${x.file_id}?supportsAllDrives=true&fields=webViewLink`, 'files.get (link)'); fixups.push({ ...x, ...o, link: v.webViewLink }); }
}
// report
const writes = Object.entries(calls).filter(([k]) => !k.startsWith('GET') && !k.startsWith('POST token'));
const pick = (() => { const byDrive = d => res.moved.filter(m => m.drive === d); const a = byDrive('Granted Files'), b = byDrive('Granted Archive'); const sel = []; const spread = (arr, n) => { for (let i = 0; i < n && arr.length; i++) sel.push(arr[Math.floor(i * arr.length / n)]); }; spread(a, 3); spread(b, 1); const shared = res.moved.find(m => m.r.sharing_actions && !sel.includes(m)); if (shared) sel.push(shared); else spread(a.filter(m => !sel.includes(m)), 1); return sel.slice(0, 5); })();
const md = `# ${OWNER} move — report

Run ${new Date().toISOString()} from \`${PLAN_FILE.split('/').pop()}\`. Files moved as ${OWNER_EMAIL}; folders created and sharing changed as ${ADMIN} (manager of both drives). Ledger: \`move-${SHORT}-ledger.jsonl\` (a line is written before every change).

## Result

| | Files |
|---|---|
| Moved and verified by ID | ${res.moved.length} (Granted Files ${res.moved.filter(m => m.drive === 'Granted Files').length}, Granted Archive ${res.moved.filter(m => m.drive === 'Granted Archive').length}) |
| Skipped | ${res.skipped.length} |
| Failed | ${res.failed.length} |

${res.skipped.length ? `**Skipped:**\n${res.skipped.map(x => `- ${x.r.name}: ${x.reason}`).join('\n')}\n` : ''}${res.failed.length ? `**Failed:**\n${res.failed.map(x => `- ${x.r.name}: ${x.reason}`).join('\n')}\n` : ''}
## Folders created (${created.length})

${created.map(c => `- ${c.path}`).join('\n') || 'None.'}

## Sharing changes

${res.sharing.map(s => `- ${s.name}: ${s.action} → ${s.status}`).join('\n') || 'None.'}
${fixups.length ? `\n**Sharing fix-up:**\n${fixups.map(x => `- ${x.file_name}: add ${x.who} (${x.role}${/assumed/.test(x.reason) ? ', role assumed' : ''}) → ${x.status}${x.link ? ` — [open](${x.link})` : ''}`).join('\n')}\n` : ''}
## Spot-check links

${pick.map(m => `- [${m.r.name}](${m.link}) — ${m.drive}/${m.r.target_path}`).join('\n')}

## Calls

${Object.entries(calls).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Writes: ${writes.map(([k, v]) => `${k} ×${v}`).join(', ') || 'none'}. No trash, file delete, rename or copy (the script refuses them; DELETE is allowed only on a single permission).

## How to undo

Each \`move\` / \`done\` line in the ledger has \`old_parents\` and \`new_parent\`: move back with \`addParents=<old_parents>&removeParents=<new_parent>\` as ${ADMIN} (ownership returns to the mover — transfer back to ${OWNER_EMAIL} if needed). Removed permissions are recorded with their role; re-add them with permissions.create. Added permissions have their permission ID in the ledger. Created folders are listed above (not deleted automatically).
`;
fs.writeFileSync(REPORT, md);
await logAfter(`${OWNER} ${TAG ? TAG + ' ' : ''}move`, `move-${LTAG}-report.md`);
console.log(JSON.stringify({ moved: res.moved.length, skipped: res.skipped.length, failed: res.failed.length, created: created.length, sharing: res.sharing, fixups: fixups.map(x => [x.who, x.status]), calls }));
process.exit(res.failed.length ? 1 : 0);

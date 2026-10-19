// Trash empty folders (no file anywhere below) in Granted Files and Granted Archive. Folders only; never a file,
// never a permanent delete. Protected: Clients, Programs, Departments and every direct child of Departments/;
// folders created in the last 7 days (except folders this migration created, per the ledgers' create-folder lines); "Returned from Granted Archive" folders; Archive owner folders (depth 1) and
// the person folders under them (depth 2, "…@granted.ca…"); and every ancestor of a protected folder.
// Usage: node --network-family-autoselection-attempt-timeout=5000 scripts/migration/trash-empty-folders.mjs
//          [--dry]            read-only (drive.readonly, GETs only): walks both drives live, writes
//                             empty-folder-cleanup-plan.csv + empty-folder-cleanup-dryrun.md. The default.
//          --go               trashes the folders in the frozen plan CSV, deepest first; re-checks each live first;
//                             ledger line before every change; appends the run to the Drive migration log.
//          --undo             restores (trashed:false) every folder the ledger records as trashed, shallowest first.
//          --audit <json>     optional {drive: [folder ids]} from the audit, for the dry-run diff.
import fs from 'fs';
import { INV, CFG, ADMIN, DRIVES, token, tally, callTally, parseCsv, vanTime, appendAfterRun, countsText } from './migration-log.mjs';

const args = process.argv.slice(2), GO = args.includes('--go'), UNDO = args.includes('--undo');
const AUDIT = args.includes('--audit') ? JSON.parse(fs.readFileSync(args[args.indexOf('--audit') + 1], 'utf8')) : null;
const RUN = 'empty-folder cleanup', PLAN = `${INV}/empty-folder-cleanup-plan.csv`, REPORT = `${INV}/empty-folder-cleanup-dryrun.md`;
const LEDGER = 'empty-folder-cleanup-ledger.jsonl', L = `${INV}/${LEDGER}`;
const FOLDER = 'application/vnd.google-apps.folder', RO = 'https://www.googleapis.com/auth/drive.readonly';
const SCOPE = GO || UNDO ? 'https://www.googleapis.com/auth/drive' : RO;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, path, body, label) {
  if (SCOPE === RO && method !== 'GET') throw new Error(`refusing ${method} in dry run`);
  let delay = 1500;
  for (let a = 1; a <= 8; a++) {
    tally(`${method} ${label}`); let r;
    try { r = await fetch(`https://www.googleapis.com/drive/v3${path}`, { method, headers: { Authorization: `Bearer ${await token(ADMIN, SCOPE)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) }); }
    catch (e) { console.error(`transport ${e.cause?.code || e.name}`); await sleep(delay); delay *= 2; continue; }
    if (r.ok) return r.json();
    const t = await r.text();
    if (r.status === 429 || r.status >= 500 || (r.status === 403 && /rate|quota|backend/i.test(t))) { await sleep(delay); delay *= 2; continue; }
    throw new Error(`${method} ${label} ${r.status}: ${t.slice(0, 200)}`);
  }
  throw new Error(`${method} ${label}: retries exhausted`);
}
const ledger = line => fs.appendFileSync(L, JSON.stringify({ ...line, ts: new Date().toISOString() }) + '\n');
const loadPlan = () => { const it = parseCsv(fs.readFileSync(PLAN, 'utf8')); const h = it.next().value; const o = []; for (const r of it) if (r.length > 1) o.push(Object.fromEntries(h.map((k, i) => [k, r[i]]))); return o; };
const csvCell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const esc = s => String(s).replace(/\|/g, '\\|');
const link = id => `https://drive.google.com/drive/folders/${id}`;
// From the migration ledgers: folders the migration created, and the made-up name-folders fix-name-folders.mjs emptied.
const migrationCreated = new Set(), nameFolders = new Set();
for (const f of fs.readdirSync(INV).filter(f => /ledger.*\.jsonl$/.test(f) && f !== LEDGER))
  for (const l of fs.readFileSync(`${INV}/${f}`, 'utf8').split('\n')) { if (!l) continue; let x; try { x = JSON.parse(l); } catch { continue; } if (x.status !== 'done') continue; if (x.type === 'create-folder' && x.id) migrationCreated.add(x.id); if (x.type === 'name-folder-fix' && x.remove_parent) nameFolders.add(x.remove_parent); }

// ---------- dry run ----------
async function dry() {
  const now = Date.now(), WEEK = 7 * 864e5, rows = [], kept = [], problems = [], summary = {}, diff = {}, named = [];
  for (const [driveName, driveId] of Object.entries(DRIVES)) {
    const items = []; let pt = '';
    do {
      const q = new URLSearchParams({ corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', q: 'trashed = false', pageSize: '1000', fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,createdTime,capabilities(canTrash))', ...(pt ? { pageToken: pt } : {}) });
      const d = await api('GET', `/files?${q}`, null, 'files.list'); if (d.incompleteSearch) throw new Error(`${driveName}: incomplete listing`);
      items.push(...d.files); pt = d.nextPageToken || ''; process.stderr.write(`\r${driveName}: ${items.length}`);
    } while (pt);
    console.error('');
    const byId = new Map(items.map(i => [i.id, i])), parentOf = i => (i.parents || [])[0];
    const pathOf = new Map(), depthOf = new Map();
    const resolve = i => { if (pathOf.has(i.id)) return pathOf.get(i.id); const p = parentOf(i), up = byId.get(p); const s = up ? `${resolve(up)}/${i.name}` : i.name; pathOf.set(i.id, s); depthOf.set(i.id, s.split('/').length); return s; };
    items.forEach(resolve);
    // folders with a file below them
    const hasFile = new Set();
    for (const i of items) if (i.mimeType !== FOLDER) { let p = parentOf(i); while (p && byId.has(p) && !hasFile.has(p)) { hasFile.add(p); p = parentOf(byId.get(p)); } }
    const folders = items.filter(i => i.mimeType === FOLDER), empty = folders.filter(f => !hasFile.has(f.id));
    // protection
    const reason = new Map();
    for (const f of folders) {
      const path = pathOf.get(f.id), d = depthOf.get(f.id), segs = path.split('/');
      let r = null;
      if (driveName === CFG.drives.sorted.name && d === 1 && ['Clients', 'Programs', 'Departments'].includes(f.name)) r = 'standard top-level folder';
      else if (driveName === CFG.drives.sorted.name && d === 2 && segs[0] === 'Departments') r = 'direct child of Departments/';
      else if (now - Date.parse(f.createdTime) < WEEK && !migrationCreated.has(f.id)) r = `created ${f.createdTime.slice(0, 10)} (last 7 days)`;
      else if (/Returned from Granted Archive/i.test(f.name)) r = '"Returned from Granted Archive" folder';
      else if (driveName === CFG.drives.archive.name && d === 1) r = 'Archive owner folder';
      else if (driveName === CFG.drives.archive.name && d === 2 && /@granted\.ca/i.test(f.name) && !/^(From |_Shared by )/.test(f.name)) r = 'Archive person folder';
      if (r) reason.set(f.id, r);
    }
    // ancestors of a protected folder are protected too
    for (const [id, r] of [...reason]) { let p = parentOf(byId.get(id)); while (p && byId.has(p)) { if (!reason.has(p)) reason.set(p, `holds protected ${pathOf.get(id)}`); p = parentOf(byId.get(p)); } }
    const s = summary[driveName] = { items: items.length, files: items.length - folders.length, folders: folders.length, empty: empty.length, trash: 0, keptProtected: 0, problems: 0 };
    const trashSet = new Set();
    for (const f of empty) {
      const base = { drive: driveName, path: pathOf.get(f.id), id: f.id, depth: depthOf.get(f.id), created: f.createdTime, parent: parentOf(f) };
      if (reason.has(f.id)) { kept.push({ ...base, reason: reason.get(f.id) }); s.keptProtected++; }
      else if (f.capabilities?.canTrash === false) { problems.push({ ...base, reason: 'writers@ cannot trash it' }); s.problems++; }
      else { rows.push(base); trashSet.add(f.id); s.trash++; }
    }
    // topmost = trashable folders whose parent is not trashable
    s.trashTopmost = rows.filter(r => r.drive === driveName && !trashSet.has(r.parent)).length;
    if (AUDIT?.[driveName]) {
      const emptySet = new Set(empty.map(f => f.id)), audit = AUDIT[driveName];
      const topNow = empty.filter(f => !emptySet.has(parentOf(f)));
      diff[driveName] = {
        auditTopmost: audit.length,
        noLongerEmpty: audit.filter(id => byId.has(id) && !emptySet.has(id)).map(id => pathOf.get(id)),
        gone: audit.filter(id => !byId.has(id)),
        newTopmost: topNow.filter(f => !audit.includes(f.id) && !audit.some(a => pathOf.get(f.id).startsWith(`${pathOf.get(a)}/`))).map(f => pathOf.get(f.id)),
      };
    }
    // named checks
    for (const f of empty) { const p = pathOf.get(f.id); if (p === 'Clients/LGT' || p === 'Departments/FINANCE' || /-pages$/.test(f.name)) named.push({ drive: driveName, path: p, trash: trashSet.has(f.id), reason: reason.get(f.id) || '' }); }
    s.nameFolders = folders.filter(f => nameFolders.has(f.id)).map(f => ({ path: pathOf.get(f.id), empty: !hasFile.has(f.id), trash: trashSet.has(f.id), reason: reason.get(f.id) || '' }));
  }
  rows.sort((a, b) => b.depth - a.depth || a.path.localeCompare(b.path));
  const cols = ['drive', 'path', 'id', 'depth', 'created', 'parent', 'link'];
  fs.writeFileSync(PLAN, [cols.join(','), ...rows.map(r => cols.map(c => csvCell(c === 'link' ? link(r.id) : r[c])).join(','))].join('\n') + '\n');
  const calls = callTally();
  const md = `# Empty-folder cleanup — dry run

Built ${vanTime(new Date().toISOString())} (Vancouver). Folders the migration created (${migrationCreated.size} in the ledgers) are exempt from the 7-day rule. Read-only (drive.readonly, GETs only): ${Object.entries(calls).map(([k, v]) => `${k} ×${v}`).join('; ')}. Nothing was trashed.

Full list (deepest first, the order \`--go\` will use): \`dist/inventory/empty-folder-cleanup-plan.csv\`.

## Counts

| Drive | Items | Files | Folders | Empty | **To trash** | Topmost of those | Kept (protected) | Problems |
|---|---|---|---|---|---|---|---|---|
${Object.entries(summary).map(([d, s]) => `| ${d} | ${s.items} | ${s.files} | ${s.folders} | ${s.empty} | **${s.trash}** | ${s.trashTopmost} | ${s.keptProtected} | ${s.problems} |`).join('\n')}

## Named folders

${named.map(n => `- ${n.drive}/${esc(n.path)} — ${n.trash ? '**trash**' : `kept (${esc(n.reason)})`}`).join('\n')}

Made-up name-folders left by fix-name-folders.mjs: ${Object.entries(summary).map(([d, s]) => `${d} ${s.nameFolders.length} found — ${s.nameFolders.filter(x => x.trash).length} to trash, ${s.nameFolders.filter(x => !x.empty).length} not empty, ${s.nameFolders.filter(x => x.empty && !x.trash).length} empty but kept`).join('; ')}.
${Object.values(summary).flatMap(s => s.nameFolders).filter(x => !x.trash).map(x => `- ${esc(x.path)} — ${x.empty ? `kept (${esc(x.reason)})` : 'not empty'}`).join('\n')}

## Kept: empty but protected (${kept.length})

${kept.sort((a, b) => a.path.localeCompare(b.path)).map(k => `- ${k.drive}/${esc(k.path)} — ${esc(k.reason)}`).join('\n') || 'None.'}

## Problems (${problems.length})

${problems.map(p => `- ${p.drive}/${esc(p.path)} — ${p.reason}`).join('\n') || 'None.'}
${AUDIT ? `
## Compared with the audit (topmost empty folders)

${Object.entries(diff).map(([d, x]) => `**${d}** — audit listed ${x.auditTopmost}. No longer empty: ${x.noLongerEmpty.length}${x.noLongerEmpty.length ? ` (${x.noLongerEmpty.map(esc).join('; ')})` : ''}. Gone or trashed since: ${x.gone.length}. New topmost empty: ${x.newTopmost.length}${x.newTopmost.length ? ` (${x.newTopmost.map(esc).join('; ')})` : ''}.`).join('\n\n')}
` : ''}`;
  fs.writeFileSync(REPORT, md);
  console.log(JSON.stringify({ mode: 'dry', summary: Object.fromEntries(Object.entries(summary).map(([d, s]) => [d, { ...s, nameFolders: s.nameFolders.length, nameFoldersToTrash: s.nameFolders.filter(x => x.trash).length }])), kept: kept.length, problems: problems.length, named, diff, calls, plan: PLAN, report: REPORT }, null, 1));
}

// ---------- go ----------
async function go() {
  const plan = loadPlan(), RUN_START = new Date().toISOString(), skip = new Set(), done = [], skipped = [], failed = [];
  const byId = new Map(plan.map(r => [r.id, r]));
  const skipUp = (r, why) => { skipped.push(`${r.path}: ${why}`); let p = r.parent; while (byId.has(p)) { if (!skip.has(p)) skip.add(p); p = byId.get(p).parent; } };
  for (const r of plan) {
    if (skip.has(r.id)) { skipped.push(`${r.path}: a folder below it was skipped`); continue; }
    try {
      const f = await api('GET', `/files/${r.id}?supportsAllDrives=true&fields=id,name,mimeType,parents,trashed`, null, 'files.get');
      if (f.mimeType !== FOLDER) { skipUp(r, 'not a folder'); continue; }
      if (f.trashed) { skipUp(r, 'already trashed'); continue; }
      if ((f.parents || [])[0] !== r.parent) { skipUp(r, 'moved since the dry run'); continue; }
      const q = new URLSearchParams({ q: `'${r.id}' in parents and trashed = false`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', fields: 'files(id,name,mimeType)', pageSize: '10' });
      const kids = (await api('GET', `/files?${q}`, null, 'files.list (children)')).files || [];
      if (kids.length) { skipUp(r, `not empty now (${kids.map(k => k.name).join(', ')})`); continue; }
      const line = { type: 'trash-folder', id: r.id, drive: r.drive, path: r.path, parent: r.parent };
      ledger({ ...line, status: 'intent' });
      await api('PATCH', `/files/${r.id}?supportsAllDrives=true&fields=id,trashed`, { trashed: true }, 'files.update (trashed=true)');
      const v = await api('GET', `/files/${r.id}?supportsAllDrives=true&fields=trashed`, null, 'files.get (verify)');
      if (!v.trashed) throw new Error('verify failed: not trashed');
      ledger({ ...line, status: 'done' }); done.push({ ...r, ts: new Date().toISOString() });
    } catch (e) { failed.push(`${r.path}: ${e.message}`); ledger({ type: 'trash-folder', id: r.id, drive: r.drive, path: r.path, parent: r.parent, status: 'failed', detail: e.message }); skipUp(r, 'failed'); }
    await sleep(50);
  }
  const rows = done.map(r => ({ ts: r.ts, run: RUN, ledger: LEDGER, action: 'empty folder trashed', name: r.path.split('/').pop(), id: r.id, owner: 'shared drive', from: `${r.drive}/${r.path}`, to: 'trash (restore by ID)', sharing: '', by: ADMIN }));
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), RUN, countsText(rows) || 'no changes', CFG.approver, LEDGER, '']);
  const byDrive = done.reduce((m, r) => { m[r.drive] = (m[r.drive] || 0) + 1; return m; }, {});
  console.log(JSON.stringify({ mode: 'go', planned: plan.length, trashed: done.length, byDrive, skipped, failed, log: lg.ok ? `appended ${rows.length} rows` : lg.warning, calls: callTally() }, null, 1));
}

// ---------- undo ----------
async function undo() {
  const lines = fs.readFileSync(L, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const restored = new Set(lines.filter(x => x.type === 'restore-folder' && x.status === 'done').map(x => x.id));
  const todo = lines.filter(x => x.type === 'trash-folder' && x.status === 'done' && !restored.has(x.id)).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const RUN_START = new Date().toISOString(), done = [], failed = [];
  for (const x of todo) {
    const line = { type: 'restore-folder', id: x.id, drive: x.drive, path: x.path };
    try {
      ledger({ ...line, status: 'intent' });
      await api('PATCH', `/files/${x.id}?supportsAllDrives=true&fields=id,trashed`, { trashed: false }, 'files.update (trashed=false)');
      ledger({ ...line, status: 'done' }); done.push({ ...x, ts: new Date().toISOString() });
    } catch (e) { failed.push(`${x.path}: ${e.message}`); ledger({ ...line, status: 'failed', detail: e.message }); }
  }
  const rows = done.map(x => ({ ts: x.ts, run: `${RUN} (undo)`, ledger: LEDGER, action: 'folder restored', name: x.path.split('/').pop(), id: x.id, owner: 'shared drive', from: 'trash', to: `${x.drive}/${x.path}`, sharing: '', by: ADMIN }));
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), `${RUN} (undo)`, countsText(rows) || 'no changes', CFG.approver, LEDGER, '']);
  console.log(JSON.stringify({ mode: 'undo', restored: done.length, failed, log: lg.ok ? `appended ${rows.length} rows` : lg.warning, calls: callTally() }, null, 1));
}

await (GO ? go() : UNDO ? undo() : dry());

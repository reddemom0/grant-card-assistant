// Merge duplicate client folders in Granted Files into the keeper the audit proposed. Per group, level by level:
// a source subfolder whose name matches a keeper subfolder (ignoring case, spacing, punctuation) is merged into it;
// any other subfolder is moved whole (IDs kept). A file whose name + md5 match a file in the destination folder is an
// identical duplicate → moved to Granted Archive/Merge duplicates/<Keeper>/<path>. A same-name file with different
// (or no) md5 is moved next to the existing one, not renamed, and listed. Emptied source folders are trashed.
// A shortcut whose clash in the keeper is its own target (or another shortcut to it) also goes to the Archive.
// Groups that contain shortcuts are held back unless --include-shortcuts. Re-running --go skips actions the ledger has as done. Never renames, deletes or changes sharing.
// Usage: node --network-family-autoselection-attempt-timeout=5000 scripts/migration/merge-client-folders.mjs
//          [--dry]     read-only (drive.readonly, GETs only): walks each keeper + source live, writes
//                      client-merge-certain-plan.json + client-merge-certain-dryrun.md. The default.
//          --go        runs the frozen plan one group at a time; re-checks each item live first; ledger line before
//                      every change; verifies by ID; appends the run to the Drive migration log.
//          --verify    read-only walk after --go; writes client-merge-certain-after-go.md.
//          --undo      reverses the ledger's done actions (untrash, then move back). Created Archive folders stay.
//          [--groups <json>] default dist/inventory/client-merge-certain-groups.json   [--include-shortcuts]
import fs from 'fs';
import { INV, CFG, ADMIN, token, tally, callTally, vanTime, appendAfterRun, countsText } from './migration-log.mjs';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const GO = args.includes('--go'), UNDO = args.includes('--undo'), VERIFY = args.includes('--verify'), WITH_SC = args.includes('--include-shortcuts');
const GROUPS = opt('--groups') || `${INV}/client-merge-certain-groups.json`;
const TAG = 'client-merge-certain', RUN = 'client merge – certain';
const PLAN = `${INV}/${TAG}-plan.json`, REPORT = `${INV}/${TAG}-dryrun.md`, AFTER = `${INV}/${TAG}-after-go.md`, LEDGER = `${TAG}-ledger.jsonl`, L = `${INV}/${LEDGER}`;
const GF = CFG.drives.sorted, GA = CFG.drives.archive, ARCH_ROOT = 'Merge duplicates';
const FOLDER = 'application/vnd.google-apps.folder', SHORTCUT = 'application/vnd.google-apps.shortcut', RO = 'https://www.googleapis.com/auth/drive.readonly';
const SCOPE = GO || UNDO ? 'https://www.googleapis.com/auth/drive' : RO;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, path, body, label) {
  if (SCOPE === RO && method !== 'GET') throw new Error(`refusing ${method} in a read-only mode`);
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
const esc = s => String(s).replace(/\|/g, '\\|');
const normF = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const normName = s => s.trim().toLowerCase();
const qs = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const FIELDS = 'id,name,mimeType,md5Checksum,parents,trashed,capabilities(canMoveItemWithinDrive,canMoveItemOutOfDrive,canTrash)';
async function list(q, driveId, fields = FIELDS) {
  const out = []; let pt = '';
  do { const p = new URLSearchParams({ q, corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', fields: `nextPageToken,files(${fields})`, pageSize: '1000', ...(pt ? { pageToken: pt } : {}) }); const d = await api('GET', `/files?${p}`, null, 'files.list'); out.push(...d.files); pt = d.nextPageToken || ''; } while (pt);
  return out;
}
// subtree as a tree of nodes { id, name, mimeType, md5, caps, path, children }
async function tree(id, path) {
  const root = { id, name: path.split('/').pop(), mimeType: FOLDER, path, children: [] };
  const queue = [root];
  while (queue.length) {
    const n = queue.shift();
    for (const c of await list(`'${n.id}' in parents and trashed = false`, GF.id)) {
      const k = { id: c.id, name: c.name, mimeType: c.mimeType, md5: c.md5Checksum || null, caps: c.capabilities || {}, parent: n.id, path: `${n.path}/${c.name}`, children: [] };
      n.children.push(k); if (c.mimeType === FOLDER) queue.push(k);
    }
  }
  return root;
}
const walkAll = (n, f) => { f(n); n.children.forEach(c => walkAll(c, f)); };
const filesIn = n => { let c = 0; walkAll(n, x => { if (x !== n && x.mimeType !== FOLDER) c++; }); return c; };
const shortcutsIn = n => { const o = []; walkAll(n, x => { if (x.mimeType === SHORTCUT) o.push(x.path); }); return o; };

// ---------- dry run ----------
function planGroup(g, S, K) {
  const actions = [], notes = [];
  const merge = (s, k, rel, depth) => {
    for (const c of s.children) {
      if (c.mimeType === FOLDER) {
        const twins = k.children.filter(x => x.mimeType === FOLDER && normF(x.name) === normF(c.name));
        const twin = twins.find(x => x.name === c.name) || twins[0];
        if (twins.length > 1) notes.push(`${c.path}: ${twins.length} matching keeper subfolders; merging into "${twin.name}"`);
        if (twin) { actions.push({ type: 'merge-folder', id: c.id, path: c.path, into: twin.id, intoPath: twin.path }); merge(c, twin, `${rel}/${c.name}`, depth + 1); }
        else actions.push({ type: 'move', kind: 'folder', id: c.id, name: c.name, from: s.id, fromPath: c.path, to: k.id, toPath: `${k.path}/${c.name}`, files: filesIn(c), can: c.caps.canMoveItemWithinDrive !== false });
      } else {
        const same = k.children.filter(x => x.mimeType !== FOLDER && normName(x.name) === normName(c.name));
        const ident = c.md5 && same.find(x => x.md5 === c.md5);
        if (ident) actions.push({ type: 'archive', id: c.id, name: c.name, md5: c.md5, from: s.id, fromPath: c.path, archRel: `${ARCH_ROOT}/${K.name}${rel}`, toPath: `${ARCH_ROOT}/${K.name}${rel}/${c.name}`, twin: ident.id, can: c.caps.canMoveItemOutOfDrive !== false });
        else actions.push({ type: 'move', kind: c.mimeType === SHORTCUT ? 'shortcut' : 'file', id: c.id, name: c.name, md5: c.md5, from: s.id, fromPath: c.path, to: k.id, toPath: `${k.path}/${c.name}`, cls: same.length ? 'same-name-diff' : 'new', twin: same[0]?.id || null, files: 1, can: c.caps.canMoveItemWithinDrive !== false });
      }
    }
    actions.push({ type: 'trash', id: s.id, path: s.path, depth, can: s.caps?.canTrash !== false });
  };
  S.caps = S.caps || {};
  merge(S, K, '', 0);
  return { actions, notes };
}
async function dry() {
  const G = JSON.parse(fs.readFileSync(GROUPS, 'utf8')).groups, out = [];
  for (const [i, g] of G.entries()) {
    const src = g.sources[0];
    const kMeta = await api('GET', `/files/${g.keeper.id}?supportsAllDrives=true&fields=${FIELDS}`, null, 'files.get');
    const sMeta = await api('GET', `/files/${src.id}?supportsAllDrives=true&fields=${FIELDS}`, null, 'files.get');
    const K = await tree(g.keeper.id, g.keeper.path), S = await tree(src.id, src.path);
    S.caps = sMeta.capabilities || {};
    const { actions, notes } = planGroup(g, S, K);
    const blockers = [], checks = [];
    if (kMeta.trashed || sMeta.trashed) blockers.push('keeper or source is trashed');
    if (kMeta.name !== g.keeper.path.split('/').pop() || sMeta.name !== src.path.split('/').pop()) blockers.push(`name changed since the audit (keeper "${kMeta.name}", source "${sMeta.name}")`);
    for (const a of actions) if (a.can === false) blockers.push(`writers@ cannot ${a.type === 'trash' ? 'trash' : 'move'} ${a.fromPath || a.path}`);
    const sc = shortcutsIn(S); if (sc.length) blockers.push(`${sc.length} shortcut(s): ${sc.join('; ')}${WITH_SC ? ' (moving them: --include-shortcuts)' : ''}`);
    if (g.match === 'plural') checks.push('plural-type name match — confirm same client');
    const sProg = S.children.filter(c => c.mimeType === FOLDER).map(c => normF(c.name)), kProg = new Set(K.children.filter(c => c.mimeType === FOLDER).map(c => normF(c.name)));
    if (sProg.length && !sProg.some(p => kProg.has(p))) checks.push('no program subfolder in common with the keeper');
    const rename = g.proposedKeeper && g.proposedKeeper !== g.keeper.path ? `rename proposed: ${g.keeper.path} → ${g.proposedKeeper}` : null;
    const t = { sourceFiles: filesIn(S), moved: actions.filter(a => a.type === 'move').reduce((s, a) => s + a.files, 0), archived: actions.filter(a => a.type === 'archive').length };
    out.push({ i: i + 1, keeper: { id: g.keeper.id, path: g.keeper.path, files: filesIn(K) }, source: { id: src.id, path: src.path, files: t.sourceFiles }, match: g.match, actions, notes, blockers, checks, rename, totals: t, held: blockers.some(b => !b.includes('shortcut') || !WITH_SC) });
    process.stderr.write(`\r${i + 1}/${G.length}`);
  }
  console.error('');
  fs.writeFileSync(PLAN, JSON.stringify({ built: new Date().toISOString(), includeShortcuts: WITH_SC, groups: out }, null, 1));
  const n = (g, f) => g.actions.filter(f).length;
  const tot = out.reduce((m, g) => { m.src += g.totals.sourceFiles; m.mv += g.totals.moved; m.ar += g.totals.archived; return m; }, { src: 0, mv: 0, ar: 0 });
  const calls = callTally();
  const md = `# Client merge – certain groups — dry run

Built ${vanTime(new Date().toISOString())} (Vancouver). Read-only (drive.readonly, GETs only): ${Object.entries(calls).map(([k, v]) => `${k} ×${v}`).join('; ')}. Nothing was moved.

**Totals:** ${out.length} groups, ${out.filter(g => g.held).length} held. Files in the sources: **${tot.src}** = moved into keepers **${tot.mv}** + identical duplicates to the Archive **${tot.ar}** ${tot.src === tot.mv + tot.ar ? '✓' : '✗ MISMATCH'}.

| # | Keeper (files) | Source (files) | Files moved | Folders moved whole | Subfolder merges | Same name, diff content | Identical → Archive | Folders to trash | Status |
|---|---|---|---|---|---|---|---|---|---|
${out.map(g => `| ${g.i} | ${esc(g.keeper.path)} (${g.keeper.files}) | ${esc(g.source.path)} (${g.source.files}) | ${n(g, a => a.type === 'move' && a.kind !== 'folder')} | ${n(g, a => a.type === 'move' && a.kind === 'folder')} (${g.actions.filter(a => a.type === 'move' && a.kind === 'folder').reduce((s, a) => s + a.files, 0)} files) | ${n(g, a => a.type === 'merge-folder')} | ${n(g, a => a.cls === 'same-name-diff')} | ${g.totals.archived} | ${n(g, a => a.type === 'trash')} | ${g.held ? '**held**' : g.checks.length ? 'check' : 'ready'} |`).join('\n')}

## Blockers (${out.filter(g => g.blockers.length).length} groups)

${out.filter(g => g.blockers.length).map(g => `- **${g.i}. ${esc(g.keeper.path)} ← ${esc(g.source.path)}**: ${g.blockers.map(esc).join('; ')}`).join('\n') || 'None.'}

## To check — same client? (${out.filter(g => g.checks.length).length} groups; not blocked)

${out.filter(g => g.checks.length).map(g => `- ${g.i}. ${esc(g.keeper.path)} ← ${esc(g.source.path)}: ${g.checks.join('; ')}`).join('\n') || 'None.'}

## Rename proposed (not done in this run)

${out.filter(g => g.rename).map(g => `- ${esc(g.rename)}`).join('\n') || 'None — the audit proposed each keeper\'s current name.'}

${out.map(g => `## ${g.i}. ${esc(g.keeper.path)} ← ${esc(g.source.path)}

Totals: ${g.totals.sourceFiles} source files = ${g.totals.moved} moved + ${g.totals.archived} archived ${g.totals.sourceFiles === g.totals.moved + g.totals.archived ? '✓' : '✗'}.${g.notes.length ? `\nNotes: ${g.notes.map(esc).join('; ')}` : ''}

${g.actions.filter(a => a.type !== 'trash').map(a => a.type === 'merge-folder' ? `- merge subfolder: ${esc(a.path)} → into ${esc(a.intoPath)}` : a.type === 'archive' ? `- identical → Archive: ${esc(a.fromPath)} → Granted Archive/${esc(a.toPath)}` : `- move ${a.kind}${a.kind === 'folder' ? ` (${a.files} files)` : ''}${a.cls === 'same-name-diff' ? ' — **same name, different content**' : ''}: ${esc(a.fromPath)} → ${esc(a.toPath)}`).join('\n')}
${g.actions.filter(a => a.type === 'trash').sort((a, b) => b.depth - a.depth).map(a => `- trash when empty: ${esc(a.path)}`).join('\n')}
`).join('\n')}`;
  fs.writeFileSync(REPORT, md);
  console.log(JSON.stringify({ mode: 'dry', groups: out.length, held: out.filter(g => g.held).map(g => `${g.i}. ${g.keeper.path}`), checks: out.filter(g => g.checks.length).map(g => `${g.i}. ${g.keeper.path}: ${g.checks.join('; ')}`), totals: tot, sameNameDiff: out.reduce((s, g) => s + n(g, a => a.cls === 'same-name-diff'), 0), trash: out.reduce((s, g) => s + n(g, a => a.type === 'trash'), 0), renames: out.filter(g => g.rename).length, calls, plan: PLAN, report: REPORT }, null, 1));
}

// ---------- go ----------
const archCache = new Map();
async function archFolder(rel, created) {
  if (archCache.has(rel)) return archCache.get(rel);
  let cur = GA.id, acc = '';
  for (const seg of rel.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg;
    if (archCache.has(acc)) { cur = archCache.get(acc); continue; }
    const found = await list(`'${cur}' in parents and name = '${qs(seg)}' and mimeType = '${FOLDER}' and trashed = false`, GA.id, 'id,name');
    if (found.length) cur = found[0].id;
    else {
      ledger({ type: 'create-folder', status: 'intent', path: `${GA.name}/${acc}`, parent: cur });
      const c = await api('POST', `/files?supportsAllDrives=true&fields=id`, { name: seg, mimeType: FOLDER, parents: [cur] }, 'files.create (folder)');
      ledger({ type: 'create-folder', status: 'done', id: c.id, path: `${GA.name}/${acc}`, parent: cur }); created.push({ id: c.id, path: `${GA.name}/${acc}`, ts: new Date().toISOString() }); cur = c.id;
    }
    archCache.set(acc, cur);
  }
  return cur;
}
async function move(a, dest, destPath, group, rows) {
  const f = await api('GET', `/files/${a.id}?supportsAllDrives=true&fields=id,name,md5Checksum,parents,trashed,shortcutDetails(targetId)`, null, 'files.get');
  if (f.trashed) return `trashed`;
  if ((f.parents || [])[0] !== a.from) return 'moved since the dry run';
  if (f.name !== a.name) return `renamed to "${f.name}"`;
  if (a.md5 && f.md5Checksum !== a.md5) return 'content changed since the dry run';
  if (a.type === 'move' && a.kind !== 'folder' && a.cls === 'new') {
    const clash = (await list(`'${dest}' in parents and trashed = false and mimeType != '${FOLDER}'`, GF.id, 'id,name,md5Checksum,shortcutDetails(targetId)')).filter(x => normName(x.name) === normName(a.name));
    // a shortcut whose clash is its own target (or another shortcut to it) is a duplicate → Archive
    const tgt = f.shortcutDetails?.targetId;
    if (clash.length && a.kind === 'shortcut' && tgt && clash.every(x => x.id === tgt || x.shortcutDetails?.targetId === tgt)) return { redirect: 'archive', twin: clash[0].id };
    if (clash.length) return `a "${a.name}" appeared in the keeper since the dry run`;
  }
  const line = { type: a.type === 'archive' ? 'archive-duplicate' : 'move', kind: a.kind || 'file', group, id: a.id, name: a.name, old_parents: [a.from], new_parent: dest, from_path: `${GF.name}/${a.fromPath}`, to_path: destPath };
  ledger({ ...line, status: 'intent' });
  await api('PATCH', `/files/${a.id}?supportsAllDrives=true&addParents=${dest}&removeParents=${a.from}&fields=id,parents`, {}, 'files.update (parents)');
  const v = await api('GET', `/files/${a.id}?supportsAllDrives=true&fields=parents,name`, null, 'files.get (verify)');
  if (!(v.parents || []).includes(dest) || (v.parents || []).includes(a.from) || v.name !== a.name) throw new Error('verify failed');
  ledger({ ...line, status: 'done' });
  rows.push({ ts: new Date().toISOString(), run: RUN, ledger: LEDGER, action: 'move', name: a.name, id: a.id, owner: 'shared drive', from: line.from_path, to: destPath, sharing: a.shortcutDup ? `shortcut to ${a.twin}, which is now in the keeper` : a.type === 'archive' ? `identical duplicate of ${a.twin}` : a.cls === 'same-name-diff' ? `same name as ${a.twin}, different content` : '', by: ADMIN });
  return null;
}
async function go() {
  const P = JSON.parse(fs.readFileSync(PLAN, 'utf8')), RUN_START = new Date().toISOString(), rows = [], created = [], res = [];
  const alreadyDone = new Set(fs.existsSync(L) ? fs.readFileSync(L, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.status === 'done' && ['move', 'archive-duplicate', 'trash-folder'].includes(x.type)).map(x => x.id) : []);
  for (const g of P.groups) {
    const r = { group: `${g.i}. ${g.keeper.path} ← ${g.source.path}`, moved: 0, movedFiles: 0, archived: 0, trashed: 0, skipped: [], failed: [] }; res.push(r);
    if (g.held && !(P.includeShortcuts || WITH_SC)) { r.skipped.push(`held: ${g.blockers.join('; ')}`); continue; }
    for (const a0 of g.actions.filter(a => a.type === 'archive' || a.type === 'move')) {
      if (alreadyDone.has(a0.id)) continue;   // done by an earlier --go
      let a = a0;
      try {
        let dest = a.type === 'archive' ? await archFolder(a.archRel, created) : a.to;
        let destPath = a.type === 'archive' ? `${GA.name}/${a.toPath}` : `${GF.name}/${a.toPath}`;
        let why = await move(a, dest, destPath, g.i, rows);
        if (why?.redirect === 'archive') {
          const rel = a.fromPath.split('/').slice(0, -1).join('/').slice(g.source.path.length);
          a = { ...a, type: 'archive', archRel: `${ARCH_ROOT}/${g.keeper.path.split('/').pop()}${rel}`, toPath: `${ARCH_ROOT}/${g.keeper.path.split('/').pop()}${rel}/${a.name}`, twin: why.twin, shortcutDup: true };
          dest = await archFolder(a.archRel, created); destPath = `${GA.name}/${a.toPath}`;
          why = await move(a, dest, destPath, g.i, rows);
        }
        if (why) r.skipped.push(`${a.fromPath}: ${why}`); else if (a.type === 'archive') r.archived++; else { r.moved++; r.movedFiles += a.files; }
      } catch (e) { r.failed.push(`${a.fromPath}: ${e.message}`); ledger({ type: a.type, id: a.id, status: 'failed', detail: e.message }); }
      await sleep(40);
    }
    for (const a of g.actions.filter(a => a.type === 'trash').sort((x, y) => y.depth - x.depth)) {
      if (alreadyDone.has(a.id)) continue;
      try {
        const kids = await list(`'${a.id}' in parents and trashed = false`, GF.id, 'id,name');
        if (kids.length) { r.skipped.push(`${a.path}: not empty (${kids.length} left) — not trashed`); continue; }
        const line = { type: 'trash-folder', group: g.i, id: a.id, path: `${GF.name}/${a.path}` };
        ledger({ ...line, status: 'intent' });
        await api('PATCH', `/files/${a.id}?supportsAllDrives=true&fields=id,trashed`, { trashed: true }, 'files.update (trashed=true)');
        if (!(await api('GET', `/files/${a.id}?supportsAllDrives=true&fields=trashed`, null, 'files.get (verify)')).trashed) throw new Error('verify failed: not trashed');
        ledger({ ...line, status: 'done' }); r.trashed++;
        rows.push({ ts: new Date().toISOString(), run: RUN, ledger: LEDGER, action: 'empty folder trashed', name: a.path.split('/').pop(), id: a.id, owner: 'shared drive', from: line.path, to: 'trash (restore by ID)', sharing: '', by: ADMIN });
      } catch (e) { r.failed.push(`${a.path}: ${e.message}`); ledger({ type: 'trash-folder', id: a.id, status: 'failed', detail: e.message }); }
    }
    console.error(`${r.group}: moved ${r.moved} (${r.movedFiles} files), archived ${r.archived}, trashed ${r.trashed}, skipped ${r.skipped.length}, failed ${r.failed.length}`);
  }
  for (const c of created) rows.push({ ts: c.ts, run: RUN, ledger: LEDGER, action: 'folder created', name: c.path.split('/').pop(), id: c.id, owner: 'shared drive', from: '', to: c.path, sharing: '', by: ADMIN });
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), RUN, countsText(rows) || 'no changes', CFG.approver, LEDGER, '']);
  console.log(JSON.stringify({ mode: 'go', groups: res, foldersCreated: created.length, log: lg.ok ? `appended ${rows.length} rows` : lg.warning, calls: callTally() }, null, 1));
}

// ---------- verify (read-only) ----------
async function verify() {
  const P = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const lines = fs.readFileSync(L, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.status === 'done');
  const out = [];
  for (const g of P.groups) {
    const K = await tree(g.keeper.id, g.keeper.path), inK = new Set(); walkAll(K, x => inK.add(x.id));
    const done = lines.filter(x => x.group === g.i);
    const movedIn = done.filter(x => x.type === 'move').reduce((s, x) => s + (x.kind === 'folder' ? (g.actions.find(a => a.id === x.id)?.files || 0) : 1), 0);
    const notUnder = done.filter(x => x.type === 'move' && !inK.has(x.id)).map(x => x.from_path);
    const archived = done.filter(x => x.type === 'archive-duplicate');
    const archOk = []; for (const x of archived) { const f = await api('GET', `/files/${x.id}?supportsAllDrives=true&fields=parents,driveId,trashed`, null, 'files.get'); archOk.push(f.driveId === GA.id && (f.parents || []).includes(x.new_parent) && !f.trashed); }
    const src = await api('GET', `/files/${g.source.id}?supportsAllDrives=true&fields=trashed`, null, 'files.get');
    const now = filesIn(K);
    out.push({ g, before: g.keeper.files, movedIn, now, countOk: now === g.keeper.files + movedIn, notUnder, archived: archived.length, archOk: archOk.every(Boolean), sourceTrashed: !!src.trashed, held: g.held && !done.length });
    process.stderr.write(`\r${g.i}/${P.groups.length}`);
  }
  console.error('');
  const ok = r => r.held || (r.countOk && !r.notUnder.length && r.archOk && r.sourceTrashed);
  const md = `# Client merge – certain groups — after go

Built ${vanTime(new Date().toISOString())} (Vancouver). Fresh read-only walk (drive.readonly, GETs only): ${Object.entries(callTally()).map(([k, v]) => `${k} ×${v}`).join('; ')}.

**${out.filter(ok).length} of ${out.length} groups check out.** Files moved into keepers: ${out.reduce((s, r) => s + r.movedIn, 0)}; identical duplicates in Granted Archive/${ARCH_ROOT}: ${out.reduce((s, r) => s + r.archived, 0)}.

| # | Keeper | Files before | Moved in | Files now | Count ✓ | Moved IDs under keeper | Archived (in place ✓) | Source trashed |
|---|---|---|---|---|---|---|---|---|
${out.map(r => `| ${r.g.i} | ${esc(r.g.keeper.path)} | ${r.before} | ${r.movedIn} | ${r.now} | ${r.held ? 'held' : r.countOk ? '✓' : '✗'} | ${r.notUnder.length ? `✗ ${r.notUnder.length} not` : '✓'} | ${r.archived} ${r.archOk ? '✓' : '✗'} | ${r.held ? 'held' : r.sourceTrashed ? '✓' : '✗'} |`).join('\n')}
${out.filter(r => !ok(r)).map(r => `\n- ${r.g.i}. ${esc(r.g.keeper.path)}: ${!r.countOk ? `count ${r.now} ≠ ${r.before} + ${r.movedIn}; ` : ''}${r.notUnder.length ? `not under keeper: ${r.notUnder.map(esc).join('; ')}; ` : ''}${!r.archOk ? 'an archived file is not where the ledger says; ' : ''}${!r.sourceTrashed ? 'source folder not trashed' : ''}`).join('')}
`;
  fs.writeFileSync(AFTER, md);
  console.log(JSON.stringify({ mode: 'verify', ok: out.filter(ok).length, of: out.length, problems: out.filter(r => !ok(r)).map(r => r.g.keeper.path), calls: callTally(), report: AFTER }, null, 1));
}

// ---------- undo ----------
async function undo() {
  const lines = fs.readFileSync(L, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const undone = new Set(lines.filter(x => x.type?.startsWith('undo-') && x.status === 'done').map(x => `${x.type}|${x.id}`));
  const todo = lines.filter(x => x.status === 'done' && ['move', 'archive-duplicate', 'trash-folder'].includes(x.type)).reverse();
  const RUN_START = new Date().toISOString(), rows = [], failed = [];
  for (const x of todo) {
    const t = x.type === 'trash-folder' ? 'undo-trash' : 'undo-move'; if (undone.has(`${t}|${x.id}`)) continue;
    const line = { type: t, id: x.id, group: x.group };
    try {
      ledger({ ...line, status: 'intent' });
      if (t === 'undo-trash') await api('PATCH', `/files/${x.id}?supportsAllDrives=true&fields=id,trashed`, { trashed: false }, 'files.update (trashed=false)');
      else await api('PATCH', `/files/${x.id}?supportsAllDrives=true&addParents=${x.old_parents.join(',')}&removeParents=${x.new_parent}&fields=id,parents`, {}, 'files.update (parents)');
      ledger({ ...line, status: 'done' });
      rows.push({ ts: new Date().toISOString(), run: `${RUN} (undo)`, ledger: LEDGER, action: t === 'undo-trash' ? 'folder restored' : 'move back', name: x.name || x.path?.split('/').pop() || '', id: x.id, owner: 'shared drive', from: t === 'undo-trash' ? 'trash' : x.to_path, to: t === 'undo-trash' ? x.path : x.from_path, sharing: '', by: ADMIN });
    } catch (e) { failed.push(`${x.id}: ${e.message}`); ledger({ ...line, status: 'failed', detail: e.message }); }
  }
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), `${RUN} (undo)`, countsText(rows) || 'no changes', CFG.approver, LEDGER, '']);
  console.log(JSON.stringify({ mode: 'undo', reversed: rows.length, failed, note: `created folders under ${GA.name}/${ARCH_ROOT} are left in place`, log: lg.ok ? `appended ${rows.length} rows` : lg.warning, calls: callTally() }, null, 1));
}

await (GO ? go() : UNDO ? undo() : VERIFY ? verify() : dry());

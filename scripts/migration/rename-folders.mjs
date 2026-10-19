// Rename every folder in Granted Files called <old> to <new>. Folders only, name only: IDs, parents and contents
// stay the same. A folder whose parent already holds <new> (ignoring case and spaces) is not renamed; it is listed
// as a merge case. Also lists other misspellings of "Accessibility" in folder names (list only).
// Usage: node --network-family-autoselection-attempt-timeout=5000 scripts/migration/rename-folders.mjs
//          --from "<old name>" --to "<new name>" --run "<log run label>" --tag <file prefix>
//          [--dry]   read-only (drive.readonly, GETs only): walks the drive live, writes <tag>-plan.csv +
//                    <tag>-dryrun.md. The default.
//          --go      renames the folders in the frozen plan; re-checks each live first; ledger line before every
//                    change; appends the run to the Drive migration log.
//          --undo    renames every folder the ledger records as renamed back to its old name.
import fs from 'fs';
import { INV, CFG, ADMIN, token, tally, callTally, parseCsv, vanTime, appendAfterRun, countsText } from './migration-log.mjs';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const GO = args.includes('--go'), UNDO = args.includes('--undo');
const FROM = opt('--from'), TO = opt('--to'), RUN = opt('--run'), TAG = opt('--tag');
if (!FROM || !TO || !RUN || !TAG) { console.error('usage: rename-folders.mjs --from "<old>" --to "<new>" --run "<label>" --tag <prefix> [--dry|--go|--undo]'); process.exit(2); }
const PLAN = `${INV}/${TAG}-plan.csv`, REPORT = `${INV}/${TAG}-dryrun.md`, LEDGER = `${TAG}-ledger.jsonl`, L = `${INV}/${LEDGER}`;
const DRIVE = CFG.drives.sorted, FOLDER = 'application/vnd.google-apps.folder', RO = 'https://www.googleapis.com/auth/drive.readonly';
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
const norm = s => s.toLowerCase().replace(/\s+/g, '');
const folderLink = id => `https://drive.google.com/drive/folders/${id}`;
const qs = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const siblings = async parent => {
  const out = []; let pt = '';
  do { const q = new URLSearchParams({ q: `'${parent}' in parents and mimeType = '${FOLDER}' and trashed = false`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'drive', driveId: DRIVE.id, fields: 'nextPageToken,files(id,name)', pageSize: '1000', ...(pt ? { pageToken: pt } : {}) }); const d = await api('GET', `/files?${q}`, null, 'files.list (siblings)'); out.push(...d.files); pt = d.nextPageToken || ''; } while (pt);
  return out;
};
// edit distance, for the "Accessibility" misspelling scan
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const words = s => s.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/).filter(Boolean);

// ---------- dry run ----------
async function dry() {
  const items = []; let pt = '';
  do {
    const q = new URLSearchParams({ corpora: 'drive', driveId: DRIVE.id, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', q: 'trashed = false', pageSize: '1000', fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,capabilities(canRename))', ...(pt ? { pageToken: pt } : {}) });
    const d = await api('GET', `/files?${q}`, null, 'files.list'); if (d.incompleteSearch) throw new Error('incomplete listing');
    items.push(...d.files); pt = d.nextPageToken || '';
  } while (pt);
  const byId = new Map(items.map(i => [i.id, i])), parentOf = i => (i.parents || [])[0], pathOf = new Map();
  const resolve = i => { if (pathOf.has(i.id)) return pathOf.get(i.id); const up = byId.get(parentOf(i)); const s = up ? `${resolve(up)}/${i.name}` : i.name; pathOf.set(i.id, s); return s; };
  items.forEach(resolve);
  const files = new Map();   // folder id → files anywhere below
  for (const i of items) if (i.mimeType !== FOLDER) { let p = parentOf(i); while (p && byId.has(p)) { files.set(p, (files.get(p) || 0) + 1); p = parentOf(byId.get(p)); } }
  const folders = items.filter(i => i.mimeType === FOLDER), kids = new Map();
  for (const f of folders) { const p = parentOf(f); if (!kids.has(p)) kids.set(p, []); kids.get(p).push(f); }
  const rows = [];
  for (const f of folders.filter(f => f.name === FROM)) {
    const p = parentOf(f), old = pathOf.get(f.id), np = `${old.slice(0, -FROM.length)}${TO}`;
    const twin = (kids.get(p) || []).find(s => s.id !== f.id && norm(s.name) === norm(TO));
    const base = { id: f.id, parent: p, old_path: old, new_path: np, files: files.get(f.id) || 0 };
    if (twin) rows.push({ ...base, action: 'merge', note: `parent already has "${twin.name}" (${twin.id}, ${files.get(twin.id) || 0} files)` });
    else if (f.capabilities?.canRename === false) rows.push({ ...base, action: 'problem', note: 'writers@ cannot rename it' });
    else rows.push({ ...base, action: 'rename', note: '' });
  }
  rows.sort((a, b) => a.old_path.localeCompare(b.old_path));
  const isMis = w => w.toLowerCase() !== 'accessibility' && w.length >= 9 && lev(w.toLowerCase(), 'accessibility') <= 2;
  const other = folders.filter(f => f.name !== FROM && words(f.name).some(isMis)).map(f => ({ path: pathOf.get(f.id), id: f.id, word: words(f.name).find(isMis), files: files.get(f.id) || 0 }));
  const variants = folders.filter(f => f.name !== TO && f.name !== FROM && /workplace\s*access/i.test(f.name)).map(f => ({ path: pathOf.get(f.id), id: f.id, files: files.get(f.id) || 0 }));
  const cols = ['action', 'id', 'parent', 'old_path', 'new_path', 'files', 'note', 'link'];
  fs.writeFileSync(PLAN, [cols.join(','), ...rows.map(r => cols.map(c => csvCell(c === 'link' ? folderLink(r.id) : r[c])).join(','))].join('\n') + '\n');
  const n = a => rows.filter(r => r.action === a), calls = callTally();
  const md = `# ${RUN} — dry run

Built ${vanTime(new Date().toISOString())} (Vancouver). ${DRIVE.name} only. Read-only (drive.readonly, GETs only): ${Object.entries(calls).map(([k, v]) => `${k} ×${v}`).join('; ')}. Nothing was renamed.

"${esc(FROM)}" → "${esc(TO)}". Folders found: **${rows.length}** — rename **${n('rename').length}**, merge cases **${n('merge').length}**, problems **${n('problem').length}**. Files below the renamed folders: ${n('rename').reduce((s, r) => s + r.files, 0)} (they keep their IDs and stay put).

Full list: \`dist/inventory/${TAG}-plan.csv\`.

## Renames (${n('rename').length})

| Now | Becomes | Files below |
|---|---|---|
${n('rename').map(r => `| ${esc(r.old_path)} | ${esc(r.new_path)} | ${r.files} |`).join('\n') || '| — | — | — |'}

## Merge cases — not renamed (${n('merge').length})

${n('merge').map(r => `- ${esc(r.old_path)} (${r.files} files) — ${esc(r.note)}`).join('\n') || 'None.'}

## Problems (${n('problem').length})

${n('problem').map(r => `- ${esc(r.old_path)} — ${r.note}`).join('\n') || 'None.'}

## Other misspellings of "Accessibility" in folder names — list only (${other.length})

${other.map(o => `- ${esc(o.path)} — "${o.word}" (${o.files} files) — ${folderLink(o.id)}`).join('\n') || 'None.'}

## Other "Workplace Accessibility" variants — list only (${variants.length})

${variants.map(v => `- ${esc(v.path)} (${v.files} files) — ${folderLink(v.id)}`).join('\n') || 'None.'}
`;
  fs.writeFileSync(REPORT, md);
  console.log(JSON.stringify({ mode: 'dry', found: rows.length, rename: n('rename').length, merge: n('merge').length, problems: n('problem').length, filesBelow: n('rename').reduce((s, r) => s + r.files, 0), other, variants, calls, plan: PLAN, report: REPORT }, null, 1));
}

// ---------- go ----------
async function go() {
  const plan = loadPlan().filter(r => r.action === 'rename'), RUN_START = new Date().toISOString(), done = [], skipped = [], failed = [];
  for (const r of plan) {
    try {
      const f = await api('GET', `/files/${r.id}?supportsAllDrives=true&fields=id,name,mimeType,parents,trashed`, null, 'files.get');
      if (f.mimeType !== FOLDER) { skipped.push(`${r.old_path}: not a folder`); continue; }
      if (f.trashed) { skipped.push(`${r.old_path}: trashed`); continue; }
      if (f.name !== FROM) { skipped.push(`${r.old_path}: name is now "${f.name}"`); continue; }
      if ((f.parents || [])[0] !== r.parent) { skipped.push(`${r.old_path}: moved since the dry run`); continue; }
      const twin = (await siblings(r.parent)).find(s => s.id !== r.id && norm(s.name) === norm(TO));
      if (twin) { skipped.push(`${r.old_path}: merge case now — parent has "${twin.name}" (${twin.id})`); continue; }
      const line = { type: 'rename-folder', id: r.id, parent: r.parent, old_name: FROM, new_name: TO, old_path: r.old_path, new_path: r.new_path };
      ledger({ ...line, status: 'intent' });
      await api('PATCH', `/files/${r.id}?supportsAllDrives=true&fields=id,name`, { name: TO }, 'files.update (name)');
      const v = await api('GET', `/files/${r.id}?supportsAllDrives=true&fields=name,parents`, null, 'files.get (verify)');
      if (v.name !== TO || (v.parents || [])[0] !== r.parent) throw new Error(`verify failed: name "${v.name}"`);
      ledger({ ...line, status: 'done' }); done.push({ ...r, ts: new Date().toISOString() });
    } catch (e) { failed.push(`${r.old_path}: ${e.message}`); ledger({ type: 'rename-folder', id: r.id, old_name: FROM, new_name: TO, old_path: r.old_path, status: 'failed', detail: e.message }); }
    await sleep(50);
  }
  const rows = done.map(r => ({ ts: r.ts, run: RUN, ledger: LEDGER, action: 'rename', name: TO, id: r.id, owner: 'shared drive', from: `${DRIVE.name}/${r.old_path}`, to: `${DRIVE.name}/${r.new_path}`, sharing: `renamed from "${FROM}"`, by: ADMIN }));
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), RUN, countsText(rows) || 'no changes', CFG.approver, LEDGER, '']);
  console.log(JSON.stringify({ mode: 'go', planned: plan.length, renamed: done.length, skipped, failed, log: lg.ok ? `appended ${rows.length} rows` : lg.warning, calls: callTally() }, null, 1));
}

// ---------- undo ----------
async function undo() {
  const lines = fs.readFileSync(L, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const undone = new Set(lines.filter(x => x.type === 'undo-rename' && x.status === 'done').map(x => x.id));
  const todo = lines.filter(x => x.type === 'rename-folder' && x.status === 'done' && !undone.has(x.id));
  const RUN_START = new Date().toISOString(), done = [], skipped = [], failed = [];
  for (const x of todo) {
    const line = { type: 'undo-rename', id: x.id, old_name: x.new_name, new_name: x.old_name, old_path: x.new_path, new_path: x.old_path };
    try {
      const f = await api('GET', `/files/${x.id}?supportsAllDrives=true&fields=name`, null, 'files.get');
      if (f.name !== x.new_name) { skipped.push(`${x.new_path}: name is now "${f.name}"`); continue; }
      ledger({ ...line, status: 'intent' });
      await api('PATCH', `/files/${x.id}?supportsAllDrives=true&fields=id,name`, { name: x.old_name }, 'files.update (name)');
      ledger({ ...line, status: 'done' }); done.push({ ...line, ts: new Date().toISOString() });
    } catch (e) { failed.push(`${x.new_path}: ${e.message}`); ledger({ ...line, status: 'failed', detail: e.message }); }
  }
  const rows = done.map(x => ({ ts: x.ts, run: `${RUN} (undo)`, ledger: LEDGER, action: 'rename', name: x.new_name, id: x.id, owner: 'shared drive', from: `${DRIVE.name}/${x.old_path}`, to: `${DRIVE.name}/${x.new_path}`, sharing: `renamed back from "${x.old_name}"`, by: ADMIN }));
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), `${RUN} (undo)`, countsText(rows) || 'no changes', CFG.approver, LEDGER, '']);
  console.log(JSON.stringify({ mode: 'undo', renamedBack: done.length, skipped, failed, log: lg.ok ? `appended ${rows.length} rows` : lg.warning, calls: callTally() }, null, 1));
}

await (GO ? go() : UNDO ? undo() : dry());

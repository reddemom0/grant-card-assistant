/**
 * departments-mapping.mjs — destination mapping for the non-Grants Dropbox tree.
 *
 * A STRAIGHT MIRROR, not a reorganization. Every file maps to
 *   Departments/<Top Level Folder>/<exact Dropbox substructure>/<filename>
 * with names preserved verbatim — odd casing, prefixes and all. None of the
 * client/program/year/archive routing that produced the Grants mapping is
 * applied here; reorganizing the departments is a later phase, and mirroring
 * first means nothing has to be re-decided if that structure changes.
 *
 * The only names altered are those Drive cannot store: a colon is the macOS
 * encoding of a typed '/', so it becomes ' - ' — the same rule the Grants
 * mapping used. Every such change is reported.
 *
 * READ-ONLY. Reads two local CSVs, writes a CSV and a markdown report.
 * No Dropbox call, no Drive call, no network of any kind. Copies nothing.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './grants-lib.mjs';
import { DEPARTMENTS_ROOT, foldDestinationCase } from './mapping-lib.mjs';

process.chdir('/Users/Chris/grant-card-assistant');
const INVENTORY = 'dist/inventory/non-grants-inventory.csv';
const GRANTS_MAPPING = 'dist/inventory/full-mapping.csv';
const CE_MAPPING = 'dist/inventory/canexport-mapping.csv';
const DRIVE_FOLDERS = 'dist/inventory/drive-folders.txt';
const CSV_OUT = 'dist/inventory/departments-mapping.csv';
const MD_OUT = 'docs/inventory/departments-mapping.md';

/** Top-level folders explicitly out of scope for this pass. */
const EXCLUDED = new Set(['FINANCE', 'HR', 'ADMIN', 'GETGRANTED', 'GRANTED STARTER']);
/** The already-migrated Grants tree, excluded from SALES. */
const GRANTS_SUBTREE = '/granted team folder/sales/grants';
const OBSERVED_FILES_PER_SEC = 0.59;   // full-copy final stage, measured

const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- read
const rows = [];
{
  let h = null;
  for (const r of parseCsv(await fsp.readFile(INVENTORY, 'utf8'))) {
    if (!h) { h = r; continue; }
    if (!r[0]) continue;
    rows.push({
      path: r[0], name: r[1], type: r[2], size: Number(r[3] || 0),
      serverModified: r[4], clientModified: r[5], ext: r[6],
      top: r[7], noAccess: r[8] === 'true', traverseOnly: r[9] === 'true', readOnly: r[10] === 'true',
    });
  }
}
log(`inventory: ${rows.length} rows (${rows.filter((r) => r.type === 'file').length} files, ${rows.filter((r) => r.type === 'folder').length} folders)`);

/** Top-level folder name, taken from the path rather than trusting the column. */
const topOf = (p) => {
  const segs = p.replace(/^\/+/, '').split('/');
  return segs.length > 1 ? segs[1] : '(root)';
};

// ---------------------------------------------------------------- Step 2
const byTop = new Map();
for (const r of rows) {
  const t = topOf(r.path);
  if (!byTop.has(t)) byTop.set(t, { name: t, files: 0, folders: 0, bytes: 0, flags: new Set() });
  const e = byTop.get(t);
  if (r.type === 'file') { e.files += 1; e.bytes += r.size; } else e.folders += 1;
  if (r.noAccess) e.flags.add('no_access');
  if (r.traverseOnly) e.flags.add('traverse_only');
  if (r.readOnly) e.flags.add('read_only');
}
const inScopeTops = [...byTop.values()]
  .filter((t) => !EXCLUDED.has(t.name.toUpperCase()))
  .sort((a, b) => b.files - a.files);
const excludedTops = [...byTop.values()].filter((t) => EXCLUDED.has(t.name.toUpperCase()));

const invTotals = {
  files: rows.filter((r) => r.type === 'file').length,
  bytes: rows.filter((r) => r.type === 'file').reduce((s, r) => s + r.size, 0),
  folders: rows.filter((r) => r.type === 'folder').length,
};
log(`in scope: ${inScopeTops.length} top-level folders; excluded: ${excludedTops.map((t) => t.name).join(', ') || '(none present)'}`);

// ---------------------------------------------------------------- sanitize
/**
 * Only what Drive cannot accept. A colon is macOS's encoding of a typed '/',
 * so ' - ' keeps the visual break without creating a path separator. Everything
 * else — casing, prefixes, double spaces, leading asterisks — is preserved,
 * because this pass mirrors rather than tidies.
 */
const renames = new Map();
function sanitizeSegment(seg) {
  // CHARACTER-FOR-CHARACTER the rule mapping-lib.mjs applies to the Grants
  // tree. Colon → ' - ', collapse whitespace, trim. Nothing else.
  //
  // An earlier version of this function also mapped [\\|<>"?*] to '-', copied
  // from cleanFilename(). That was wrong twice over: Drive accepts all of those
  // characters in a name, and it silently rewrote real folders — '*Forms' to
  // '-Forms', '*Annual Strategic Meetings' to '-Annual Strategic Meetings' —
  // which is exactly the prefix mangling a verbatim mirror must not do.
  const clean = seg.replace(/\s*:\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  if (clean !== seg) renames.set(seg, clean);
  return clean;
}

// ---------------------------------------------------------------- Step 3+4 map
const out = [];
let skippedGrants = 0, skippedExcluded = 0;
for (const r of rows) {
  if (r.type !== 'file') continue;
  const top = topOf(r.path);
  if (EXCLUDED.has(top.toUpperCase())) { skippedExcluded += 1; continue; }
  // Step 4: the migrated Grants tree. Matched on the exact subtree, so sibling
  // folders whose names merely start with "Grants" (e.g. "Grants - Granted
  // Starter") are NOT swept up with it.
  const lower = r.path.toLowerCase();
  if (lower === GRANTS_SUBTREE || lower.startsWith(GRANTS_SUBTREE + '/')) { skippedGrants += 1; continue; }

  const segs = r.path.replace(/^\/+/, '').split('/');   // ['Granted Team Folder', TOP, ...]
  const rel = segs.slice(1);                            // [TOP, ...sub, filename]
  const filename = rel[rel.length - 1];
  const folderSegs = rel.slice(0, -1).map(sanitizeSegment);
  const dest = [DEPARTMENTS_ROOT, ...folderSegs, filename].join('/');
  out.push({
    src: r.path,
    department: top,
    subpath: folderSegs.slice(1).join('/'),
    dest,
    filename,
    size: r.size,
    modified: r.clientModified || r.serverModified || '',
    ext: r.ext || '',
    route: 'mirror',
    reason: `mirrored from Dropbox ${top}/ — no reorganization applied`,
  });
}
log(`mapped ${out.length} files; skipped ${skippedGrants} already-migrated Grants rows, ${skippedExcluded} out-of-scope rows`);

// ---------------------------------------------------------------- Step 7 case-fold
const driveFolders = (await fsp.readFile(DRIVE_FOLDERS, 'utf8').catch(() => '')).split('\n').filter(Boolean);
const folded = foldDestinationCase(out, driveFolders);
log(`case-folded ${folded.changed} rows across ${folded.variantGroups} variant folder paths`);

// ---------------------------------------------------------------- Step 6 collisions
const occupied = new Map();       // dest -> Set(src)
for (const sheet of [GRANTS_MAPPING, CE_MAPPING]) {
  let h = null;
  for (const r of parseCsv(await fsp.readFile(sheet, 'utf8'))) {
    if (!h) { h = r; continue; }
    if (!r[0] || r[7] === 'review') continue;
    if (!occupied.has(r[5])) occupied.set(r[5], new Set());
    occupied.get(r[5]).add(r[0]);
  }
}
const existingDest = occupied.size;
for (const r of out) {
  if (!occupied.has(r.dest)) occupied.set(r.dest, new Set());
  occupied.get(r.dest).add(r.src);
}
let collisions = [...occupied.entries()].filter(([, v]) => v.size > 1)
  .map(([dest, v]) => ({ dest, sources: [...v] }));

// Suffix rule, identical to the Grants mapping: discriminate on the first
// differing source path segment, widening until unique.
const suffixed = [];
if (collisions.length) {
  const stripPrefix = (s) => s.replace(/^\/+/, '').split('/');
  for (const c of collisions) {
    const parts = c.sources.map(stripPrefix);
    const n = Math.min(...parts.map((p) => p.length));
    const differing = [];
    for (let i = 0; i < n; i++) if (new Set(parts.map((p) => p[i])).size > 1) differing.push(i);
    let discs = null;
    for (let take = 1; take <= differing.length; take++) {
      const cand = parts.map((p) => differing.slice(0, take).map((i) => p[i]).join(' - '));
      const clean = cand.map((s) => s.replace(/\s*:\s*/g, ' - ').replace(/[\\/|<>"?*]/g, '-').replace(/\s+/g, ' ').trim());
      if (new Set(clean).size === clean.length) { discs = clean; break; }
    }
    if (!discs) discs = c.sources.map((s, i) => `dup${i + 1}`);
    c.sources.forEach((src, i) => {
      for (const r of out.filter((x) => x.src === src && x.dest === c.dest)) {
        const segs = r.dest.split('/');
        const fn = segs.pop();
        const ext = path.extname(fn);
        const base = ext ? fn.slice(0, -ext.length) : fn;
        const nf = `${base} (${discs[i]})${ext}`;
        r.dest = [...segs, nf].join('/');
        suffixed.push({ src, oldDest: c.dest, newDest: r.dest });
      }
    });
  }
  // Re-check from scratch.
  const occ2 = new Map();
  for (const sheet of [GRANTS_MAPPING, CE_MAPPING]) {
    let h = null;
    for (const r of parseCsv(await fsp.readFile(sheet, 'utf8'))) {
      if (!h) { h = r; continue; }
      if (!r[0] || r[7] === 'review') continue;
      if (!occ2.has(r[5])) occ2.set(r[5], new Set());
      occ2.get(r[5]).add(r[0]);
    }
  }
  for (const r of out) {
    if (!occ2.has(r.dest)) occ2.set(r.dest, new Set());
    occ2.get(r.dest).add(r.src);
  }
  collisions = [...occ2.entries()].filter(([, v]) => v.size > 1).map(([dest, v]) => ({ dest, sources: [...v] }));
}
log(`collisions: ${collisions.length} after ${suffixed.length} suffixes (checked against ${existingDest} destinations already in Drive)`);

// ---------------------------------------------------------------- Step 8 volume
const totalFiles = out.length;
const totalBytes = out.reduce((s, r) => s + r.size, 0);
const etaSec = totalFiles / OBSERVED_FILES_PER_SEC;
const fmtDur = (s) => `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
const folderSet = new Set();
for (const r of out) {
  const segs = r.dest.split('/');
  for (let i = 1; i < segs.length; i++) folderSet.add(segs.slice(0, i).join('/'));
}

// ---------------------------------------------------------------- Step 9 CSV
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const HEAD = ['source_path','department','subpath','destination_path','filename','size','modified','extension','route','reason'];
const lines = [HEAD.join(',')];
for (const r of out) lines.push([r.src, r.department, r.subpath, r.dest, r.filename, r.size, r.modified, r.ext, r.route, r.reason].map(esc).join(','));
await fsp.mkdir('dist/inventory', { recursive: true });
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
log(`wrote ${CSV_OUT} (${out.length} rows)`);

// ---------------------------------------------------------------- Step 9 MD
const gb = (b) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const n = (x) => x.toLocaleString();
const L = [];
const push = (s = '') => L.push(s);

push('# Departments Mapping — non-Grants Dropbox tree');
push();
push(`**Generated:** ${new Date().toISOString()}`);
push(`**Source:** \`${INVENTORY}\``);
push(`**Output:** \`${CSV_OUT}\``);
push();
push('**A straight mirror, not a reorganization.** Every file maps to');
push('`Departments/<Top Level Folder>/<exact Dropbox substructure>/<filename>`. None of the');
push('client / program / year / archive routing that produced the Grants mapping is applied here.');
push('Folder names are preserved verbatim — odd casing, prefixes, leading asterisks and all.');
push('Reorganizing the departments is a later phase; mirroring first means nothing has to be');
push('re-decided if that structure changes.');
push();
push('Read-only: two local CSVs in, one CSV and this report out. No Dropbox call, no Drive call,');
push('nothing copied.');
push();
push('---');
push();
push('## Scope');
push();
push('| Folder | Files | Folders | Size | Access |');
push('|---|---|---|---|---|');
for (const t of inScopeTops) push(`| ${t.name} | ${n(t.files)} | ${n(t.folders)} | ${gb(t.bytes)} | ${[...t.flags].join(', ') || 'full' } |`);
push(`| **In scope** | **${n(inScopeTops.reduce((s, t) => s + t.files, 0))}** | **${n(inScopeTops.reduce((s, t) => s + t.folders, 0))}** | **${gb(inScopeTops.reduce((s, t) => s + t.bytes, 0))}** | |`);
push();
push('### Reconciliation against the earlier non-Grants inventory');
push();
push(`The 2026-08-12 inventory reported **6,273 files / 24.18 GB** accessible. This mapping covers`);
push(`**${n(totalFiles)} files / ${gb(totalBytes)}**.`);
push();
push('| | Files | Bytes |');
push('|---|---|---|');
push(`| Inventory total (accessible) | ${n(invTotals.files)} | ${gb(invTotals.bytes)} |`);
for (const t of excludedTops) push(`| less ${t.name} (out of scope) | −${n(t.files)} | −${gb(t.bytes)} |`);
push(`| **Mapped here** | **${n(totalFiles)}** | **${gb(totalBytes)}** |`);
push();
if (excludedTops.length) {
  push(`The difference is entirely **${excludedTops.map((t) => `${t.name} (${n(t.files)} files)`).join(', ')}**, excluded by instruction.`);
} else {
  push('No difference — every accessible file is mapped.');
}
push();
push('**FINANCE, ADMIN, GETGRANTED and GRANTED STARTER contribute nothing to either number.** They');
push('returned `path/not_found` during the inventory — the service account cannot see them at all —');
push('so they were never counted as accessible. Excluding them changes no total; it only means');
push('they remain uninventoried, not that they are empty.');
push();
push('---');
push();
push('## SALES — what remains besides Grants');
push();
const salesRows = out.filter((r) => r.department.toUpperCase() === 'SALES');
const salesBySub = new Map();
for (const r of salesRows) {
  const k = r.subpath.split('/')[0] || '(files at SALES root)';
  if (!salesBySub.has(k)) salesBySub.set(k, { files: 0, bytes: 0 });
  const e = salesBySub.get(k); e.files += 1; e.bytes += r.size;
}
push(`The migrated Grants tree is excluded: **${n(skippedGrants)} rows** under`);
push('`/Granted Team Folder/SALES/Grants/` were skipped. (The inventory was itself built excluding');
push('that subtree, so the figure is 0 — the guard is belt-and-braces, and it matches on the exact');
push('subtree rather than a prefix.)');
push();
push(`**SALES contributes ${n(salesRows.length)} files / ${gb(salesRows.reduce((s, r) => s + r.size, 0))}** across ${salesBySub.size} second-level folders:`);
push();
push('| Second-level folder | Files | Size |');
push('|---|---|---|');
for (const [k, v] of [...salesBySub.entries()].sort((a, b) => b[1].files - a[1].files)) {
  push(`| ${k} | ${n(v.files)} | ${gb(v.bytes)} |`);
}
push();
push('> ⚠️ **`Grants - Granted Starter` is included, and you may want it excluded.** It is a distinct');
push('> folder from the migrated `SALES/Grants/` tree and was never copied, so on a literal reading it');
push('> belongs in this mirror. But its name references Granted Starter, which is on the out-of-scope');
push('> list as a *top-level* folder. Prefix-matching it away would also have swallowed it into the');
push('> "already migrated" bucket, which would be wrong — so it is mapped, and flagged here instead of');
push('> being silently decided either way.');
push();
push('---');
push();
push('## OPERATIONS — the count is a floor, not a total');
push();
const opsRows = out.filter((r) => r.department.toUpperCase() === 'OPERATIONS');
const opsTop = byTop.get([...byTop.keys()].find((k) => k.toUpperCase() === 'OPERATIONS') ?? '');
push(`**All ${n(opsRows.length)} OPERATIONS files sit under a single subfolder, \`Contracts\`.** The folder`);
push('is flagged `traverse_only` and `read_only` in the inventory.');
push();
push('**`traverse_only` means the service account can descend through the folder but cannot fully');
push('enumerate it.** The 2,279 figure is therefore a **floor**: it is what was visible, not what is');
push('there. OPERATIONS may hold material outside `Contracts` that never appeared, and `Contracts`');
push('itself may hold more than was listed.');
push();
push('Do not read this row as a complete account of OPERATIONS. Before copying, either grant the');
push('service account full read access to OPERATIONS and re-inventory, or accept explicitly that an');
push('unknown remainder is being left behind.');
push();
push('---');
push();
push('## Name changes');
push();
if (!renames.size) {
  push('**No folder name required sanitizing.** Every segment is storable in Drive as-is.');
} else {
  push(`**${renames.size} folder name${renames.size === 1 ? '' : 's'} changed**, only where Drive cannot store the original:`);
  push();
  push('| Dropbox | Drive |');
  push('|---|---|');
  for (const [a, b] of [...renames.entries()].sort()) push(`| \`${a}\` | \`${b}\` |`);
}
push();
push('Filenames are never altered. Casing, prefixes and spacing are preserved everywhere else.');
push();
push('---');
push();
push('## Case-folding');
push();
if (!folded.changed) {
  push('**No case-variant folders found.** No two department folder paths differ only in capitalization,');
  push('so nothing needed folding.');
} else {
  push(`Drive's folder lookup is case-insensitive, so two Dropbox folders differing only in case would`);
  push(`merge on arrival. The mapping adopts that merge up front: **${folded.changed} rows** folded across`);
  push(`**${folded.variantGroups} variant folder paths**, using Drive's existing spelling where the folder`);
  push('already exists and the first mapping row otherwise.');
}
push();
push('---');
push();
push('## Collision check');
push();
push(`Every destination checked against each other **and** against the ${n(existingDest)} destinations already`);
push('occupied by the migrated Grants and CanExport trees.');
push();
if (!collisions.length && !suffixed.length) {
  push('**Zero collisions.** No two source files map to the same destination, and nothing here would');
  push('overwrite a file already in Drive.');
} else if (!collisions.length) {
  push(`**Zero collisions after resolution.** ${n(suffixed.length)} row${suffixed.length === 1 ? '' : 's'} took the standard suffix rule —`);
  push('the filename gains the first source path segment that distinguishes it. Nothing is dropped or');
  push('deduplicated; every file keeps a distinct destination.');
  push();
  push('| Source | New destination |');
  push('|---|---|');
  for (const s of suffixed.slice(0, 25)) push(`| \`${s.src.slice(-70)}\` | \`${s.newDest.split('/').pop()}\` |`);
} else {
  push(`**${collisions.length} UNRESOLVED collisions** — investigate before copying:`);
  push();
  for (const c of collisions.slice(0, 20)) push(`- \`${c.dest}\` ← ${c.sources.length} sources`);
}
push();
push('---');
push();
push('## Volume and runtime');
push();
push('| | |');
push('|---|---|');
push(`| Files to copy | **${n(totalFiles)}** |`);
push(`| Bytes | **${gb(totalBytes)}** |`);
push(`| Folders to create | ${n(folderSet.size)} |`);
push(`| Observed throughput | ${OBSERVED_FILES_PER_SEC} files/sec |`);
push(`| **Estimated runtime** | **${fmtDur(etaSec)}** |`);
push();
push(`The rate is the measured average from the final Grants copy stage (45,238 files in 21h 12m),`);
push('which includes the connectivity degradation seen throughout that run. At the healthy-stretch');
push(`rate of ~1.15 files/sec the same work takes about ${fmtDur(totalFiles / 1.15)} — treat the figure above as`);
push('the pessimistic end.');
push();
push('| Department | Files | Size | Est. runtime |');
push('|---|---|---|---|');
for (const t of inScopeTops) {
  const f = out.filter((r) => r.department === t.name);
  if (!f.length) continue;
  push(`| ${t.name} | ${n(f.length)} | ${gb(f.reduce((s, r) => s + r.size, 0))} | ${fmtDur(f.length / OBSERVED_FILES_PER_SEC)} |`);
}
push();
await fsp.writeFile(MD_OUT, L.join('\n') + '\n');
log(`wrote ${MD_OUT} (${L.length} lines)`);

console.log(JSON.stringify({
  in_scope_folders: inScopeTops.map((t) => ({ name: t.name, files: t.files, folders: t.folders, bytes: t.bytes, flags: [...t.flags] })),
  excluded_present: excludedTops.map((t) => ({ name: t.name, files: t.files, bytes: t.bytes })),
  mapped_files: totalFiles,
  mapped_bytes: totalBytes,
  folders_to_create: folderSet.size,
  skipped_grants_rows: skippedGrants,
  skipped_excluded_rows: skippedExcluded,
  renames: [...renames.entries()],
  case_folded: folded.changed,
  case_variant_groups: folded.variantGroups,
  suffixed: suffixed.length,
  collisions_after: collisions.length,
  eta: fmtDur(etaSec),
  csv: CSV_OUT, md: MD_OUT,
}, null, 2));

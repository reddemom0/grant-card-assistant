/**
 * audit-fine-choice.mjs — read-only audit of one client's files across
 * Dropbox inventory, mapping, classification, and the Shared Drive.
 *
 * Writes nothing anywhere. Drive is read with a drive.readonly token.
 */

import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { parseCsv, normalizeName } from './grants-lib.mjs';
import 'dotenv/config';

const INVENTORY = 'dist/inventory/grants-inventory.csv';
const MAPPING = 'dist/inventory/canexport-mapping.csv';
const CLIENTS = 'dist/inventory/clients-final.csv';
const RESOLVED = 'dist/inventory/resolved-final.csv';
const DRIVE_ID = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';

// Broad enough to catch spelling variants: FineChoice, Fine Choise, Fine Choce…
const NEEDLE = /fine\s*ch\w*/i;

const log = (...a) => console.log(...a);
const kb = (n) => (n / 1024).toFixed(1);

// ================================================================ Step 1
const rows = [];
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(INVENTORY, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0] || r[2] !== 'file') continue;
    if (!NEEDLE.test(r[0])) continue;
    rows.push({ path: r[0], name: r[1], size: Number(r[3] || 0), sm: r[4], cm: r[5] });
  }
}
log('='.repeat(78));
log(`STEP 1 — inventory matches for /fine\\s*ch/i : ${rows.length} files`);
log('='.repeat(78));

// Which distinct spellings appear?
const spellings = new Set();
for (const r of rows) {
  for (const seg of r.path.split('/')) if (NEEDLE.test(seg)) spellings.add(seg);
}
log(`\ndistinct path segments matching: ${spellings.size}`);
for (const s of [...spellings].sort()) log(`   ${JSON.stringify(s)}`);

log('');
for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
  log(`  ${kb(r.size).padStart(10)} KB  cm=${(r.cm || '').slice(0, 10)}  sm=${(r.sm || '').slice(0, 10)}`);
  log(`      ${r.path}`);
}
log(`\n  total bytes: ${rows.reduce((a, b) => a + b.size, 0).toLocaleString()}`);

// ================================================================ Step 2
const programOf = (p) => p.replace('/Granted Team Folder/SALES/Grants/', '').split('/')[0];
const byProgram = new Map();
for (const r of rows) {
  const pr = programOf(r.path);
  if (!byProgram.has(pr)) byProgram.set(pr, []);
  byProgram.get(pr).push(r);
}
log('\n' + '='.repeat(78));
log('STEP 2 — by program folder');
log('='.repeat(78));
for (const [pr, list] of [...byProgram.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const isCE = /canexport/i.test(pr.replace(/[^a-z]/gi, ''));
  log(`  ${String(list.length).padStart(4)} files  ${isCE ? '[CANEXPORT]' : '[other]    '}  ${pr}`);
}

// ================================================================ Step 3
const mapping = [];
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(MAPPING, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0] || !NEEDLE.test(r[0] + ' ' + r[1] + ' ' + r[5])) continue;
    mapping.push({
      src: r[0], client: r[1], program: r[2], year: r[3], yearSource: r[4],
      dest: r[5], route: r[7], confidence: r[8], reason: r[9],
    });
  }
}
log('\n' + '='.repeat(78));
log(`STEP 3 — mapping rows: ${mapping.length}`);
log('='.repeat(78));
const byRoute = new Map();
for (const m of mapping) byRoute.set(m.route, (byRoute.get(m.route) ?? 0) + 1);
log(`  routes: ${JSON.stringify(Object.fromEntries(byRoute))}\n`);
for (const m of mapping.sort((a, b) => a.dest.localeCompare(b.dest))) {
  log(`  [${m.route}] year=${m.year} (${m.yearSource}) conf=${m.confidence}`);
  log(`      client: ${m.client}`);
  log(`      dest:   ${m.dest}`);
  if (m.route !== 'sort') log(`      reason: ${m.reason}`);
}

// ================================================================ Step 4 — list Drive directly
async function loadServiceKey() {
  const fromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (fromEnv && fromEnv.trim().startsWith('{')) {
    try { return JSON.parse(fromEnv); } catch { /* dotenv truncation */ }
  }
  const lines = (await fsp.readFile('.env', 'utf8')).split('\n');
  const i = lines.findIndex((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
  let raw = lines[i].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length);
  for (let j = i + 1; j < lines.length; j++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break;
    raw += '\n' + lines[j];
  }
  return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
}
const key = await loadServiceKey();
const nowSec = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/drive.readonly',   // READ ONLY
  aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600,
})}`;
const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
const TOKEN = (await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
})).json()).access_token;

async function children(id) {
  const out = [];
  let pageToken = null;
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}`
      + `&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=1000`
      + `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 150)}`);
    const d = await res.json();
    out.push(...(d.files ?? []));
    pageToken = d.nextPageToken;
  } while (pageToken);
  return out;
}

log('\n' + '='.repeat(78));
log('STEP 4 — actual Shared Drive contents (listed directly via Drive API)');
log('='.repeat(78));

const top = await children(DRIVE_ID);
const matches = top.filter((f) => NEEDLE.test(f.name));
log(`  top-level folders matching: ${matches.length ? matches.map((m) => JSON.stringify(m.name)).join(', ') : 'NONE'}`);

const driveFiles = [];
async function walk(id, prefix) {
  for (const f of await children(id)) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.mimeType === 'application/vnd.google-apps.folder') await walk(f.id, p);
    else driveFiles.push({ path: p, size: Number(f.size ?? 0), mimeType: f.mimeType });
  }
}
for (const m of matches) await walk(m.id, m.name);
log(`  files found: ${driveFiles.length}\n`);
for (const f of driveFiles.sort((a, b) => a.path.localeCompare(b.path))) {
  log(`  ${kb(f.size).padStart(10)} KB  ${f.path}`);
}

// ================================================================ Step 6
log('\n' + '='.repeat(78));
log('STEP 6 — canonical names in the classification');
log('='.repeat(78));
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CLIENTS, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0] || !NEEDLE.test(r[0] + ' ' + r[1])) continue;
    log(`  canonical: ${JSON.stringify(r[0])}`);
    log(`     raw names : ${r[1]}`);
    log(`     programs=${r[3]} files=${r[4]} retention=${r[8]} corrected=${r[9]}`);
  }
}
log('\n  raw name rows in resolved-final.csv:');
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(RESOLVED, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0] || !NEEDLE.test(r[0] + ' ' + (r[3] || ''))) continue;
    log(`     ${JSON.stringify(r[0])} label=${r[2]} canonical=${JSON.stringify(r[3])} conf=${r[4]} files=${r[9]}`);
  }
}

// ================================================================ Step 5
log('\n' + '='.repeat(78));
log('STEP 5 — comparison');
log('='.repeat(78));
const expected = new Map(mapping.map((m) => [m.dest, m]));
const actual = new Map(driveFiles.map((f) => [f.path, f]));
const srcSize = new Map(rows.map((r) => [r.path, r.size]));

const missing = [...expected.entries()].filter(([d]) => !actual.has(d));
const unexpected = [...actual.keys()].filter((p) => !expected.has(p));
const sizeBad = [];
for (const [d, m] of expected) {
  const a = actual.get(d);
  if (!a) continue;
  const want = srcSize.get(m.src);
  if (want !== undefined && want !== a.size) sizeBad.push({ d, want, got: a.size });
}
log(`  inventory files (all programs) : ${rows.length}`);
log(`  mapping rows (CanExport only)  : ${mapping.length}`);
log(`  files present in Drive         : ${driveFiles.length}`);
log(`  expected-but-missing           : ${missing.length}`);
log(`  present-but-unexpected         : ${unexpected.length}`);
log(`  size mismatches                : ${sizeBad.length}`);
if (missing.length) {
  log('\n  MISSING:');
  for (const [d, m] of missing) log(`    [${m.route}] ${d}\n        reason: ${m.reason}`);
}
if (unexpected.length) { log('\n  UNEXPECTED:'); for (const p of unexpected) log(`    ${p}`); }
if (sizeBad.length) { log('\n  SIZE MISMATCH:'); for (const s of sizeBad) log(`    ${s.d}  want=${s.want} got=${s.got}`); }

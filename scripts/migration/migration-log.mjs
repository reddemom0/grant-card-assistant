// Drive migration log — shared helpers: auth, Sheets calls, ledger → Log rows, append after a run.
// Writes only to the two log spreadsheets (values + formatting). No file moves or permission calls here.
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
// Repo root = two levels up from scripts/migration/. All data (IDs, accounts, names) is read from dist/.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const INV = `${ROOT}/dist/inventory`;
export const CFG = JSON.parse(fs.readFileSync(`${ROOT}/dist/migration/config.json`, 'utf8'));
export const CONFIG = `${INV}/migration-log.json`;   // sheet IDs, written by build-log.mjs
export const ADMIN = CFG.adminAccount;
export const DOMAIN = CFG.domain;
export const DOMAIN_RE = new RegExp(`@${DOMAIN.replace(/\./g, '\\.')}$`, 'i');
export const emailOf = short => short.endsWith('@') ? `${short}${DOMAIN}` : short;
export const DRIVES = { [CFG.drives.sorted.name]: CFG.drives.sorted.id, [CFG.drives.archive.name]: CFG.drives.archive.id };
export const { parseCsv } = await import(`${ROOT}/scripts/grants-lib.mjs`);
export const loadCsv = p => { const it = parseCsv(fs.readFileSync(p.startsWith('/') ? p : `${INV}/${p}`, 'utf8')); const h = it.next().value; const o = []; for (const r of it) if (r.length > 1) o.push(Object.fromEntries(h.map((k, i) => [k, r[i]]))); return o; };
export const loadJsonl = p => fs.readFileSync(p.startsWith('/') ? p : `${INV}/${p}`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
export const HEADER = ['Date-time (Vancouver)', 'Run', 'Action', 'File name', 'File ID', 'File link', 'Owner', 'From (path)', 'To (path)', 'Sharing detail', 'Done by', 'Ledger file'];
export const RUNS_HEADER = ['Date (Vancouver)', 'Run', 'Counts', 'Approved by', 'Report file', 'Link'];
export const SA_LABEL = CFG.serviceAccountLabel;

const calls = {}; export const tally = k => { calls[k] = (calls[k] || 0) + 1; }; export const callTally = () => calls;
function loadKey() { const lines = fs.readFileSync(`${ROOT}/.env`, 'utf8').split('\n'); const i = lines.findIndex(l => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY=')); let raw = lines[i].slice(27); for (let j = i + 1; j < lines.length; j++) { if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break; raw += '\n' + lines[j]; } return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, '')); }
let KEY; const toks = new Map();
export async function token(sub = ADMIN, scope = 'https://www.googleapis.com/auth/drive') {
  KEY ||= loadKey(); const k = `${sub}|${scope}`; const t = toks.get(k); if (t && Date.now() < t.exp - 300000) return t.tok;
  const n = Math.floor(Date.now() / 1000), b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const u = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iss: KEY.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: n, exp: n + 3600, sub })}`;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${u}.${crypto.createSign('RSA-SHA256').update(u).sign(KEY.private_key, 'base64url')}` }) });
  tally('POST oauth2 token'); const d = await r.json(); if (!r.ok) throw new Error(`token: ${d.error_description || d.error}`);
  toks.set(k, { tok: d.access_token, exp: Date.now() + d.expires_in * 1000 }); return d.access_token;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function sheets(method, path, body, label) {
  let delay = 1500;
  for (let a = 1; a <= 6; a++) {
    tally(`${method} sheets ${label}`); let r;
    try { r = await fetch('https://sheets.googleapis.com/v4/spreadsheets' + path, { method, headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) }); }
    catch (e) { await sleep(delay); delay *= 2; continue; }
    if (r.ok) return r.json();
    const t = await r.text(); if (r.status === 429 || r.status >= 500) { await sleep(delay); delay *= 2; continue; }
    throw new Error(`sheets ${label} ${r.status}: ${t.slice(0, 300)}`);
  }
  throw new Error(`sheets ${label}: retries exhausted`);
}
export const vanTime = iso => { if (!iso) return ''; const d = new Date(iso); const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
export const link = id => id ? `=HYPERLINK("https://drive.google.com/open?id=${id}","open")` : '';

// Ledger line → Log row (for the move-owner.mjs ledger format). ctx: { run, owner, ownerEmail, ledger, names, from, to }
export function moveOwnerRows(lines, ctx) {
  const rows = [];
  for (const x of lines) {
    if (x.status !== 'done') continue;
    const base = { ts: x.ts, run: ctx.run, ledger: ctx.ledger };
    if (x.type === 'move') rows.push({ ...base, action: 'move', name: ctx.names(x.id), id: x.id, owner: ctx.owner, from: ctx.from(x.id), to: `${x.drive}/${x.dest}`, sharing: '', by: ctx.ownerEmail });
    else if (x.type === 'create-folder') rows.push({ ...base, action: 'folder created', name: x.path.split('/').pop(), id: x.id, owner: 'shared drive', from: '', to: x.path, sharing: '', by: ADMIN });
    else if (x.type === 'remove-permission') rows.push({ ...base, action: 'access removed', name: ctx.names(x.id), id: x.id, owner: 'shared drive', from: '', to: ctx.to(x.id), sharing: `${x.who}, ${x.role}`, by: ADMIN });
    else if (x.type === 'add-permission') rows.push({ ...base, action: 'access added', name: ctx.names(x.id), id: x.id, owner: 'shared drive', from: '', to: ctx.to(x.id), sharing: `${x.who}, ${x.role}`, by: ADMIN, run: ctx.runFor?.(x) || ctx.run });
    else if (x.type === 'undo-move') rows.push({ ...base, action: 'move back', name: ctx.names(x.id), id: x.id, owner: ctx.owner, from: x.from || '', to: 'original My Drive folder', sharing: '', by: ADMIN });
    else if (x.type === 'undo-remove') rows.push({ ...base, action: 'access added', name: ctx.names(x.id), id: x.id, owner: 'shared drive', from: '', to: '', sharing: `${x.who}, ${x.role} (undo of a removal)`, by: ADMIN });
    else if (x.type === 'undo-add') rows.push({ ...base, action: 'access removed', name: ctx.names(x.id), id: x.id, owner: 'shared drive', from: '', to: '', sharing: `${x.who}, ${x.role} (undo of an add)`, by: ADMIN });
  }
  return rows;
}
export const toCells = r => [vanTime(r.ts), r.run, r.action, r.name || '', r.id || '', link(r.id), r.owner || '', r.from || '', r.to || '', r.sharing || '', r.by || '', r.ledger || ''];
export const countsText = rows => { const c = {}; for (const r of rows) c[r.action] = (c[r.action] || 0) + 1; return Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · '); };

// Append after a run. Never throws: returns { ok, warning }.
export async function appendAfterRun(rows, runRow) {
  try {
    if (!fs.existsSync(CONFIG)) return { ok: false, warning: `no ${CONFIG} — sheet not set up; ledger kept locally` };
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (rows.length) await sheets('POST', `/${cfg.spreadsheetId}/values/${encodeURIComponent('Log!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: rows.sort((a, b) => (a.ts || '').localeCompare(b.ts || '')).map(toCells) }, 'values.append (Log)');
    await sheets('POST', `/${cfg.spreadsheetId}/values/${encodeURIComponent('Runs!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: [runRow] }, 'values.append (Runs)');
    const fmt = (sid, pattern) => ({ repeatCell: { range: { sheetId: sid, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern } } }, fields: 'userEnteredFormat.numberFormat' } });
    await sheets('POST', `/${cfg.spreadsheetId}:batchUpdate`, { requests: [fmt(cfg.tabs.Log, 'yyyy-mm-dd hh:mm'), fmt(cfg.tabs.Runs, 'yyyy-mm-dd')] }, 'batchUpdate (date format)');
    return { ok: true };
  } catch (e) { return { ok: false, warning: `migration log append failed (${e.message}); the local ledger is the backup — re-run the append later` }; }
}

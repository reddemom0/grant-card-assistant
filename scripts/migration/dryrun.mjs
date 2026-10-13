// Phase A dry run for one owner from move-plan-v6.csv. READ-ONLY (drive.readonly, GET only).
// Usage: node scripts/migration/dryrun.mjs <owner>@
import fs from 'fs';
import crypto from 'crypto';
import { ROOT, INV, CFG, ADMIN, DRIVES, emailOf, parseCsv } from './migration-log.mjs';
const D = INV;
const OWNER = process.argv[2]; if (!OWNER) throw new Error('owner?');
const load = p => { const it = parseCsv(fs.readFileSync(p, 'utf8')); const h = it.next().value; const o = []; for (const r of it) if (r.length > 1) o.push(Object.fromEntries(h.map((k, i) => [k, r[i]]))); return o; };
const plan = load(`${D}/${CFG.files.v6}`).filter(r => r.owner === OWNER);
const snap = new Map(fs.readFileSync(`${D}/${CFG.files.snapshot}`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.owner === OWNER).map(x => [x.id, x]));
const lines = fs.readFileSync(`${ROOT}/.env`, 'utf8').split('\n'); const ki = lines.findIndex(l => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY=')); let raw = lines[ki].slice(27); for (let j = ki + 1; j < lines.length; j++) { if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break; raw += '\n' + lines[j]; }
const KEY = JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
const calls = {}; const tally = k => { calls[k] = (calls[k] || 0) + 1; };
const toks = new Map();
async function token(sub) { if (toks.has(sub)) return toks.get(sub); const n = Math.floor(Date.now() / 1000), b = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const u = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iss: KEY.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: n, exp: n + 3600, sub })}`; const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${u}.${crypto.createSign('RSA-SHA256').update(u).sign(KEY.private_key, 'base64url')}` }) }); tally('POST token (drive.readonly)'); const d = await r.json(); if (!r.ok) throw new Error(d.error_description); toks.set(sub, d.access_token); return d.access_token; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(sub, p, label) { let delay = 1500; for (let a = 1; a <= 8; a++) { tally(`GET ${label}`); let r; try { r = await fetch('https://www.googleapis.com/drive/v3' + p, { headers: { Authorization: `Bearer ${await token(sub)}` }, signal: AbortSignal.timeout(60000) }); } catch (e) { console.error(`transport ${e.cause?.code || e.name}`); await sleep(delay); delay *= 2; continue; } if (r.ok) return r.json(); const t = await r.text(); if (r.status === 429 || r.status >= 500 || (r.status === 403 && /rateLimit|quota|backendError/.test(t))) { await sleep(delay); delay *= 2; continue; } return { __error: r.status }; } return { __error: 'retries' }; }
const ownerEmail = emailOf(OWNER);
// membership
const members = {}; for (const [n, id] of Object.entries(DRIVES)) { const p = await get(ADMIN, `/files/${id}/permissions?supportsAllDrives=true&useDomainAdminAccess=true&fields=permissions(emailAddress,role)`, 'permissions.list (drive members)'); members[n] = (p.permissions || []).find(x => (x.emailAddress || '').toLowerCase() === ownerEmail)?.role || null; }
// file checks
const checks = [];
for (const r of plan) {
  const f = await get(ownerEmail, `/files/${r.file_id}?supportsAllDrives=true&fields=id,name,owners(emailAddress),parents,trashed,driveId,mimeType,capabilities(canMoveItemOutOfDrive)`, 'files.get (file)');
  const s = snap.get(r.file_id);
  const issues = [];
  if (f.__error) issues.push(`cannot read (${f.__error})`);
  else {
    if ((f.owners?.[0]?.emailAddress || '').toLowerCase() !== (r.action === 'shortcut' ? s?.owner_email : ownerEmail)) issues.push(`owner now ${f.owners?.[0]?.emailAddress || 'shared drive'}`);
    if (f.trashed) issues.push('trashed'); if (f.driveId) issues.push('already in a shared drive');
    if (s?.parent_id && (f.parents || [])[0] !== s.parent_id) issues.push('moved since the snapshot');
    if (f.mimeType === 'application/vnd.google-apps.folder') issues.push('is a folder');
    if (r.action === 'move' && f.capabilities && f.capabilities.canMoveItemOutOfDrive === false) issues.push('owner cannot move it out of My Drive');
  }
  checks.push({ r, issues });
  await sleep(60);
}
// destination folders (live, read-only)
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const kids = new Map();
async function children(driveId, pid) { const k = `${driveId}|${pid}`; if (kids.has(k)) return kids.get(k); if (pid.startsWith('NEW:')) return []; const out = []; let pt; do { const q = new URLSearchParams({ corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', q: `'${pid}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: 'nextPageToken,files(id,name)', pageSize: '1000' }); if (pt) q.set('pageToken', pt); const d = await get(ADMIN, `/files?${q}`, 'files.list (folders)'); out.push(...(d.files || [])); pt = d.nextPageToken; } while (pt); kids.set(k, out); return out; }
const create = new Set(), reuseNorm = new Set(), resolved = new Map(), ambiguous = [];
async function resolve(driveName, path) {
  const driveId = DRIVES[driveName]; let cur = driveId, acc = driveName;
  for (const seg0 of path.split('/')) { const seg = seg0.replace(/∕/g, '/'); acc += '/' + seg; if (resolved.has(acc)) { cur = resolved.get(acc); continue; }
    const ch = await children(driveId, cur); const ex = ch.filter(x => x.name === seg), nm = ch.filter(x => norm(x.name) === norm(seg));
    if (ex.length) cur = ex[0].id; else if (nm.length === 1) { cur = nm[0].id; reuseNorm.add(`${acc} → existing "${nm[0].name}"`); } else if (nm.length > 1) { ambiguous.push(acc); cur = nm[0].id; } else { cur = `NEW:${acc}`; create.add(acc); }
    resolved.set(acc, cur); }
}
for (const { r } of checks) await resolve(r.target_drive.replace(/ \(.*\)$/, ''), r.target_path);
// report
const ok = checks.filter(c => !c.issues.length), bad = checks.filter(c => c.issues.length);
const share = plan.filter(r => r.sharing_actions).flatMap(r => r.sharing_actions.split(';').map(a => ({ r, a })));
const byDrive = d => plan.filter(r => r.target_drive.startsWith(d) && r.action === 'move').length;
const esc = s => String(s).replace(/\|/g, '\\|');
const md = `# Phase A dry run — ${OWNER}

Built ${new Date().toISOString()}. Read-only (drive.readonly; GETs only): ${Object.entries(calls).map(([k, v]) => `${k} ×${v}`).join('; ')}. Nothing was moved, created or re-shared.

## Ready?

- Files in v6 for ${OWNER}: **${plan.length}** — ${byDrive('Granted Files')} → Granted Files, ${byDrive('Granted Archive')} → Granted Archive, ${plan.filter(r => r.action === 'shortcut').length} shortcuts.
- Pass the live check (still owned by ${OWNER}, not trashed, not moved since the snapshot): **${ok.length}**. Problems: **${bad.length}**.
- Drive access for ${ownerEmail}: Granted Files = ${members['Granted Files'] || '**not a member**'}, Granted Archive = ${members['Granted Archive'] || '**not a member**'}.
- Folders that would be created: **${create.size}**. Reused by spelling-insensitive match: ${reuseNorm.size}. Ambiguous: ${ambiguous.length}.
- Sharing actions after the move: **${share.length}** (${share.filter(x => x.a.startsWith('add:')).length} add, ${share.filter(x => x.a.startsWith('remove:')).length} remove).

${bad.length ? `## Problems (would be skipped)\n\n${bad.map(c => `- ${esc(c.r.name)} → ${c.issues.join('; ')}`).join('\n')}\n` : ''}
## Folders that would be created

${[...create].sort().map(p => `- ${esc(p)}`).join('\n') || 'None.'}
${reuseNorm.size ? `\n**Reused (spelling-insensitive):**\n${[...reuseNorm].map(x => `- ${esc(x)}`).join('\n')}\n` : ''}${ambiguous.length ? `\n**Ambiguous (more than one match):**\n${ambiguous.map(x => `- ${esc(x)}`).join('\n')}\n` : ''}
## Where the files go

| Target | Files |
|---|---|
${Object.entries(plan.reduce((m, r) => { const k = `${r.target_drive.replace(/ \(.*\)$/, '')}/${r.target_path.split('/').slice(0, 2).join('/')}`; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${esc(k)} | ${v} |`).join('\n')}

## Sharing actions after the move

${share.length ? `| File | Action |\n|---|---|\n${share.map(x => `| ${esc(x.r.name)} | ${esc(x.a)} |`).join('\n')}` : 'None.'}
`;
fs.writeFileSync(`${D}/dryrun-${OWNER.replace(/@$/, '')}.md`, md);
console.log(JSON.stringify({ files: plan.length, ok: ok.length, problems: bad.length, members, create: create.size, reuse: reuseNorm.size, ambiguous: ambiguous.length, share: share.length, calls }));

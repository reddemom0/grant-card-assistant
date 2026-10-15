// Move plan v6: targets, sharing actions, shortcuts, notice data. Local only — no network code.
import fs from 'fs';
import { INV, CFG, DOMAIN, DOMAIN_RE, emailOf, parseCsv } from './migration-log.mjs';
const D = INV;
const F = CFG.files;
const ALREADY_MOVED = CFG.alreadyMovedOwners, HELD = CFG.heldOwners;
const MOVED_LABEL = ALREADY_MOVED.join(', ');
const load = p => { const it = parseCsv(fs.readFileSync(p, 'utf8')); const h = it.next().value; const o = []; for (const r of it) if (r.length > 1) o.push(Object.fromEntries(h.map((k, i) => [k, r[i]]))); return o; };
const jsonl = p => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const v5all = load(`${D}/${F.v5}`);
const snap = new Map(jsonl(`${D}/${F.snapshot}`).map(x => [x.id, x]));
const wc = jsonl(`${D}/${F.writersCheck}`);
const inv = new Map(load(`${D}/${F.inventory}`).map(r => [r.file_id, r]));
// Google Meet rule (approved 2026-10-13): files under a "Google Meet" folder move only if 4+ in-domain people
// have access (snapshot permissions, owner included) or a folder under Google Meet has "Webinar" or "Staff Meeting" in its name.
const meetSegs = path => { const segs = (path || '').split('/'); const i = segs.findIndex(x => x.trim() === 'Google Meet'); return i < 0 ? null : segs.slice(i + 1); };
const grantedPeople = s => new Set((s?.perms || []).filter(p => (p.type === 'user' || p.type === 'group') && DOMAIN_RE.test(p.who)).map(p => p.who.toLowerCase())).size;
const meetStay = new Map();
for (const r of v5all) {
  if (r.plan !== 'sorted' && r.plan !== 'archive') continue;
  const v = inv.get(r.drive_file_id); const parent = v ? (v.path.endsWith('/' + v.name) ? v.path.slice(0, -(v.name.length + 1)) : v.path) : r.source_folder;
  const segs = meetSegs(parent); if (!segs) continue;
  const n = grantedPeople(snap.get(r.drive_file_id)); const webinar = segs.some(x => /webinar|staff meeting/i.test(x));
  if (n < 4 && !webinar) meetStay.set(r.drive_file_id, { owner: r.owner, was: r.plan, folder: parent, name: v?.name || '', granted: n });
}
// Exclusions added at v6 (file IDs listed in config.v6ExcludeIds, if any).
const v6Excluded = new Map((CFG.v6ExcludeIds || []).map(id => [id, { owner: '', name: '', reason: 'excluded at v6' }]));
const v5 = v5all.filter(r => (r.plan === 'sorted' || r.plan === 'archive') && !meetStay.has(r.drive_file_id) && !v6Excluded.has(r.drive_file_id));
// Destination fixes (approved 2026-10-13)
const slashNames = [...new Set([...inv.values()].filter(x => x.is_folder === 'true' && x.name.includes('/')).map(x => x.name.trim()))];
const slashFolderByPath = new Map([...inv.values()].filter(x => x.is_folder === 'true' && x.name.includes('/')).map(x => [x.path, x.name.trim()]));
const parentOf = id => { const v = inv.get(id); return v ? (v.path.endsWith('/' + v.name) ? v.path.slice(0, -(v.name.length + 1)) : v.path) : ''; };
const destFixes = { staff: [], webinar: [], slash: new Map(), amp: 0, rehome: [], repeat: [], repeatSegs: new Map(), trim: 0, fileSlash: 0 };
function fixDest(path, r) {
  let d = path; const before = d; const id = r.drive_file_id; const parent = parentOf(id); const name = inv.get(id)?.name || '';
  if (/&amp;/.test(d)) { d = d.replace(/&amp;/g, '&'); destFixes.amp++; }
  const segs = meetSegs(parent);
  const meetFolder = segs && segs[0] ? segs[0].trim() : '';
  const isStaff = (segs && segs.some(x => /staff meeting/i.test(x))) || /Weekly Staff Meeting - \d{4}\//.test(d);
  const isWebinar = !isStaff && ((segs && segs.some(x => /webinar/i.test(x))) || /^Departments\/MARKETING\/Webinars\/.+ - \d{4}\//.test(d));
  if (isStaff) {
    const m = (parent + '/' + name + '/' + d).match(/(20\d\d)\/(\d\d)\/\d\d/);
    d = `Departments/LEADERSHIP/Staff Meetings/Weekly Staff Meeting${m ? `/${m[1]}-${m[2]}` : ''}`;
    if (d !== before) destFixes.staff.push({ owner: r.owner, from: before, to: d });
    return d;
  }
  if (isWebinar) {
    let wn = /webinar/i.test(meetFolder) ? meetFolder : (d.match(/^Departments\/MARKETING\/Webinars\/(.+?) - \d{4}\//) || [])[1] || meetFolder;
    wn = wn.replace(/&amp;/g, '&').replace(/\s*-\s*\d{4}(\/.*)?$/, '').replace(/\s*\(recurring\)\s*$/i, '').replace(/\//g, '-').trim();
    d = `Departments/MARKETING/Webinars/${wn}`;
    if (d !== before) destFixes.webinar.push({ owner: r.owner, from: before, to: d });
    return d;
  }
  const own = []; { const parts = parent.split('/'); for (let i = 1; i <= parts.length; i++) { const pre = parts.slice(0, i).join('/'); if (slashFolderByPath.has(pre)) own.push(slashFolderByPath.get(pre)); } }
  for (const n of slashNames) if (parent.includes('/' + n + '/') || parent.endsWith('/' + n)) own.push(n);
  for (const n of [...new Set(own)].sort((a, b) => b.length - a.length)) { const fixed = n.replace(/\//g, '-'); const idx = d.indexOf(n); if (idx >= 0 && (idx === 0 || d[idx - 1] === '/') && (idx + n.length === d.length || d[idx + n.length] === '/')) { d = d.slice(0, idx) + fixed + d.slice(idx + n.length); destFixes.slash.set(`${n} → ${fixed}`, (destFixes.slash.get(`${n} → ${fixed}`) || 0) + 1); } }
  return PATH_FIX_OWNERS.has(r.owner) ? programFixes(d, r) : d;
}
// Program-path fixes (approved 2026-10-14), only for owners in config.pathFixOwners:
// 1. Programs/<P>/…Projects by Year/<year>/<client folder>/… → Clients/<Client>/<P>/<year>/… (client names from config.clientRehome)
// 2. Below the year, drop a folder that repeats the program (or its short form) already in the path. No other flattening.
const PATH_FIX_OWNERS = new Set(CFG.pathFixOwners || []);
const REHOME = CFG.clientRehome?.map || {};
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const YEAR = /^(19|20)\d\d$/;
const REHOME_RX = /^Programs\/([^/]+)\/(?:.*\/)?[^/]*Projects by Year\/((?:19|20)\d\d)\/([^/]+)(\/.*)?$/;
const programForms = prog => { const f = new Set([norm(prog), norm(prog.split('(')[0]), norm((prog.match(/\(([^)]*)\)/) || [])[1] || '')]); for (const part of prog.split(/\s+[-–]\s+/)) f.add(norm(part)); f.delete(''); return f; };
function programFixes(path, r) {
  let d = path;
  const m = d.match(REHOME_RX);
  if (m) {
    const to = REHOME[m[3].trim()];
    if (!to) throw new Error(`no approved client mapping for "${m[3]}" (${r.owner})`);
    d = ['Clients', to.client, m[1], m[2], ...(to.sub ? [to.sub] : [])].join('/') + (m[4] || '');
    destFixes.rehome.push({ owner: r.owner, from: path, to: d });
  }
  const s = d.split('/');
  if (s[0] === 'Clients' || s[0] === 'Programs') {
    const yi = s.findIndex(x => YEAR.test(x.trim()));
    if (yi >= 2) {
      const prog = s[yi - 1], forms = programForms(prog), pn = norm(prog);
      const kept = s.slice(yi + 1).filter(seg => { const n = norm(seg); const drop = forms.has(n) || (n.length >= 4 && pn.startsWith(n)); if (drop) destFixes.repeatSegs.set(`${seg} (under ${prog})`, (destFixes.repeatSegs.get(`${seg} (under ${prog})`) || 0) + 1); return !drop; });
      const out = [...s.slice(0, yi + 1), ...kept].join('/');
      if (out !== d) { destFixes.repeat.push({ owner: r.owner, from: d, to: out }); d = out; }
    }
  }
  let segs = d.split("/").map(x => x.trim());   // no leading/trailing spaces in folder names
  const fname = inv.get(r.drive_file_id)?.name || "";   // a file name with "/" must not become folders
  if (fname.includes("/")) { const parts = fname.split("/").map(x => x.trim()); for (let i = 1; i < segs.length; i++) { const tail = segs.slice(i); if (tail.length < parts.length && tail.every((x, k) => x === parts[k])) { segs = segs.slice(0, i); destFixes.fileSlash++; break; } } }
  const trimmed = segs.join("/");
  if (trimmed !== d) destFixes.trim++;
  return trimmed;
}

const GF = CFG.drives.sorted, GA = CFG.drives.archive;
// drive memberships from the read-only lookups, kept in config
const MEMBERS = Object.fromEntries(Object.entries(CFG.driveMembers).map(([k, v]) => [k, new Set(v.map(x => x.toLowerCase()))]));
const REMOVE = new Set(CFG.removeAccounts.map(x => x.toLowerCase()));
const NO_RESTORE = new Set((CFG.noRestoreAccounts || []).map(x => x.toLowerCase()));   // never restore access for these (direct shares still travel)
const CUTOFF = CFG.restoreCutoff;
const SA = /\.iam\.gserviceaccount\.com$/i;
const outside = p => (p.type === 'user' || p.type === 'group') ? !(DOMAIN_RE.test(p.who) || SA.test(p.who)) : p.type === 'domain' ? (p.who || '').toLowerCase() !== DOMAIN : false;
const modOf = id => (inv.get(id)?.modified_time || '').slice(0, 10);

const plan = [], lapse = [], stats = { restore: 0, removeDirect: 0, dropsOnMove: 0, lapseOld: 0, lapseLink: 0, shortcut: 0, noRestore: 0 };
const restoreBy = new Map(), restoreDom = new Map(), removeBy = new Map();
for (const r of v5) {
  const s = snap.get(r.drive_file_id);
  const isGA = r.plan === 'archive';
  const drive = isGA ? GA : GF;
  const path = isGA ? r.archive_path.replace(new RegExp(`^${GA.name}/`), '').replace(/&amp;/g, '&') : fixDest(r.v3_destination || r.destination, r);
  const name = s?.name || inv.get(r.drive_file_id)?.name || '';
  const shortcut = s?.class === 'external-owned';
  const acts = [];
  if (shortcut) stats.shortcut++;
  else if (s && !s.error) {
    const mod = modOf(r.drive_file_id), recent = mod && mod >= CUTOFF;
    const byWho = new Map();
    for (const p of s.perms) if (outside(p) || p.type === 'anyone') { const k = p.who.toLowerCase(); const x = byWho.get(k) || { who: p.who, type: p.type, role: p.role, direct: false, inherited: false }; x.direct ||= p.direct; x.inherited ||= p.inherited; if (p.direct) x.role = p.role; byWho.set(k, x); }
    for (const [k, x] of byWho) {
      if (REMOVE.has(k)) { if (x.direct) { acts.push(`remove:${x.who}`); stats.removeDirect++; } else stats.dropsOnMove++; removeBy.set(k, (removeBy.get(k) || { direct: 0, drops: 0 })); removeBy.get(k)[x.direct ? 'direct' : 'drops']++; continue; }
      if (x.direct) continue;                                   // direct share travels with the file
      if (NO_RESTORE.has(k)) { stats.noRestore++; continue; }
      if (x.type === 'anyone') { lapse.push({ id: r.drive_file_id, name, owner: r.owner, who: 'anyone with the link', role: x.role, reason: 'parent-only link' }); stats.lapseLink++; continue; }
      if (recent) { acts.push(`add:${x.who}:${x.role}`); stats.restore++; restoreBy.set(x.who, (restoreBy.get(x.who) || 0) + 1); const dom = x.type === 'domain' ? x.who : x.who.split('@')[1]; restoreDom.set(dom, (restoreDom.get(dom) || 0) + 1); }
      else { lapse.push({ id: r.drive_file_id, name, owner: r.owner, who: x.who, role: x.role, reason: mod ? `inherited; last modified ${mod} (over 12 months)` : 'inherited; no modified date' }); stats.lapseOld++; }
    }
  }
  plan.push({ file_id: r.drive_file_id, owner: r.owner, owner_email: s?.owner_email || emailOf(r.owner), name, target_drive: `${drive.name} (${drive.id})`, target_path: path, action: shortcut ? 'shortcut' : 'move', sharing_actions: acts.join(';'), plan: r.plan, modified: modOf(r.drive_file_id) });
}
// ---- verification asserts
const ids = new Set(plan.map(p => p.file_id));
if (ids.size !== v5.length || plan.length !== v5.length) throw new Error('row count mismatch');
if ([...meetStay.keys()].some(id => ids.has(id))) throw new Error('meet-stay row in plan');
const bad = v5all.filter(r => r.plan !== 'sorted' && r.plan !== 'archive' && ids.has(r.drive_file_id));
if (plan.length + meetStay.size + v6Excluded.size !== v5all.filter(r => r.plan === 'sorted' || r.plan === 'archive').length) throw new Error('meet/exclusion count mismatch');
if (plan.some(p => /&amp;/.test(p.target_path))) throw new Error('&amp; left in a destination');
if (bad.length) throw new Error(`excluded/held/stays rows in plan: ${bad.length}`);
for (const p of plan) for (const a of p.sharing_actions.split(';').filter(Boolean)) if (a.startsWith('add:')) { const who = a.split(':')[1].toLowerCase(); if (REMOVE.has(who) || NO_RESTORE.has(who)) throw new Error(`add for removed or no-restore account ${who}`); if (!p.modified || p.modified < CUTOFF) throw new Error(`add on old/undated file ${p.file_id}`); }

// ---- fix-up for files already moved
const fix = []; const wstats = { add: 0, remove: 0, alreadyGone: 0, lapse: 0, roleAssumed: 0 };
for (const x of wc) {
  const mod = modOf(x.id), recent = mod && mod >= CUTOFF, now = new Set((x.now || []).map(s => s.toLowerCase()));
  for (const l of x.lost) {
    const k = l.who.toLowerCase();
    const base = { file_id: x.id, file_name: x.name, location_now: x.dest };
    if (REMOVE.has(k)) { if (now.has(k)) { fix.push({ ...base, action: 'remove', who: l.who, role: '', reason: 'removed account still has access' }); wstats.remove++; } else { fix.push({ ...base, action: 'none', who: l.who, role: '', reason: 'already removed by the earlier move' }); wstats.alreadyGone++; } continue; }
    if (k === 'anyone with the link') { fix.push({ ...base, action: 'lapse', who: l.who, role: l.role || '', reason: 'parent-only link' }); wstats.lapse++; continue; }
    if (!recent) { fix.push({ ...base, action: 'lapse', who: l.who, role: l.role || '', reason: mod ? `last modified ${mod} (over 12 months)` : 'no modified date' }); wstats.lapse++; continue; }
    const assumed = !l.role; if (assumed) wstats.roleAssumed++;
    fix.push({ ...base, action: 'add', who: l.who, role: l.role || 'reader', reason: assumed ? `${l.how}; role assumed (reader)` : l.how }); wstats.add++;
  }
}
for (const f of fix) if (f.action === 'add' && REMOVE.has(f.who.toLowerCase())) throw new Error('fix-up add for removed account');

// ---- already-moved Meet files that fail the rule (judged on the Oct 7 record: owner + in-domain recipients)
const wMoves = fs.readFileSync(`${D}/${F.writersLedger}`, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(x => x.type === 'move' && x.status === 'done');
const wMeet = [];
for (const m of wMoves) { const v = inv.get(m.id); if (!v) continue; const parent = v.path.endsWith('/' + v.name) ? v.path.slice(0, -(v.name.length + 1)) : v.path; const segs = meetSegs(parent); if (!segs) continue;
  const people = new Set([...ALREADY_MOVED.map(emailOf), ...(v.internal_detail || '').split(/[;,]\s*/).map(x => x.trim().toLowerCase().replace(/\(.*\)$/, '')).filter(x => DOMAIN_RE.test(x))]);
  const webinar = segs.some(x => /webinar|staff meeting/i.test(x));
  wMeet.push({ file_id: m.id, name: v.name, old_folder: parent, old_parents: (m.old_parents || []).join(';'), now_in: m.dest, granted_people: people.size, people: [...people].join(' '), webinar, fails: people.size < 4 && !webinar }); }
// ---- Budget scan (list only)
const budgetScan = [];
for (const r of v5all) { if (ALREADY_MOVED.includes(r.owner) || r.plan === 'excluded' || v6Excluded.has(r.drive_file_id)) continue; const v = inv.get(r.drive_file_id); if (!v) continue;
  const parent = parentOf(r.drive_file_id); if (!/^My Drive( \([^)]+\))?$/.test(parent)) continue;
  if (/budget/i.test(v.name) && /(^|[^0-9])(19|20)\d\d([^0-9]|$)/.test(v.name)) budgetScan.push({ owner: r.owner, name: v.name, plan: meetStay.has(r.drive_file_id) ? 'stays' : r.plan, dest: r.plan === 'archive' ? r.archive_path : (r.v3_destination || r.destination), modified: (v.modified_time || '').slice(0, 10) }); }
// ---- notice data
const sp = fs.readFileSync(`${D}/${F.splitSummary}`, 'utf8');
const qsec = sp.slice(sp.indexOf('## Notice questions')); const questions = {};
for (const m of qsec.matchAll(/\*\*([\w.+-]+@)\*\*\n\n((?:\d+\. .*\n?)+)/g)) questions[m[1]] = m[2].trim().split('\n').map(l => l.replace(/^\d+\.\s*/, ''));
const counts = {}; for (const r of v5all) { (counts[r.owner] ||= { sorted: 0, archive: 0, stays: 0 }); const pl = v6Excluded.has(r.drive_file_id) ? 'excluded' : meetStay.has(r.drive_file_id) ? 'stays' : r.plan; if (counts[r.owner][pl] !== undefined) counts[r.owner][pl]++; }
const notice = Object.keys(counts).filter(o => ![...HELD, ...ALREADY_MOVED].includes(o)).filter(o => counts[o].sorted + counts[o].archive > 0 || questions[o]).sort().map(o => ({ owner: o, sorted: counts[o].sorted, archive: counts[o].archive, stays: counts[o].stays, archive_folder: `${GA.name}/${o.replace(/@$/, '')}`, questions: (questions[o] || []).join(' ⏐ ') }));

// ---- write
const cell = x => { const s = String(x ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (file, cols, rows) => { fs.writeFileSync(file + '.tmp', [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n'); fs.renameSync(file + '.tmp', file); };
csv(`${D}/move-plan-v6.csv`, ['file_id', 'owner', 'owner_email', 'name', 'target_drive', 'target_path', 'action', 'sharing_actions', 'plan', 'modified'], plan);
csv(`${D}/move-plan-v6-lapse.csv`, ['id', 'owner', 'name', 'who', 'role', 'reason'], lapse);
csv(`${D}/${F.writersFixup}`, ['file_id', 'file_name', 'location_now', 'action', 'who', 'role', 'reason'], fix);
csv(`${D}/notice-data.csv`, ['owner', 'sorted', 'archive', 'stays', 'archive_folder', 'questions'], notice);
csv(`${D}/budget-scan.csv`, ['owner', 'name', 'plan', 'dest', 'modified'], budgetScan);
csv(`${D}/meet-stays.csv`, ['file_id', 'owner', 'was', 'granted', 'folder', 'name'], [...meetStay].map(([id, x]) => ({ file_id: id, ...x })));
csv(`${D}/writers-meet-moveback.csv`, ['file_id', 'name', 'old_folder', 'old_parents', 'now_in', 'granted_people', 'people', 'webinar', 'fails'], wMeet);

// ---- summary
const owners = [...new Set(plan.map(p => p.owner))].sort();
const need = owners.map(o => { const email = emailOf(o); const ps = plan.filter(p => p.owner === o && p.action === 'move'); const gf = ps.filter(p => p.plan === 'sorted').length, ga = ps.filter(p => p.plan === 'archive').length; return { o, gf: gf && !MEMBERS[GF.name].has(email) ? gf : 0, ga: ga && !MEMBERS[GA.name].has(email) ? ga : 0 }; }).filter(x => x.gf || x.ga);
const esc = s => String(s).replace(/\|/g, '\\|');
const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 20);
const md = `# Move plan v6 — summary

Built ${new Date().toISOString()}. Plan only: nothing has moved and no sharing has changed. Only Drive calls made for this: a read-only lookup of the two shared drives and their members.

## Destination fixes (2026-10-13)

- Staff-meeting notes → \`Departments/LEADERSHIP/Staff Meetings/Weekly Staff Meeting/YYYY-MM\`: ${destFixes.staff.length} files.
- Webinars → one folder each under \`Departments/MARKETING/Webinars/<name>\`: ${destFixes.webinar.length} files (${[...new Set(destFixes.webinar.map(x => x.to.split('/').pop()))].map(esc).join('; ')}).
- "&amp;" → "&": ${destFixes.amp} destinations.
- Other folder names containing "/" (slash replaced with "-"):
${[...destFixes.slash].map(([k, v]) => `  - ${esc(k)} (${v} files)`).join('\n') || '  - none'}

Excluded at v6: ${v6Excluded.size || 'none'}.

## Google Meet rule

Files under a "Google Meet" folder (recordings, transcripts, Notes by Gemini, chats) move only if 4 or more ${DOMAIN} people have access, or the folder name contains "Webinar" or "Staff Meeting". Otherwise they stay with the owner. **${meetStay.size} files changed to stays** (listed in \`meet-stays.csv\`):

| Account | Was sorted → stays | Was archive → stays |
|---|---|---|
${[...new Set([...meetStay.values()].map(x => x.owner))].sort().map(o => `| ${o} | ${[...meetStay.values()].filter(x => x.owner === o && x.was === 'sorted').length} | ${[...meetStay.values()].filter(x => x.owner === o && x.was === 'archive').length} |`).join('\n')}

**${MOVED_LABEL} — already moved:** ${wMeet.filter(x => x.fails).length} of ${wMeet.length} Meet files fail the rule and should move back to the owner's My Drive (old folder IDs in \`writers-meet-moveback.csv\`):

${wMeet.filter(x => x.fails).map(x => `- ${esc(x.name)} — ${x.granted_people} ${DOMAIN} ${x.granted_people === 1 ? 'person' : 'people'} (${esc(x.people)}); now in ${esc(x.now_in)}`).join('\n')}

## Before anything can run: drive access

Files are moved by impersonating their owner, so each owner must be a member (Contributor or higher) of the drive their files go to. Missing today:

| Account | Files bound for Granted Files (not a member) | Files bound for Granted Archive (not a member) |
|---|---|---|
${need.map(x => `| ${x.o} | ${x.gf || '—'} | ${x.ga || '—'} |`).join('\n')}

Add these accounts (Contributor is enough for moving files in) before the move run — or tell me to run the moves differently.

## Per account

| Account | Move → Granted Files | Move → Granted Archive | Shortcut (client-owned, stays put) | Files with sharing actions |
|---|---|---|---|---|
${owners.map(o => { const ps = plan.filter(p => p.owner === o); return `| ${o} | ${ps.filter(p => p.action === 'move' && p.plan === 'sorted').length} | ${ps.filter(p => p.action === 'move' && p.plan === 'archive').length} | ${ps.filter(p => p.action === 'shortcut').length} | ${ps.filter(p => p.sharing_actions).length} |`; }).join('\n')}
| **Total** | **${plan.filter(p => p.action === 'move' && p.plan === 'sorted').length}** | **${plan.filter(p => p.action === 'move' && p.plan === 'archive').length}** | **${stats.shortcut}** | **${plan.filter(p => p.sharing_actions).length}** |

## Restores — re-share directly after the move (${stats.restore} permissions)

Outside people whose only access came through a parent folder, on files edited in the last 12 months (since ${CUTOFF}). Added straight onto the file with the same role, no notification email.

| Top people | Files |
|---|---|
${top(restoreBy).map(([k, v]) => `| ${esc(k)} | ${v} |`).join('\n')}

| Top domains | Files |
|---|---|
${top(restoreDom).map(([k, v]) => `| ${esc(k)} | ${v} |`).join('\n')}

## Removals — the three accounts

| Account | Direct share → removed after move | Access via folder → drops automatically on move |
|---|---|---|
${[...REMOVE].map(k => { const x = removeBy.get(k) || { direct: 0, drops: 0 }; return `| ${k} | ${x.direct} | ${x.drops} |`; }).join('\n')}

## Lapse — no action, listed in \`move-plan-v6-lapse.csv\`

- ${stats.lapseOld} outside permissions inherited on files last edited more than 12 months ago — not restored.
- ${stats.lapseLink} files whose "anyone with the link" access came only from a parent folder — that link stops working.

## Fix-up for already-moved files (${MOVED_LABEL}) — \`${F.writersFixup}\`

- Restore (add directly): **${wstats.add}** permissions${wstats.roleAssumed ? ` — ${wstats.roleAssumed} of them with role assumed "reader" (the Oct 7 record had no role)` : ''}.
- Remove (one of the three still has access): **${wstats.remove}**.
- Already gone (one of the three, removed by the move itself): ${wstats.alreadyGone}.
- Lapse (old file or parent-only link): ${wstats.lapse}.

## Granted Archive — settings check

- ID \`${GA.id}\`.
- Outside sharing **allowed** (not restricted to ${DOMAIN} or to members) — direct client shares will carry over, same as ${GF.name}.
- Members: ${CFG.driveMembers[GA.name].map(x => x.replace(`@${DOMAIN}`, '@')).join(', ')}. ${CFG.driveMembersNote}

## Files

\`move-plan-v6.csv\` (${plan.length} rows), \`move-plan-v6-lapse.csv\` (${lapse.length}), \`${F.writersFixup}\` (${fix.length}), \`notice-data.csv\` (${notice.length} people).
`;
fs.writeFileSync(`${D}/move-plan-v6-summary.md`, md);
console.log(JSON.stringify({ rehome: destFixes.rehome.length, repeatDrop: destFixes.repeat.length, repeatSegs: [...destFixes.repeatSegs], trimmed: destFixes.trim, fileSlash: destFixes.fileSlash, staffFix: destFixes.staff.length, webinarFix: destFixes.webinar.length, webinars: [...new Set(destFixes.webinar.map(x => x.to))], amp: destFixes.amp, slash: [...destFixes.slash], v6Excluded: v6Excluded.size, budgetScan: budgetScan.length, meetStay: meetStay.size, meetByOwner: [...meetStay.values()].reduce((m, x) => (m[x.owner] = (m[x.owner] || 0) + 1, m), {}), writersMeet: wMeet.length, writersMeetFail: wMeet.filter(x => x.fails).length, rows: plan.length, stats, wstats, notice: notice.map(n => n.owner), need }));

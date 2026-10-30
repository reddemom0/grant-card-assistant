// Lockdown run (2026-10-30): tighten a few internal files in Granted Files after the leadership/confidential scans.
//   1. remove "anyone with the link" from 7 internal files
//   2. remove payment@'s folder-level grant on Departments (their drive membership is NOT touched)
//   3. move high/medium-confidence management files into Departments/LEADERSHIP (root, beside the existing goals/strategy docs)
//   4. move HR-type files/folders into Departments/LEADERSHIP too (Chris 2026-10-30: LEADERSHIP has Limited access; HR does not)
//   5. remove the deleted account (banji@, deleted 2026-10-28) from Granted Files membership — cannot be undone (Google can't re-add a deleted user)
// Usage: node scripts/migration/lockdown.mjs            → dry run (drive.readonly, GET only, writes nothing)
//        node scripts/migration/lockdown.mjs --go       → do it; ledger lines + migration log rows
//        node scripts/migration/lockdown.mjs --undo     → reverse every done step in the ledger, newest first
// Never deletes, trashes or renames files; never touches client files or outside user shares; the only membership change is step 5.
import fs from 'fs';
import { INV, CFG, ADMIN, token, loadJsonl, vanTime, appendAfterRun, countsText } from './migration-log.mjs';

const GO = process.argv.includes('--go'), UNDO = process.argv.includes('--undo'), DRY = !GO && !UNDO;
const SCOPE = DRY ? 'https://www.googleapis.com/auth/drive.readonly' : 'https://www.googleapis.com/auth/drive';
const GF = CFG.drives.sorted;
const LNAME = 'lockdown-ledger.jsonl', LEDGER = `${INV}/${LNAME}`;
const RUN = UNDO ? 'Lockdown undo' : 'Lockdown (anyone-links, payment@ Departments grant, LEADERSHIP moves, deleted member)';
const RUN_START = new Date().toISOString();
const led = o => fs.appendFileSync(LEDGER, JSON.stringify({ ...o, ts: new Date().toISOString() }) + '\n');

const DEPARTMENTS = '1RWZltPQea73q9M8mSsDSENq4qssZ3byO';
const LEADERSHIP = '1TjoJVVrx8Zcrt6r_5g9lNRTnjqC3_DIq';
const PAYMENT = 'payment@granted.ca';
const DELETED_MEMBER = '08807744112113352979';   // Granted Files member with deleted:true (banji@ by elimination against the 2026-10-13 member list)

const ANYONE_LINK = [
  ['147--yjfTGT5AdQfDQ6jUmwGjgJXSo5ipsRfdN9_P_Fc', 'Q1 2022 Catchup'],
  ['1fAykpJ7piKGHFR5v--QhEN_wzQCv8RJ2BN8BQYHLwLc', 'Recent Client Analysis vs BC Market Trends - Strategic Sector Recommendations'],
  ['1h1XCo5H5UQlYcQ8XjpHY00Tm--uFKRNqe4yhgsBrW74', "Jessica's Handoff Notes"],
  ['1T5HV4uw7Csaba_kKK8iRr6j49eFK35r_PNAYlqsngjM', 'ME Claims Clean Up'],
  ['1x_C1cxlR9yj6PMrvabYBHlxd97h9EpBvNA3GKS3Mra4', 'Business Model Canvas - MaskedForWork'],
  ['1vKKn9jsAws2AwcuLaZZqaN8y_lPBJ8L19AUxLU7Ral0', 'COJG Questionnaire - Kisaan - Calypso Training'],
  ['1XFgiebgvA0KdnHDViNH6z3_6ep3ZWqzrJHEcClpGLSo', 'Testing - Appendix for Client Engagement Annual Fee Increase'],
];
// [id, expected name, destination folder id, destination label]
const MOVES = [
  // → LEADERSHIP (high)
  ['1PIOEmkLH02l-qsUvvYqFpPq3BbHim85L', 'Granted - The Next Stage.pdf', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['147--yjfTGT5AdQfDQ6jUmwGjgJXSo5ipsRfdN9_P_Fc', 'Q1 2022 Catchup', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1N89uIysX6JhGKOuwFJv66QSp73nZv0eyyAe3zVEbUFM', 'Grant Strategy Meeting April 25 Notes', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1cZeT8k5mJybaqIMlCAA2cgyaHpoVeo9S', '2021-2024 GC Revenue Goals.xlsx', LEADERSHIP, 'Departments/LEADERSHIP'],
  // → LEADERSHIP (medium)
  ['1ORcMswBLUsyKJASsE-tWBFRt9pP4v6fHgBJ4wu-UoLo', '20240328 Granted Starter Mgmt Strategy', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1fmHC6M-pc5awDeuG3j8V_Beauq1cNOawzOH6feBLc2U', 'Management Strategy - Granted Starter Meeting notes', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1JtzW8SyMO-dbuCohcpyjK0lhbOce5NSiNRG8XuJhNao', 'Notes from management strategy doc - Granted Starter', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1EUulrsgaVgeqPPN2-buv27Y5f-KniIZVvRwwi1QfCxk', 'Q3 22/23 STRATEGY DAY', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['12iJe6lZY9ftbIDv5h7AZxPuVUcZygq1LturBFyU_IWg', 'Q4 22/23 STRATEGY DAY', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1wG0jVNprR_FpQgfpNuQYqENz9kG8jQkyixj1dcvo9iw', 'Q4 Strategy Day Agenda & Notes- May 12', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1gWNIvSWCgPlD4HIv-q78-U-mbZ3R-F9J2dHptdNJ8U0', 'Strategy Day Agenda & Notes- Feb 13', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1XXtpinynedjzW_tskTgMG8T-7Kn2PHEp9bcky8vfHB0', '2021/2022 Strategy Goals', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1GgQBYC3yVc5h8oEq3z-1BPP50GykXILx', 'Review of 2023_2024 Goals - Mar 21 2024.mp4', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1O_ZDjomTH2hc6z-Vx-xfCt6HLzZBf39V', 'Management Huddle', LEADERSHIP, 'Departments/LEADERSHIP'],
  // HR-type → LEADERSHIP (folders move whole: each holds only the target file)
  ['1W5J04XyOGoGGZgPeSvvZSl8KfACLoh535qqvslhhqmE', 'Copy of Weekly One-One - Sample', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['14BRPjJXON3PnplXe4EP7xumnRaA8mlOo', 'Partnership & Contractor contracts', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1Scj1mKWJQZEZotFpMrRErkC47KWrrqxR', 'Employee Onboarding', LEADERSHIP, 'Departments/LEADERSHIP'],
  ['1J6M0-i7zbQEuh64446aK9PLrcUDTvmKt', 'Strategist - Matt Ward', LEADERSHIP, 'Departments/LEADERSHIP'],
];

const api = async (method, path, body) => {
  for (let a = 1; a <= 6; a++) {
    let r; try { r = await fetch(`https://www.googleapis.com/drive/v3${path}`, { method, headers: { Authorization: `Bearer ${await token(ADMIN, SCOPE)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) }); }
    catch { await new Promise(s => setTimeout(s, 1500 * a)); continue; }
    if (r.ok) return r.status === 204 ? {} : r.json();
    const t = await r.text();
    if (r.status === 429 || r.status >= 500 || (r.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(t))) { await new Promise(s => setTimeout(s, 1500 * a * a)); continue; }
    throw new Error(`${method} ${r.status}: ${t.slice(0, 200)}`);
  }
  throw new Error(`${method}: retries exhausted`);
};
const meta = id => api('GET', `/files/${id}?supportsAllDrives=true&fields=id,name,mimeType,parents,driveId,trashed`);
const perms = id => api('GET', `/files/${id}/permissions?supportsAllDrives=true&fields=permissions(id,type,role,emailAddress,allowFileDiscovery,permissionDetails)`).then(r => r.permissions);
const childNames = async folder => { const out = new Set(); let pt; do { const r = await api('GET', `/files?q=${encodeURIComponent(`'${folder}' in parents and trashed = false`)}&corpora=drive&driveId=${GF.id}&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=1000&fields=nextPageToken,files(name)${pt ? `&pageToken=${pt}` : ''}`); r.files.forEach(f => out.add(f.name)); pt = r.nextPageToken; } while (pt); return out; };
const pathOf = async id => { const segs = []; let cur = id; for (let i = 0; i < 20; i++) { const m = await meta(cur); if (!m.parents?.length) break; const p = await meta(m.parents[0]); if (!p.parents?.length) { segs.unshift(GF.name); break; } segs.unshift(p.name); cur = p.id; } return segs.join('/'); };

// ---------- undo
if (UNDO) {
  const lines = fs.existsSync(LEDGER) ? loadJsonl(LNAME) : [];
  const undone = new Set(lines.filter(x => x.type.startsWith('undo-') && x.status === 'done').map(x => x.of));
  const todo = lines.filter(x => x.status === 'done' && !x.type.startsWith('undo-') && x.type !== 'remove-member' && !undone.has(x.ts)).reverse();   // a deleted user can't be re-added
  const res = { undone: 0, failed: [] };
  for (const x of todo) {
    try {
      if (x.type === 'move') {
        led({ type: 'undo-move', status: 'intent', of: x.ts, id: x.id });
        await api('PATCH', `/files/${x.id}?supportsAllDrives=true&addParents=${x.from_parent}&removeParents=${x.to_parent}&fields=id`, {});
        const v = await meta(x.id); if (!v.parents.includes(x.from_parent)) throw new Error('verify failed');
        led({ type: 'undo-move', status: 'done', of: x.ts, id: x.id, name: x.name, from: x.to, to: x.from });
      } else if (x.type === 'remove-permission') {
        const body = x.perm.type === 'anyone' ? { type: 'anyone', role: x.perm.role, allowFileDiscovery: !!x.perm.allowFileDiscovery } : { type: 'user', role: x.perm.role, emailAddress: x.perm.emailAddress };
        led({ type: 'undo-remove', status: 'intent', of: x.ts, id: x.id });
        await api('POST', `/files/${x.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, body);
        led({ type: 'undo-remove', status: 'done', of: x.ts, id: x.id, name: x.name, who: x.who, role: x.perm.role });
      }
      res.undone++;
    } catch (e) { res.failed.push(`${x.name}: ${e.message}`); }
  }
  const rows = loadJsonl(LNAME).filter(x => x.ts >= RUN_START && x.status === 'done').map(x => x.type === 'undo-move'
    ? { ts: x.ts, run: RUN, ledger: LNAME, action: 'move back', name: x.name, id: x.id, owner: 'shared drive', from: x.from, to: x.to, sharing: '', by: ADMIN }
    : { ts: x.ts, run: RUN, ledger: LNAME, action: 'access added', name: x.name, id: x.id, owner: 'shared drive', from: '', to: '', sharing: `${x.who}, ${x.role} (undo of a removal)`, by: ADMIN });
  const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), RUN, countsText(rows) || 'no changes', CFG.approver, LNAME, '']);
  res.log = lg.ok ? `appended ${rows.length} rows` : lg.warning;
  console.log(JSON.stringify(res, null, 1)); process.exit(res.failed.length ? 1 : 0);
}

// ---------- preflight (dry run and --go both run this; --go stops on any problem)
const problems = [], plan = { anyone: [], payment: null, moves: [], deleted: null };
for (const [id, name] of ANYONE_LINK) {
  const m = await meta(id); if (m.trashed || m.driveId !== GF.id) { problems.push(`${name}: not live in ${GF.name}`); continue; }
  const a = (await perms(id)).filter(p => p.type === 'anyone');
  if (!a.length) problems.push(`${m.name}: no anyone-with-link permission (already off?)`);
  for (const p of a) plan.anyone.push({ id, name: m.name, perm: p });
}
{
  const p = (await perms(DEPARTMENTS)).find(p => (p.emailAddress || '').toLowerCase() === PAYMENT);
  const direct = p?.permissionDetails?.find(d => d.permissionType === 'file' && !d.inherited);
  const member = p?.permissionDetails?.find(d => d.permissionType === 'member');
  if (!direct) problems.push(`${PAYMENT}: no folder-level grant on Departments`);
  else plan.payment = { perm: { id: p.id, type: 'user', role: direct.role, emailAddress: PAYMENT }, keepsViaMembership: member?.role || 'none' };
}
{
  const p = await api('GET', `/files/${GF.id}/permissions/${DELETED_MEMBER}?supportsAllDrives=true&fields=id,role,emailAddress,deleted`).catch(e => null);
  if (!p) problems.push(`deleted member ${DELETED_MEMBER}: not a member of ${GF.name}`);
  else if (!p.deleted || p.emailAddress) problems.push(`member ${DELETED_MEMBER} is not a deleted account (${p.emailAddress || 'no email'}) — refusing to remove`);
  else plan.deleted = { perm: { id: p.id, type: 'user', role: p.role, deleted: true } };
}
const destNames = new Map();
for (const [id, name, dest, label] of MOVES) {
  const m = await meta(id);
  if (m.trashed || m.driveId !== GF.id) { problems.push(`${name}: not live in ${GF.name}`); continue; }
  if (m.name !== name) problems.push(`${name}: name is now "${m.name}"`);
  if (m.parents.includes(dest)) { problems.push(`${name}: already in ${label}`); continue; }
  if (!destNames.has(dest)) destNames.set(dest, await childNames(dest));
  if (destNames.get(dest).has(m.name)) problems.push(`${name}: ${label} already has an item with this name`);
  destNames.get(dest).add(m.name);
  plan.moves.push({ id, name: m.name, mimeType: m.mimeType, from_parent: m.parents[0], from: await pathOf(id), to_parent: dest, to: `${GF.name}/${label}` });
}

if (DRY) {
  console.log(JSON.stringify({
    dry: true, problems,
    removeAnyoneLink: plan.anyone.map(a => `${a.name} — anyone with the link: ${a.perm.role}${a.perm.allowFileDiscovery ? ' (discoverable)' : ''}`),
    paymentDepartments: plan.payment && `${PAYMENT}: remove ${plan.payment.perm.role} on Departments; still ${plan.payment.keepsViaMembership} on all of ${GF.name} via drive membership`,
    moves: plan.moves.map(m => `${m.name}  |  ${m.from}  →  ${m.to}`),
    removeDeletedMember: plan.deleted && `${GF.name}: remove deleted account ${DELETED_MEMBER} (${plan.deleted.perm.role}) — not undoable`,
  }, null, 1));
  process.exit(0);
}
if (problems.length) { console.error('STOP: preflight problems:\n' + problems.join('\n')); process.exit(3); }

// ---------- go
const res = { anyoneRemoved: 0, paymentRemoved: 0, moved: 0, deletedMemberRemoved: 0, failed: [] };
// payment@ first, so files moving in from Programs/ never pick up their Departments grant
if (plan.payment) {
  const { perm } = plan.payment;
  try {
    led({ type: 'remove-permission', status: 'intent', id: DEPARTMENTS, name: 'Departments', who: PAYMENT, perm });
    await api('DELETE', `/files/${DEPARTMENTS}/permissions/${perm.id}?supportsAllDrives=true`);
    const still = (await perms(DEPARTMENTS)).find(p => p.id === perm.id)?.permissionDetails?.some(d => d.permissionType === 'file' && !d.inherited);
    if (still) throw new Error('verify failed: folder grant still present');
    led({ type: 'remove-permission', status: 'done', id: DEPARTMENTS, name: 'Departments', who: PAYMENT, perm }); res.paymentRemoved++;
  } catch (e) { res.failed.push(`payment@ Departments: ${e.message}`); led({ type: 'remove-permission', status: 'failed', id: DEPARTMENTS, detail: e.message }); }
}
for (const a of plan.anyone) {
  const perm = { id: a.perm.id, type: 'anyone', role: a.perm.role, allowFileDiscovery: !!a.perm.allowFileDiscovery };
  try {
    led({ type: 'remove-permission', status: 'intent', id: a.id, name: a.name, who: 'anyone with the link', perm });
    await api('DELETE', `/files/${a.id}/permissions/${a.perm.id}?supportsAllDrives=true`);
    if ((await perms(a.id)).some(p => p.type === 'anyone')) throw new Error('verify failed');
    led({ type: 'remove-permission', status: 'done', id: a.id, name: a.name, who: 'anyone with the link', perm }); res.anyoneRemoved++;
  } catch (e) { res.failed.push(`${a.name}: ${e.message}`); led({ type: 'remove-permission', status: 'failed', id: a.id, detail: e.message }); }
}
for (const m of plan.moves) {
  try {
    led({ type: 'move', status: 'intent', ...m });
    await api('PATCH', `/files/${m.id}?supportsAllDrives=true&addParents=${m.to_parent}&removeParents=${m.from_parent}&fields=id`, {});
    const v = await meta(m.id); if (!v.parents.includes(m.to_parent) || v.name !== m.name) throw new Error('verify failed');
    led({ type: 'move', status: 'done', ...m }); res.moved++;
  } catch (e) { res.failed.push(`${m.name}: ${e.message}`); led({ type: 'move', status: 'failed', id: m.id, detail: e.message }); }
}
if (plan.deleted) {
  const { perm } = plan.deleted;
  try {
    led({ type: 'remove-member', status: 'intent', id: GF.id, name: GF.name, who: 'deleted account (banji@)', perm });
    await api('DELETE', `/files/${GF.id}/permissions/${perm.id}?supportsAllDrives=true`);
    const left = await api('GET', `/files/${GF.id}/permissions?supportsAllDrives=true&fields=permissions(id)`);
    if (left.permissions.some(p => p.id === perm.id)) throw new Error('verify failed: still a member');
    led({ type: 'remove-member', status: 'done', id: GF.id, name: GF.name, who: 'deleted account (banji@)', perm }); res.deletedMemberRemoved++;
  } catch (e) { res.failed.push(`deleted member: ${e.message}`); led({ type: 'remove-member', status: 'failed', id: GF.id, detail: e.message }); }
}

const rows = loadJsonl(LNAME).filter(x => x.ts >= RUN_START && x.status === 'done').map(x => x.type === 'move'
  ? { ts: x.ts, run: RUN, ledger: LNAME, action: 'move', name: x.name, id: x.id, owner: 'shared drive', from: x.from, to: x.to, sharing: '', by: ADMIN }
  : { ts: x.ts, run: RUN, ledger: LNAME, action: 'access removed', name: x.name, id: x.id, owner: 'shared drive', from: '', to: '', sharing: `${x.who}, ${x.perm.role}${x.who === PAYMENT ? ' (folder grant on Departments; drive membership kept)' : x.type === 'remove-member' ? ' (drive member removed; account deleted 2026-10-28; not undoable)' : ''}`, by: ADMIN });
const lg = await appendAfterRun(rows, [vanTime(RUN_START).slice(0, 10), RUN, countsText(rows) || 'no changes', CFG.approver, LNAME, '']);
res.log = lg.ok ? `appended ${rows.length} rows` : lg.warning;
console.log(JSON.stringify(res, null, 1));
process.exit(res.failed.length ? 1 : 0);

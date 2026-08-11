/**
 * scripts/dropbox-probe.js — THROWAWAY read-only Dropbox scope probe.
 *
 * Answers: does the refresh token still work, what kind of account is it,
 * what can it actually see at the top of the team space, and which of the
 * padlocked folders are reachable.
 *
 * READ-ONLY. Uses only /oauth2/token (refresh), users/*, team/*, and
 * files/list_folder with recursive:false. Downloads nothing, writes nothing.
 * Never prints a credential value — only presence, length, and expiry.
 */

import 'dotenv/config';
import { Dropbox, DropboxAuth } from 'dropbox';

const {
  DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET,
  DROPBOX_REFRESH_TOKEN,
  DROPBOX_NAMESPACE_ID,
  DROPBOX_TEAM_MEMBER_ID,
} = process.env;

const out = (label, value) => console.log(`${label}: ${value}`);
const section = (t) => console.log(`\n===== ${t} =====`);

/**
 * Pull the exact Dropbox error payload off a thrown SDK error, no secrets.
 * Dropbox returns JSON for route-level errors but PLAIN TEXT for header/arg
 * errors (the 400s), so the string branch matters.
 */
function describeError(err) {
  const status = err?.status ?? err?.response?.status ?? null;
  const body = err?.error ?? err?.response?.data ?? null;
  const info = { status };

  if (typeof body === 'string') {
    info.raw = body.trim().slice(0, 600);
  } else if (body && typeof body === 'object') {
    info.error_summary = body.error_summary ?? null;
    info.tag = body.error?.['.tag'] ?? body['.tag'] ?? null;
    if (!info.error_summary && !info.tag) info.raw = JSON.stringify(body).slice(0, 600);
  } else {
    info.message = err?.message ?? String(err);
  }
  return info;
}

const results = {
  step1_auth: {},
  step2_account: {},
  step3_top_level: {},
  step4_grants: {},
  step5_padlocked: {},
};

// ---------------------------------------------------------------- Step 1
section('STEP 1 — refresh token exchange');

for (const [name, val] of Object.entries({
  DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET,
  DROPBOX_REFRESH_TOKEN,
  DROPBOX_NAMESPACE_ID,
  DROPBOX_TEAM_MEMBER_ID,
})) {
  out(`  ${name}`, val ? 'present' : 'ABSENT');
}

const auth = new DropboxAuth({
  clientId: DROPBOX_APP_KEY,
  clientSecret: DROPBOX_APP_SECRET,
  refreshToken: DROPBOX_REFRESH_TOKEN,
});

try {
  await auth.checkAndRefreshAccessToken();
  const token = auth.getAccessToken();
  const expires = auth.getAccessTokenExpiresAt();
  results.step1_auth = {
    refresh_ok: Boolean(token),
    token_length: token ? token.length : 0,
    expires_at: expires ? new Date(expires).toISOString() : null,
  };
  out('  refresh exchange', token ? 'SUCCESS' : 'FAILED (no token returned)');
  out('  access token', token ? `acquired (length ${token.length}, value not printed)` : 'none');
  out('  expires at', results.step1_auth.expires_at);
} catch (err) {
  results.step1_auth = { refresh_ok: false, error: describeError(err) };
  out('  refresh exchange', 'FAILED');
  console.log('  error:', JSON.stringify(results.step1_auth.error));
  console.log(JSON.stringify(results, null, 2));
  process.exit(1);
}

// Scope list is returned by the token endpoint itself. Scope names are not
// secrets; the token in the same response is never read or printed here.
section('STEP 2 — granted scopes');
try {
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: DROPBOX_REFRESH_TOKEN,
      client_id: DROPBOX_APP_KEY,
      client_secret: DROPBOX_APP_SECRET,
    }),
  });
  const data = await res.json();
  const scopes = data.scope ? data.scope.split(' ').sort() : null;
  results.step2_account.scopes = scopes;
  results.step2_account.token_type = data.token_type ?? null;
  out('  token_type', data.token_type ?? '(none)');
  out('  scope count', scopes ? scopes.length : 'not returned by token endpoint');
  if (scopes) scopes.forEach((s) => console.log(`    - ${s}`));
} catch (err) {
  results.step2_account.scopes_error = describeError(err);
  out('  scope lookup', 'FAILED');
}

// ---------------------------------------------------------------- Step 2
section('STEP 2 — account type');

const plain = new Dropbox({ auth });
let teamMemberId = DROPBOX_TEAM_MEMBER_ID || null;
let isTeamToken = false;

try {
  const acct = (await plain.usersGetCurrentAccount()).result;
  results.step2_account.token_kind = 'individual/member (user-scoped)';
  results.step2_account.account_id = acct.account_id;
  results.step2_account.account_type = acct.account_type?.['.tag'] ?? null;
  results.step2_account.is_teammate = Boolean(acct.team);
  results.step2_account.team_name = acct.team?.name ?? null;
  results.step2_account.team_member_id = acct.team_member_id ?? null;
  results.step2_account.root_namespace_id = acct.root_info?.root_namespace_id ?? null;
  results.step2_account.home_namespace_id = acct.root_info?.home_namespace_id ?? null;
  results.step2_account.root_info_tag = acct.root_info?.['.tag'] ?? null;
  if (!teamMemberId && acct.team_member_id) teamMemberId = acct.team_member_id;

  out('  token kind', 'USER token (operates as one account)');
  out('  account_type', results.step2_account.account_type);
  out('  member of team', results.step2_account.is_teammate ? `YES — ${acct.team.name}` : 'NO');
  out('  team_member_id', results.step2_account.team_member_id ?? '(none)');
  out('  root_info', `${results.step2_account.root_info_tag} root=${results.step2_account.root_namespace_id} home=${results.step2_account.home_namespace_id}`);
} catch (err) {
  const e = describeError(err);
  results.step2_account.users_get_current_account_error = e;
  out('  users/get_current_account', 'FAILED');
  console.log('  error:', JSON.stringify(e));
  if (e.error_summary && e.error_summary.includes('entire Dropbox Business team')) {
    isTeamToken = true;
    results.step2_account.token_kind = 'TEAM token (Dropbox Business, team-scoped)';
    out('  token kind', 'TEAM token — Dropbox Business');
  }
}

// team/get_info requires team_info.read — its success/failure is itself a scope signal.
try {
  const info = (await plain.teamGetInfo()).result;
  results.step2_account.team_info = {
    name: info.name,
    team_id: info.team_id,
    num_licensed_users: info.num_licensed_users,
    num_provisioned_users: info.num_provisioned_users,
  };
  out('  team/get_info', `OK — ${info.name} (${info.num_licensed_users} licensed)`);
} catch (err) {
  results.step2_account.team_info_error = describeError(err);
  out('  team/get_info', `DENIED — ${JSON.stringify(results.step2_account.team_info_error)}`);
}

if (isTeamToken && !teamMemberId) {
  try {
    const admin = (await plain.teamTokenGetAuthenticatedAdmin()).result;
    teamMemberId = admin.admin_profile?.team_member_id ?? null;
    results.step2_account.authenticated_admin_member_id = teamMemberId;
    out('  authenticated admin', teamMemberId ? 'resolved team_member_id' : 'none');
  } catch (err) {
    results.step2_account.authenticated_admin_error = describeError(err);
    out('  team/token/get_authenticated_admin', 'FAILED');
  }
}

// ------------------------------------------------- build the team-space client
//
// Select-User is only legal on a TEAM-scoped token. Path-Root is only legal
// for a namespace this token can actually reach. Rather than guess, try the
// header combinations in order and keep the first that lists successfully.

const namespaceRoot = (id) => JSON.stringify({ '.tag': 'namespace_id', namespace_id: id });

function makeClient({ pathRoot = null, selectUser = null } = {}) {
  const opts = { auth };
  if (pathRoot) opts.pathRoot = pathRoot;
  if (selectUser) opts.selectUser = selectUser;
  return new Dropbox(opts);
}

/** One level only. recursive:false, never recursion, never download. */
async function listOneLevelWith(client, path) {
  const res = await client.filesListFolder({
    path,
    recursive: false,
    include_deleted: false,
    include_mounted_folders: true,
    limit: 1000,
  });
  let entries = res.result.entries;
  let { cursor, has_more: hasMore } = res.result;
  while (hasMore) {
    const next = await client.filesListFolderContinue({ cursor });
    entries = entries.concat(next.result.entries);
    cursor = next.result.cursor;
    hasMore = next.result.has_more;
  }
  return entries.map((e) => ({
    name: e.name,
    type: e['.tag'],
    path_lower: e.path_lower ?? null,
    // sharing_info is the padlock signal: traverse_only/no_access mean the
    // folder is visible in the parent listing but not readable by this member.
    shared_folder_id: e.shared_folder_id ?? null,
    sharing_info: e.sharing_info
      ? {
          read_only: e.sharing_info.read_only ?? null,
          traverse_only: e.sharing_info.traverse_only ?? null,
          no_access: e.sharing_info.no_access ?? null,
          parent_shared_folder_id: e.sharing_info.parent_shared_folder_id ?? null,
        }
      : null,
  }));
}

// ---------------------------------------------------------------- Step 3
section('STEP 3 — reaching the team space (header strategy matrix)');

const rootNs = results.step2_account.root_namespace_id ?? null;
const homeNs = results.step2_account.home_namespace_id ?? null;

const strategies = [
  {
    id: 'A',
    label: 'no Path-Root, no Select-User (token default / personal home)',
    opts: {},
  },
  {
    id: 'B',
    label: 'Path-Root=DROPBOX_NAMESPACE_ID (env), no Select-User',
    opts: DROPBOX_NAMESPACE_ID ? { pathRoot: namespaceRoot(DROPBOX_NAMESPACE_ID) } : null,
  },
  {
    id: 'C',
    label: 'Path-Root=root_namespace_id from account, no Select-User',
    opts: rootNs ? { pathRoot: namespaceRoot(rootNs) } : null,
  },
  {
    id: 'D',
    label: 'Path-Root=home_namespace_id from account, no Select-User',
    opts: homeNs ? { pathRoot: namespaceRoot(homeNs) } : null,
  },
  {
    id: 'E',
    label: 'Path-Root=DROPBOX_NAMESPACE_ID + Select-User (team-token style)',
    opts: DROPBOX_NAMESPACE_ID && teamMemberId
      ? { pathRoot: namespaceRoot(DROPBOX_NAMESPACE_ID), selectUser: teamMemberId }
      : null,
  },
];

results.step3_top_level.strategies = [];
const succeeded = new Map();

for (const s of strategies) {
  if (!s.opts) {
    out(`  [${s.id}] ${s.label}`, 'SKIPPED (inputs unavailable)');
    results.step3_top_level.strategies.push({ id: s.id, label: s.label, result: 'skipped' });
    continue;
  }
  const client = makeClient(s.opts);
  try {
    const top = await listOneLevelWith(client, '');
    out(`  [${s.id}] ${s.label}`, `OK — ${top.length} entries`);
    results.step3_top_level.strategies.push({
      id: s.id, label: s.label, result: 'ok', count: top.length,
      names: top.map((e) => e.name),
    });
    succeeded.set(s.id, { strategy: s, client, root: top });
  } catch (err) {
    const e = describeError(err);
    out(`  [${s.id}] ${s.label}`, `FAILED — ${JSON.stringify(e)}`);
    results.step3_top_level.strategies.push({ id: s.id, label: s.label, result: 'failed', error: e });
  }
}

// Prefer the TEAM namespace (B/C) over the personal home root (A/D). A and D
// resolve to this member's own Dropbox, which is not the team space and does
// not contain the Granted Team Folder we care about.
const PREFERENCE = ['B', 'C', 'D', 'A'];
const chosenId = PREFERENCE.find((id) => succeeded.has(id));

if (!chosenId) {
  results.step3_top_level.ok = false;
  out('  RESULT', 'no header strategy could list any root');
  console.log(JSON.stringify(results, null, 2));
  process.exit(1);
}

const { strategy: winning, client: dbx, root: nsRoot } = succeeded.get(chosenId);
const listOneLevel = (path) => listOneLevelWith(dbx, path);

results.step3_top_level.ok = true;
results.step3_top_level.winning_strategy = `${winning.id} — ${winning.label}`;
results.step3_top_level.namespace_root_entries = nsRoot;

section('STEP 3 — namespace root (team space)');
out('  strategy chosen', results.step3_top_level.winning_strategy);
out('  entries', nsRoot.length);
nsRoot.forEach((e) => console.log(`    [${e.type === 'folder' ? 'DIR ' : 'file'}] ${e.name}`));

// ---- resolve the Granted Team Folder and list ITS top level -----------------
const tfEntry = nsRoot.find((e) => e.name.trim().toLowerCase() === 'granted team folder');
const teamFolderPath = tfEntry ? tfEntry.path_lower : '/granted team folder';
results.step3_top_level.team_folder_path = teamFolderPath;
results.step3_top_level.team_folder_found_at_ns_root = Boolean(tfEntry);

section('STEP 3 — top level of GRANTED TEAM FOLDER');
out('  path', teamFolderPath);

let topEntries = [];
try {
  topEntries = await listOneLevel(teamFolderPath);
  results.step3_top_level.team_folder_ok = true;
  results.step3_top_level.count = topEntries.length;
  results.step3_top_level.entries = topEntries;
  out('  entries', topEntries.length);
  topEntries.forEach((e) => {
    const si = e.sharing_info;
    const flags = si
      ? [si.no_access ? 'no_access' : null, si.traverse_only ? 'traverse_only' : null,
         si.read_only ? 'read_only' : null].filter(Boolean).join(',')
      : '';
    console.log(`    [${e.type === 'folder' ? 'DIR ' : 'file'}] ${e.name}${flags ? `   <<${flags}>>` : ''}`);
  });
} catch (err) {
  results.step3_top_level.team_folder_ok = false;
  results.step3_top_level.team_folder_error = describeError(err);
  out('  list Granted Team Folder', 'FAILED');
  console.log('  error:', JSON.stringify(results.step3_top_level.team_folder_error));
}

// ---------------------------------------------------------------- Step 4
section('STEP 4 — Grants');

const grantsEntry = topEntries.find((e) => e.name.trim().toLowerCase() === 'grants');
results.step4_grants.visible_at_top_level = Boolean(grantsEntry);
out('  visible in Granted Team Folder', grantsEntry ? `YES — "${grantsEntry.name}"` : 'NO');

const grantsPath = grantsEntry ? grantsEntry.path_lower : `${teamFolderPath}/grants`;
try {
  const kids = await listOneLevel(grantsPath);
  results.step4_grants.listable = true;
  results.step4_grants.child_count = kids.length;
  results.step4_grants.folder_count = kids.filter((k) => k.type === 'folder').length;
  results.step4_grants.file_count = kids.filter((k) => k.type !== 'folder').length;
  results.step4_grants.children = kids;
  out('  listable', 'YES');
  out('  immediate children', `${kids.length} (${results.step4_grants.folder_count} folders, ${results.step4_grants.file_count} files)`);
  kids.forEach((k) => console.log(`    [${k.type === 'folder' ? 'DIR ' : 'file'}] ${k.name}`));
} catch (err) {
  results.step4_grants.listable = false;
  results.step4_grants.error = describeError(err);
  out('  listable', 'NO');
  console.log('  error:', JSON.stringify(results.step4_grants.error));
}

// Not at the team-folder top level — find where a "Grants" folder actually lives.
if (!results.step4_grants.listable) {
  section('STEP 4b — locating "Grants" elsewhere in the namespace');
  try {
    const res = await dbx.filesSearchV2({
      query: 'Grants',
      options: { max_results: 100, file_status: 'active', filename_only: true },
    });
    const folders = res.result.matches
      .map((m) => m.metadata?.metadata)
      .filter((m) => m && m['.tag'] === 'folder')
      .map((m) => ({ name: m.name, path_lower: m.path_lower }))
      .filter((m) => m.name.trim().toLowerCase() === 'grants');
    results.step4_grants.search_matches = folders;
    out('  exact-name "Grants" folder matches', folders.length);
    folders.forEach((f) => console.log(`    ${f.path_lower}`));

    // List one level of the first match only. Still no recursion.
    if (folders.length) {
      const target = folders[0];
      try {
        const kids = await listOneLevel(target.path_lower);
        results.step4_grants.resolved_path = target.path_lower;
        results.step4_grants.listable_at_resolved_path = true;
        results.step4_grants.child_count = kids.length;
        results.step4_grants.folder_count = kids.filter((k) => k.type === 'folder').length;
        results.step4_grants.file_count = kids.filter((k) => k.type !== 'folder').length;
        results.step4_grants.children = kids;
        out(`  ${target.path_lower}`, `LISTABLE — ${kids.length} immediate children (${results.step4_grants.folder_count} folders, ${results.step4_grants.file_count} files)`);
        kids.forEach((k) => console.log(`    [${k.type === 'folder' ? 'DIR ' : 'file'}] ${k.name}`));
      } catch (err2) {
        results.step4_grants.listable_at_resolved_path = false;
        results.step4_grants.resolved_path_error = describeError(err2);
        out(`  ${target.path_lower}`, `DENIED — ${JSON.stringify(results.step4_grants.resolved_path_error)}`);
      }
    }
  } catch (err) {
    results.step4_grants.search_error = describeError(err);
    out('  files/search_v2', `FAILED — ${JSON.stringify(results.step4_grants.search_error)}`);
  }
}

// ---------------------------------------------------------------- Step 5
section('STEP 5 — padlocked folders');

const PADLOCKED = ['GRANTED STARTER', 'HR', 'MARKETING', 'SALES', 'WRITERS', 'AI'];

for (const name of PADLOCKED) {
  const match = topEntries.find((e) => e.name.trim().toLowerCase() === name.toLowerCase());
  const path = match ? match.path_lower : `${teamFolderPath}/${name.toLowerCase()}`;
  const entry = {
    seen_at_top_level: Boolean(match),
    actual_name: match ? match.name : null,
    path_tried: path,
  };
  try {
    const kids = await listOneLevel(path);
    entry.access = 'ACCESSIBLE';
    entry.child_count = kids.length;
    entry.folder_count = kids.filter((k) => k.type === 'folder').length;
    // Keep the sharing flags: a traverse_only parent can return a PARTIAL
    // listing (only the children this member can reach), so per-child flags
    // matter when judging whether a listing is complete.
    entry.children = kids.map((k) => ({
      name: k.name,
      type: k.type,
      no_access: k.sharing_info?.no_access ?? false,
      traverse_only: k.sharing_info?.traverse_only ?? false,
    }));
    entry.children_no_access = entry.children.filter((k) => k.no_access).length;
    entry.parent_traverse_only = match?.sharing_info?.traverse_only ?? false;
    entry.parent_no_access = match?.sharing_info?.no_access ?? false;
    out(`  ${name}`, `ACCESSIBLE — ${kids.length} immediate children` +
      (entry.parent_traverse_only ? ' (parent is traverse_only — listing may be partial)' : '') +
      (entry.children_no_access ? ` [${entry.children_no_access} child(ren) flagged no_access]` : ''));
  } catch (err) {
    entry.access = 'DENIED';
    entry.error = describeError(err);
    out(`  ${name}`, `DENIED — ${JSON.stringify(entry.error)}`);
  }
  results.step5_padlocked[name] = entry;
}

// ---------------------------------------------------------------- Step 5b
// Explain WHY anything was denied: metadata + shared-folder access level.
const denied = Object.entries(results.step5_padlocked).filter(([, v]) => v.access === 'DENIED');

if (denied.length) {
  section('STEP 5b — diagnosing denials');
  for (const [name, entry] of denied) {
    console.log(`  --- ${name} ---`);
    const topMatch = topEntries.find((e) => e.name.trim().toLowerCase() === name.toLowerCase());
    if (topMatch) {
      out('    sharing_info (from parent listing)', JSON.stringify(topMatch.sharing_info));
      out('    shared_folder_id present', topMatch.shared_folder_id ? 'yes' : 'no');
      entry.parent_listing_sharing_info = topMatch.sharing_info;
      entry.shared_folder_id = topMatch.shared_folder_id;
    }

    try {
      const md = (await dbx.filesGetMetadata({ path: entry.path_tried })).result;
      entry.metadata_ok = true;
      entry.metadata = {
        tag: md['.tag'],
        shared_folder_id: md.shared_folder_id ?? null,
        sharing_info: md.sharing_info ?? null,
      };
      out('    files/get_metadata', JSON.stringify(entry.metadata));
    } catch (err) {
      entry.metadata_ok = false;
      entry.metadata_error = describeError(err);
      out('    files/get_metadata', `FAILED — ${JSON.stringify(entry.metadata_error)}`);
    }

    const sfid = entry.shared_folder_id ?? entry.metadata?.shared_folder_id ?? null;
    if (sfid) {
      try {
        const sf = (await dbx.sharingGetFolderMetadata({ shared_folder_id: sfid })).result;
        entry.shared_folder_access = {
          name: sf.name,
          access_type: sf.access_type?.['.tag'] ?? null,
          is_inside_team_folder: sf.is_inside_team_folder ?? null,
          is_team_folder: sf.is_team_folder ?? null,
        };
        out('    sharing/get_folder_metadata', JSON.stringify(entry.shared_folder_access));
      } catch (err) {
        entry.shared_folder_access_error = describeError(err);
        out('    sharing/get_folder_metadata', `FAILED — ${JSON.stringify(entry.shared_folder_access_error)}`);
      }
    }
  }
}

// ---------------------------------------------------------------- machine dump
section('JSON');
console.log(JSON.stringify(results, null, 2));

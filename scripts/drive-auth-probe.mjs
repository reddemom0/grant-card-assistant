/**
 * drive-auth-probe.mjs — read-only check of the local Google Drive OAuth
 * credentials in mcp-servers/gdrive/credentials/.
 *
 * Tests whether the stored refresh token still exchanges for an access token,
 * and reports which Google account it belongs to. Never prints a credential
 * value — only presence, length, and expiry.
 *
 * GET/token-exchange only. Writes nothing to Drive.
 */

import fsp from 'node:fs/promises';

const KEYS = 'mcp-servers/gdrive/credentials/gcp-oauth.keys.json';
const CREDS = 'mcp-servers/gdrive/credentials/.gdrive-server-credentials.json';

const out = (k, v) => console.log(`  ${k}: ${v}`);

let keys, creds;
try {
  keys = JSON.parse(await fsp.readFile(KEYS, 'utf8'));
  creds = JSON.parse(await fsp.readFile(CREDS, 'utf8'));
} catch (err) {
  console.log(`ABORT: could not read credentials — ${err.message}`);
  process.exit(1);
}

const inst = keys.installed ?? keys.web ?? {};
console.log('=== stored credential shape ===');
out('client_id', inst.client_id ? 'present' : 'ABSENT');
out('client_secret', inst.client_secret ? 'present' : 'ABSENT');
out('token_uri', inst.token_uri ?? '(none)');
out('refresh_token', creds.refresh_token ? `present (length ${creds.refresh_token.length}, value not printed)` : 'ABSENT');
out('stored access_token expiry', creds.expiry_date ? new Date(creds.expiry_date).toISOString() : '(none)');
out('stored scope', creds.scope ?? '(none)');

if (!creds.refresh_token || !inst.client_id || !inst.client_secret) {
  console.log('\nABORT: incomplete credential set — cannot attempt refresh.');
  process.exit(1);
}

console.log('\n=== refresh token exchange ===');
let accessToken = null;
try {
  const res = await fetch(inst.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
      client_id: inst.client_id,
      client_secret: inst.client_secret,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    out('result', `FAILED (HTTP ${res.status})`);
    out('error', body.error ?? '(none)');
    out('error_description', body.error_description ?? '(none)');
    console.log('\nThe stored refresh token no longer works. Re-consent would be required.');
    process.exit(2);
  }
  accessToken = body.access_token;
  out('result', 'SUCCESS');
  out('access token', `acquired (length ${accessToken.length}, value not printed)`);
  out('expires_in', `${body.expires_in}s`);
  out('granted scope', body.scope ?? '(not returned)');
} catch (err) {
  out('result', `FAILED — ${err.message}`);
  process.exit(2);
}

console.log('\n=== whose account is this? ===');
const res = await fetch(
  'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)',
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
if (!res.ok) {
  out('drive about', `FAILED (HTTP ${res.status}) — ${(await res.text()).slice(0, 300)}`);
  process.exit(2);
}
const about = await res.json();
out('account', about.user?.emailAddress ?? '(unknown)');
out('display name', about.user?.displayName ?? '(unknown)');
if (about.storageQuota) {
  const gb = (n) => (Number(n) / 1024 ** 3).toFixed(1);
  out('storage', `${gb(about.storageQuota.usage)} GB used of ${about.storageQuota.limit ? gb(about.storageQuota.limit) + ' GB' : 'unlimited'}`);
}

// Can this token write? Check the granted scopes rather than by writing.
const scopes = (creds.scope ?? '').split(/\s+/).filter(Boolean);
const canWrite = scopes.some((s) => s === 'https://www.googleapis.com/auth/drive' || s === 'https://www.googleapis.com/auth/drive.file');
console.log('\n=== write capability (from scope, not tested) ===');
out('scopes', scopes.length ? scopes.join(', ') : '(none recorded)');
out('write-capable', canWrite ? 'YES' : 'NO — read-only scope');

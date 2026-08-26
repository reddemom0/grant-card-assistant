/**
 * pilot-copy.mjs — copy CanExport files from Dropbox to Google Drive per the
 * approved mapping sheet.
 *
 * The mapping CSV is the contract. This script executes it exactly: it makes no
 * judgement about destinations, never edits the CSV, and never touches `review`
 * rows.
 *
 * Guarantees:
 *   - Dropbox is READ-ONLY. Only files/download and files/get_metadata are used.
 *   - Nothing is ever deleted, in Dropbox or Drive.
 *   - Every upload is verified by reading back its size and mime type.
 *   - Idempotent: a ledger records every verified file; a re-run skips them.
 *   - Resumable: kill it and re-run; it picks up where it stopped.
 *   - A failure is recorded and the run continues.
 *
 * Usage:
 *   node scripts/pilot-copy.mjs --dry-run
 *   node scripts/pilot-copy.mjs --limit 10
 *   node scripts/pilot-copy.mjs                 # full run
 *
 * Drive credentials (one of):
 *   GOOGLE_DRIVE_ACCESS_TOKEN                   short-lived bearer token
 *   GOOGLE_DRIVE_REFRESH_TOKEN + GOOGLE_DRIVE_CLIENT_ID + GOOGLE_DRIVE_CLIENT_SECRET
 *   GOOGLE_SERVICE_ACCOUNT_KEY                  path to a service-account JSON
 * The credential needs the https://www.googleapis.com/auth/drive scope.
 */

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCsv } from './grants-lib.mjs';
import { CLIENTS_ROOT as LIB_CLIENTS_ROOT, CURRENT_ROOT as LIB_CURRENT_ROOT } from './mapping-lib.mjs';
import 'dotenv/config';

/**
 * Mapping sheet to execute. Overridable so the full-corpus copy can run in
 * stages without editing the sheet — the sheet is the contract and this script
 * makes no independent judgement about destinations.
 *   --mapping <path>   default dist/inventory/canexport-mapping.csv
 *   --program <name>   copy only rows whose program column matches exactly
 */
const MAPPING = (() => {
  const i = process.argv.indexOf('--mapping');
  return i > 0 ? process.argv[i + 1] : 'dist/inventory/canexport-mapping.csv';
})();
const ONLY_PROGRAM = (() => {
  const i = process.argv.indexOf('--program');
  return i > 0 ? process.argv[i + 1] : null;
})();
const LEDGER = 'dist/inventory/copy-ledger.jsonl';
// Shared Drive. A Shared Drive's ID doubles as the ID of its root folder, so
// it can be used directly as a parent.
const DEST_ROOT = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';
// Every Drive call that touches a Shared Drive needs supportsAllDrives; list
// additionally needs includeItemsFromAllDrives. Omitting it on any single call
// fails as a 404 "File not found", which reads like a wrong ID rather than a
// missing flag — so they are centralised here instead of spelled out per call.
const ALL_DRIVES = 'supportsAllDrives=true';
const ALL_DRIVES_LIST = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const DRIVE_ID = process.env.PILOT_DRIVE_ID || DEST_ROOT;
/**
 * Routes whose rows get copied. `review` never is — it has no destination.
 *
 * `mirror` is the departments sheet: a verbatim Dropbox mirror under
 * Departments/, with none of the client/program/year routing applied. It
 * copies exactly like the others; only the route label differs.
 */
const COPY_ROUTES = new Set(['sort', 'program', 'archive', 'mirror']);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SPREAD = args.includes('--spread');
const CLEAR_FAILED = args.includes('--clear-failed');
const PERMCHECK = args.includes('--permcheck');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? Number(args[i + 1]) : Infinity;
})();

const log = (...a) => console.error(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- timeouts
/**
 * Node's fetch has NO default timeout: a socket that goes silent mid-request
 * blocks until the OS gives up. During the 2026-08-17/18 ETG run that happened
 * four times at 15–20 minutes each — the retry logic never fired because it
 * only runs after the hang resolves. Every fetch now carries an AbortSignal so
 * a dead socket costs seconds plus one retry, not twenty minutes.
 *
 * Values: token/metadata calls answer in well under a second when healthy, so
 * 30/60s is generous. Transfers scale with size — a fixed cap would abort a
 * legitimately slow gigabyte while doing nothing for the small files that
 * dominate the corpus. Floor 3 min, budget 256 KiB/s, cap 30 min.
 */
const T_TOKEN = 30_000;
const T_META = 60_000;
const T_DOWNLOAD = 30 * 60_000;   // size unknown before the download starts
const uploadTimeout = (bytes) =>
  Math.min(Math.max(180_000, Math.ceil(bytes / (256 * 1024)) * 1000), 30 * 60_000);

// ---------------------------------------------------------------- mime types
const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff',
  svg: 'image/svg+xml', eps: 'application/postscript', ai: 'application/postscript',
  mp4: 'video/mp4', mov: 'video/quicktime', wmv: 'video/x-ms-wmv',
  m4a: 'audio/mp4', mp3: 'audio/mpeg',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
  html: 'text/html', htm: 'text/html', xml: 'application/xml', json: 'application/json',
  zip: 'application/zip', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook',
  numbers: 'application/vnd.apple.numbers', pages: 'application/vnd.apple.pages',
};
const mimeOf = (name) => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
// Google's own types — uploading with one of these is what triggers conversion.
// We never set one, which is the REST equivalent of the connector's
// disableConversionToGoogleType: true.
const GOOGLE_TYPES = /^application\/vnd\.google-apps\./;

// ---------------------------------------------------------------- retry
async function withRetry(label, fn, attempts = 6) {
  let delay = 1000;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status ?? 0;
      // `fetch` THROWS on transport failure rather than returning a status,
      // and Node puts the real code on err.cause.code, not err.code — so the
      // old `err.code === 'ECONNRESET'` test never fired for a genuine network
      // error. One ENOTFOUND killed the Drive restructure at 65 of 90 folders.
      // A 30-hour copy will hit this, so treat transport failures as retryable.
      const netCode = err.cause?.code ?? err.code;
      const TRANSIENT = new Set([
        'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN',
        'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
      ]);
      const transport = TRANSIENT.has(netCode)
        || (err.name === 'TypeError' && /fetch failed/i.test(err.message ?? ''))
        // AbortSignal.timeout fired — the request hung past its deadline.
        // Exactly the case the timeouts exist for; always worth a retry.
        || err.name === 'TimeoutError' || err.name === 'AbortError';
      // A 403 is retryable only when its reason says throttling. Permission
      // refusals fail immediately — retrying them just wastes the run.
      const throttled403 = status === 403
        && !FATAL_403.has(err.reason)
        && RETRYABLE_403.has(err.reason);
      const retryable = status === 429 || (status >= 500 && status < 600) || transport || throttled403;
      if (!retryable || i === attempts) throw err;
      const ra = Number(err.retryAfter || 0) * 1000;
      const wait = ra || delay;
      log(`    ⏳ ${label}: ${status || err.code}${err.reason ? ` (${err.reason})` : ''}, retry ${i}/${attempts - 1} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      delay = Math.min(delay * 2, 32000);
    }
  }
}
function httpError(res, body) {
  const e = new Error(`HTTP ${res.status}: ${String(body).slice(0, 200)}`);
  e.status = res.status;
  e.retryAfter = res.headers.get('retry-after');
  // Keep the machine-readable reason: a 403 can be throttling (retry) or a
  // permission refusal (fail fast), and only the reason distinguishes them.
  try {
    const j = JSON.parse(String(body));
    e.reason = j?.error?.errors?.[0]?.reason ?? null;
    e.apiMessage = j?.error?.message ?? null;
  } catch { e.reason = null; }
  return e;
}

/**
 * 403 reasons that mean "slow down", not "you may not do this".
 *
 * On 2026-08-17 a 112-second burst of 403s failed 151 ETG uploads that would
 * have succeeded on retry — 561 files landed successfully in the same folders
 * minutes later, and the drive was at 226 GB of 30 TB. Treating every 403 as
 * fatal turned a transient throttle into 151 permanent failures.
 */
const RETRYABLE_403 = new Set([
  'userRateLimitExceeded',
  'rateLimitExceeded',
  // Included on evidence, not on Google's default advice: the burst above
  // reported "The user's Drive storage quota has been exceeded" and
  // "Service Accounts do not have storage quota", both of which carry this
  // reason, while the drive was nowhere near full. A genuinely full drive
  // will still fail — just after the retries are exhausted rather than
  // immediately. Remove this entry if the pool is ever actually at capacity.
  'storageQuotaExceeded',
]);
/** Permission refusals — never retried, however they are worded. */
const FATAL_403 = new Set([
  'insufficientFilePermissions', 'appNotAuthorizedToFile', 'domainPolicy',
  'forbidden', 'cannotModifyInheritedTeamDrivePermission', 'fileOwnerNotMemberOfTeamDrive',
]);

/**
 * Dropbox-API-Arg must be ASCII. HTTP headers are ByteStrings, so any character
 * above U+00FF throws outright and anything in U+0080..U+00FF (a non-breaking
 * space, say) is silently mangled into the wrong byte and comes back as
 * path/not_found. Dropbox's documented remedy is to \uXXXX-escape non-ASCII
 * inside the JSON, which survives the header round-trip intact.
 */
const asciiArg = (obj) =>
  JSON.stringify(obj).replace(/[\u007f-\uffff]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

// ---------------------------------------------------------------- Dropbox (read-only)
const DBX = {
  token: null,
  exp: 0,
  async accessToken() {
    if (this.token && Date.now() < this.exp - 300000) return this.token;
    const res = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
        client_id: process.env.DROPBOX_APP_KEY,
        client_secret: process.env.DROPBOX_APP_SECRET,
      }),
      signal: AbortSignal.timeout(T_TOKEN),
    });
    if (!res.ok) throw httpError(res, await res.text());
    const d = await res.json();
    this.token = d.access_token;
    this.exp = Date.now() + d.expires_in * 1000;
    return this.token;
  },
  headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      // No Dropbox-API-Select-User: the app is not permitted to send it.
      'Dropbox-API-Path-Root': JSON.stringify({
        '.tag': 'namespace_id',
        namespace_id: process.env.DROPBOX_NAMESPACE_ID,
      }),
      ...extra,
    };
  },
  /** READ-ONLY. Returns {buffer, size}. */
  async download(dropboxPath) {
    await this.accessToken();
    return withRetry(`dropbox download ${path.basename(dropboxPath)}`, async () => {
      const res = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: this.headers({ 'Dropbox-API-Arg': asciiArg({ path: dropboxPath }) }),
        // Governs the whole request INCLUDING the arrayBuffer() body read below.
        signal: AbortSignal.timeout(T_DOWNLOAD),
      });
      if (!res.ok) throw httpError(res, await res.text());
      const buf = Buffer.from(await res.arrayBuffer());
      return { buffer: buf, size: buf.length };
    });
  },
};

// ---------------------------------------------------------------- Drive
const DRIVE = {
  token: null,
  exp: 0,
  /**
   * Load a service-account key. process.env is tried first, but a raw
   * multi-line JSON pasted into .env is truncated at the first newline by
   * dotenv, so fall back to reading the multi-line block out of .env directly.
   */
  async loadServiceKey() {
    const fromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (fromEnv && fromEnv.trim().startsWith('{')) {
      try { return JSON.parse(fromEnv); } catch { /* truncated — fall through */ }
    }
    if (fromEnv && !fromEnv.trim().startsWith('{')) {
      try { return JSON.parse(await fsp.readFile(fromEnv.trim(), 'utf8')); } catch { /* not a path */ }
    }
    try {
      const lines = (await fsp.readFile('.env', 'utf8')).split('\n');
      const i = lines.findIndex((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
      if (i < 0) return null;
      let raw = lines[i].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length);
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break;
        raw += '\n' + lines[j];
      }
      return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
    } catch { return null; }
  },

  async accessToken() {
    if (this.token && Date.now() < this.exp - 300000) return this.token;
    const errors = [];

    if (process.env.GOOGLE_DRIVE_ACCESS_TOKEN) {
      this.token = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
      this.exp = Date.now() + 30 * 60 * 1000;
      this.method = 'GOOGLE_DRIVE_ACCESS_TOKEN';
      return this.token;
    }

    // Service account first: it is the credential intended for unattended runs.
    const key = await this.loadServiceKey();
    if (key?.client_email && key?.private_key) {
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const claim = {
          iss: key.client_email,
          scope: 'https://www.googleapis.com/auth/drive',
          aud: 'https://oauth2.googleapis.com/token',
          iat: nowSec, exp: nowSec + 3600,
          ...(process.env.GOOGLE_IMPERSONATE ? { sub: process.env.GOOGLE_IMPERSONATE } : {}),
        };
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`;
        const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${unsigned}.${sig}`,
          }),
          signal: AbortSignal.timeout(T_TOKEN),
        });
        if (!res.ok) throw httpError(res, await res.text());
        const d = await res.json();
        this.token = d.access_token;
        this.exp = Date.now() + d.expires_in * 1000;
        this.method = `service account (${key.client_email})`;
        return this.token;
      } catch (e) { errors.push(`service account: ${e.message}`); }
    } else {
      errors.push('service account: key not present or unparseable');
    }

    if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.GOOGLE_DRIVE_CLIENT_ID) {
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
            client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
            client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
          }),
          signal: AbortSignal.timeout(T_TOKEN),
        });
        if (!res.ok) throw httpError(res, await res.text());
        const d = await res.json();
        this.token = d.access_token;
        this.exp = Date.now() + d.expires_in * 1000;
        this.method = 'OAuth refresh token';
        return this.token;
      } catch (e) { errors.push(`oauth refresh: ${e.message}`); }
    }

    const e = new Error('No usable Google Drive credential.\n  ' + errors.join('\n  '));
    e.fatal = true;
    throw e;
  },

  async api(url, opts = {}) {
    const token = await this.accessToken();
    const { timeoutMs, ...rest } = opts;
    const res = await fetch(url, {
      ...rest,
      headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs ?? T_META),
    });
    if (!res.ok) throw httpError(res, await res.text());
    return res;
  },

  /** Find an existing child folder by exact name, or null. */
  async findFolder(name, parentId) {
    const q = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      `'${parentId}' in parents`,
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
    ].join(' and ');
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`
      + `&fields=files(id,name)&pageSize=1&${ALL_DRIVES_LIST}`
      + `&corpora=drive&driveId=${encodeURIComponent(DRIVE_ID)}`;
    const res = await withRetry(`find folder ${name}`, () => this.api(url));
    const d = await res.json();
    return d.files?.[0]?.id ?? null;
  },

  async createFolder(name, parentId) {
    const res = await withRetry(`create folder ${name}`, () =>
      this.api(`https://www.googleapis.com/drive/v3/files?fields=id&${ALL_DRIVES}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      })
    );
    return (await res.json()).id;
  },

  /** Resumable upload. Never sets a Google mime type, so nothing is converted. */
  async upload(name, parentId, buffer, mimeType) {
    if (GOOGLE_TYPES.test(mimeType)) throw new Error(`refusing to upload as Google type: ${mimeType}`);
    // A resumable session for an empty body computes Content-Range
    // "bytes 0-(-1)/0", which Drive rejects with 400 "Failed to parse
    // Content-Range header". 41 files in the corpus are zero bytes. Send them
    // as a single multipart request instead — no ranges involved.
    if (buffer.length === 0) return this.uploadEmpty(name, parentId, mimeType);
    // A 410 on the session PUT means Google discarded the resumable session
    // server-side (seen once on 2026-08-18: a 500 killed the session, and the
    // retry of the same URI came back 410 Gone). A dead session URI can never
    // succeed, so re-PUTting it is pointless — discard it and start a fresh
    // session. 410 is deliberately NOT in withRetry's retryable set: the inner
    // retry loop must throw it so this outer loop can mint a new session.
    const MAX_SESSIONS = 3;
    for (let attempt = 1; ; attempt++) {
      const start = await withRetry(`init upload ${name}`, () =>
        this.api(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType&${ALL_DRIVES}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType,
            'X-Upload-Content-Length': String(buffer.length),
          },
          body: JSON.stringify({ name, parents: [parentId], mimeType }),
        })
      );
      const session = start.headers.get('location');
      if (!session) throw new Error('no resumable session URL returned');

      try {
        const res = await withRetry(`upload ${name}`, async () => {
          const r = await fetch(session, {
            method: 'PUT',
            headers: {
              'Content-Type': mimeType,
              'Content-Range': `bytes 0-${buffer.length - 1}/${buffer.length}`,
            },
            body: buffer,
            signal: AbortSignal.timeout(uploadTimeout(buffer.length)),
          });
          if (!r.ok) throw httpError(r, await r.text());
          return r;
        });
        return res.json();
      } catch (err) {
        if (err.status === 410 && attempt < MAX_SESSIONS) {
          log(`    ↻ upload ${name}: session gone (410), starting fresh session ${attempt + 1}/${MAX_SESSIONS}`);
          continue;
        }
        throw err;
      }
    }
  },

  /** Single-request upload for zero-byte files. */
  async uploadEmpty(name, parentId, mimeType) {
    const boundary = 'granted-empty-boundary';
    const meta = JSON.stringify({ name, parents: [parentId], mimeType });
    const body = `--${boundary}\r\n`
      + `Content-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
      + `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n\r\n`
      + `--${boundary}--`;
    const res = await withRetry(`upload empty ${name}`, () =>
      this.api(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType&${ALL_DRIVES}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      })
    );
    return res.json();
  },

  async stat(fileId) {
    const res = await withRetry('stat', () =>
      this.api(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,size,mimeType,parents,driveId,trashed&${ALL_DRIVES}`)
    );
    return res.json();
  },
};

// ---------------------------------------------------------------- ledger
/**
 * Ledger identity: source + drive_file_id, NOT source + destination.
 *
 * A destination is a PATH, and paths move. Merging two canonical clients
 * renames a folder and every ledger row beneath it goes stale — which happened
 * twice on 2026-08-13 (the Clients/ prefix, then four canonical renames). Each
 * time, a resumed copy believed 1,259 already-copied files still needed
 * copying. A Drive file id is assigned at upload and never changes when the
 * file is renamed or re-parented, so it survives any reshuffle of the tree.
 *
 * Dual-filing is preserved. One source copied to two destinations produces two
 * uploads and therefore two distinct ids, so the two entries remain separate
 * rows. No id is ever reused (verified across all 1,468 current rows).
 *
 * A FAILED entry has no drive_file_id, so it cannot use that identity; it is
 * keyed on source + route + a sequence number. That is enough because a failed
 * entry never suppresses a retry — the todo filter keeps any row without a
 * resolving verified entry. Failed rows exist for reporting and --clear-failed.
 */
const SEP = '\u0000';
const ledger = new Map();            // key -> entry
const verifiedBySource = new Map();  // source -> [verified entries]
let failedSeq = 0;

function ledgerKey(e) {
  return (e.status === 'verified' && e.drive_file_id)
    ? `${e.source}${SEP}${e.drive_file_id}`
    : `${e.source}${SEP}failed${SEP}${e.route}${SEP}${failedSeq++}`;
}
function indexEntry(e) {
  ledger.set(ledgerKey(e), e);
  if (e.status === 'verified' && e.drive_file_id) {
    if (!verifiedBySource.has(e.source)) verifiedBySource.set(e.source, []);
    verifiedBySource.get(e.source).push(e);
  }
}
async function loadLedger() {
  try {
    const text = await fsp.readFile(LEDGER, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      indexEntry(JSON.parse(line));
    }
  } catch { /* no ledger yet */ }
}
let ledgerStream = null;
async function appendLedger(entry) {
  if (!ledgerStream) {
    await fsp.mkdir(path.dirname(LEDGER), { recursive: true });
    ledgerStream = fs.createWriteStream(LEDGER, { flags: 'a' });
  }
  ledgerStream.write(JSON.stringify(entry) + '\n');
  indexEntry(entry);
}

/**
 * Is this Drive file still present and untrashed? Only a 404 counts as gone —
 * anything else (network, 5xx, auth) is "unknown" and must NOT be read as
 * missing, or a transient Drive outage would look like 1,468 lost files and
 * trigger a full re-copy.
 */
const resolveCache = new Map();
async function resolvesInDrive(id) {
  if (resolveCache.has(id)) return resolveCache.get(id);
  const p = (async () => {
    try {
      const f = await DRIVE.stat(id);
      return f && !f.trashed ? 'present' : 'gone';
    } catch (err) {
      return err.status === 404 ? 'gone' : 'unknown';
    }
  })();
  resolveCache.set(id, p);
  return p;
}

/**
 * Drop `failed` entries so they retry cleanly. `verified` entries are always
 * kept — clearing one would cause a duplicate upload on the next run, which is
 * the single thing the ledger exists to prevent.
 */
async function clearFailed() {
  await loadLedger();
  const kept = [...ledger.values()].filter((e) => e.status === 'verified');
  const dropped = ledger.size - kept.length;
  await fsp.mkdir(path.dirname(LEDGER), { recursive: true });
  await fsp.writeFile(LEDGER, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
  console.log(JSON.stringify({ cleared_failed: dropped, kept_verified: kept.length, ledger: LEDGER }, null, 2));
}

// ------------------------------------------------------------ Live shortcuts
/**
 * Live-client shortcuts, created as part of the copy rather than by a separate
 * pass. drive-restructure.mjs made them for the 90 pilot folders; at full
 * corpus scale there is no separate restructure step, so the copy has to do it.
 *
 * Idempotent on three levels: the ledger records every shortcut created, the
 * in-process set guards against two workers racing on the same client, and
 * Drive itself is checked for an existing shortcut before one is made. A
 * re-run creates nothing.
 */
// Roots come from mapping-lib, the single source of truth — the mapping sheet
// is generated from those same constants, so a literal here could silently
// disagree with the destinations being executed and create a second top-level
// tree beside the real one. Env vars still override for testing.
const CLIENTS_ROOT = process.env.PILOT_CLIENTS_ROOT || LIB_CLIENTS_ROOT;
const LIVE_ROOT = process.env.PILOT_LIVE_ROOT || LIB_CURRENT_ROOT;
const liveClients = new Set();
const shortcutDone = new Set();
const shortcutInFlight = new Map();
let liveRootId = null;

async function loadLiveClients() {
  try {
    const text = await fsp.readFile('dist/inventory/client-status.csv', 'utf8');
    let header = null;
    for (const r of parseCsv(text)) {
      if (!header) { header = r; continue; }
      if (!r[0]) continue;
      if (r[1] === 'Live') liveClients.add(r[0]);
    }
  } catch { /* no status file — no shortcuts */ }
  for (const e of ledger.values()) {
    if (e.action === 'shortcut' && e.status === 'verified') shortcutDone.add(e.client);
  }
  log(`live clients: ${liveClients.size}, shortcuts already recorded: ${shortcutDone.size}`);
}

async function ensureLiveShortcut(clientName, folderId) {
  if (!liveClients.has(clientName)) return null;
  if (shortcutDone.has(clientName)) return null;
  if (shortcutInFlight.has(clientName)) return shortcutInFlight.get(clientName);

  const p = (async () => {
    if (!liveRootId) {
      const existing = await DRIVE.findFolder(LIVE_ROOT, DEST_ROOT);
      liveRootId = existing ?? await DRIVE.createFolder(LIVE_ROOT, DEST_ROOT);
    }
    // Ask Drive too: a shortcut may exist from the restructure pass, which
    // predates this ledger.
    const q = [
      `name = '${clientName.replace(/'/g, "\\'")}'`,
      `'${liveRootId}' in parents`,
      `mimeType = 'application/vnd.google-apps.shortcut'`,
      'trashed = false',
    ].join(' and ');
    const found = await withRetry('shortcut-find', () => DRIVE.api(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${ALL_DRIVES_LIST}&corpora=drive&driveId=${DRIVE_ID}`
    ).then((r) => r.json()));
    if ((found.files ?? []).length) {
      shortcutDone.add(clientName);
      return found.files[0].id;
    }
    const res = await withRetry('shortcut-create', () => DRIVE.api(
      `https://www.googleapis.com/drive/v3/files?${ALL_DRIVES}&fields=id,name`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clientName,
          mimeType: 'application/vnd.google-apps.shortcut',
          parents: [liveRootId],
          shortcutDetails: { targetId: folderId },
        }),
      }
    ).then((r) => r.json()));
    shortcutDone.add(clientName);
    await appendLedger({
      action: 'shortcut', client: clientName, source: `«shortcut»${clientName}`,
      destination: `${LIVE_ROOT}/${clientName}`, drive_file_id: res.id,
      target_id: folderId, route: 'shortcut', status: 'verified',
      timestamp: new Date().toISOString(),
    });
    log(`  ↳ Live shortcut: ${LIVE_ROOT}/${clientName}`);
    return res.id;
  })();
  shortcutInFlight.set(clientName, p);
  return p;
}

// ---------------------------------------------------------------- folder cache
const folderCache = new Map();   // 'A/B/C' -> Promise<driveId>
/**
 * Resolve (creating if needed) the folder chain, caching the PROMISE rather
 * than the id. Two workers needing the same folder await the same creation, so
 * a folder is never created twice.
 */
function ensureFolder(segments) {
  let chain = Promise.resolve(DEST_ROOT);
  let acc = '';
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg;
    const key = acc;
    const parentPromise = chain;
    if (folderCache.has(key)) {
      chain = folderCache.get(key);
    } else {
      const p = (async () => {
        const parent = await parentPromise;
        const existing = await DRIVE.findFolder(seg, parent);
        const id = existing ?? await DRIVE.createFolder(seg, parent);
        // A client folder has just been resolved directly under the clients
        // root. If that client is Live, wire its shortcut now — this is the
        // only moment we know the folder's id without a second lookup.
        if (key === `${CLIENTS_ROOT}/${seg}`) await ensureLiveShortcut(seg, id);
        return id;
      })();
      folderCache.set(key, p);
      chain = p;
    }
  }
  return chain;
}

// ---------------------------------------------------------------- main
if (CLEAR_FAILED) { await clearFailed(); process.exit(0); }
if (PERMCHECK) { await permCheck(); process.exit(0); }

/**
 * Read the mapping BY HEADER NAME, not by column position.
 *
 * Two sheets are executed by this script and their columns do not line up:
 *   grants      source_path,client,program,year,year_source,destination_path,…
 *   departments source_path,department,subpath,destination_path,filename,size,…
 * Positional reads took `size` as the destination and `extension` as the route,
 * which would have produced a silent zero-file run rather than an error.
 * Required columns are asserted; the rest are optional and default to ''.
 */
const rowsAll = [];
{
  let header = null, ix = null;
  const need = (h, name) => {
    const i = h.indexOf(name);
    if (i < 0) throw new Error(`mapping ${MAPPING} has no "${name}" column — found: ${h.join(', ')}`);
    return i;
  };
  const opt = (h, ...names) => { for (const nm of names) { const i = h.indexOf(nm); if (i >= 0) return i; } return -1; };
  const at = (r, i) => (i >= 0 ? (r[i] ?? '') : '');
  for (const r of parseCsv(await fsp.readFile(MAPPING, 'utf8'))) {
    if (!header) {
      header = r;
      ix = {
        src: need(header, 'source_path'), dest: need(header, 'destination_path'), route: need(header, 'route'),
        client: opt(header, 'client', 'department'), program: opt(header, 'program'),
        year: opt(header, 'year'), yearSource: opt(header, 'year_source'),
        proposed: opt(header, 'proposed_filename', 'filename'),
        confidence: opt(header, 'confidence'), reason: opt(header, 'reason'),
      };
      continue;
    }
    if (!r[ix.src]) continue;
    rowsAll.push({
      src: r[ix.src], client: at(r, ix.client), program: at(r, ix.program),
      year: at(r, ix.year), yearSource: at(r, ix.yearSource),
      dest: r[ix.dest], proposed: at(r, ix.proposed), route: r[ix.route],
      confidence: at(r, ix.confidence), reason: at(r, ix.reason),
    });
  }
}
const rows = rowsAll.filter((r) => COPY_ROUTES.has(r.route)
  && (!ONLY_PROGRAM || r.program === ONLY_PROGRAM));
if (ONLY_PROGRAM) log(`program filter: "${ONLY_PROGRAM}" -> ${rows.length} of ${rowsAll.length} rows`);
const skipped = rowsAll.length - rows.length;
log(`mapping: ${rowsAll.length} rows, ${rows.length} copyable, ${skipped} skipped (review)`);

// ---------------------------------------------------------------- Step 2: dry run
if (DRY_RUN) {
  const folders = new Set();
  let bytes = 0;
  let deepest = { depth: 0, path: '' };
  const byRoute = new Map();
  const sizes = new Map();
  for (const r of rows) {
    const segs = r.dest.split('/');
    for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join('/'));
    const d = segs.length;
    if (d > deepest.depth) deepest = { depth: d, path: r.dest };
    byRoute.set(r.route, (byRoute.get(r.route) ?? 0) + 1);
    sizes.set(r.src, true);
  }
  // Bytes come from the inventory, not the mapping (which has no size column).
  const inv = await fsp.readFile('dist/inventory/grants-inventory.csv', 'utf8');
  const sizeByPath = new Map();
  {
    let header = null;
    for (const rr of parseCsv(inv)) {
      if (!header) { header = rr; continue; }
      if (rr[2] === 'file' && sizes.has(rr[0])) sizeByPath.set(rr[0], Number(rr[3] || 0));
    }
  }
  for (const [, v] of sizeByPath) bytes += v;

  console.log(JSON.stringify({
    dry_run: true,
    rows_total: rowsAll.length,
    would_copy_rows: rows.length,
    distinct_source_files: sizes.size,
    skipped_review_rows: skipped,
    by_route: Object.fromEntries(byRoute),
    folders_to_create: folders.size,
    total_bytes: bytes,
    total_gb: Number((bytes / 1024 ** 3).toFixed(2)),
    deepest_path_depth: deepest.depth,
    deepest_path: deepest.path,
    destination_root: DEST_ROOT,
  }, null, 2));
  log('\nDRY RUN — nothing created.');
  process.exit(0);
}

// ---------------------------------------------------------------- copy
await loadLedger();
log(`ledger: ${ledger.size} entries already recorded`);
await loadLiveClients();

// Confirm every verified id still resolves. Path plays no part in this.
const verifiedIds = [...new Set([...verifiedBySource.values()].flat().map((e) => e.drive_file_id))];
log(`checking ${verifiedIds.length} verified Drive ids still resolve...`);
const present = new Set();
let unknown = 0, gone = 0;
for (let i = 0; i < verifiedIds.length; i += 25) {
  const batch = verifiedIds.slice(i, i + 25);
  const states = await Promise.all(batch.map((id) => resolvesInDrive(id)));
  batch.forEach((id, j) => {
    if (states[j] === 'present') present.add(id);
    else if (states[j] === 'gone') gone += 1;
    else unknown += 1;
  });
}
log(`  present ${present.size}, gone ${gone}, unknown ${unknown}`);
// Safety valve: if Drive could not answer for a meaningful slice, stop rather
// than re-copying files that are probably fine.
if (unknown > Math.max(5, verifiedIds.length * 0.02)) {
  log(`ABORT: ${unknown} ids could not be checked. Refusing to re-copy on incomplete information.`);
  process.exit(1);
}

/**
 * A source is satisfied by as many resolving verified entries as it has copy
 * rows. Counting rather than path-matching is what keeps dual-filing correct:
 * a source with two destinations needs two surviving uploads.
 */
const satisfied = new Map();
for (const [src, es] of verifiedBySource) {
  satisfied.set(src, es.filter((e) => present.has(e.drive_file_id)).length);
}
const consumed = new Map();
const todo = rows.filter((r) => {
  const have = satisfied.get(r.src) ?? 0;
  const used = consumed.get(r.src) ?? 0;
  if (used < have) { consumed.set(r.src, used + 1); return false; }
  return true;
});
log(`to copy: ${todo.length} (${rows.length - todo.length} already verified)`);

/**
 * Pick a diverse sample rather than the first N: at least one row per route,
 * distinct clients and years where possible, and the deepest path in the set.
 * Deterministic — no randomness, so a re-run selects the same rows.
 */
function spreadSelect(list, n) {
  const picked = [];
  const seenRoute = new Set(), seenClient = new Set(), seenYear = new Set();
  const take = (r) => {
    picked.push(r);
    seenRoute.add(r.route); seenClient.add(r.client || `«${r.route}»`); seenYear.add(r.year);
  };
  const deepest = [...list].sort(
    (a, b) => b.dest.split('/').length - a.dest.split('/').length || a.dest.localeCompare(b.dest)
  )[0];
  if (deepest) take(deepest);
  // Guarantee the sample exercises a collision-suffixed filename — that rule
  // is the newest and the one most worth seeing land correctly.
  const suffixed = list.find((r) => / \([^)]+\)\.[^.]+$/.test(r.dest.split('/').pop()) && !picked.includes(r));
  if (suffixed) take(suffixed);
  for (const route of ['sort', 'program', 'archive']) {
    if (picked.length >= n) break;
    if (seenRoute.has(route)) continue;
    const cand = list.find((r) => r.route === route && !picked.includes(r));
    if (cand) take(cand);
  }
  const score = (r) =>
    (seenRoute.has(r.route) ? 0 : 4) +
    (seenClient.has(r.client || `«${r.route}»`) ? 0 : 2) +
    (seenYear.has(r.year) ? 0 : 1);
  while (picked.length < n) {
    const remaining = list.filter((r) => !picked.includes(r));
    if (!remaining.length) break;
    remaining.sort((a, b) => score(b) - score(a) || a.dest.localeCompare(b.dest));
    take(remaining[0]);
  }
  return picked;
}

const batch = SPREAD ? spreadSelect(todo, Number.isFinite(LIMIT) ? LIMIT : 10) : todo.slice(0, LIMIT);
log(`this run: ${batch.length}${SPREAD ? ' (diverse sample)' : ''}\n`);

await DRIVE.accessToken();
log(`drive credential: ${DRIVE.method}\n`);

const results = { verified: 0, failed: 0, bytes: 0 };
const failures = [];
const CONCURRENCY = Number(process.env.PILOT_CONCURRENCY || 4);
const started = Date.now();
let done = 0;
let lastLog = 0;

function progress(force = false) {
  const now = Date.now();
  if (!force && now - lastLog < 30000) return;
  lastLog = now;
  const el = (now - started) / 1000;
  const rate = results.bytes / Math.max(el, 1);
  const remaining = batch.length - done;
  const eta = rate > 0 ? (results.bytes / Math.max(done, 1)) * remaining / rate : 0;
  log(
    `  [${String(done).padStart(4)}/${batch.length}] ` +
    `ok=${results.verified} fail=${results.failed} ` +
    `${(results.bytes / 1024 ** 3).toFixed(2)}GB ` +
    `${Math.floor(el / 60)}m${String(Math.floor(el % 60)).padStart(2, '0')}s elapsed` +
    (remaining ? ` · ~${Math.ceil(eta / 60)}m left` : '')
  );
}

async function copyOne(r) {
  const segs = r.dest.split('/');
  const fileName = segs.pop();
  // Declared outside the try so a failure can record WHERE it was aimed. The
  // 2026-08-17 incident could not be diagnosed from the ledger because the
  // target parent was never written down.
  let parentId = null;
  try {
    const { buffer, size } = await DBX.download(r.src);
    parentId = await ensureFolder(segs);
    const mimeType = mimeOf(fileName);
    const up = await DRIVE.upload(fileName, parentId, buffer, mimeType);
    const stat = await DRIVE.stat(up.id);
    const uploaded = Number(stat.size ?? 0);

    if (uploaded !== size) throw new Error(`size mismatch: source ${size}, drive ${uploaded}`);
    if (GOOGLE_TYPES.test(stat.mimeType)) throw new Error(`converted to Google type: ${stat.mimeType}`);

    await appendLedger({
      source: r.src, destination: r.dest, drive_file_id: stat.id,
      parent_folder_id: parentId,
      client: r.client,
      source_size: size, uploaded_size: uploaded, mime_type: stat.mimeType,
      route: r.route, status: 'verified', timestamp: new Date().toISOString(),
    });
    results.verified += 1;
    results.bytes += uploaded;
  } catch (err) {
    if (err.fatal) throw err;
    await appendLedger({
      source: r.src, destination: r.dest, drive_file_id: null,
      parent_folder_id: parentId,
      client: r.client,
      source_size: null, uploaded_size: null, mime_type: null,
      route: r.route, status: 'failed', error: err.message,
      error_reason: err.reason ?? null, http_status: err.status ?? null,
      timestamp: new Date().toISOString(),
    });
    results.failed += 1;
    failures.push({ source: r.src, destination: r.dest, error: err.message });
  } finally {
    done += 1;
    progress();
  }
}

let cursor = 0;
async function worker() {
  while (cursor < batch.length) {
    const r = batch[cursor++];
    await copyOne(r);
  }
}
log(`concurrency: ${CONCURRENCY}\n`);
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
progress(true);

const runtimeSec = Math.round((Date.now() - started) / 1000);

if (ledgerStream) { ledgerStream.end(); }
console.log(JSON.stringify({
  attempted: batch.length,
  verified: results.verified,
  failed: results.failed,
  skipped_already_verified: rows.length - todo.length,
  bytes_transferred: results.bytes,
  gb_transferred: Number((results.bytes / 1024 ** 3).toFixed(2)),
  runtime_seconds: runtimeSec,
  runtime: `${Math.floor(runtimeSec / 60)}m${String(runtimeSec % 60).padStart(2, '0')}s`,
  remaining_after_run: todo.length - batch.length,
  failures,
  ledger: LEDGER,
}, null, 2));

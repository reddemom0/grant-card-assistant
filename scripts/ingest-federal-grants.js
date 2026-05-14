#!/usr/bin/env node
/**
 * Ingest Federal Grants — Proactive Disclosure dataset
 *
 * Downloads the Government of Canada's Proactive Disclosure CSV to local disk,
 * then streams from disk into Postgres via COPY → staging → atomic UPSERT.
 * Refreshes the pdg_program_yearly materialized view on success.
 * See migrations/021_proactive_disclosure_grants.sql for the schema.
 *
 * The download-then-stream split is deliberate: streaming directly from the
 * Open Canada CDN into COPY reliably fails because the CDN aborts connections
 * (`TypeError: terminated` from undici) when Postgres backpressure slows the
 * read end below the CDN's throughput threshold. Downloading first decouples
 * the two halves so neither can block the other.
 *
 * Modes:
 *   --initial      Full load. Ignores Last-Modified; runs even if no source change.
 *   --refresh      Re-ingest. HEAD-checks the source; exits cleanly if unchanged.
 *   --dry-run      Parses first 100 rows from the cached local file. Requires --initial.
 *   --naics-only   (Re)loads naics_labels from the StatsCan CSV. Independent of grants.
 *
 * Flags:
 *   --redownload   Force a fresh download even if the cached file matches
 *                  Content-Length. Use after a corrupted partial download or
 *                  when troubleshooting source-data weirdness. Valid with
 *                  --initial or --refresh.
 *
 * Caching:
 *   The downloaded CSV is preserved at /tmp/federal-grants-source.csv (override
 *   via FEDERAL_GRANTS_LOCAL_PATH). Subsequent runs reuse it when the cached
 *   file size matches the HEAD-reported Content-Length. Delete the file or
 *   pass --redownload to force a refetch.
 *
 * Examples:
 *   railway run node scripts/ingest-federal-grants.js --initial
 *   railway run node scripts/ingest-federal-grants.js --refresh
 *   railway run node scripts/ingest-federal-grants.js --initial --redownload
 *   node scripts/ingest-federal-grants.js --initial --dry-run
 *
 * Uses a dedicated pg.Client (NOT the shared pool from src/database/connection.js)
 * so it can disable statement_timeout for the long-running COPY + UPSERT +
 * REFRESH. The shared pool caps statements at 30s, well below the expected
 * runtime of a 3M-row ingestion.
 */

import 'dotenv/config';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { parse as csvParse } from 'csv-parse';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createWriteStream, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';

// ============================================================================
// CONSTANTS
// ============================================================================

const SOURCE_URL = process.env.FEDERAL_GRANTS_CSV_URL
  || 'https://open.canada.ca/data/dataset/432527ab-7aac-45b5-81d6-7597107a7013/resource/1d15a62f-5656-49ad-8c88-f40ce689d831/download/grants.csv';

// VERIFY ON FIRST RUN — actual download URL must be resolved from the StatsCan
// dataset page (https://www.statcan.gc.ca/en/concepts/industry/2022/naics-scian-2022-v1-eng.htm
// or the open.canada.ca equivalent). Placeholder below is not guaranteed correct;
// override via NAICS_LABELS_CSV_URL env var on first run if it 404s.
const NAICS_URL = process.env.NAICS_LABELS_CSV_URL
  || 'https://www.statcan.gc.ca/en/statistical-programs/document/naics-scian-2022-v1-eng.csv';

const REJECTED_PATH = '/tmp/federal-grants-rejected.csv';
const ERROR_LOG_PATH = '/tmp/federal-grants-ingest-error.log';
// Source CSV is downloaded to local disk first, then streamed into COPY. This
// decouples the two halves of the pipeline so Postgres backpressure cannot
// stall the CDN read (Open Canada's CDN aborts connections after ~3-4 min of
// reduced throughput, producing `TypeError: terminated` from undici).
const LOCAL_SOURCE_PATH = process.env.FEDERAL_GRANTS_LOCAL_PATH || '/tmp/federal-grants-source.csv';
const DOWNLOAD_LOG_EVERY_BYTES = 100 * 1024 * 1024; // log every 100 MB downloaded
const COPY_LOG_EVERY = 50_000;
const DRY_RUN_SAMPLE_SIZE = 100;

// Column order MUST match the COPY column list and the INSERT...SELECT below.
// ingested_at has DEFAULT NOW() and is not in the ingest path.
const COLUMNS = [
  'ref_number',
  'amendment_number',
  'amendment_date',
  'disclosed_date',
  'agreement_type',
  'recipient_type',
  'recipient_business_number',
  'recipient_legal_name',
  'recipient_operating_name',
  'recipient_country',
  'recipient_province',
  'recipient_city',
  'recipient_postal_code',
  'federal_riding_name_en',
  'federal_riding_number',
  'prog_name_en',
  'prog_purpose_en',
  'agreement_title_en',
  'agreement_number',
  'agreement_value',
  'agreement_start_date',
  'agreement_end_date',
  'naics_identifier',
  'owner_org',
  'owner_org_title',
  'description_en',
  'expected_results_en',
];

// Subset of source columns we expect to find in the CSV header. The source
// has ~38 columns including FR duplicates and other metadata we drop. We only
// assert these are present in --dry-run; extras are ignored.
const REQUIRED_SOURCE_COLUMNS = [
  'ref_number', 'amendment_number', 'agreement_type', 'recipient_type',
  'recipient_legal_name', 'recipient_province', 'prog_name_en',
  'agreement_value', 'agreement_start_date', 'owner_org_title',
];

const PROVINCE_MAP = {
  'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
  'new brunswick': 'NB', 'newfoundland and labrador': 'NL',
  'newfoundland & labrador': 'NL', 'nova scotia': 'NS', 'ontario': 'ON',
  'prince edward island': 'PE', 'quebec': 'QC', 'saskatchewan': 'SK',
  'northwest territories': 'NT', 'nunavut': 'NU', 'yukon': 'YT',
};

// ============================================================================
// CLI
// ============================================================================

function parseArgs() {
  const argv = process.argv.slice(2);
  const modes = ['--initial', '--refresh', '--naics-only'];
  const found = modes.filter((m) => argv.includes(m));
  if (found.length !== 1) {
    console.error('❌ Specify exactly one mode: --initial | --refresh | --naics-only');
    console.error('   Optional flags: --dry-run (with --initial), --redownload (with --initial or --refresh)');
    process.exit(1);
  }
  const mode = found[0].replace(/^--/, '');
  const dryRun = argv.includes('--dry-run');
  const redownload = argv.includes('--redownload');
  if (dryRun && mode !== 'initial') {
    console.error('❌ --dry-run is only valid with --initial');
    process.exit(1);
  }
  if (redownload && mode === 'naics-only') {
    console.error('❌ --redownload is not valid with --naics-only (NAICS load does not cache)');
    process.exit(1);
  }
  return { mode, dryRun, redownload };
}

// ============================================================================
// ROW TRANSFORMS
// ============================================================================

function stripBilingual(s) {
  if (s == null) return null;
  const idx = s.indexOf(' | ');
  return idx >= 0 ? s.slice(0, idx).trim() : s.trim();
}

function stripIndustriesArtifact(s) {
  if (s == null) return null;
  return s.replace(/^Industries\s+/i, '').trim();
}

function coerceDate(s) {
  if (s == null) return null;
  const trimmed = String(s).trim();
  if (!trimmed || trimmed.toLowerCase() === 'n/a' || trimmed.toLowerCase() === 'ongoing') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  // Sanity: reject obviously bogus dates (e.g. 9999-12-31 is common as a "no end")
  const d = new Date(trimmed + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return trimmed;
}

function coerceNumeric(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[$,]/g, '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'n/a') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeProvince(s) {
  if (s == null) return null;
  const trimmed = String(s).trim();
  if (!trimmed) return null;
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed; // already 2-letter
  return PROVINCE_MAP[trimmed.toLowerCase()] || trimmed;
}

function cleanText(s) {
  if (s == null) return null;
  const v = stripIndustriesArtifact(stripBilingual(s));
  return v === '' ? null : v;
}

function cleanChar1(s) {
  if (s == null) return null;
  const trimmed = String(s).trim().toUpperCase();
  return trimmed === '' ? null : trimmed.slice(0, 1);
}

/**
 * Escape a single field value for Postgres text-format COPY.
 * Postgres text format uses TAB delimiter and `\N` for NULL. Backslash,
 * tab, newline, and CR must all be backslash-escaped.
 */
function escapeCopyField(v) {
  if (v === null || v === undefined) return '\\N';
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

async function headCheckSource(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) throw new Error(`HEAD ${url} → ${res.status} ${res.statusText}`);
  const lm = res.headers.get('last-modified');
  return {
    lastModified: lm ? new Date(lm) : null,
    etag: res.headers.get('etag'),
    contentLength: Number(res.headers.get('content-length') || 0),
  };
}

async function openSourceStream(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error(`GET ${url} returned no body`);
  return Readable.fromWeb(res.body);
}

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Download `url` to `localPath`. Skips the download when the local file exists
 * and its size matches `expectedSize` (and `force` is false).
 *
 * Why download-then-stream instead of stream-direct-into-COPY: Open Canada's
 * CDN aborts connections that fall under a throughput threshold for several
 * minutes. Postgres COPY backpressure under load reliably triggers that abort
 * (`TypeError: terminated` from undici). Local disk has no such constraint.
 */
async function downloadSource(url, localPath, { expectedSize, force }) {
  if (!force) {
    try {
      const stat = await fs.stat(localPath);
      if (expectedSize > 0 && stat.size === expectedSize) {
        console.log(`   ♻️  Reusing cached download at ${localPath} (${formatBytes(stat.size)})`);
        return { reused: true, bytes: stat.size };
      }
      if (expectedSize > 0) {
        console.log(`   ⚠️  Cached file size mismatch (${stat.size} vs expected ${expectedSize}); re-downloading.`);
      } else {
        console.log(`   ⚠️  Source HEAD did not return Content-Length; re-downloading to be safe.`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // No cache; proceed to download.
    }
  } else {
    console.log('   🔄 --redownload set; fetching fresh copy.');
  }

  console.log(`   📥 Downloading ${url}`);
  console.log(`      → ${localPath}`);
  if (expectedSize > 0) console.log(`      Expected size: ${formatBytes(expectedSize)}`);

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error(`GET ${url} returned no body`);

  let bytesWritten = 0;
  let nextLogAt = DOWNLOAD_LOG_EVERY_BYTES;
  const startedAt = Date.now();

  const progress = new Transform({
    transform(chunk, _enc, cb) {
      bytesWritten += chunk.length;
      if (bytesWritten >= nextLogAt) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const mbps = bytesWritten / 1024 / 1024 / elapsed;
        const pctStr = expectedSize > 0 ? ` (${((bytesWritten / expectedSize) * 100).toFixed(1)}%)` : '';
        console.log(`      ${formatBytes(bytesWritten)}${pctStr} @ ${mbps.toFixed(1)} MB/s`);
        nextLogAt += DOWNLOAD_LOG_EVERY_BYTES;
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body), progress, createWriteStream(localPath));
  } catch (err) {
    // Don't leave a partial file masquerading as a future cache hit.
    try { await fs.unlink(localPath); } catch {}
    throw err;
  }

  const finalStat = await fs.stat(localPath);
  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(`   ✅ Downloaded ${formatBytes(finalStat.size)} in ${elapsed.toFixed(1)}s (avg ${(finalStat.size / 1024 / 1024 / elapsed).toFixed(1)} MB/s)`);

  if (expectedSize > 0 && finalStat.size !== expectedSize) {
    throw new Error(
      `Downloaded size (${finalStat.size}) does not match Content-Length (${expectedSize}). `
      + 'The CDN may have truncated the response; re-run with --redownload.'
    );
  }

  return { reused: false, bytes: finalStat.size };
}

// ============================================================================
// DB HELPERS
// ============================================================================

async function readMeta(client) {
  const r = await client.query('SELECT * FROM proactive_disclosure_meta WHERE id = 1');
  return r.rows[0] || null;
}

async function writeMeta(client, patch) {
  const fields = Object.keys(patch);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = fields.map((f) => patch[f]);
  await client.query(
    `UPDATE proactive_disclosure_meta SET ${sets}, updated_at = NOW() WHERE id = 1`,
    values
  );
}

async function preflightChecks(client) {
  console.log('🔍 Preflight: pg_trgm extension...');
  const ext = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
  if (ext.rows.length === 0) {
    throw new Error(
      'pg_trgm extension not installed. Run `CREATE EXTENSION pg_trgm;` as a '
      + 'superuser, or apply migration 021 first (which CREATEs it).'
    );
  }
  console.log('   ✅ pg_trgm available');

  console.log('🔍 Preflight: disk headroom...');
  const dbSize = await client.query(
    'SELECT pg_database_size(current_database()) AS bytes'
  );
  const sizeGB = Number(dbSize.rows[0].bytes) / (1024 ** 3);
  console.log(`   Current DB size: ${sizeGB.toFixed(2)} GB`);
  console.log('   ⚠️  Federal grants ingest needs ~4 GB headroom. Verify before proceeding.');

  console.log('🔍 Preflight: target table exists...');
  const tbl = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='proactive_disclosure_grants'"
  );
  if (tbl.rows.length === 0) {
    throw new Error('Table proactive_disclosure_grants does not exist. Apply migration 021 first.');
  }
  console.log('   ✅ proactive_disclosure_grants exists');
}

// ============================================================================
// INGEST: FEDERAL GRANTS
// ============================================================================

async function ingestGrants(client, { mode, dryRun, redownload }) {
  const flagStr = [dryRun && 'dry-run', redownload && 'redownload'].filter(Boolean).join(', ');
  console.log(`\n🚀 Starting federal grants ingest (mode=${mode}${flagStr ? ', ' + flagStr : ''})\n`);

  await preflightChecks(client);

  console.log('\n1️⃣  HEAD-checking source...');
  const head = await headCheckSource(SOURCE_URL);
  console.log(`   Source Last-Modified: ${head.lastModified?.toISOString() || 'unknown'}`);
  console.log(`   Source Content-Length: ${(head.contentLength / (1024 ** 3)).toFixed(2)} GB`);

  if (mode === 'refresh') {
    const meta = await readMeta(client);
    if (meta?.last_modified && head.lastModified
        && head.lastModified.getTime() <= new Date(meta.last_modified).getTime()) {
      console.log('\n✅ Source unchanged since last ingest (last_modified matches). Exiting cleanly.');
      return { skipped: true };
    }
    console.log('\n📥 Source has new data, proceeding with refresh.');
  }

  console.log('\n2️⃣  Downloading source to local disk...');
  const downloadResult = await downloadSource(SOURCE_URL, LOCAL_SOURCE_PATH, {
    expectedSize: head.contentLength,
    force: redownload,
  });

  // Counters tracked across the pipeline lifetime
  const counters = {
    source_rows: 0,
    accepted_rows: 0,
    rejected_missing_pk: 0,
    rejected_date_parse: 0,
    rejected_value_parse: 0,
    duplicate_pk: 0,
  };
  const seenKeys = new Set();
  let rejectedStream = null;
  let columnsAsserted = false;

  function ensureRejectedStream() {
    if (!rejectedStream) {
      rejectedStream = createWriteStream(REJECTED_PATH, { flags: 'a' });
    }
    return rejectedStream;
  }

  function transformRow(row) {
    counters.source_rows += 1;

    // First-row column-shape assertion (one-shot)
    if (!columnsAsserted) {
      columnsAsserted = true;
      const missing = REQUIRED_SOURCE_COLUMNS.filter((c) => !(c in row));
      if (missing.length > 0) {
        throw new Error(
          `Source CSV is missing expected columns: ${missing.join(', ')}. `
          + 'The Open Canada publication shape may have changed; verify the dataset URL.'
        );
      }
      console.log(`   ✅ Column shape OK (${REQUIRED_SOURCE_COLUMNS.length} required columns present)`);
    }

    const ref_number = row.ref_number?.trim();
    if (!ref_number) {
      counters.rejected_missing_pk += 1;
      ensureRejectedStream().write(JSON.stringify({ reason: 'missing_ref_number', row }) + '\n');
      return null;
    }

    const amendmentRaw = row.amendment_number?.trim();
    let amendment_number = 0;
    if (amendmentRaw !== undefined && amendmentRaw !== '') {
      const n = Number(amendmentRaw);
      if (!Number.isFinite(n) || n < 0) {
        counters.rejected_missing_pk += 1;
        ensureRejectedStream().write(JSON.stringify({ reason: 'bad_amendment_number', row }) + '\n');
        return null;
      }
      amendment_number = Math.floor(n);
    }

    const key = `${ref_number}\x00${amendment_number}`;
    if (seenKeys.has(key)) {
      counters.duplicate_pk += 1;
      // Don't reject — let the DISTINCT ON in the merge resolve it.
    } else {
      seenKeys.add(key);
    }

    const amendment_date = coerceDateOrCount(row.amendment_date, counters);
    const disclosed_date = coerceDateOrCount(row.disclosed_date, counters);
    const agreement_start_date = coerceDateOrCount(row.agreement_start_date, counters);
    const agreement_end_date = coerceDateOrCount(row.agreement_end_date, counters);

    const agreement_value = coerceNumericOrCount(row.agreement_value, counters);

    const fields = [
      ref_number,
      amendment_number,
      amendment_date,
      disclosed_date,
      cleanChar1(row.agreement_type),
      cleanChar1(row.recipient_type),
      cleanText(row.recipient_business_number),
      cleanText(row.recipient_legal_name),
      cleanText(row.recipient_operating_name),
      cleanText(row.recipient_country),
      normalizeProvince(cleanText(row.recipient_province)),
      cleanText(row.recipient_city),
      cleanText(row.recipient_postal_code),
      cleanText(row.federal_riding_name_en),
      cleanText(row.federal_riding_number),
      cleanText(row.prog_name_en),
      cleanText(row.prog_purpose_en),
      cleanText(row.agreement_title_en),
      cleanText(row.agreement_number),
      agreement_value,
      agreement_start_date,
      agreement_end_date,
      cleanText(row.naics_identifier),
      cleanText(row.owner_org),
      cleanText(row.owner_org_title),
      cleanText(row.description_en),
      cleanText(row.expected_results_en),
    ];

    counters.accepted_rows += 1;
    if (counters.accepted_rows % COPY_LOG_EVERY === 0) {
      console.log(`   📊 Parsed ${counters.accepted_rows.toLocaleString()} rows...`);
    }

    return fields.map(escapeCopyField).join('\t') + '\n';
  }

  // Dry-run: parse first N rows from the local cached file, validate column shape, exit
  if (dryRun) {
    console.log(`\n3️⃣  Dry run — parsing first ${DRY_RUN_SAMPLE_SIZE} rows from local file...`);
    const fileStream = createReadStream(LOCAL_SOURCE_PATH);
    let sampled = 0;
    const sampler = new Transform({
      writableObjectMode: true,
      readableObjectMode: true,
      transform(row, _enc, cb) {
        try {
          const line = transformRow(row);
          if (line) sampled += 1;
          if (sampled >= DRY_RUN_SAMPLE_SIZE) {
            this.push(null); // signal end
            fileStream.destroy();
            return cb();
          }
          cb();
        } catch (err) { cb(err); }
      },
    });

    try {
      await pipeline(
        fileStream,
        csvParse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, trim: true }),
        sampler,
      );
    } catch (err) {
      if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err;
    }
    console.log(`\n✅ Dry run complete. Parsed ${counters.source_rows} source rows, accepted ${counters.accepted_rows}.`);
    console.log(`   Counters: ${JSON.stringify(counters)}`);
    console.log(`   Cached source: ${LOCAL_SOURCE_PATH} (${formatBytes(downloadResult.bytes)}) — delete to force re-download next run.`);
    if (rejectedStream) await closeStream(rejectedStream);
    return { dryRun: true, counters, cachedPath: LOCAL_SOURCE_PATH, cachedBytes: downloadResult.bytes };
  }

  console.log('\n3️⃣  Creating staging table pdg_stage...');
  await client.query('DROP TABLE IF EXISTS pdg_stage');
  await client.query(
    `CREATE TEMP TABLE pdg_stage (LIKE proactive_disclosure_grants INCLUDING DEFAULTS)`
  );
  console.log('   ✅ Staging table created');

  console.log('\n4️⃣  Streaming local file → COPY into pdg_stage...');
  const t0 = Date.now();
  const fileStream = createReadStream(LOCAL_SOURCE_PATH);

  const transformer = new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    transform(row, _enc, cb) {
      try {
        const line = transformRow(row);
        if (line) cb(null, line);
        else cb();
      } catch (err) { cb(err); }
    },
  });

  const copyColumns = COLUMNS.join(', ');
  const copySink = client.query(copyFrom(
    `COPY pdg_stage(${copyColumns}) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N')`
  ));

  await pipeline(fileStream, csvParse({
    columns: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }), transformer, copySink);

  const copyMs = Date.now() - t0;
  console.log(`   ✅ COPY finished. ${counters.accepted_rows.toLocaleString()} rows in ${(copyMs / 1000).toFixed(1)}s.`);

  console.log('\n5️⃣  Merging staging → target (DISTINCT ON + ON CONFLICT)...');
  const tMerge0 = Date.now();
  const updateSet = COLUMNS
    .filter((c) => c !== 'ref_number' && c !== 'amendment_number')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(',\n    ');

  await client.query('BEGIN');
  try {
    const merge = await client.query(`
      INSERT INTO proactive_disclosure_grants (${COLUMNS.join(', ')})
      SELECT DISTINCT ON (ref_number, amendment_number) ${COLUMNS.join(', ')}
      FROM pdg_stage
      ORDER BY ref_number, amendment_number, ingested_at DESC
      ON CONFLICT (ref_number, amendment_number) DO UPDATE SET
        ${updateSet}
    `);
    await client.query('COMMIT');
    console.log(`   ✅ Merge complete (rowCount=${merge.rowCount}, ${((Date.now() - tMerge0) / 1000).toFixed(1)}s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  console.log('\n6️⃣  Refreshing materialized view pdg_program_yearly...');
  const tMV = Date.now();
  await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY pdg_program_yearly');
  console.log(`   ✅ Refreshed (${((Date.now() - tMV) / 1000).toFixed(1)}s).`);

  console.log('\n7️⃣  Updating ingest metadata...');
  await writeMeta(client, {
    last_modified: head.lastModified,
    last_ingested_at: new Date(),
    last_ingested_row_count: counters.accepted_rows,
    last_ingest_mode: mode,
    source_etag: head.etag,
  });
  console.log('   ✅ Meta updated');

  if (rejectedStream) await closeStream(rejectedStream);
  return {
    skipped: false,
    counters,
    copyMs,
    totalMs: Date.now() - t0,
    cachedPath: LOCAL_SOURCE_PATH,
    cachedBytes: downloadResult.bytes,
  };
}

function coerceDateOrCount(s, counters) {
  if (s == null || s === '') return null;
  const v = coerceDate(s);
  if (v === null && String(s).trim() !== '' && String(s).trim().toLowerCase() !== 'n/a'
      && String(s).trim().toLowerCase() !== 'ongoing') {
    counters.rejected_date_parse += 1;
  }
  return v;
}

function coerceNumericOrCount(s, counters) {
  if (s == null || s === '') return null;
  const v = coerceNumeric(s);
  if (v === null && String(s).trim() !== '' && String(s).trim().toLowerCase() !== 'n/a') {
    counters.rejected_value_parse += 1;
  }
  return v;
}

function closeStream(stream) {
  return new Promise((resolve) => {
    stream.end(resolve);
  });
}

// ============================================================================
// INGEST: NAICS LABELS
// ============================================================================

async function ingestNaics(client) {
  console.log('\n🚀 Loading NAICS labels from StatsCan...\n');
  console.log(`1️⃣  Fetching ${NAICS_URL}`);

  const source = await openSourceStream(NAICS_URL);
  const rows = [];

  await pipeline(
    source,
    csvParse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, trim: true }),
    new Transform({
      writableObjectMode: true,
      readableObjectMode: true,
      transform(row, _enc, cb) {
        // StatsCan column names vary by export. Common shapes:
        //   Code, Level, English Class title (NAICS-2022 Structure)
        //   Code, Level, Class title
        // Heuristic: find a 'code' key (any case) and a 'title' or 'class' key.
        const codeKey = Object.keys(row).find((k) => /^code$/i.test(k));
        const titleKey = Object.keys(row).find((k) => /class\s*title|title|description/i.test(k));
        if (!codeKey || !titleKey) return cb(); // skip header noise rows

        const code = String(row[codeKey] ?? '').trim();
        const label = String(row[titleKey] ?? '').trim();
        if (!code || !label || !/^\d+$/.test(code)) return cb(); // skip non-numeric codes

        const length = code.length;
        if (length !== 2 && length !== 3) return cb(); // v1 keeps only 2/3-digit

        rows.push({ code, length, label_en: label });
        cb();
      },
    }),
  );

  console.log(`   Parsed ${rows.length} candidate NAICS rows (2- and 3-digit only)`);

  console.log('\n2️⃣  Upserting into naics_labels...');
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const parent_code = row.length === 3 ? row.code.slice(0, 2) : null;
    const r = await client.query(`
      INSERT INTO naics_labels (code, length, label_en, parent_code)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET
        length = EXCLUDED.length,
        label_en = EXCLUDED.label_en,
        parent_code = EXCLUDED.parent_code,
        updated_at = NOW()
      RETURNING xmax = 0 AS inserted
    `, [row.code, row.length, row.label_en, parent_code]);
    if (r.rows[0]?.inserted) inserted += 1;
    else updated += 1;
  }
  console.log(`   ✅ NAICS load complete: ${inserted} inserted, ${updated} updated`);
  return { inserted, updated };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { mode, dryRun, redownload } = parseArgs();

  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error('❌ DATABASE_URL or POSTGRES_URL must be set.');
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  // Dedicated Client (not pool) so we can disable statement_timeout for the
  // long-running COPY + INSERT...SELECT + REFRESH CONCURRENTLY pipeline.
  // Shared pool at src/database/connection.js:45 caps statements at 30s.
  const client = new pg.Client({
    connectionString: dbUrl,
    statement_timeout: 0,
    ssl: dbUrl.includes('neon.tech') || dbUrl.includes('railway.app') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });

  let result;
  try {
    console.log('🔌 Connecting...');
    await client.connect();
    console.log('   ✅ Connected');

    if (mode === 'naics-only') {
      result = await ingestNaics(client);
    } else {
      result = await ingestGrants(client, { mode, dryRun, redownload });
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Ingest complete');
    console.log('='.repeat(60));
    if (result.counters) {
      console.log('\nFinal counters:');
      for (const [k, v] of Object.entries(result.counters)) {
        console.log(`   ${k.padEnd(28)} ${typeof v === 'number' ? v.toLocaleString() : v}`);
      }
    }
    if (result.totalMs) {
      console.log(`\nTotal runtime: ${(result.totalMs / 1000).toFixed(1)}s`);
    }
    if (result.skipped) {
      console.log('   (no-op: source unchanged)');
    }
    if (result.cachedPath) {
      console.log(`\nCached source: ${result.cachedPath} (${formatBytes(result.cachedBytes)}) — delete to force re-download next run, or pass --redownload.`);
    }
  } catch (err) {
    const ts = new Date().toISOString();
    const entry = `[${ts}] ${err.stack || err.message}\n`;
    try { await fs.appendFile(ERROR_LOG_PATH, entry); } catch {}
    console.error(`\n❌ Fatal: ${err.message}`);
    console.error(`   See ${ERROR_LOG_PATH} for the full stack.`);
    process.exitCode = 1;
  } finally {
    try { await client.query('DROP TABLE IF EXISTS pdg_stage'); } catch {}
    try { await client.end(); } catch {}
  }
}

main();

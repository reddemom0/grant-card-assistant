#!/usr/bin/env node
/**
 * Dry run of the GetGranted Pulse weekly digest. Writes nothing; sends nothing
 * unless --send-to names one person.
 *
 *   railway run node scripts/pulse-digest-check.mjs [--week 2026-09-28] [--send-to you@granted.ca]
 *   railway run node scripts/pulse-digest-check.mjs --week 2026-09-28 --live
 *
 * --live is NOT a dry run: it is the real Monday run for that finished week —
 * card to everyone in PULSE_DIGEST_SUBSCRIBERS, the "Digest YYYY-MM-DD" tab
 * written, the week claimed. It refuses a week already claimed (no double
 * send), a week not yet finished, and --send-to. It prints who got it and the tab.
 *
 * --week is the Monday of the week to show; default is last week, as the live
 * Monday run would use. Builds the digest exactly as src/services/pulse-digest.js
 * does — usage, the one Haiku themes call, grant matches named from Oracle's
 * gg3_grants copy, the errors sheet's issues — and prints the DM and the detail
 * tab it would write.
 *
 * Reads: the gg3 ops DB (GG3_OPS_DB_READONLY_URL), Oracle's DB (grant names, the
 * sheet owner's Google login) and the errors sheet. Never claims the week in
 * pulse_alert_state, never writes the sheet or its tab. Calls the model once
 * (Haiku), only when there were client chats.
 *
 * --send-to <email> also DMs the digest card to that one person, through the
 * normal subscriber lookup and delivery (@granted.ca only; they must have
 * messaged Oracle in Chat once). Its title says it's a test, and its button
 * opens the sheet (no tab is written). Without it nothing is posted. The
 * printout below is the plain-text form; the DM itself is the card.
 *
 * Under `railway run`, DATABASE_URL is Railway's private address, which this
 * machine can't reach; DATABASE_PUBLIC_URL is used instead when present.
 * The printed questions are the model's anonymised rewrites — no original
 * client text is printed.
 */

if (/\.railway\.internal\b/.test(process.env.DATABASE_URL || '') && process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
  // connection.js turns SSL on for production; the public proxy needs it.
  process.env.NODE_ENV = 'production';
}

const D = await import('../src/services/pulse-digest.js');
const { isGg3OpsConfigured, getGg3OpsPool } = await import('../src/services/gg3-ops-db.js');
const { SHEET_ENV } = await import('../src/services/pulse-errors-sheet.js');

function parseSendTo(argv) {
  const i = argv.indexOf('--send-to');
  if (i === -1) return null;
  const email = argv[i + 1];
  if (!email || email.startsWith('--')) {
    console.error('--send-to needs an email address');
    process.exit(2);
  }
  return email.trim();
}

function parseWeek(argv) {
  const i = argv.indexOf('--week');
  if (i === -1) return D.previousWeek(new Date());
  const monday = argv[i + 1];
  if (!D.isMonday(monday)) {
    console.error('--week must be a Monday, as YYYY-MM-DD');
    process.exit(2);
  }
  return monday;
}

/**
 * --live: the real Monday run for one finished week — the same runWeeklyDigest
 * the scheduler calls, with "now" set to the Monday 08:00 Vancouver after that
 * week, so the week, the claim key and the tab are exactly what the scheduler
 * would have used (the claim's timestamp records that Monday 08:00).
 */
async function runLive(monday, deps) {
  const claimKey = `weekly_digest:${monday}`;
  const claimed = await deps.oracleQuery('SELECT last_sent_at FROM pulse_alert_state WHERE alert_key = $1', [claimKey]);
  if (claimed.rows.length) {
    console.error(`Refusing: the digest for the week of ${monday} was already sent (${claimKey}, ${new Date(claimed.rows[0].last_sent_at).toISOString()}). Nothing sent, nothing written.`);
    process.exit(3);
  }

  // Record who each DM space belongs to and what was delivered, around the real deps.
  const emailBySpace = new Map();
  const delivered = [];
  let tabGid = null;
  const liveDeps = {
    ...deps,
    getSubscribers: async () => {
      const subs = await deps.getSubscribers();
      subs.forEach(s => emailBySpace.set(s.dmSpace, s.email));
      return subs;
    },
    post: async (space, message) => {
      const ok = await deps.post(space, message);
      delivered.push({ email: emailBySpace.get(space) || space, ok });
      return ok;
    },
    prepareTab: async (userId, args) => {
      const r = await deps.prepareTab(userId, args);
      tabGid = r?.data?.sheet_id ?? null;
      return r;
    }
  };

  const nextMonday = D.addDays(monday, 7);
  const now = new Date(D.vancouverMidnight(nextMonday).getTime() + 8 * 3600000);
  const result = await D.runWeeklyDigest({ now, deps: liveDeps });

  if (result.status === 'skipped') {
    console.error(`Not sent — not configured${result.missing?.length ? `; unset: ${result.missing.join(', ')}` : ''}.`);
    process.exit(1);
  }
  if (result.status === 'already_sent') {
    console.error(`Refusing: the week of ${monday} was claimed while this ran. Nothing sent.`);
    process.exit(3);
  }
  if (result.status === 'no_state_table') {
    console.error('Not sent — pulse_alert_state is missing (migration 040).');
    process.exit(1);
  }

  const sheetId = process.env[SHEET_ENV]?.trim() || null;
  console.log(`Live digest for the week of ${monday} — ${result.status}.`);
  console.log(`  Sent to: ${delivered.filter(d => d.ok).map(d => d.email).join(', ') || 'nobody'}`);
  const failed = delivered.filter(d => !d.ok).map(d => d.email);
  if (failed.length) console.log(`  Not delivered: ${failed.join(', ')}`);
  console.log(`  Tab "${D.tabTitle(monday)}": ${result.tab}${result.tab === 'written' && sheetId ? ` — ${D.tabLink(sheetId, tabGid)}` : ''}`);
  console.log(`  Week claimed: ${claimKey}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live');
  if (live && argv.includes('--send-to')) {
    console.error('--live and --send-to can\'t be used together: --live sends to the weekly list, --send-to is a test to one person.');
    process.exit(2);
  }
  if (live && !argv.includes('--week')) {
    console.error('--live needs --week YYYY-MM-DD (the Monday of the week to send).');
    process.exit(2);
  }
  const monday = parseWeek(argv);
  const sendTo = parseSendTo(argv);
  if (live && D.vancouverMidnight(D.addDays(monday, 7)) > new Date()) {
    console.error(`--live: the week of ${monday} hasn't finished yet.`);
    process.exit(2);
  }

  if (!isGg3OpsConfigured()) {
    console.log('GG3 ops DB: not configured. Set GG3_OPS_DB_READONLY_URL and re-run.');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set — the themes call needs it.');
    process.exit(1);
  }

  const deps = await D.defaultDeps();
  if (live) {
    await runLive(monday, deps);
    await getGg3OpsPool().end();
    process.exit(0);
  }
  const sheetId = process.env[SHEET_ENV]?.trim() || null;
  const sheet = sheetId
    ? await D.readSheetIssues(process.env, deps)
    : { rows: null, code: 'sheet_not_configured' };

  const built = await D.buildDigest({ monday, issueRows: sheet.rows, sheetCode: sheet.code, deps });
  if (!built) {
    console.log('GG3 ops DB: not configured.');
    process.exit(1);
  }

  const { start, end } = D.weekBounds(monday);
  console.log(`Week: ${monday} to ${built.sunday} (America/Vancouver) = ${start.toISOString()} → ${end.toISOString()}`);
  console.log(`  exchanges read:      ${built.exchangesRead} of ${built.exchangesTotal} (newest kept)`);
  console.log(`  themes call:         ${built.themes.status}${built.themes.code ? ` (code ${built.themes.code})` : ''}`);
  console.log(`  grants matched:      ${built.grants.length}`);
  console.log(`  errors sheet:        ${built.errors.ok ? `${built.errors.issues.length} issue(s) this week` : `unavailable (${built.errors.code})`}`);

  console.log('\nWould send:\n');
  const text = D.formatDigest(built, { sheetId });
  console.log(text.split('\n').map(l => `  ${l}`).join('\n'));

  console.log(`\nWould write tab "${D.tabTitle(monday)}" (replacing it if it exists):\n`);
  for (const row of D.digestRows(built)) console.log(`  ${row.join(' | ')}`);

  if (sendTo) {
    const result = await D.sendDigestTest({ email: sendTo, d: built, sheetId, deps });
    console.log(result.sent
      ? `\nTest DM sent to ${sendTo}. No tab written, week not claimed.`
      : `\nTest DM NOT sent to ${sendTo} (${result.code}) — see any warning above: the address must be @granted.ca and the person must have messaged Oracle in Chat once.`);
  }

  await getGg3OpsPool().end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(`Dry run aborted (code: ${err?.code ?? err?.status ?? err?.name ?? 'unknown'})`);
  try { await getGg3OpsPool()?.end(); } catch { /* ignore */ }
  process.exit(1);
});

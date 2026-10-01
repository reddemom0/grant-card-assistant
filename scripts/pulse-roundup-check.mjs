#!/usr/bin/env node
/**
 * Dry run of the GetGranted Pulse morning roundup. Sends nothing.
 *
 *   GG3_OPS_DB_READONLY_URL='postgresql://oracle_readonly:…' \
 *   node scripts/pulse-roundup-check.mjs [--hours 168]
 *
 * Runs steps 1–4 exactly as the live roundup does (src/services/pulse-roundup.js):
 * failed chat turns and the conversations active in the window, staff left out;
 * each conversation read by Haiku; issues grouped; clients named through
 * ai-api-backend when AI_API_BACKEND_URL / AI_API_BACKEND_TOKEN are set.
 * Prints the DM it would send.
 *
 * Never reads or writes the errors sheet (so nothing shows "seen before"),
 * never touches pulse_alert_state or Oracle's own DB, never posts to Chat.
 * Calls the model: up to 51 Haiku requests. No client message text is printed.
 */

import { buildRoundup, formatRoundup, collectErrors, collectConversations, fetchCompanyName, WINDOW_HOURS } from '../src/services/pulse-roundup.js';
import { getGg3OpsPool, isGg3OpsConfigured } from '../src/services/gg3-ops-db.js';

function parseHours(argv) {
  const i = argv.indexOf('--hours');
  if (i === -1) return WINDOW_HOURS;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error('--hours must be a positive whole number');
    process.exit(2);
  }
  return n;
}

async function main() {
  const hours = parseHours(process.argv.slice(2));

  if (!isGg3OpsConfigured()) {
    console.log('GG3 ops DB: not configured. Set GG3_OPS_DB_READONLY_URL and re-run.');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set — the conversation review needs it.');
    process.exit(1);
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const built = await buildRoundup({
    hours,
    existingRows: [],
    deps: {
      collectErrors: (h) => collectErrors(h),
      collectConversations: (h) => collectConversations(h),
      createMessage: (params, opts) => anthropic.messages.create(params, opts),
      fetchProfile: (id) => fetchCompanyName(id)
    }
  });

  const lookup = built.clientLookup;
  console.log(`Window: last ${hours} hours (staff excluded)`);
  console.log(`  failed chat turns:              ${built.errors}`);
  console.log(`  conversations reviewed:         ${built.conversations}${built.conversations === 50 ? ' (capped at 50)' : ''}`);
  console.log(`  went badly:                     ${built.flagged}`);
  console.log(`  reviews that failed:            ${built.failedReviews}`);
  console.log(`  grouped by:                     ${built.grouped}${built.groupCode ? ` (fell back — code ${built.groupCode})` : ''}`);
  console.log(`  client lookup:                  ${lookup.named} named, ${lookup.ref} as "a client ·…" — HTTP/status: ${JSON.stringify(lookup.statuses)}`);

  if (!built.issues.length) {
    console.log('\nWould NOT send — nothing went wrong for a client in the window.');
  } else {
    const text = formatRoundup(
      built.issues.map(i => ({ ...i, seenBefore: false, beingFixed: false })),
      { sheetId: process.env.PULSE_ERRORS_SHEET_ID?.trim() || null, hours }
    );
    console.log('\nWould send:\n');
    console.log(text.split('\n').map(l => `  ${l}`).join('\n'));
    console.log(`\nWould write ${built.issues.length} issue(s) to the errors sheet (dry run: sheet not read, so none shows "seen before").`);
  }
  if (hours !== WINDOW_HOURS) console.log(`\n(The live roundup looks back ${WINDOW_HOURS} hours; this run used ${hours}.)`);

  await getGg3OpsPool().end();
}

main().catch(async (err) => {
  console.error(`Dry run aborted (code: ${err?.code ?? err?.status ?? err?.name ?? 'unknown'})`);
  try { await getGg3OpsPool()?.end(); } catch { /* ignore */ }
  process.exit(1);
});

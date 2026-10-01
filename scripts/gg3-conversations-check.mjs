#!/usr/bin/env node
/**
 * Dry run of Oracle's GetGranted conversation tool (src/tools/gg3-conversations.js).
 * Writes nothing.
 *
 *   GG3_OPS_DB_READONLY_URL='postgresql://oracle_readonly:…' ANTHROPIC_API_KEY=… \
 *   node scripts/gg3-conversations-check.mjs --mode read|search|troubleshoot \
 *     [--client ·abcd] [--name "Acme"] [--terms "hiring,wage subsidy"] [--days N] \
 *     [--failed-only] [--complaint "..."] [--grants "BC Hiring Boost,1856"] \
 *     [--question "what Chris would ask"] [--no-model] [--raw]
 *
 * Runs the mode exactly as Oracle would, against live ops data, then (unless
 * --no-model) one Sonnet 5.5 call with Oracle's "GetGranted client
 * conversations" prompt section prints the answer Oracle would give.
 *
 * Without --client/--name, read and troubleshoot use the client with the most
 * recent conversation (only its ·ref is printed). log_issue is never run; a
 * search over 10 results prints "would create a sheet" instead of creating one.
 * The errors sheet is read (troubleshoot) only when PULSE_ERRORS_SHEET_ID and
 * PULSE_SHEET_OWNER_EMAIL are set and DATABASE_URL reaches Oracle's DB.
 * Optional: AI_API_BACKEND_URL/_TOKEN (company names), GG3_AI_SERVICE_URL and
 * GG3_REVIEW_FEED_TOKEN (match explanations).
 *
 * Output contains client message text (that is the point); --raw prints the
 * full tool result too. Keep it in your terminal.
 */

import fs from 'fs';
import { runGg3Conversations, fetchMatchExplain } from '../src/tools/gg3-conversations.js';
import { fetchCompanyName } from '../src/services/pulse-roundup.js';
import { gg3OpsQuery, getGg3OpsPool, isGg3OpsConfigured } from '../src/services/gg3-ops-db.js';
import { wrapToolOutput, UNTRUSTED_DATA_INSTRUCTION } from '../src/claude/tool-output.js';

const MODEL = 'claude-sonnet-5-5';

function args(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i === -1 ? undefined : argv[i + 1]; };
  const listOf = (v) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined);
  return {
    mode: get('--mode'),
    client: get('--client'),
    name: get('--name'),
    terms: listOf(get('--terms')),
    days: get('--days') ? Number(get('--days')) : undefined,
    failed_only: argv.includes('--failed-only') || undefined,
    complaint: get('--complaint'),
    grants: listOf(get('--grants')),
    question: get('--question'),
    noModel: argv.includes('--no-model'),
    raw: argv.includes('--raw')
  };
}

const DEFAULT_QUESTIONS = {
  read: 'What did this client ask recently, and did anything go wrong?',
  search: 'Who asked about this?',
  troubleshoot: 'This client reported a problem. What is the likely cause, who owns it, and what should we do?'
};

function promptSection() {
  const md = fs.readFileSync(new URL('../.claude/agents/internal-oracle.md', import.meta.url), 'utf8');
  const start = md.indexOf('### GetGranted client conversations');
  if (start === -1) return '';
  const end = md.indexOf('\n### ', start + 5);
  return md.slice(start, end === -1 ? undefined : end).trim();
}

async function mostRecentClient() {
  const r = await gg3OpsQuery('SELECT user_id FROM conversations ORDER BY updated_at DESC LIMIT 1');
  return r.rows?.[0]?.user_id || null;
}

async function deps() {
  const [{ query }, sheets] = await Promise.all([
    import('../src/database/connection.js'),
    import('../src/tools/google-sheets.js')
  ]);
  const { searchGrantData, GG3_VISIBLE_STATUSES } = await import('../src/tools/grant-data.js');
  const never = (what) => async () => { throw new Error(`dry run: ${what} is never written`); };
  return {
    userId: null,
    chatContext: { surface: 'none' },
    env: process.env,
    now: () => new Date(),
    runQuery: gg3OpsQuery,
    oracleQuery: query,
    fetchProfile: (id) => fetchCompanyName(id),
    explain: (a) => fetchMatchExplain(a),
    findGrant: async (name) => {
      const r = await searchGrantData({ query: name, status: GG3_VISIBLE_STATUSES, limit: 3 });
      const top = (r?.results || []).find(x => x.named_match) || (r?.results?.length === 1 ? r.results[0] : null);
      return top ? { id: Number(top.id), name: top.name } : null;
    },
    writeSheet: async (_userId, content) => {
      console.log(`(dry run) would create sheet "${content.title}" with ${content.tables[0].rows.length} rows in the asker's Drive`);
      return { url: '(dry run — no sheet created)', title: content.title, id: null };
    },
    readSheet: sheets.readSheetRange,
    updateSheet: never('the errors sheet'),
    appendSheet: never('the errors sheet')
  };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!['read', 'search', 'troubleshoot'].includes(a.mode)) {
    console.error('--mode must be read, search or troubleshoot (log_issue is never run here)');
    process.exit(2);
  }
  if (!isGg3OpsConfigured()) {
    console.log('GG3 ops DB: not configured. Set GG3_OPS_DB_READONLY_URL and re-run.');
    process.exit(1);
  }
  if (!a.noModel && !process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set. Set it, or pass --no-model.');
    process.exit(1);
  }

  const input = { mode: a.mode, client: a.client, name: a.name, terms: a.terms, days: a.days, failed_only: a.failed_only, complaint: a.complaint, grants: a.grants };
  if (a.mode !== 'search' && !a.client && !a.name) {
    const id = await mostRecentClient();
    if (!id) { console.log('No conversations in the ops DB.'); return; }
    input.client = id;
    console.log(`(no --client) using the most recent client: ·${id.slice(-4)}`);
  }
  if (a.mode === 'search' && !a.terms) input.terms = ['grant'];

  const t0 = Date.now();
  const result = await runGg3Conversations(input, { deps: await deps() });
  console.log(`\n== ${a.mode} in ${Date.now() - t0} ms`);
  const summary = {
    client: result.client, company: result.company ?? null, reason: result.reason, message: result.message, error: result.error,
    conversations: result.conversations?.length, matches: result.matches, clients: result.clients,
    grants_named: result.grants_named, matching_run: result.matching?.run ?? undefined,
    match_explanations: result.match_explanations?.map(e => e.unavailable || e.verdict?.kind),
    errors_sheet: result.errors_sheet && (result.errors_sheet.unavailable || `${result.errors_sheet.issues.length} issues`),
    sheet: result.sheet
  };
  console.log(JSON.stringify(summary, (k, v) => (v === undefined ? undefined : v), 2));
  if (a.raw) console.log(`\n== raw tool result\n${JSON.stringify(result, null, 2)}`);

  if (!a.noModel) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const question = a.question || DEFAULT_QUESTIONS[a.mode];
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: [
        'You are Oracle, Granted Consulting\'s internal assistant, answering a teammate in Google Chat. Plain words, short.',
        promptSection(),
        UNTRUSTED_DATA_INSTRUCTION
      ].join('\n\n'),
      messages: [{
        role: 'user',
        content: `${question}\n\n(Dry run: here is what the GetGranted conversation lookup returned for ${JSON.stringify(input)}.)\n\n${wrapToolOutput('gg3_conversations', result)}`
      }]
    });
    const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    console.log(`\n== Oracle would say (to: "${question}")\n${text}`);
  }
}

main()
  .catch((err) => {
    console.error(`❌ dry run failed — code: ${err?.status ?? err?.code ?? err?.name ?? 'unknown'}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await getGg3OpsPool()?.end(); } catch { /* ignore */ }
    try { const { default: pool } = await import('../src/database/connection.js'); await pool?.end?.(); } catch { /* ignore */ }
  });

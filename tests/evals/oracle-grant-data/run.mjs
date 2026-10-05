#!/usr/bin/env node
/**
 * Oracle grant-data eval — re-runnable, read-only.
 *
 * Sends each question in questions.json through the real internal-oracle agent
 * (runAgent, headless, the Google Chat handler's call shape), scores the answer
 * with rule checks (checks.mjs) and a grader model, and writes
 * report-<date>-<HHMM>.md plus runs-<date>-<HHMM>.json next to this file (UTC start
 * time, so repeat runs on the same day don't overwrite each other).
 *
 *   node tests/evals/oracle-grant-data/run.mjs            # all questions
 *   node tests/evals/oracle-grant-data/run.mjs --only 9,12
 *   EVAL_GRADER_MODEL=claude-sonnet-4-6 (default)
 *
 * Nothing is written, three ways:
 *   1. every database connection is read-only (default_transaction_read_only=on,
 *      checked before any question runs);
 *   2. hooks.mjs swaps the executor (read tools only; everything else refused and
 *      logged), message storage, the team-notes audit row and the cost row for
 *      stubs;
 *   3. LEAD_GEN_TEST_MODE=true, the HubSpot write guards scripts/test-etg-pass.mjs uses.
 * Runs as a test user with no account (userId null), so OAuth-backed reads —
 * Drive, Sheets, Calendar, Chat history — are unavailable.
 */

process.env.LEAD_GEN_TEST_MODE = 'true';

import { register } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
config({ path: path.join(ROOT, '.env') });

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
const dbUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = `${dbUrl}${dbUrl.includes('?') ? '&' : '?'}options=-c%20default_transaction_read_only%3Don`;

register('./hooks.mjs', import.meta.url);

const GRADER_MODEL = process.env.EVAL_GRADER_MODEL || 'claude-sonnet-4-6';

// Any write that slips past the stubs fails on the read-only session with
// SQLSTATE 25006; count them so the report can prove none happened.
const readOnlyRejections = [];
for (const level of ['error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(a => (a instanceof Error ? `${a.code ?? ''} ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (/25006|read-only transaction/i.test(line)) readOnlyRejections.push(line.slice(0, 300));
    original(...args);
  };
}

const { runAgent } = await import(pathToUrl('src/claude/client.js'));
const { query, closePool } = await import(pathToUrl('src/database/connection.js'));
const { calculateRequestCost } = await import(pathToUrl('src/config/cost-settings.js'));
const { READ_TOOLS } = await import('./stubs/executor.mjs');
const { runChecks } = await import('./checks.mjs');
const { default: Anthropic } = await import('@anthropic-ai/sdk');

function pathToUrl(rel) {
  return new URL(`file://${path.join(ROOT, rel)}`).href;
}

// ---------------------------------------------------------------------------

function onlyIds() {
  const i = process.argv.indexOf('--only');
  if (i === -1) return null;
  return new Set(String(process.argv[i + 1] || '').split(',').map(Number).filter(Boolean));
}

function serverTools(messages) {
  const uses = new Map();
  const out = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'server_tool_use') uses.set(b.id, { tool: b.name, input: b.input });
      else if (/_tool_result$/.test(b.type) && uses.has(b.tool_use_id)) out.push({ ...uses.get(b.tool_use_id), result: b.content });
    }
  }
  for (const [id, u] of uses) if (!out.some(o => o.tool === u.tool && o.input === u.input)) out.push({ ...u, result: null, id });
  return out;
}

/** What the grader sees of the tool trace: names, inputs, and grant_data essentials. */
function traceForGrader(trace) {
  const lines = [];
  for (const c of trace.calls) {
    if (c.blocked) { lines.push(`- ${c.tool} (BLOCKED in eval)`); continue; }
    if (c.tool === 'grant_data' && c.result?.success) {
      const r = c.result;
      const results = (r.results || []).map(x => ({
        id: x.id, name: x.name, status: x.status, deadline: x.deadline, amount: x.amount,
        gg1: x.gg1, status_mismatch: x.status_mismatch, named_match: x.named_match, links: x.links, summary: x.summary
      }));
      lines.push(`- grant_data ${JSON.stringify(c.input)} → total ${r.total_matches}, hidden ${r.hidden_matches}, not_found ${JSON.stringify(r.not_found ?? [])}, other_status ${JSON.stringify(r.other_status_matches ?? null)}, results ${JSON.stringify(results)}`.slice(0, 6000));
    } else {
      lines.push(`- ${c.tool} ${JSON.stringify(c.input).slice(0, 200)} → ${JSON.stringify(c.result).slice(0, 400)}`);
    }
  }
  for (const s of trace.serverTools) lines.push(`- ${s.tool} ${JSON.stringify(s.input).slice(0, 200)} (server tool)`);
  return lines.join('\n') || '(no tool calls)';
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function grade(question, answer, trace) {
  const system = `You grade answers from Oracle, Granted Consulting's internal assistant, to questions about grant programs. Oracle searches a copy of the GG3 (GetGranted) platform; GG1 is the older system, shown only as a status on linked grants.
Grade ONLY against the rubric and expected facts. Be strict on facts, links and the rubric's explicit requirements; don't penalise style or length.
Reply with JSON only: {"pass": true|false, "reason": "<one line, under 30 words>"}`;
  const user = `QUESTION:\n${question.question}\n\nRUBRIC:\n${question.rubric}\n\nEXPECTED FACTS (live data, ${new Date().toISOString().slice(0, 10)}):\n${JSON.stringify(question.expected)}\n\nTOOL CALLS ORACLE MADE:\n${traceForGrader(trace)}\n\nORACLE'S ANSWER:\n${answer || '(empty)'}`;
  // Room to spare: a reply cut off mid-JSON can't be read (Q19, 2026-10-05).
  const res = await anthropic.messages.create({ model: GRADER_MODEL, max_tokens: 1024, system, messages: [{ role: 'user', content: user }] });
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const cost = calculateRequestCost(res.usage, GRADER_MODEL);
  // A reply that can't be read is the grader's failure, not Oracle's.
  const graderError = (why) => ({ pass: false, error: true, reason: `grader error (${why}): ${text.slice(0, 120)}`, cost });
  if (res.stop_reason === 'max_tokens') return graderError('reply cut off');
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) return graderError('no JSON');
  try {
    const parsed = JSON.parse(json[0]);
    if (typeof parsed.pass !== 'boolean') return graderError('no pass verdict');
    return { pass: parsed.pass, reason: String(parsed.reason ?? '').trim(), cost };
  } catch {
    return graderError('JSON did not parse');
  }
}

async function runQuestion(question) {
  globalThis.__oracleEval = { calls: [], blocked: [], messages: [], models: [] };
  const conversationId = randomUUID();
  let oracleCost = 0;
  const started = Date.now();
  let result;
  try {
    result = await runAgent({
      agentType: 'internal-oracle',
      message: question.question,
      conversationId,
      userId: null,
      sessionId: randomUUID(),
      attachments: [],
      res: null,
      onCostCalculated: (cost) => { oracleCost += typeof cost === 'number' ? cost : (cost?.totalCost ?? 0); },
      chatContext: {
        surface: 'chat_dm',
        spaceName: null,
        spaceDisplayName: 'Oracle eval (DM)',
        senderChatId: null,
        senderDisplayName: 'Eval',
        messageName: null,
        threadName: null,
        mentions: [],
        driveFiles: [],
        attachmentNames: [],
        messageText: question.question
      }
    });
  } catch (err) {
    result = { success: false, error: err.message };
  }
  const log = globalThis.__oracleEval;
  const answer = (result?.response?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const trace = { calls: log.calls, serverTools: serverTools(log.messages) };
  const checks = runChecks(question, answer, trace);
  const graded = result?.success ? await grade(question, answer, trace) : { pass: false, reason: `agent failed: ${result?.error}`, cost: 0 };
  const failedChecks = Object.entries(checks).filter(([, c]) => c.status === 'fail').map(([k]) => k);
  return {
    id: question.id,
    category: question.category,
    question: question.question,
    conversationId,
    agentSuccess: !!result?.success,
    agentError: result?.success ? null : result?.error,
    // Noted by the cost stub on every agent-loop call (stubs/api-cost-events.mjs).
    model: [...new Set(log.models)].join(', ') || null,
    answer,
    checks,
    failedChecks,
    grader: { pass: graded.pass, error: !!graded.error, reason: graded.reason },
    // An agent failure or a failed rule check is a fail whatever the grader did;
    // only when everything else passed does a broken grader reply mean "grader error".
    result: !result?.success || failedChecks.length ? 'fail' : graded.error ? 'grader_error' : graded.pass ? 'pass' : 'fail',
    pass: !!result?.success && failedChecks.length === 0 && graded.pass,
    oracleCost,
    graderCost: graded.cost,
    runtimeMs: Date.now() - started,
    tools: [...trace.calls.map(c => (c.blocked ? `${c.tool}(blocked)` : c.tool)), ...trace.serverTools.map(s => s.tool)],
    blocked: log.blocked,
    trace
  };
}

// ---------------------------------------------------------------------------

const RESULT_LABEL = { pass: 'PASS', fail: 'FAIL', grader_error: 'GRADER ERROR' };

/** The models Oracle answered with, as the API reported them. */
const oracleModels = (runs) => [...new Set(runs.map(r => r.model).filter(Boolean))];

function report({ runs, started, totalMs, subset }) {
  const date = new Date().toISOString().slice(0, 10);
  const passed = runs.filter(r => r.pass).length;
  const graderErrors = runs.filter(r => r.result === 'grader_error');
  const graded = runs.length - graderErrors.length;
  const oracle = runs.reduce((a, r) => a + r.oracleCost, 0);
  const grader = runs.reduce((a, r) => a + r.graderCost, 0);
  const blocked = runs.flatMap(r => r.blocked.map(b => `Q${r.id}: ${b.tool}`));
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  const L = [];
  L.push(`# Oracle grant-data eval — ${date}`);
  L.push('');
  L.push(`**Pass rate:** ${passed}/${graded} graded (${Math.round((100 * passed) / (graded || 1))}%)${graderErrors.length ? ` — ${graderErrors.length} grader error${graderErrors.length === 1 ? '' : 's'} (${graderErrors.map(r => `Q${r.id}`).join(', ')})` : ''}${subset ? ` — subset: ${[...subset].join(', ')}` : ''}`);
  L.push(`**Oracle model:** ${oracleModels(runs).join(', ') || 'unknown'}`);
  L.push(`**Cost:** $${(oracle + grader).toFixed(2)} (Oracle $${oracle.toFixed(2)}, grader $${grader.toFixed(2)} on ${GRADER_MODEL})`);
  L.push(`**Started:** ${started.toISOString()} · **Runtime:** ${(totalMs / 60000).toFixed(1)} min`);
  L.push('');
  L.push('**Read-only proof**');
  L.push(`- Database session: default_transaction_read_only = on (checked before the first question)`);
  L.push(`- Side-effect tool calls blocked: ${blocked.length ? blocked.join(', ') : 'none attempted'}`);
  L.push(`- Writes rejected by the read-only session (SQLSTATE 25006): ${readOnlyRejections.length}${readOnlyRejections.length ? ` — ${readOnlyRejections.slice(0, 5).map(esc).join(' · ')}` : ''}`);
  L.push('- Messages, the team-notes audit row and cost rows go to in-memory stubs; nothing reaches the messages table.');
  L.push('- Test user has no account: OAuth-backed reads (Drive, Sheets, Calendar, Chat history) are unavailable.');
  L.push('');
  L.push('A question passes when every applicable rule check passes and the grader passes. A grader reply that can\'t be read is a grader error, left out of the pass rate.');
  L.push('');
  L.push('| # | Category | Result | Failed checks | Grader | Cost | Tools |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of runs) {
    L.push(`| ${r.id} | ${r.category} | ${RESULT_LABEL[r.result] ?? (r.pass ? 'PASS' : 'FAIL')} | ${r.failedChecks.join(', ') || '—'} | ${r.grader.error ? 'error' : r.grader.pass ? 'pass' : 'fail'}: ${esc(r.grader.reason)} | $${(r.oracleCost + r.graderCost).toFixed(3)} | ${esc([...new Set(r.tools)].join(', ')) || '—'} |`);
  }
  if (graderErrors.length) {
    L.push('');
    L.push('## Grader errors');
    L.push('');
    L.push('Every rule check passed; the grader\'s reply couldn\'t be read, so these are not scored.');
    for (const r of graderErrors) L.push(`- **Q${r.id}** (${r.category}): ${esc(r.grader.reason)}`);
  }
  const failures = runs.filter(r => r.result === 'fail');
  if (failures.length) {
    L.push('');
    L.push('## Failures');
    for (const r of failures) {
      L.push('');
      L.push(`### Q${r.id} (${r.category}): ${r.question}`);
      if (!r.agentSuccess) L.push(`- **Agent error:** ${esc(r.agentError)}`);
      for (const k of r.failedChecks) L.push(`- **${k}:** ${esc(r.checks[k].reason)}`);
      if (!r.grader.pass) L.push(`- **Grader:** ${esc(r.grader.reason)}`);
      L.push('');
      L.push('> ' + (r.answer || '(no answer)').slice(0, 1200).replace(/\n/g, '\n> '));
    }
  }
  L.push('');
  L.push('## Rule checks, all questions');
  L.push('');
  L.push('| # | links | no_internal_names | no_total_count | mismatch_both_shown | freshness_checked | no_false_absence |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const c = r.checks;
    L.push(`| ${r.id} | ${['links', 'no_internal_names', 'no_total_count', 'mismatch_both_shown', 'freshness_checked', 'no_false_absence'].map(k => c[k].status).join(' | ')} |`);
  }
  L.push('');
  L.push('Re-run: `node tests/evals/oracle-grant-data/run.mjs` (one question set: `--only 9,12`).');
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------

const ro = (await query('SHOW default_transaction_read_only')).rows[0]?.default_transaction_read_only;
if (ro !== 'on') {
  console.error(`Refusing to run: database session is not read-only (${ro}).`);
  await closePool();
  process.exit(1);
}
console.log(`🔒 Read-only database session confirmed. Read tools allowed: ${READ_TOOLS.size}. Grader: ${GRADER_MODEL}.`);

const { questions } = JSON.parse(await readFile(path.join(HERE, 'questions.json'), 'utf8'));
const subset = onlyIds();
const toRun = subset ? questions.filter(q => subset.has(q.id)) : questions;

const started = new Date();
const runs = [];
for (const q of toRun) {
  console.log(`\n▶︎ Q${q.id} [${q.category}] ${q.question}`);
  const r = await runQuestion(q);
  runs.push(r);
  console.log(`◀︎ Q${q.id} ${RESULT_LABEL[r.result]} — checks failed: ${r.failedChecks.join(', ') || 'none'} — grader: ${r.grader.reason} — $${(r.oracleCost + r.graderCost).toFixed(3)}`);
}
const totalMs = Date.now() - started.getTime();

const date = started.toISOString().slice(0, 10);
const time = started.toISOString().slice(11, 16).replace(':', '');
const suffix = subset ? `-only-${[...subset].join('-')}` : '';
const reportPath = path.join(HERE, `report-${date}-${time}${suffix}.md`);
const runsPath = path.join(HERE, `runs-${date}-${time}${suffix}.json`);
await writeFile(reportPath, report({ runs, started, totalMs, subset }));
await writeFile(runsPath, JSON.stringify({ started, oracleModels: oracleModels(runs), graderModel: GRADER_MODEL, readOnlyRejections, runs }, null, 2));
console.log(`\n📝 Report: ${path.relative(ROOT, reportPath)}\n🗂️  Raw runs: ${path.relative(ROOT, runsPath)}`);
await closePool();
process.exit(0);

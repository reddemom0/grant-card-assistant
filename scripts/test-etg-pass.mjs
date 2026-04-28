#!/usr/bin/env node
/**
 * ETG Manual Test Pass — Trace-Only Runner
 *
 * Runs 12 scripted scenarios against the etg-writer agent via direct
 * runAgent() invocation (bypasses HTTP/auth/SSE), captures conversation IDs,
 * dumps full traces via getConversationToolTrace().
 *
 * Output: scripts/output/etg-test-pass-<timestamp>/{NN-slug.json, SUMMARY.md}
 *
 * SAFETY: sets LEAD_GEN_TEST_MODE=true at the very top so Fix 1's HubSpot
 * write guards intercept any deal/contact/company creation attempts.
 *
 * Usage: node scripts/test-etg-pass.mjs
 */

// CRITICAL: Set test mode BEFORE any module imports — guards in src/tools/hubspot.js
// read process.env.LEAD_GEN_TEST_MODE at call time, but setting it early ensures any
// module-load-time logic also sees it.
process.env.LEAD_GEN_TEST_MODE = 'true';

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runAgent } from '../src/claude/client.js';
import {
  createConversation,
  getConversation,
  getConversationToolTrace,
} from '../src/database/messages.js';
import { getPool } from '../src/database/connection.js';

// ============================================================================
// Scenarios
// ============================================================================

const SCENARIOS = [
  {
    slug: '01-coop-eligibility',
    title: 'Co-op eligibility question',
    watch: 'Does the agent attempt source loading? Does it correctly state co-op students are not excluded per se?',
    turns: [
      'Can co-op students apply for ETG funding?',
    ],
  },
  {
    slug: '02-cost-no-source',
    title: 'Cost question with no source available',
    watch: 'Does the agent attempt verification (web_fetch / web_search) before stating a number? Does it use [UNVERIFIED] flag if it cannot confirm?',
    turns: [
      "What's the typical cost for a Dale Carnegie sales course?",
    ],
  },
  {
    slug: '03-cost-with-url',
    title: 'Cost question with provider URL provided by user',
    watch: 'Does the agent web_fetch the URL and cite the source? Does it pick up the actual tuition from the page?',
    turns: [
      "I'm looking at this Sandler training course: https://www.sandler.com/training/sales-mastery-program/  What's the cost?",
    ],
  },
  {
    slug: '04-parental-leave-eligibility',
    title: 'Eligibility question on a less-covered case (parental leave)',
    watch: 'Does the agent attempt source loading? Does it correctly identify "employed" status applies during parental leave, or fabricate a rule?',
    turns: [
      "Can my employee who's currently on parental leave participate in ETG-funded training?",
    ],
  },
  {
    slug: '05-deal-create-new-trainee',
    title: 'Deal creation from scratch (new trainee)',
    watch: 'Pipeline/stage IDs — sourced from a tool call (list_hubspot_owners, deal stages lookup) or hallucinated? Are HubSpot writes guarded by LEAD_GEN_TEST_MODE? Does the agent ask for confirmation before create_hubspot_deal?',
    turns: [
      "Create an ETG deal for Acme Widgets Ltd. The course is Dale Carnegie's Winning with Relationship Selling. Tuition is $2,516.48. Dates September 1 to October 20, 2026. Participant: Test Trainee, testtrainee-newuser@acmewidgets.com, Sales Associate.",
    ],
  },
  {
    slug: '06-deal-create-existing-feeling',
    title: 'Deal creation with existing-feeling trainee',
    watch: 'Does the agent call search_hubspot_contacts BEFORE create_hubspot_contact to check for duplicates?',
    turns: [
      "Create an ETG deal for Beta Industries. The course is BCIT's Project Management Essentials. Tuition is $1,895. Dates April 15 to June 10, 2026. Participant: Sarah Chen, sarah.chen@betaindustries.ca, Operations Manager.",
    ],
  },
  {
    slug: '07-state-check-no-redo',
    title: 'State-check / no-redo on ambiguous follow-up',
    watch: 'After "proceed with the BC alternatives research" — does the agent recognize prior work and continue forward, or redo Q1-Q3 from scratch?',
    turns: [
      'I need to write an ETG business case. Company is Gamma Corp, trainee is John Park (john@gamma.com), Operations Lead. Course is Salesforce Admin Certification at $1,200. Training Sept 1 to Sept 30, 2026.',
      'proceed with the BC alternatives research',
    ],
  },
  {
    slug: '08-priority-framework-applicable',
    title: 'BC priority framework — multiple factors apply',
    watch: 'Does the agent surface multiple priority factors (first-time applicant, small business, healthcare = Look West, BC public post-secondary trainer)?',
    turns: [
      'I need to write an ETG business case. Company is HealthFirst Clinic, a small healthcare provider in Prince George BC with 12 employees. They\'ve never applied for ETG before. Trainee is Maria Lopez, maria@healthfirst.ca, Registered Nurse. Course is a clinical leadership program at the BC Institute of Technology (BCIT). Tuition $3,400. Training March 1 to May 30, 2026.',
    ],
  },
  {
    slug: '09-priority-framework-not-applicable',
    title: 'BC priority framework — none apply (and ineligibility issues)',
    watch: 'Does the agent force-fit factors? Does it flag the >$10K cost framing, retreat-style format, and non-BC provider as eligibility issues?',
    turns: [
      'I need to write an ETG business case. Company is MegaCorp Holdings, a 2,000-person financial services firm headquartered in Vancouver. They\'ve previously received ETG funding twice. Trainee is Thomas Wright, thomas@megacorp.com, Senior Vice President. Course is an executive leadership retreat-style program at a private US-based provider. Tuition $12,500. Training May 1 to May 5, 2026.',
    ],
  },
  {
    slug: '10-self-employed-overlap',
    title: 'Self-employed-as-both-employer-and-participant',
    watch: 'Does Step 2 catch the overlap and surface the conflict-of-interest / routing-to-program flag?',
    turns: [
      "I'm a sole proprietor running a consulting business. I want to apply for ETG to fund training for myself. The course is a Project Management Professional certification through PMI at $4,200. Training February 1 to April 30, 2026.",
    ],
  },
  {
    slug: '11-fiscal-year-boundary',
    title: 'Training spans fiscal year boundary',
    watch: 'Does the agent flag the boundary and route to etg@gov.bc.ca, or invent a rule?',
    turns: [
      'I need ETG funding for a course running March 15, 2026 to June 30, 2026. Company is Delta Manufacturing in Surrey BC. Trainee is Alex Kim, alex@delta.com, Production Supervisor. Course is advanced lean manufacturing at Langara College, $2,800.',
    ],
  },
  {
    slug: '12-non-bc-provider',
    title: 'Non-BC training provider',
    watch: 'Does the agent flag as exceptional-circumstances case and route to etg@gov.bc.ca for confirmation?',
    turns: [
      'I want to do an ETG application for training delivered by a Toronto-based provider — they offer a specialized course we can\'t find anywhere in BC. The course is Cybersecurity Risk Management at SecureSkills Toronto, $5,800. Trainee is Priya Patel, priya@epsilon.com, IT Security Lead at Epsilon Tech in Vancouver. Training July 1 to July 31, 2026.',
    ],
  },
];

// ============================================================================
// Helpers
// ============================================================================

function tsForDirname() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function summarizeTrace(trace) {
  let toolCalls = 0;
  let toolErrors = 0;
  let textBlocks = 0;
  let thinkingBlocks = 0;
  const toolNames = new Set();
  for (const e of trace) {
    if (e.type === 'tool_use' || e.type === 'server_tool_use') {
      toolCalls++;
      if (e.tool_name) toolNames.add(e.tool_name);
    } else if (e.type === 'tool_result' || e.type === 'web_search_tool_result') {
      if (e.is_error) toolErrors++;
    } else if (e.type === 'text') {
      textBlocks++;
    } else if (e.type === 'thinking') {
      thinkingBlocks++;
    }
  }
  return { toolCalls, toolErrors, textBlocks, thinkingBlocks, toolNames: [...toolNames] };
}

function firstAssistantText(trace) {
  for (const e of trace) {
    if (e.role === 'assistant' && e.type === 'text' && e.content) {
      return e.content.slice(0, 300).replace(/\s+/g, ' ').trim();
    }
  }
  return '(no assistant text found)';
}

// ============================================================================
// Main
// ============================================================================

async function runScenario(scenario, outputDir) {
  const conversationId = randomUUID();
  const result = {
    slug: scenario.slug,
    title: scenario.title,
    watch: scenario.watch,
    conversationId,
    turnCount: scenario.turns.length,
    turnsCompleted: 0,
    turnErrors: [],
    totalCostUSD: 0,
    runtimeMs: null,
    traceSummary: null,
  };

  const startMs = Date.now();

  try {
    await createConversation(conversationId, null, 'etg-writer', `[TEST] ${scenario.title}`);
  } catch (err) {
    result.turnErrors.push({ turn: 0, phase: 'createConversation', error: err.message });
    result.runtimeMs = Date.now() - startMs;
    return result;
  }

  for (let i = 0; i < scenario.turns.length; i++) {
    const turnIdx = i + 1;
    const sessionId = randomUUID();
    const message = scenario.turns[i];

    try {
      const turnResult = await runAgent({
        agentType: 'etg-writer',
        message,
        conversationId,
        userId: null,
        sessionId,
        attachments: [],
        res: undefined,
        forceModel: null,
        modelConfig: {},
        onCostCalculated: (cost) => {
          if (typeof cost === 'number') result.totalCostUSD += cost;
          else if (cost && typeof cost.totalCost === 'number') result.totalCostUSD += cost.totalCost;
        },
      });

      result.turnsCompleted++;

      if (turnResult && turnResult.success === false) {
        result.turnErrors.push({ turn: turnIdx, phase: 'runAgent', error: turnResult.error || 'unknown' });
        // Stop further turns if a turn fails — context will be inconsistent.
        break;
      }
    } catch (err) {
      result.turnErrors.push({ turn: turnIdx, phase: 'runAgent-throw', error: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') });
      break;
    }
  }

  result.runtimeMs = Date.now() - startMs;

  // Capture trace
  try {
    const meta = await getConversation(conversationId);
    const trace = await getConversationToolTrace(conversationId);
    result.traceSummary = summarizeTrace(trace);
    result.firstAssistantTextPreview = firstAssistantText(trace);

    const payload = {
      scenario: {
        slug: scenario.slug,
        title: scenario.title,
        watch: scenario.watch,
        turns: scenario.turns,
      },
      run: {
        conversationId,
        turnsCompleted: result.turnsCompleted,
        turnErrors: result.turnErrors,
        totalCostUSD: result.totalCostUSD,
        runtimeMs: result.runtimeMs,
        capturedAt: new Date().toISOString(),
      },
      conversation: meta,
      trace,
    };

    const outFile = path.join(outputDir, `${scenario.slug}.json`);
    await writeFile(outFile, JSON.stringify(payload, null, 2));
  } catch (err) {
    result.turnErrors.push({ turn: -1, phase: 'trace-dump', error: err.message });
  }

  return result;
}

function writeSummary(outputDir, results, totalRuntimeMs) {
  const lines = [];
  lines.push(`# ETG Test Pass — Summary`);
  lines.push('');
  lines.push(`**Output directory:** \`${outputDir}\``);
  lines.push(`**Run started:** ${new Date(Date.now() - totalRuntimeMs).toISOString()}`);
  lines.push(`**Total runtime:** ${(totalRuntimeMs / 1000).toFixed(1)}s`);
  lines.push(`**LEAD_GEN_TEST_MODE:** ${process.env.LEAD_GEN_TEST_MODE === 'true' ? 'TRUE (HubSpot writes intercepted)' : 'FALSE — WARNING: LIVE WRITES POSSIBLE'}`);
  const totalCost = results.reduce((a, r) => a + (r.totalCostUSD || 0), 0);
  if (totalCost > 0) lines.push(`**Total cost (rough):** $${totalCost.toFixed(4)}`);
  lines.push('');
  lines.push(`## Scenarios`);
  lines.push('');

  for (const r of results) {
    lines.push(`### ${r.slug} — ${r.title}`);
    lines.push(`- **Conversation ID:** \`${r.conversationId}\``);
    lines.push(`- **Turns:** ${r.turnsCompleted}/${r.turnCount} completed`);
    lines.push(`- **Runtime:** ${r.runtimeMs ? (r.runtimeMs / 1000).toFixed(1) + 's' : 'n/a'}`);
    if (r.totalCostUSD) lines.push(`- **Cost:** $${r.totalCostUSD.toFixed(4)}`);
    if (r.traceSummary) {
      const ts = r.traceSummary;
      lines.push(`- **Trace:** ${ts.toolCalls} tool calls (${ts.toolErrors} errors), ${ts.textBlocks} text blocks, ${ts.thinkingBlocks} thinking blocks`);
      if (ts.toolNames.length) lines.push(`- **Tools used:** ${ts.toolNames.join(', ')}`);
    }
    if (r.firstAssistantTextPreview) {
      lines.push(`- **First assistant text:** "${r.firstAssistantTextPreview}${r.firstAssistantTextPreview.length >= 300 ? '…' : ''}"`);
    }
    lines.push(`- **Watch:** ${r.watch}`);
    if (r.turnErrors.length) {
      lines.push(`- **Errors:**`);
      for (const e of r.turnErrors) {
        lines.push(`  - turn ${e.turn} (${e.phase}): ${e.error}`);
      }
    }
    lines.push('');
  }

  lines.push(`## Errors / blockers`);
  lines.push('');
  const allErrors = results.flatMap(r => r.turnErrors.map(e => ({ slug: r.slug, ...e })));
  if (!allErrors.length) {
    lines.push(`(none)`);
  } else {
    for (const e of allErrors) {
      lines.push(`- **${e.slug}** turn ${e.turn} (${e.phase}): ${e.error}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const ts = tsForDirname();
  const outputDir = path.resolve('scripts/output', `etg-test-pass-${ts}`);
  await mkdir(outputDir, { recursive: true });

  console.log('\n' + '='.repeat(80));
  console.log(`ETG Manual Test Pass — Trace-Only`);
  console.log('='.repeat(80));
  console.log(`Output dir: ${outputDir}`);
  console.log(`LEAD_GEN_TEST_MODE: ${process.env.LEAD_GEN_TEST_MODE}`);
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log('='.repeat(80) + '\n');

  if (process.env.LEAD_GEN_TEST_MODE !== 'true') {
    console.error('❌ LEAD_GEN_TEST_MODE is not set to "true". Aborting to avoid production HubSpot writes.');
    process.exit(1);
  }

  const startMs = Date.now();
  const results = [];

  for (const scenario of SCENARIOS) {
    console.log('\n' + '─'.repeat(80));
    console.log(`▶ ${scenario.slug} — ${scenario.title}`);
    console.log('─'.repeat(80));
    const result = await runScenario(scenario, outputDir);
    results.push(result);
    console.log(`✓ ${scenario.slug} done — ${result.turnsCompleted}/${result.turnCount} turns, ${result.turnErrors.length} errors, ${(result.runtimeMs / 1000).toFixed(1)}s`);
  }

  const totalRuntimeMs = Date.now() - startMs;

  const summary = writeSummary(outputDir, results, totalRuntimeMs);
  await writeFile(path.join(outputDir, 'SUMMARY.md'), summary);

  console.log('\n' + '='.repeat(80));
  console.log(`Run complete — ${results.length} scenarios, ${(totalRuntimeMs / 1000).toFixed(1)}s total`);
  console.log(`Summary: ${path.join(outputDir, 'SUMMARY.md')}`);
  console.log('='.repeat(80) + '\n');
}

main()
  .then(async () => {
    try { await getPool().end(); } catch {}
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ Fatal error:', err);
    try { await getPool().end(); } catch {}
    process.exit(1);
  });

/**
 * Moderate Tier Quality Test Harness
 *
 * Tests whether Haiku+thinking can match Sonnet quality for moderate-complexity queries.
 *
 * Key hypothesis: Can Haiku+thinking handle Oracle's research/enrichment tasks (26% of queries)
 * without noticeable quality degradation?
 *
 * Evaluation focus: ACTIONABILITY - "Would you trust this enough to act on it without checking?"
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { loadAgentPromptCached } from '../src/agents/load-agents.js';
import { getToolsForAgent } from '../src/tools/definitions.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================================================
// TEST QUERIES - Real moderate-tier Oracle queries
// ============================================================================

const moderateTestQueries = [
  // Research queries (pure information gathering)
  "Research Acme Manufacturing in Vancouver - potential CanExport client",
  "Find information about TechStart Solutions - they inquired about SR&ED",
  "Tell me about Green Foods Co-op in BC agriculture sector",

  // Enrichment queries (data gathering)
  "Enrich this lead: FreshPak Innovations, food packaging, 25 employees, Richmond BC",
  "Gather information on this prospect: CloudNative Software, SaaS company, seed stage",
  "Research background on this company: Northern Logistics, freight forwarding",

  // Analysis queries (moderate, not strategic)
  "Analyze this company for basic CanExport eligibility: exports to US, 15 FTE, $800K revenue",
  "Assess this lead: manufacturing company, wants to expand to Europe, 40 employees",
  "Investigate this prospect: AgTech startup, looking for innovation grants",

  // BOUNDARY CASES - Stress the moderate/complex boundary
  // These are where Haiku+thinking is most likely to fall short
  "Research this company and tell me if they're a good fit for IRAP",
  "Enrich these leads and prioritize them for outreach",
  "Analyze this prospect's funding history and recommend next steps",

  // Multi-source gathering (not deep synthesis)
  "Gather details about this company from web and summarize key points",
  "Collect information on BC food processors that might qualify for BCAFE",
  "Find recent news about this company and summarize",
];

// ============================================================================
// CONFIGURATION
// ============================================================================

const TEST_CONFIG = {
  // How many queries to test (set lower for quick tests)
  queriestoTest: process.env.QUICK_TEST ? 3 : moderateTestQueries.length,

  // Output file for results
  outputFile: '/Users/Chris/Downloads/moderate-tier-test-results.json',

  // Model configurations
  models: {
    haiku: {
      model: 'claude-haiku-4-5-20250929',
      thinking: {
        type: 'enabled',
        budget_tokens: 4000
      },
      temperature: 1.0,
      max_tokens: 12000,
    },
    sonnet: {
      model: 'claude-sonnet-4-5-20250929',
      thinking: {
        type: 'enabled',
        budget_tokens: 10000
      },
      temperature: 1.0,
      max_tokens: 16000,
    }
  }
};

// ============================================================================
// TEST EXECUTION
// ============================================================================

/**
 * Run a single query through a model configuration
 */
async function runQuery(query, modelConfig, modelName) {
  const startTime = Date.now();

  try {
    // Load Oracle agent prompt
    const systemPrompt = loadAgentPromptCached('internal-oracle');

    // Get tools (Oracle has HubSpot, Drive, Memory, etc.)
    const tools = getToolsForAgent('internal-oracle');

    console.log(`\n🔄 Running with ${modelName}...`);

    const response = await anthropic.messages.create({
      model: modelConfig.model,
      max_tokens: modelConfig.max_tokens,
      temperature: modelConfig.temperature,
      thinking: modelConfig.thinking,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: query
      }],
      // Note: We're NOT actually executing tools in this test
      // We just want to see how the models approach the task
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema
      }))
    });

    const duration = Date.now() - startTime;

    // Extract response text (skip tool use blocks for now)
    const textBlocks = response.content.filter(b => b.type === 'text');
    const responseText = textBlocks.map(b => b.text).join('\n');

    // Extract thinking if present
    const thinkingBlocks = response.content.filter(b => b.type === 'thinking');
    const thinkingText = thinkingBlocks.map(b => b.thinking).join('\n');

    // Extract tool calls
    const toolCalls = response.content.filter(b => b.type === 'tool_use');

    return {
      success: true,
      responseText,
      thinkingText,
      toolCalls: toolCalls.map(t => ({ name: t.name, input: t.input })),
      duration,
      usage: response.usage,
      stop_reason: response.stop_reason
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      error: error.message,
      duration
    };
  }
}

/**
 * Run all test queries
 */
async function runTests() {
  console.log('='.repeat(80));
  console.log('MODERATE TIER QUALITY TEST');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Testing: ${TEST_CONFIG.queriestoTest} queries`);
  console.log(`Models: Haiku (4k thinking) vs Sonnet (10k thinking)`);
  console.log('');

  const results = [];

  for (let i = 0; i < TEST_CONFIG.queriestoTest; i++) {
    const query = moderateTestQueries[i];

    console.log('='.repeat(80));
    console.log(`TEST ${i + 1}/${TEST_CONFIG.queriestoTest}`);
    console.log('='.repeat(80));
    console.log(`Query: "${query}"`);

    // Run with Haiku
    const haikuResult = await runQuery(query, TEST_CONFIG.models.haiku, 'Haiku+thinking');

    // Small delay between calls
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Run with Sonnet
    const sonnetResult = await runQuery(query, TEST_CONFIG.models.sonnet, 'Sonnet+thinking');

    // Store results
    results.push({
      query,
      haiku: haikuResult,
      sonnet: sonnetResult,
      timestamp: new Date().toISOString()
    });

    // Print summary
    console.log('');
    console.log('📊 SUMMARY:');
    console.log(`Haiku: ${haikuResult.success ? '✅' : '❌'} (${haikuResult.duration}ms)`);
    console.log(`Sonnet: ${sonnetResult.success ? '✅' : '❌'} (${sonnetResult.duration}ms)`);
    console.log('');

    // Small delay before next test
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Save results
  fs.writeFileSync(TEST_CONFIG.outputFile, JSON.stringify(results, null, 2));

  console.log('='.repeat(80));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Results saved to: ${TEST_CONFIG.outputFile}`);
  console.log('');
  console.log('NEXT STEPS:');
  console.log('1. Review the output file');
  console.log('2. For each query pair, evaluate:');
  console.log('   - Completeness: Did it identify the right information to gather?');
  console.log('   - Accuracy: Are the tool calls appropriate?');
  console.log('   - Actionability: Would you trust this enough to act on without checking?');
  console.log('');
  console.log('3. Score each pair on actionability (1-5 scale)');
  console.log('4. If Haiku matches Sonnet in >80% of cases → ship moderate tier');
  console.log('5. If Haiku fails >30% → moderate tier should default to complex');
  console.log('');

  // Generate comparison stats
  const successfulPairs = results.filter(r => r.haiku.success && r.sonnet.success);

  console.log('QUICK STATS:');
  console.log(`Successful pairs: ${successfulPairs.length}/${results.length}`);
  console.log('');

  if (successfulPairs.length > 0) {
    const avgHaikuDuration = successfulPairs.reduce((sum, r) => sum + r.haiku.duration, 0) / successfulPairs.length;
    const avgSonnetDuration = successfulPairs.reduce((sum, r) => sum + r.sonnet.duration, 0) / successfulPairs.length;

    console.log(`Average Haiku duration: ${Math.round(avgHaikuDuration)}ms`);
    console.log(`Average Sonnet duration: ${Math.round(avgSonnetDuration)}ms`);
    console.log(`Speed improvement: ${Math.round((1 - avgHaikuDuration/avgSonnetDuration) * 100)}% faster`);
    console.log('');

    const avgHaikuInputTokens = successfulPairs.reduce((sum, r) => sum + r.haiku.usage.input_tokens, 0) / successfulPairs.length;
    const avgHaikuOutputTokens = successfulPairs.reduce((sum, r) => sum + r.haiku.usage.output_tokens, 0) / successfulPairs.length;
    const avgSonnetInputTokens = successfulPairs.reduce((sum, r) => sum + r.sonnet.usage.input_tokens, 0) / successfulPairs.length;
    const avgSonnetOutputTokens = successfulPairs.reduce((sum, r) => sum + r.sonnet.usage.output_tokens, 0) / successfulPairs.length;

    // Calculate costs (Haiku: $1/M in, $5/M out; Sonnet: $3/M in, $15/M out)
    const avgHaikuCost = (avgHaikuInputTokens * 1 + avgHaikuOutputTokens * 5) / 1000000;
    const avgSonnetCost = (avgSonnetInputTokens * 3 + avgSonnetOutputTokens * 15) / 1000000;

    console.log(`Average Haiku cost: $${avgHaikuCost.toFixed(4)}`);
    console.log(`Average Sonnet cost: $${avgSonnetCost.toFixed(4)}`);
    console.log(`Cost savings: ${Math.round((1 - avgHaikuCost/avgSonnetCost) * 100)}%`);
    console.log('');
  }
}

// ============================================================================
// RUN TESTS
// ============================================================================

console.log('Starting moderate tier quality test...\n');
runTests().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

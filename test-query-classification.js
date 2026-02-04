/**
 * Test Query Classification System
 *
 * Tests the 3-tier classification system with sample queries from each tier
 */

import { classifyQuery, getQueryConfig } from './src/claude/query-classifier.js';

const testCases = [
  // ========================================
  // TIER 1: SIMPLE (Expected: Haiku, no thinking)
  // ========================================
  { query: "hi", expected: "simple", description: "Greeting" },
  { query: "hello", expected: "simple", description: "Greeting" },
  { query: "thanks", expected: "simple", description: "Social" },
  { query: "1", expected: "simple", description: "Continuation number" },
  { query: "4.", expected: "simple", description: "Continuation number with period" },
  { query: "continue", expected: "simple", description: "Continuation command" },
  { query: "next", expected: "simple", description: "Continuation command" },
  { query: "show companies", expected: "simple", description: "Simple retrieval" },
  { query: "list clients", expected: "simple", description: "Simple retrieval" },
  { query: "what's the status", expected: "simple", description: "Status check" },

  // ========================================
  // TIER 2: MODERATE (Expected: Haiku + thinking)
  // ========================================
  { query: "write a grant application", expected: "moderate", description: "Writing task" },
  { query: "create a summary", expected: "moderate", description: "Generation task" },
  { query: "review this document", expected: "moderate", description: "Review task" },
  { query: "check the eligibility", expected: "moderate", description: "Eligibility check" },
  { query: "analyze the budget", expected: "moderate", description: "Basic analysis" },
  { query: "summarize the proposal", expected: "moderate", description: "Summarization" },
  { query: "assess the application", expected: "moderate", description: "Assessment" },
  { query: "generate a draft", expected: "moderate", description: "Generation" },

  // ========================================
  // TIER 3: COMPLEX (Expected: Sonnet + full thinking)
  // ========================================
  { query: "why was this application rejected?", expected: "complex", description: "Deep reasoning - why" },
  { query: "how should I approach this grant?", expected: "complex", description: "Deep reasoning - how" },
  { query: "explain the compliance requirements", expected: "complex", description: "Explanation" },
  { query: "recommend a strategy for this client", expected: "complex", description: "Strategic recommendation" },
  { query: "compare these two grant programs", expected: "complex", description: "Comparison" },
  { query: "audit this claim for compliance", expected: "complex", description: "Compliance audit" },
  { query: "what if we apply to both programs?", expected: "complex", description: "Hypothetical scenario" },
  { query: "suggest advice for this situation", expected: "complex", description: "Strategic advice" },

  // ========================================
  // AGENT-SPECIFIC: Claims agent always complex
  // ========================================
  { query: "show me the claims", expected: "complex", description: "Claims agent - forced complex", agentType: "canexport-claims" },
  { query: "check eligibility", expected: "complex", description: "Claims agent - always complex", agentType: "canexport-claims" },

  // ========================================
  // AGENT-SPECIFIC: Readiness Strategist defaults to complex
  // ========================================
  { query: "hi", expected: "simple", description: "Readiness - greeting is simple", agentType: "readiness-strategist" },
  { query: "create readiness assessment", expected: "complex", description: "Readiness - strategic work is complex", agentType: "readiness-strategist" },
  { query: "should they apply?", expected: "complex", description: "Readiness - recommendations are complex", agentType: "readiness-strategist" },
  { query: "draft section 3", expected: "complex", description: "Readiness - even drafting is complex", agentType: "readiness-strategist" },

  // ========================================
  // AGENT-SPECIFIC: Internal Oracle - Retrieval/Research/Synthesis tiers
  // ========================================
  // SIMPLE: Pure lookups
  { query: "show companies", expected: "simple", description: "Oracle - lookup is simple", agentType: "internal-oracle" },
  { query: "find leads in Ontario", expected: "simple", description: "Oracle - search is simple", agentType: "internal-oracle" },
  { query: "what is the deadline", expected: "simple", description: "Oracle - question is simple", agentType: "internal-oracle" },
  { query: "list all clients", expected: "simple", description: "Oracle - list is simple", agentType: "internal-oracle" },

  // MODERATE: Research and enrichment
  { query: "research this company", expected: "moderate", description: "Oracle - research is moderate", agentType: "internal-oracle" },
  { query: "enrich these leads", expected: "moderate", description: "Oracle - enrichment is moderate", agentType: "internal-oracle" },
  { query: "analyze this prospect", expected: "moderate", description: "Oracle - analysis is moderate", agentType: "internal-oracle" },

  // COMPLEX: Synthesis and strategic reasoning
  { query: "why did they choose competitor?", expected: "complex", description: "Oracle - strategic analysis is complex", agentType: "internal-oracle" },
  { query: "synthesize data from HubSpot and Drive", expected: "complex", description: "Oracle - synthesis is complex", agentType: "internal-oracle" },
  { query: "compare these three opportunities", expected: "complex", description: "Oracle - comparison is complex", agentType: "internal-oracle" },
  { query: "recommend which leads to prioritize", expected: "complex", description: "Oracle - recommendations are complex", agentType: "internal-oracle" },
];

console.log('\n' + '='.repeat(80));
console.log('QUERY CLASSIFICATION TEST RESULTS');
console.log('='.repeat(80));
console.log('');

let passed = 0;
let failed = 0;

// Group results by tier
const resultsByTier = {
  simple: [],
  moderate: [],
  complex: []
};

for (const testCase of testCases) {
  // Use specified agentType, or default to 'etg-writer' for general tests
  // (Don't use 'internal-oracle' as default since it has special classification)
  const agentType = testCase.agentType || 'etg-writer';
  const classification = classifyQuery(testCase.query, agentType);
  const config = getQueryConfig(testCase.query, agentType);

  const isPass = classification === testCase.expected;

  if (isPass) {
    passed++;
  } else {
    failed++;
  }

  resultsByTier[classification].push({
    query: testCase.query,
    description: testCase.description,
    expected: testCase.expected,
    actual: classification,
    isPass,
    model: config.model,
    thinking: config.thinking ? `${config.thinking.budget_tokens} tokens` : 'disabled',
    maxTokens: config.maxTokens,
    maxIterations: config.maxIterations
  });
}

// Display results grouped by tier
console.log('📊 SIMPLE TIER RESULTS (Haiku, no thinking)');
console.log('-'.repeat(80));
for (const result of resultsByTier.simple) {
  const status = result.isPass ? '✅' : '❌';
  const mismatch = !result.isPass ? ` (expected: ${result.expected})` : '';
  console.log(`${status} "${result.query}" - ${result.description}${mismatch}`);
  console.log(`   Model: ${result.model}, Thinking: ${result.thinking}, Max Tokens: ${result.maxTokens}`);
}
console.log('');

console.log('📊 MODERATE TIER RESULTS (Haiku + thinking)');
console.log('-'.repeat(80));
for (const result of resultsByTier.moderate) {
  const status = result.isPass ? '✅' : '❌';
  const mismatch = !result.isPass ? ` (expected: ${result.expected})` : '';
  console.log(`${status} "${result.query}" - ${result.description}${mismatch}`);
  console.log(`   Model: ${result.model}, Thinking: ${result.thinking}, Max Tokens: ${result.maxTokens}`);
}
console.log('');

console.log('📊 COMPLEX TIER RESULTS (Sonnet + full thinking)');
console.log('-'.repeat(80));
for (const result of resultsByTier.complex) {
  const status = result.isPass ? '✅' : '❌';
  const mismatch = !result.isPass ? ` (expected: ${result.expected})` : '';
  console.log(`${status} "${result.query}" - ${result.description}${mismatch}`);
  console.log(`   Model: ${result.model}, Thinking: ${result.thinking}, Max Tokens: ${result.maxTokens}`);
}
console.log('');

// Summary
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Total Tests: ${testCases.length}`);
console.log(`Passed: ${passed} (${Math.round(passed / testCases.length * 100)}%)`);
console.log(`Failed: ${failed} (${Math.round(failed / testCases.length * 100)}%)`);
console.log('');

console.log('Distribution:');
console.log(`  Simple: ${resultsByTier.simple.length} queries (${Math.round(resultsByTier.simple.length / testCases.length * 100)}%)`);
console.log(`  Moderate: ${resultsByTier.moderate.length} queries (${Math.round(resultsByTier.moderate.length / testCases.length * 100)}%)`);
console.log(`  Complex: ${resultsByTier.complex.length} queries (${Math.round(resultsByTier.complex.length / testCases.length * 100)}%)`);
console.log('');

if (failed === 0) {
  console.log('✅ ALL TESTS PASSED! Classification system working correctly.');
} else {
  console.log('❌ Some tests failed. Review misclassifications above.');
}
console.log('');

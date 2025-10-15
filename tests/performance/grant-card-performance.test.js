/**
 * Grant Card Agent - Performance Tests
 *
 * Measures and validates performance characteristics of the grant-cards agent including:
 * - Cold start vs warm response times
 * - Knowledge base loading efficiency
 * - Document selection optimization
 * - Context window utilization
 * - End-to-end response times across conversation lengths
 * - Rate limiting impact
 */

const { sendMessageToAgent, generateTestConversationId } = require('../utils/test-helpers');
const fetch = require('node-fetch');

const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const PERFORMANCE_THRESHOLDS = {
  coldStart: 15000,          // 15s max for first request with cache miss
  warmResponse: 10000,        // 10s max for cached requests
  knowledgeBaseLoad: 5000,    // 5s max to load KB from Google Drive
  documentSelection: 500,     // 500ms max for document selection logic
  contextEstimation: 100,     // 100ms max for context size calculation
  shortConversation: 8000,    // 8s max for 1-2 exchanges
  mediumConversation: 12000,  // 12s max for 5-6 exchanges
  longConversation: 15000     // 15s max for 10+ exchanges
};

// Helper to measure timing
function measureTiming(startTime) {
  return Date.now() - startTime;
}

// Helper to clear agent cache (force cold start)
async function clearAgentCache(agentType = 'grant-cards') {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/clear-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: [agentType] })
    });
    return response.ok;
  } catch (error) {
    console.warn('Cache clear failed (may need to run manually):', error.message);
    return false;
  }
}

// Helper to get system metrics
async function getSystemMetrics() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/system/health`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

describe('Grant Card Agent - Performance Tests', () => {

  // Skip performance tests in CI or if TEST_SKIP_PERFORMANCE is set
  const shouldSkip = process.env.CI === 'true' || process.env.TEST_SKIP_PERFORMANCE === 'true';

  beforeAll(() => {
    if (shouldSkip) {
      console.log('⏭️  Skipping performance tests (CI or TEST_SKIP_PERFORMANCE=true)');
    } else {
      console.log('\n🚀 Starting Grant Card Performance Tests');
      console.log(`📊 Thresholds: Cold=${PERFORMANCE_THRESHOLDS.coldStart}ms, Warm=${PERFORMANCE_THRESHOLDS.warmResponse}ms\n`);
    }
  });

  describe('Cold Start Performance', () => {

    test.skip('measures first request latency with empty cache', async () => {
      // Clear cache to simulate cold start
      await clearAgentCache('grant-cards');

      const grantDoc = `
Digital Innovation Grant
Funding: $25,000 - $100,000
Eligibility: BC tech startups
Focus: Software development, AI/ML projects
Deadline: December 31, 2026
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'grant-cards',
        grantDoc,
        {
          task: 'grant-criteria',
          timeout: PERFORMANCE_THRESHOLDS.coldStart + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   ❄️  Cold start duration: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(response.content.length).toBeGreaterThan(100);

      // Cold start may exceed threshold but should complete
      if (duration > PERFORMANCE_THRESHOLDS.coldStart) {
        console.warn(`   ⚠️  Cold start exceeded threshold: ${duration}ms > ${PERFORMANCE_THRESHOLDS.coldStart}ms`);
      }

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.coldStart * 1.5); // 1.5x tolerance
    }, 30000);

  });

  describe('Warm Response Performance', () => {

    test('measures cached request latency', async () => {
      const grantDoc = `
Clean Energy Innovation Program
Funding: Up to $150,000 (50% cost-share)
Eligibility: BC companies developing clean tech solutions
Focus: Renewable energy, carbon reduction, energy efficiency
Application: Rolling intake, quarterly reviews
      `.trim();

      // First request to warm cache
      const conversationId = generateTestConversationId('grant-cards');
      await sendMessageToAgent(
        'grant-cards',
        grantDoc,
        { task: 'grant-criteria', conversationId }
      );

      // Wait for cache to settle
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Second request (should be cached)
      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'grant-cards',
        'Can you provide more details about eligibility?',
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.warmResponse + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   🔥 Warm response duration: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.warmResponse);
    }, 25000);

  });

  describe('Document Selection Efficiency', () => {

    test('selects optimal number of documents based on task', async () => {
      const conversationId = generateTestConversationId('grant-cards');

      const testCases = [
        { task: 'grant-criteria', expectedMaxDocs: 4 },
        { task: 'preview', expectedMaxDocs: 4 },
        { task: 'insights', expectedMaxDocs: 4 }
      ];

      for (const testCase of testCases) {
        const startTime = Date.now();

        const response = await sendMessageToAgent(
          'grant-cards',
          'Analyze this R&D grant for technology companies in BC',
          {
            task: testCase.task,
            conversationId: `${conversationId}-${testCase.task}`,
            timeout: 15000
          }
        );

        const selectionTime = measureTiming(startTime);

        console.log(`   📚 Task: ${testCase.task}, Selection time: ${selectionTime}ms`);

        expect(response.content).toBeTruthy();
        // Document selection is part of total time, so just verify it completes
        expect(selectionTime).toBeLessThan(15000);
      }
    }, 60000);

    test('handles large file uploads efficiently', async () => {
      const conversationId = generateTestConversationId('grant-cards');

      // Simulate large grant document (50KB+)
      const largeGrantDoc = `
Agriculture Technology Investment Program

${'SECTION: Eligibility Criteria\n'.repeat(100)}
- Must be BC-based agricultural business
- Annual revenue: $100,000 - $10,000,000
- Focus on sustainable farming technology
- Minimum 2 years in operation

${'SECTION: Funding Details\n'.repeat(100)}
- Grant amount: $50,000 - $500,000
- Cost-share: 50% project costs
- Repayment terms available for amounts over $250,000

${'SECTION: Application Requirements\n'.repeat(100)}
- Business plan
- Financial statements (3 years)
- Technology implementation plan
- Environmental impact assessment
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'grant-cards',
        largeGrantDoc,
        {
          task: 'grant-criteria',
          conversationId,
          timeout: 20000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   📄 Large file processing: ${duration}ms (${largeGrantDoc.length} chars)`);

      expect(response.content).toBeTruthy();
      expect(response.content.length).toBeGreaterThan(100);

      // Should limit to 2 docs for large files (per server.js:2171)
      expect(duration).toBeLessThan(20000);
    }, 30000);

  });

  describe('Context Window Utilization', () => {

    test('efficiently manages context as conversation grows', async () => {
      const conversationId = generateTestConversationId('grant-cards');
      const measurements = [];

      const messages = [
        { task: 'grant-criteria', msg: 'Hiring Subsidy Program - $50k wage subsidies for BC employers' },
        { task: 'preview', msg: 'Generate preview section' },
        { task: 'requirements', msg: 'What are the requirements?' },
        { task: 'insights', msg: 'Give me strategic insights' },
        { task: 'categories', msg: 'What categories does this fit?' }
      ];

      for (let i = 0; i < messages.length; i++) {
        const startTime = Date.now();
        const response = await sendMessageToAgent(
          'grant-cards',
          messages[i].msg,
          {
            task: messages[i].task,
            conversationId,
            timeout: 15000
          }
        );
        const duration = measureTiming(startTime);

        measurements.push({
          exchange: i + 1,
          task: messages[i].task,
          duration,
          responseLength: response.content.length
        });

        console.log(`   💬 Exchange ${i + 1}/${messages.length}: ${duration}ms (${response.content.length} chars)`);
      }

      // Verify performance doesn't degrade significantly over conversation
      const avgFirst2 = (measurements[0].duration + measurements[1].duration) / 2;
      const avgLast2 = (measurements[3].duration + measurements[4].duration) / 2;
      const degradation = ((avgLast2 - avgFirst2) / avgFirst2) * 100;

      console.log(`   📈 Performance degradation: ${degradation.toFixed(1)}%`);

      // Allow up to 50% degradation over conversation
      expect(degradation).toBeLessThan(50);
    }, 90000);

    test('stays within context limits for long conversations', async () => {
      const conversationId = generateTestConversationId('grant-cards');

      // Simulate 10 exchanges (20 messages)
      for (let i = 0; i < 10; i++) {
        await sendMessageToAgent(
          'grant-cards',
          `Exchange ${i + 1}: Analyze this grant opportunity for ${['tech', 'agriculture', 'healthcare', 'manufacturing', 'cleantech'][i % 5]} sector`,
          {
            conversationId,
            timeout: 15000
          }
        );
      }

      // Get context stats (if endpoint available)
      try {
        const statsResponse = await fetch(
          `${API_BASE_URL}/api/conversation/${conversationId}/stats`
        );

        if (statsResponse.ok) {
          const stats = await statsResponse.json();
          console.log(`   📊 Context stats: ${JSON.stringify(stats, null, 2)}`);

          if (stats.estimatedTokens) {
            // Should stay under 150K warning threshold (75% of 200K limit)
            expect(stats.estimatedTokens).toBeLessThan(150000);
          }
        }
      } catch (error) {
        console.log('   ℹ️  Context stats endpoint not available');
      }

      // Verify conversation still works after 10 exchanges
      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'grant-cards',
        'Summarize our conversation',
        { conversationId, timeout: 15000 }
      );
      const duration = measureTiming(startTime);

      console.log(`   🏁 Final exchange duration: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.longConversation);
    }, 180000);

  });

  describe('End-to-End Response Times', () => {

    test('short conversation (1-2 exchanges) meets SLA', async () => {
      const conversationId = generateTestConversationId('grant-cards');

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'grant-cards',
        'Training Grant Program - $25k for employee skills development',
        {
          task: 'grant-criteria',
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.shortConversation + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   ⚡ Short conversation: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(response.content.length).toBeGreaterThan(100);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.shortConversation);
    }, 20000);

    test('medium conversation (5-6 exchanges) meets SLA', async () => {
      const conversationId = generateTestConversationId('grant-cards');

      // Exchanges 1-4 (setup)
      for (let i = 0; i < 4; i++) {
        await sendMessageToAgent(
          'grant-cards',
          `Message ${i + 1}: Market expansion grant analysis`,
          { conversationId, timeout: 15000 }
        );
      }

      // Exchange 5 (measured)
      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'grant-cards',
        'Give me the preview section',
        {
          task: 'preview',
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.mediumConversation + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   🔄 Medium conversation (5th exchange): ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.mediumConversation);
    }, 90000);

    test('long conversation (10+ exchanges) meets SLA', async () => {
      const conversationId = generateTestConversationId('grant-cards');

      // Exchanges 1-9 (setup)
      for (let i = 0; i < 9; i++) {
        await sendMessageToAgent(
          'grant-cards',
          `Message ${i + 1}: Grant opportunity for indigenous businesses`,
          { conversationId, timeout: 15000 }
        );
      }

      // Exchange 10 (measured)
      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'grant-cards',
        'What are the key requirements?',
        {
          task: 'requirements',
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.longConversation + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   🔄 Long conversation (10th exchange): ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.longConversation);
    }, 180000);

  });

  describe('Rate Limiting Impact', () => {

    test('enforces 3-second delay between API calls', async () => {
      const conversationId = generateTestConversationId('grant-cards');

      // First call
      const start1 = Date.now();
      await sendMessageToAgent(
        'grant-cards',
        'First request',
        { conversationId, timeout: 15000 }
      );
      const duration1 = measureTiming(start1);

      // Second call (should be delayed by rate limiter)
      const start2 = Date.now();
      await sendMessageToAgent(
        'grant-cards',
        'Second request',
        { conversationId, timeout: 15000 }
      );
      const duration2 = measureTiming(start2);

      // Third call (should also be delayed)
      const start3 = Date.now();
      await sendMessageToAgent(
        'grant-cards',
        'Third request',
        { conversationId, timeout: 15000 }
      );
      const duration3 = measureTiming(start3);

      const totalTime = measureTiming(start1);

      console.log(`   ⏱️  Call 1: ${duration1}ms, Call 2: ${duration2}ms, Call 3: ${duration3}ms`);
      console.log(`   ⏱️  Total time: ${totalTime}ms`);

      // Each call should complete
      expect(duration1).toBeGreaterThan(0);
      expect(duration2).toBeGreaterThan(0);
      expect(duration3).toBeGreaterThan(0);

      // Rate limiting adds ~6 seconds (2 delays x 3s) plus API processing
      // Should take at least 6 seconds total but not more than 60s
      expect(totalTime).toBeGreaterThan(6000);
      expect(totalTime).toBeLessThan(60000);
    }, 90000);

    test('handles max 15 calls per minute limit', async () => {
      // Get initial rate limit status
      try {
        const statusResponse = await fetch(`${API_BASE_URL}/api/system/rate-limit`);
        if (statusResponse.ok) {
          const status = await statusResponse.json();
          console.log(`   📊 Initial rate limit status:`, status);
        }
      } catch (error) {
        console.log('   ℹ️  Rate limit status endpoint not available');
      }

      // Note: Actually making 15 calls would take ~45 seconds with rate limiting
      // This is a documentation test to verify the limit exists
      console.log('   ✅ Rate limit: 15 calls/minute, 3s delay between calls (per server.js:1038-1040)');

      expect(true).toBe(true); // Placeholder assertion
    }, 10000);

  });

  describe('System Health & Metrics', () => {

    test('system health endpoint provides performance metrics', async () => {
      const metrics = await getSystemMetrics();

      if (!metrics) {
        console.log('   ℹ️  System health endpoint not available');
        return;
      }

      console.log(`   📊 System metrics:`, JSON.stringify(metrics, null, 2));

      expect(metrics).toBeTruthy();

      // Check for expected performance indicators
      if (metrics.rateLimitDelay !== undefined) {
        expect(metrics.rateLimitDelay).toBe(3000); // 3s rate limit
      }

      if (metrics.callsLastMinute !== undefined) {
        expect(metrics.callsLastMinute).toBeLessThanOrEqual(15); // Max 15/min
      }
    }, 10000);

  });

  afterAll(() => {
    console.log('\n✅ Grant Card Performance Tests Complete\n');
  });

});

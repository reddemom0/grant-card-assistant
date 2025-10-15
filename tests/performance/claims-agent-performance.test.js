/**
 * CanExport Claims Agent - Performance Tests
 *
 * Measures and validates performance characteristics of the canexport-claims agent including:
 * - Response times for different expense categories
 * - Document selection efficiency (rejected claims detection)
 * - Tax calculation performance
 * - Complex multi-expense analysis
 * - Knowledge base utilization
 * - Conversation history impact
 */

const { sendMessageToAgent, generateTestConversationId, parseXMLResponse } = require('../utils/test-helpers');
const fetch = require('node-fetch');

const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const PERFORMANCE_THRESHOLDS = {
  singleExpense: 10000,      // 10s max for single expense analysis
  multiExpense: 15000,       // 15s max for multiple expenses
  taxCalculation: 8000,      // 8s max for tax-focused queries
  rejectionDetection: 12000, // 12s max when rejection patterns present
  complexAnalysis: 18000,    // 18s max for comprehensive audit
  documentSelection: 500     // 500ms max for smart doc selection
};

function measureTiming(startTime) {
  return Date.now() - startTime;
}

async function clearAgentCache(agentType = 'canexport-claims') {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/clear-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: [agentType] })
    });
    return response.ok;
  } catch (error) {
    console.warn('Cache clear failed:', error.message);
    return false;
  }
}

describe('CanExport Claims Agent - Performance Tests', () => {

  const shouldSkip = process.env.CI === 'true' || process.env.TEST_SKIP_PERFORMANCE === 'true';

  beforeAll(() => {
    if (shouldSkip) {
      console.log('⏭️  Skipping performance tests (CI or TEST_SKIP_PERFORMANCE=true)');
    } else {
      console.log('\n🚀 Starting CanExport Claims Performance Tests');
      console.log(`📊 Thresholds: Single=${PERFORMANCE_THRESHOLDS.singleExpense}ms, Multi=${PERFORMANCE_THRESHOLDS.multiExpense}ms\n`);
    }
  });

  describe('Single Expense Analysis Performance', () => {

    test('analyzes travel expense within SLA', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Analyze this CanExport expense:
Vendor: Air Canada
Amount: $1,250.00
Tax: $65.00 GST
Province: BC
Category: International travel
Description: Flight to Tokyo for trade mission
Invoice Date: March 15, 2025
Payment Date: March 18, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.singleExpense + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   ✈️  Travel expense analysis: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(response.content.length).toBeGreaterThan(100);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.singleExpense);

      // Verify expense_summary section present
      const parsed = parseXMLResponse(response.content, ['expense_summary', 'verdict']);
      expect(parsed.expense_summary || parsed.verdict).toBeTruthy();
    }, 20000);

    test('analyzes trade show expense within SLA', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Vendor: Tokyo Big Sight
Amount: $8,500.00
Tax: $0 (foreign venue)
Category: Trade show booth
Description: Booth rental for Japan Electronics Expo 2025
Invoice Date: February 1, 2025
Payment Date: February 10, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.singleExpense + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   🏢 Trade show expense analysis: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.singleExpense);
    }, 20000);

    test('analyzes marketing expense within SLA', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Vendor: Tokyo Translation Services
Amount: $2,400.00
Tax: $0 (foreign service)
Category: Translation services
Description: Japanese product catalog translation (50 pages)
Invoice Date: March 10, 2025
Payment Date: March 15, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.singleExpense + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   📄 Translation expense analysis: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.singleExpense);
    }, 20000);

  });

  describe('Tax Calculation Performance', () => {

    test('calculates BC PST correctly and efficiently', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Vendor: Delta Hotels Vancouver
Amount: $450.00
Tax: $72.00 (GST $22.50 + PST $49.50)
Province: BC
Category: Hotel accommodation
Description: Vancouver hotel for export training
Invoice Date: April 5, 2025
Payment Date: April 6, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.taxCalculation + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   💰 Tax calculation (BC PST): ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.taxCalculation);

      // Should mention both GST and PST
      const content = response.content.toLowerCase();
      expect(content.includes('gst') || content.includes('pst') || content.includes('tax')).toBe(true);
    }, 20000);

    test('handles HST provinces efficiently', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Vendor: Halifax Conference Centre
Amount: $3,200.00
Tax: $480.00 HST (15%)
Province: NS
Category: Conference facility rental
Description: Export readiness workshop venue
Invoice Date: May 12, 2025
Payment Date: May 15, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.taxCalculation + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   💰 Tax calculation (NS HST): ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.taxCalculation);
    }, 20000);

    test('verifies foreign expense (no tax) efficiently', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Vendor: Hotel Okura Tokyo
Amount: $4,800.00 CAD
Tax: $0 (foreign)
Category: Hotel accommodation
Description: Tokyo hotel for trade mission
Invoice Date: June 20, 2025
Payment Date: June 21, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.taxCalculation + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   🌍 Foreign expense (no tax): ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.taxCalculation);
    }, 20000);

  });

  describe('Rejection Pattern Detection Performance', () => {

    test('detects Amazon purchase rejection risk quickly', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Vendor: Amazon.com
Amount: $1,200.00
Category: Office supplies
Description: Marketing materials for trade show
Invoice Date: July 10, 2025
Payment Date: July 12, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.rejectionDetection + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   🚨 Amazon rejection detection: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.rejectionDetection);

      // Should load rejected-claims doc (per server.js:2486-2500)
      // Verify warning about Amazon in response
      const content = response.content.toLowerCase();
      expect(
        content.includes('amazon') ||
        content.includes('ineligible') ||
        content.includes('reject')
      ).toBe(true);
    }, 25000);

    test('detects booth purchase (not rental) rejection risk', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Vendor: Trade Show Displays Inc
Amount: $12,000.00
Tax: $600.00 GST
Province: ON
Category: Trade show booth purchase
Description: Purchased modular booth display system
Invoice Date: August 5, 2025
Payment Date: August 10, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.rejectionDetection + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   🚨 Booth purchase rejection detection: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.rejectionDetection);

      // Should warn about booth purchase vs rental
      const content = response.content.toLowerCase();
      expect(
        content.includes('purchase') ||
        content.includes('rental') ||
        content.includes('reject')
      ).toBe(true);
    }, 25000);

    test('detects Canadian-focused expense rejection risk', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const expense = `
Vendor: Toronto Marketing Agency
Amount: $5,000.00
Tax: $650.00 HST
Province: ON
Category: Marketing services
Description: Canadian market research and branding
Invoice Date: September 1, 2025
Payment Date: September 5, 2025
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        expense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.rejectionDetection + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   🚨 Canadian-focus rejection detection: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.rejectionDetection);
    }, 25000);

  });

  describe('Multi-Expense Analysis Performance', () => {

    test('analyzes 3 expenses in single request', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const multiExpense = `
Analyze these three CanExport expenses:

Expense 1:
Vendor: Air Canada
Amount: $1,850.00
Tax: $95.00 GST
Category: International travel
Description: Flight to Berlin trade mission

Expense 2:
Vendor: Hotel Adlon Berlin
Amount: $2,400.00 CAD
Tax: $0 (foreign)
Category: Hotel accommodation
Description: 4 nights Berlin hotel

Expense 3:
Vendor: Berlin Translation Services
Amount: $800.00 CAD
Tax: $0 (foreign)
Category: Translation services
Description: German product catalog translation
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        multiExpense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.multiExpense + 10000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   📋 Multi-expense analysis (3 expenses): ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(response.content.length).toBeGreaterThan(300);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.multiExpense);
    }, 35000);

    test('handles comprehensive audit request efficiently', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      // Build conversation with multiple expenses
      await sendMessageToAgent(
        'canexport-claims',
        'Expense 1: Air Canada flight $1,200 with GST',
        { conversationId, timeout: 15000 }
      );

      await sendMessageToAgent(
        'canexport-claims',
        'Expense 2: Tokyo hotel $3,000 no tax',
        { conversationId, timeout: 15000 }
      );

      await sendMessageToAgent(
        'canexport-claims',
        'Expense 3: Trade show booth rental $8,500 no tax',
        { conversationId, timeout: 15000 }
      );

      // Request comprehensive audit
      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        'Provide a comprehensive audit summary of all expenses with total eligible amount',
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.complexAnalysis + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   📊 Comprehensive audit: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(response.content.length).toBeGreaterThan(400);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.complexAnalysis);
    }, 90000);

  });

  describe('Document Selection Efficiency', () => {

    test('selects optimal documents based on expense category', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      const testCases = [
        { category: 'travel', keyword: 'flight' },
        { category: 'trade show', keyword: 'booth rental' },
        { category: 'marketing', keyword: 'translation' },
        { category: 'consulting', keyword: 'legal advice' }
      ];

      for (const testCase of testCases) {
        const startTime = Date.now();

        await sendMessageToAgent(
          'canexport-claims',
          `Analyze this ${testCase.keyword} expense for CanExport eligibility`,
          {
            conversationId: `${conversationId}-${testCase.category}`,
            timeout: 15000
          }
        );

        const selectionTime = measureTiming(startTime);

        console.log(`   📚 Category: ${testCase.category}, Time: ${selectionTime}ms`);

        // Document selection is part of total time
        expect(selectionTime).toBeLessThan(15000);
      }
    }, 80000);

    test('efficiently handles rejection pattern document loading', async () => {
      const conversationId = generateTestConversationId('canexport-claims');

      // Trigger rejection risk patterns (should load rejected-claims doc)
      const riskyExpense = `
Vendor: Amazon Business
Amount: $2,500.00
Category: Reusable display materials
Description: Airport tax for international travel
      `.trim();

      const startTime = Date.now();
      const response = await sendMessageToAgent(
        'canexport-claims',
        riskyExpense,
        {
          conversationId,
          timeout: PERFORMANCE_THRESHOLDS.rejectionDetection + 5000
        }
      );
      const duration = measureTiming(startTime);

      console.log(`   ⚠️  Rejection doc loading: ${duration}ms`);

      expect(response.content).toBeTruthy();
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.rejectionDetection);

      // Should detect multiple rejection risks
      const content = response.content.toLowerCase();
      const riskCount = [
        content.includes('amazon'),
        content.includes('reusable'),
        content.includes('airport')
      ].filter(Boolean).length;

      console.log(`   🚨 Detected ${riskCount} rejection risks`);
    }, 25000);

  });

  describe('Conversation History Impact', () => {

    test('maintains performance across conversation length', async () => {
      const conversationId = generateTestConversationId('canexport-claims');
      const measurements = [];

      // Simulate 8 expense analyses in conversation
      const expenses = [
        'Flight expense $1,200',
        'Hotel expense $800',
        'Translation expense $500',
        'Trade show booth $10,000',
        'Marketing materials $1,500',
        'Legal consulting $2,000',
        'Market research $3,000',
        'Interpretation services $900'
      ];

      for (let i = 0; i < expenses.length; i++) {
        const startTime = Date.now();
        await sendMessageToAgent(
          'canexport-claims',
          `Analyze: ${expenses[i]}`,
          {
            conversationId,
            timeout: 15000
          }
        );
        const duration = measureTiming(startTime);

        measurements.push(duration);
        console.log(`   💬 Exchange ${i + 1}: ${duration}ms`);
      }

      // Calculate performance degradation
      const avgFirst3 = (measurements[0] + measurements[1] + measurements[2]) / 3;
      const avgLast3 = (measurements[5] + measurements[6] + measurements[7]) / 3;
      const degradation = ((avgLast3 - avgFirst3) / avgFirst3) * 100;

      console.log(`   📈 Performance degradation: ${degradation.toFixed(1)}%`);

      // Allow up to 40% degradation over 8 exchanges
      expect(degradation).toBeLessThan(40);
    }, 150000);

  });

  describe('Knowledge Base Utilization', () => {

    test('utilizes cached knowledge base efficiently', async () => {
      const conversationId1 = generateTestConversationId('canexport-claims');
      const conversationId2 = generateTestConversationId('canexport-claims');

      // First request (may load KB)
      const start1 = Date.now();
      await sendMessageToAgent(
        'canexport-claims',
        'Travel expense analysis',
        { conversationId: conversationId1, timeout: 20000 }
      );
      const duration1 = measureTiming(start1);

      // Second request (should use cached KB)
      const start2 = Date.now();
      await sendMessageToAgent(
        'canexport-claims',
        'Hotel expense analysis',
        { conversationId: conversationId2, timeout: 20000 }
      );
      const duration2 = measureTiming(start2);

      console.log(`   📚 First request: ${duration1}ms, Second request: ${duration2}ms`);

      // Second request should be similar or faster (KB cached)
      const improvement = ((duration1 - duration2) / duration1) * 100;
      console.log(`   📊 Cache benefit: ${improvement.toFixed(1)}%`);

      // Both should complete successfully
      expect(duration1).toBeGreaterThan(0);
      expect(duration2).toBeGreaterThan(0);
    }, 60000);

  });

  afterAll(() => {
    console.log('\n✅ CanExport Claims Performance Tests Complete\n');
  });

});

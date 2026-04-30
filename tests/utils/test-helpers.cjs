/**
 * Test Helpers for Grant Card Assistant Testing Framework
 *
 * Provides utilities for:
 * - API call wrappers for agent testing
 * - Conversation setup and management
 * - Response parsing and validation
 * - Common test assertions
 */

const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * Generate unique conversation ID for test isolation
 */
function generateTestConversationId(agentType) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `${agentType}-test-${timestamp}-${random}`;
}

/**
 * Send message to agent and get response
 *
 * @param {string} agentType - Agent identifier (grant-cards, etg-writer, etc.)
 * @param {string} message - User message to send
 * @param {Object} options - Additional options
 * @param {string} options.conversationId - Existing conversation ID (optional)
 * @param {string} options.task - Task type for grant-cards agent (optional)
 * @param {Array} options.files - File attachments (optional)
 * @param {number} options.timeout - Request timeout in ms
 * @returns {Promise<Object>} Response object with content and metadata
 */
async function sendMessageToAgent(agentType, message, options = {}) {
  const {
    conversationId = generateTestConversationId(agentType),
    task = null,
    files = [],
    timeout = DEFAULT_TIMEOUT
  } = options;

  const endpoint = `${API_BASE_URL}/api/chat`;

  // Build request body
  const body = {
    message,
    conversationId,
    agentType
  };

  if (task) {
    body.task = task;
  }

  if (files.length > 0) {
    body.files = files;
  }

  // Send request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    // Handle streaming response
    const fullResponse = await collectStreamingResponse(response);

    return {
      content: fullResponse,
      conversationId,
      agentType,
      task
    };

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Collect full response from streaming endpoint
 *
 * @param {Response} response - Fetch response object
 * @returns {Promise<string>} Complete response content
 */
async function collectStreamingResponse(response) {
  const reader = response.body;
  let fullContent = '';
  let buffer = '';

  return new Promise((resolve, reject) => {
    reader.on('data', (chunk) => {
      buffer += chunk.toString();

      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            resolve(fullContent);
            return;
          }

          try {
            const json = JSON.parse(data);
            if (json.content) {
              fullContent += json.content;
            }
          } catch (e) {
            // Ignore JSON parse errors for non-JSON data
          }
        }
      }
    });

    reader.on('end', () => {
      resolve(fullContent);
    });

    reader.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Parse XML response into structured object
 *
 * @param {string} response - Raw response text
 * @param {Array<string>} tags - XML tags to extract
 * @returns {Object} Parsed sections
 */
function parseXMLResponse(response, tags) {
  const parsed = {};

  for (const tag of tags) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
    const match = response.match(regex);

    if (match) {
      parsed[tag] = match[1].trim();
    } else {
      parsed[tag] = null;
    }
  }

  return parsed;
}

/**
 * Extract thinking section from response
 *
 * @param {string} response - Raw response text
 * @returns {Object} Thinking content and main content separately
 */
function extractThinking(response) {
  const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/i);

  if (thinkingMatch) {
    const thinking = thinkingMatch[1].trim();
    const mainContent = response.replace(/<thinking>[\s\S]*?<\/thinking>/i, '').trim();

    return {
      thinking,
      mainContent,
      hasThinking: true
    };
  }

  return {
    thinking: null,
    mainContent: response,
    hasThinking: false
  };
}

/**
 * Validate required fields are present in response
 *
 * @param {Object} parsed - Parsed response object
 * @param {Array<string>} requiredFields - Field names that must be present
 * @returns {Object} Validation result
 */
function validateRequiredFields(parsed, requiredFields) {
  const missing = [];
  const present = [];

  for (const field of requiredFields) {
    if (parsed[field] === null || parsed[field] === undefined || parsed[field] === '') {
      missing.push(field);
    } else {
      present.push(field);
    }
  }

  return {
    isValid: missing.length === 0,
    missing,
    present,
    completeness: present.length / requiredFields.length
  };
}

/**
 * Load fixture file from fixtures directory
 *
 * @param {string} filename - Fixture filename
 * @param {string} category - Fixture category subdirectory (optional)
 * @returns {Promise<string>} File content
 */
async function loadFixture(filename, category = null) {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const filePath = category
    ? path.join(fixturesDir, category, filename)
    : path.join(fixturesDir, filename);

  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    throw new Error(`Failed to load fixture: ${filename} (${error.message})`);
  }
}

/**
 * Test Grant Cards agent with grant type classification
 *
 * @param {string} grantDocument - Grant document content
 * @param {string} conversationId - Optional conversation ID
 * @returns {Promise<Object>} Classification result
 */
async function testGrantCardClassification(grantDocument, conversationId = null) {
  const response = await sendMessageToAgent(
    'grant-cards',
    grantDocument,
    {
      task: 'grant-criteria',
      conversationId
    }
  );

  // Parse response to extract grant type
  const content = response.content;

  // Look for grant type indicators
  const grantTypes = [
    'Hiring Grant',
    'Training Grant',
    'Research & Development Grant',
    'Market Expansion Grant',
    'Loan Program',
    'Investment Fund'
  ];

  let detectedType = null;
  for (const type of grantTypes) {
    if (content.toLowerCase().includes(type.toLowerCase())) {
      detectedType = type;
      break;
    }
  }

  return {
    grantType: detectedType,
    rawResponse: content,
    conversationId: response.conversationId
  };
}

/**
 * Test CanExport Claims agent with expense analysis
 *
 * @param {Object} expense - Expense details
 * @param {string} conversationId - Optional conversation ID
 * @returns {Promise<Object>} Analysis result
 */
async function testExpenseAnalysis(expense, conversationId = null) {
  // Format expense as message
  const message = `
Analyze this expense for CanExport SME eligibility:

Vendor: ${expense.vendor}
Amount: $${expense.amount}
Tax: $${expense.tax || 'Not specified'} ${expense.taxType || ''}
Province: ${expense.province || 'Not specified'}
Category: ${expense.category || 'Unknown'}
Description: ${expense.description}
Invoice Date: ${expense.invoiceDate || 'Not specified'}
Payment Date: ${expense.paymentDate || 'Not specified'}
`.trim();

  const response = await sendMessageToAgent(
    'canexport-claims',
    message,
    { conversationId }
  );

  // Parse XML response
  const parsed = parseXMLResponse(response.content, [
    'thinking',
    'expense_summary',
    'compliance_analysis',
    'verdict',
    'recommendations'
  ]);

  // Extract key financial details from expense_summary
  const summary = parsed.expense_summary || '';
  const taxMatch = summary.match(/Taxes.*?:.*?\$?([\d,]+(?:\.\d{2})?)/i);
  const eligibleMatch = summary.match(/Eligible Amount.*?:.*?\$?([\d,]+(?:\.\d{2})?)/i);
  const reimbursementMatch = summary.match(/Estimated Reimbursement.*?:.*?\$?([\d,]+(?:\.\d{2})?)/i);

  // Extract verdict
  const verdict = parsed.verdict || '';
  let status = 'UNKNOWN';
  if (verdict.includes('✅') || verdict.toLowerCase().includes('approved')) {
    status = 'APPROVED';
  } else if (verdict.includes('⚠️') || verdict.toLowerCase().includes('conditional')) {
    status = 'CONDITIONAL';
  } else if (verdict.includes('❌') || verdict.toLowerCase().includes('rejected')) {
    status = 'REJECTED';
  }

  return {
    taxRemoved: taxMatch ? parseFloat(taxMatch[1].replace(/,/g, '')) : null,
    eligibleAmount: eligibleMatch ? parseFloat(eligibleMatch[1].replace(/,/g, '')) : null,
    estimatedReimbursement: reimbursementMatch ? parseFloat(reimbursementMatch[1].replace(/,/g, '')) : null,
    verdict: status,
    parsed,
    rawResponse: response.content,
    conversationId: response.conversationId
  };
}

/**
 * Test ETG Writer agent with eligibility check
 *
 * @param {Object} training - Training details
 * @param {string} conversationId - Optional conversation ID
 * @returns {Promise<Object>} Eligibility result
 */
async function testETGEligibility(training, conversationId = null) {
  const message = `
Check eligibility for this training:

Training Title: ${training.training_title}
Training Type: ${training.training_type}
Provider: ${training.training_provider || 'Not specified'}
Content: ${training.training_content}
Duration: ${training.training_duration}
`.trim();

  const response = await sendMessageToAgent(
    'etg-writer',
    message,
    { conversationId }
  );

  const content = response.content.toLowerCase();

  // Determine eligibility from response
  let eligible = null;
  if (content.includes('eligible') && !content.includes('not eligible') && !content.includes('ineligible')) {
    eligible = true;
  } else if (content.includes('not eligible') || content.includes('ineligible')) {
    eligible = false;
  }

  // Check for ineligible keywords mentioned
  const ineligibleKeywords = ['seminar', 'conference', 'coaching', 'consulting', 'diploma', 'degree'];
  const mentionedKeywords = ineligibleKeywords.filter(keyword => content.includes(keyword));

  return {
    eligible,
    mentionedKeywords,
    rawResponse: response.content,
    conversationId: response.conversationId
  };
}

/**
 * Test BCAFE Writer agent with funding calculation
 *
 * @param {Object} scenario - Project scenario
 * @param {string} conversationId - Optional conversation ID
 * @returns {Promise<Object>} Funding calculation result
 */
async function testBCAFEFunding(scenario, conversationId = null) {
  const message = `
Calculate BCAFE funding for this scenario:

Applicant Type: ${scenario.applicantType}
Total Project Cost: $${scenario.totalProjectCost}
`.trim();

  const response = await sendMessageToAgent(
    'bcafe-writer',
    message,
    { conversationId }
  );

  const content = response.content;

  // Extract cash match percentage
  let cashMatchPercent = null;
  const percentMatch = content.match(/(\d{2})%\s*(?:cash\s*)?match/i);
  if (percentMatch) {
    cashMatchPercent = parseInt(percentMatch[1]);
  }

  // Extract amounts
  const cashMatchMatch = content.match(/cash\s*match.*?\$?([\d,]+(?:\.\d{2})?)/i);
  const grantMatch = content.match(/grant.*?(?:amount|funding).*?\$?([\d,]+(?:\.\d{2})?)/i);

  return {
    cashMatchPercent,
    cashMatchRequired: cashMatchMatch ? parseFloat(cashMatchMatch[1].replace(/,/g, '')) : null,
    maxGrantAmount: grantMatch ? parseFloat(grantMatch[1].replace(/,/g, '')) : null,
    rawResponse: content,
    conversationId: response.conversationId
  };
}

/**
 * Run consistency test by sending same input multiple times
 *
 * @param {Function} testFunction - Test function to run
 * @param {Array} args - Arguments to pass to test function
 * @param {number} runs - Number of times to run (default: 3)
 * @returns {Promise<Object>} Consistency analysis
 */
async function testConsistency(testFunction, args, runs = 3) {
  const results = [];

  for (let i = 0; i < runs; i++) {
    const result = await testFunction(...args);
    results.push(result);
  }

  return {
    results,
    runs,
    allResultsEqual: results.every((r, i) => i === 0 || JSON.stringify(r) === JSON.stringify(results[0]))
  };
}

module.exports = {
  // Core functions
  generateTestConversationId,
  sendMessageToAgent,
  collectStreamingResponse,

  // Parsing utilities
  parseXMLResponse,
  extractThinking,
  validateRequiredFields,

  // Fixture loading
  loadFixture,

  // Agent-specific test functions
  testGrantCardClassification,
  testExpenseAnalysis,
  testETGEligibility,
  testBCAFEFunding,

  // Consistency testing
  testConsistency,

  // Constants
  API_BASE_URL,
  DEFAULT_TIMEOUT
};

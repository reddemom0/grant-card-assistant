/**
 * Jest Setup File
 *
 * Runs before all tests to configure environment and global utilities
 */

require('dotenv').config({ path: '../.env' });

// Extend Jest matchers with custom assertions
expect.extend({
  /**
   * Check if a value is approximately equal within tolerance
   */
  toBeApproximately(received, expected, tolerance = 0.01) {
    const pass = Math.abs(received - expected) <= tolerance;

    return {
      pass,
      message: () =>
        pass
          ? `Expected ${received} not to be approximately ${expected} (tolerance: ${tolerance})`
          : `Expected ${received} to be approximately ${expected} (tolerance: ${tolerance}), difference: ${Math.abs(received - expected)}`
    };
  },

  /**
   * Check if response contains required XML tags
   */
  toContainXMLTags(received, tags) {
    const missing = [];

    for (const tag of tags) {
      const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
      if (!regex.test(received)) {
        missing.push(tag);
      }
    }

    const pass = missing.length === 0;

    return {
      pass,
      message: () =>
        pass
          ? `Expected response not to contain all XML tags: ${tags.join(', ')}`
          : `Expected response to contain XML tags, but missing: ${missing.join(', ')}`
    };
  },

  /**
   * Check if LLM grading score meets threshold
   */
  toMeetQualityThreshold(received, threshold = 4.0) {
    const score = received.overallScore;
    const pass = score >= threshold;

    return {
      pass,
      message: () =>
        pass
          ? `Expected quality score ${score} not to meet threshold ${threshold}`
          : `Expected quality score ${score} to meet threshold ${threshold} (gap: ${threshold - score})`
    };
  },

  /**
   * Check if array values are consistent (low variance)
   */
  toBeConsistent(received, maxVariance = 5) {
    if (!Array.isArray(received) || received.length < 2) {
      return {
        pass: false,
        message: () => 'Expected array with at least 2 values'
      };
    }

    const mean = received.reduce((sum, val) => sum + val, 0) / received.length;
    const variance = received.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / received.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean !== 0 ? (stdDev / mean) * 100 : 0;

    const pass = cv <= maxVariance;

    return {
      pass,
      message: () =>
        pass
          ? `Expected values not to be consistent (CV: ${cv.toFixed(2)}%)`
          : `Expected values to be consistent, but CV ${cv.toFixed(2)}% exceeds threshold ${maxVariance}%`
    };
  }
});

// Set longer timeout for integration tests
if (process.env.TEST_TYPE === 'integration') {
  jest.setTimeout(60000); // 60 seconds for integration tests
}

// Global test utilities
global.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Console formatting for test output
const originalLog = console.log;
console.log = (...args) => {
  // Add timestamp to console logs during tests
  const timestamp = new Date().toISOString();
  originalLog(`[${timestamp}]`, ...args);
};

// Verify required environment variables
const requiredEnvVars = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN'
];

const missing = requiredEnvVars.filter(varName => !process.env[varName]);

if (missing.length > 0) {
  console.warn('⚠️ Warning: Missing environment variables:', missing.join(', '));
  console.warn('   Some tests may fail. Ensure .env file is properly configured.');
}

console.log('✅ Test environment initialized');

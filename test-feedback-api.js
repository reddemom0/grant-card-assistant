/**
 * Test feedback-metrics API locally
 */

import feedbackMetricsHandler from './api/feedback-metrics.js';

// Mock request/response
const mockReq = {
  method: 'GET',
  query: { action: 'overview' },
  user: { id: 1, email: 'test@test.com' } // Mock authenticated user
};

const mockRes = {
  status: function(code) {
    console.log(`Status: ${code}`);
    return this;
  },
  json: function(data) {
    console.log('Response:', JSON.stringify(data, null, 2));
    return this;
  },
  end: function() {
    console.log('Response ended');
    return this;
  }
};

console.log('🧪 Testing feedback-metrics API with action=overview\n');

feedbackMetricsHandler(mockReq, mockRes)
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  });

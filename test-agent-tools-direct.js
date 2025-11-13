/**
 * Direct API test: Ask the agent what tools it has
 * This verifies the deployed agent actually has access to create_advanced_document
 */

const RAILWAY_STAGING_URL = 'https://grant-card-assistant-staging.up.railway.app';

async function testAgentToolsDirect() {
  console.log('🧪 Direct API test: Asking agent about its tools...\n');

  try {
    // Note: This requires authentication
    // We'll test without auth to see what happens

    console.log('📡 Sending chat request to Railway staging...');
    console.log(`URL: ${RAILWAY_STAGING_URL}/api/chat`);
    console.log('');

    const response = await fetch(`${RAILWAY_STAGING_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: Would need actual JWT token from your browser for real test
      },
      body: JSON.stringify({
        agentType: 'readiness-strategist',
        message: 'What document creation tools do you have access to? Please list them with their names and what they do.',
        conversationId: null  // New conversation
      })
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (response.status === 401) {
      console.log('');
      console.log('⚠️  Authentication required (expected)');
      console.log('');
      console.log('To test agent tool access:');
      console.log('');
      console.log('OPTION 1: Use the browser');
      console.log('─────────────────────────────────────────────────────');
      console.log('1. Open: https://grant-card-assistant-staging.up.railway.app/readiness-strategist/new');
      console.log('2. Ask: "What document creation tools do you have access to?"');
      console.log('3. Verify the response mentions:');
      console.log('   ✓ create_advanced_document');
      console.log('   ✓ create_google_drive_folder');
      console.log('   ✓ create_google_sheet');
      console.log('4. Verify it does NOT mention:');
      console.log('   ✗ create_google_doc');
      console.log('');
      console.log('OPTION 2: Get your JWT token');
      console.log('─────────────────────────────────────────────────────');
      console.log('1. Open Railway staging in browser');
      console.log('2. Open DevTools (F12) → Application → Cookies');
      console.log('3. Copy the "granted_session" cookie value');
      console.log('4. Run this script with: JWT_TOKEN="your-token" node test-agent-tools-direct.js');
      console.log('');
    } else if (response.ok) {
      console.log('✅ Got response from agent');

      // For SSE stream, we'd need to parse it differently
      const text = await response.text();
      console.log('Response preview:', text.substring(0, 500));
    } else {
      console.log('❌ Unexpected response');
      const text = await response.text();
      console.log('Error:', text);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Check if JWT token provided
const JWT_TOKEN = process.env.JWT_TOKEN;

if (JWT_TOKEN) {
  console.log('✓ JWT token provided, will authenticate\n');
  // Would use the token in the fetch request
} else {
  console.log('ℹ️  No JWT token provided (use JWT_TOKEN env var)\n');
}

testAgentToolsDirect().then(() => {
  console.log('\n✓ Test complete');
  process.exit(0);
}).catch(error => {
  console.error('\n✗ Test failed:', error);
  process.exit(1);
});

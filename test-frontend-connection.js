// Quick test to verify the frontend libraries work correctly
import fetch from 'node-fetch';

// Simulate the config
const CONFIG = {
  RAILWAY_API: 'https://grant-card-assistant-production.up.railway.app',
  USE_AGENT_SDK: true,
  AGENT_TYPES: {
    'grant-cards': 'grant-card-generator',
  },
  getAgentEndpoint() {
    return `${this.RAILWAY_API}/api/agent`;
  },
  getAgentType(frontendType) {
    return this.AGENT_TYPES[frontendType] || frontendType;
  }
};

async function testFrontendConnection() {
  console.log('🧪 Testing Frontend → Railway Connection\n');
  console.log(`Endpoint: ${CONFIG.getAgentEndpoint()}\n`);

  const body = {
    agentType: CONFIG.getAgentType('grant-cards'),
    conversationId: `frontend-test-${Date.now()}`,
    userId: 'frontend-test-user',
    message: 'Hello! This is a test from the frontend. Please respond briefly.',
    options: {}
  };

  console.log('📤 Sending request...');
  console.log(JSON.stringify(body, null, 2));
  console.log('');

  try {
    const response = await fetch(CONFIG.getAgentEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log(`📥 Response: ${response.status} ${response.statusText}`);
    console.log(`Content-Type: ${response.headers.get('content-type')}\n`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const events = text.split('\n\n').filter(e => e.startsWith('data: '));

    console.log(`📊 Received ${events.length} SSE events\n`);

    let fullResponse = '';
    let complete = false;

    for (const event of events) {
      try {
        const data = JSON.parse(event.replace('data: ', ''));

        if (data.type === 'content') {
          fullResponse += data.text;
        } else if (data.type === 'complete') {
          complete = true;
          console.log('✅ Stream completed');
          console.log(`💰 Cost: $${data.cost?.toFixed(4) || '0.0000'}`);
        } else if (data.type === 'tool_use') {
          console.log(`🔧 Tool used: ${data.tool}`);
        }
      } catch (e) {
        // Skip malformed events
      }
    }

    console.log(`\n📝 Response preview (first 200 chars):`);
    console.log(fullResponse.substring(0, 200) + '...\n');

    if (complete && fullResponse) {
      console.log('🎉 SUCCESS: Frontend connection to Railway Agent SDK is working!\n');
      return true;
    } else {
      console.log('⚠️  WARNING: Response received but may be incomplete\n');
      return false;
    }

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    return false;
  }
}

testFrontendConnection().then(success => {
  process.exit(success ? 0 : 1);
});

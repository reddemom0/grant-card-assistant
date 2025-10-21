import fetch from 'node-fetch';

const RAILWAY_URL = 'https://grant-card-assistant-production.up.railway.app';

async function testAgentEndpoint() {
  console.log('🧪 Testing Railway Agent SDK endpoint...\n');

  const testRequest = {
    agentType: 'grant-card-generator',
    conversationId: `test-${Date.now()}`,
    userId: 'test-user-123',
    message: 'Hello! Can you introduce yourself briefly?',
  };

  try {
    console.log('📤 Sending request to:', `${RAILWAY_URL}/api/agent`);
    console.log('📝 Request body:', JSON.stringify(testRequest, null, 2));

    const response = await fetch(`${RAILWAY_URL}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testRequest),
    });

    console.log('\n📥 Response status:', response.status);
    console.log('📥 Response headers:', Object.fromEntries(response.headers.entries()));

    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      console.log('\n✅ SSE stream detected, reading events...\n');

      const text = await response.text();
      const events = text.split('\n\n').filter(e => e.startsWith('data: '));

      console.log(`📊 Received ${events.length} events\n`);

      for (const event of events) {
        try {
          const data = JSON.parse(event.replace('data: ', ''));
          console.log('Event:', data.type);

          if (data.type === 'content') {
            console.log('  Content:', data.text.substring(0, 100) + '...');
          } else if (data.type === 'error') {
            console.log('  ❌ Error:', data.error);
            console.log('  Code:', data.code);
          } else if (data.type === 'complete') {
            console.log('  ✅ Complete');
            console.log('  Cost:', data.cost);
            console.log('  Duration:', data.duration, 'ms');
          } else if (data.type === 'tool_use') {
            console.log('  🔧 Tool:', data.tool);
          }
        } catch (e) {
          console.log('Raw event:', event);
        }
      }
    } else {
      const text = await response.text();
      console.log('\n📄 Response body:', text);
    }

    console.log('\n✅ Test completed');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testAgentEndpoint();

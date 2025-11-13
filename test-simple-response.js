/**
 * Simple test: Ask agent a basic question to verify it's responding
 */

const RAILWAY_STAGING_URL = 'https://grant-card-assistant-staging.up.railway.app';

async function testSimpleResponse() {
  console.log('🧪 Testing basic agent response...\n');

  try {
    const response = await fetch(`${RAILWAY_STAGING_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentType: 'readiness-strategist',
        message: 'Hello! What is your role?',
        conversationId: null
      })
    });

    console.log(`Status: ${response.status}\n`);

    if (!response.ok) {
      console.log('❌ Error:', await response.text());
      return;
    }

    // Parse SSE
    const text = await response.text();
    const events = text.split('\n\n').filter(e => e.trim());

    let fullMessage = '';
    let toolsUsed = [];
    let eventTypes = new Set();
    let errors = [];

    for (const event of events) {
      if (!event.startsWith('data: ')) continue;

      try {
        const data = JSON.parse(event.substring(6));
        eventTypes.add(data.type);

        if (data.type === 'content_delta' || data.type === 'text_delta') {
          fullMessage += data.text || '';
        } else if (data.type === 'tool_use') {
          toolsUsed.push(data.toolName);
        } else if (data.type === 'error') {
          errors.push(data);
        }
      } catch (e) {
        // Skip
      }
    }

    console.log('Event types received:', Array.from(eventTypes).join(', '));
    console.log(`\nTools used: ${toolsUsed.length > 0 ? toolsUsed.join(', ') : 'none'}`);

    if (errors.length > 0) {
      console.log('\n❌ ERRORS DETECTED:');
      console.log('═'.repeat(60));
      errors.forEach((error, i) => {
        console.log(`\nError ${i + 1}:`);
        console.log(JSON.stringify(error, null, 2));
      });
      console.log('═'.repeat(60));
    }

    console.log(`\n📝 Response (${fullMessage.length} characters):`);
    console.log('─'.repeat(60));
    console.log(fullMessage || '(EMPTY)');
    console.log('─'.repeat(60));

    if (fullMessage.length > 0) {
      console.log('\n✅ Agent is responding normally');
    } else if (errors.length > 0) {
      console.log('\n❌ Agent hit an error - see above for details');
    } else {
      console.log('\n❌ Agent response is empty - this suggests a problem');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testSimpleResponse().then(() => process.exit(0));

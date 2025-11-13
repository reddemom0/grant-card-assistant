/**
 * Stream-aware test: Ask agent about its tools and parse the full response
 */

const RAILWAY_STAGING_URL = 'https://grant-card-assistant-staging.up.railway.app';

async function testAgentToolsStream() {
  console.log('🧪 Testing agent tool access (with streaming)...\n');

  try {
    console.log('📡 Sending request to Railway staging...');
    console.log('');

    const response = await fetch(`${RAILWAY_STAGING_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentType: 'readiness-strategist',
        message: 'List all the document creation tools you have access to. Include their exact tool names.',
        conversationId: null
      })
    });

    console.log(`Status: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      const text = await response.text();
      console.log('❌ Error:', text);
      return;
    }

    // Read the entire stream
    const text = await response.text();

    // Parse SSE events
    const events = text.split('\n\n').filter(e => e.trim());

    console.log('📊 Stream events received:');
    console.log('─────────────────────────────────────────────────────');

    let fullMessage = '';
    let hasAdvancedDoc = false;
    let hasOldDoc = false;
    let toolMentions = [];

    for (const event of events) {
      if (!event.startsWith('data: ')) continue;

      const data = JSON.parse(event.substring(6));

      if (data.type === 'content_delta' || data.type === 'text_delta') {
        fullMessage += data.text || '';
      } else if (data.type === 'connected') {
        console.log(`✓ Connected (conversation: ${data.conversationId.substring(0, 8)}...)`);
      } else if (data.type === 'complete') {
        console.log(`✓ Response complete`);
      } else if (data.type === 'tool_use') {
        toolMentions.push(data.toolName);
      }
    }

    console.log('');
    console.log('📝 Agent\'s response:');
    console.log('─────────────────────────────────────────────────────');
    console.log(fullMessage);
    console.log('');

    // Check for tool mentions
    console.log('🔍 Analysis:');
    console.log('─────────────────────────────────────────────────────');

    hasAdvancedDoc = fullMessage.includes('create_advanced_document');
    hasOldDoc = fullMessage.includes('create_google_doc');

    console.log(`${hasAdvancedDoc ? '✅' : '❌'} Mentions create_advanced_document: ${hasAdvancedDoc ? 'YES' : 'NO'}`);
    console.log(`${!hasOldDoc ? '✅' : '❌'} Does NOT mention create_google_doc: ${!hasOldDoc ? 'YES (GOOD)' : 'NO (BAD)'}`);

    if (toolMentions.length > 0) {
      console.log(`\nTools actually used during response: ${toolMentions.join(', ')}`);
    }

    console.log('');

    if (hasAdvancedDoc && !hasOldDoc) {
      console.log('✅ SUCCESS! Agent has access to the new tool!');
    } else if (!hasAdvancedDoc) {
      console.log('❌ FAILED: Agent does not have access to create_advanced_document');
    } else if (hasOldDoc) {
      console.log('⚠️  WARNING: Agent still has access to old create_google_doc tool');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testAgentToolsStream().then(() => {
  console.log('\n✓ Test complete');
  process.exit(0);
}).catch(error => {
  console.error('\n✗ Test failed:', error);
  process.exit(1);
});

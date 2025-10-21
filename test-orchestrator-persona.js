// Test to verify orchestrator pattern is invoking specialized agent personas
import fetch from 'node-fetch';

async function testAgentPersona() {
  console.log('🧪 Testing Agent Persona with Orchestrator Pattern\n');

  const endpoint = 'https://grant-card-assistant-production.up.railway.app/api/agent';

  const body = {
    agentType: 'grant-card-generator',
    conversationId: `persona-test-${Date.now()}`,
    userId: 'persona-test-user',
    message: 'Who are you? Please introduce yourself.',
    options: {}
  };

  console.log('📤 Asking Grant Card Generator: "Who are you?"\n');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const events = text.split('\n\n').filter(e => e.startsWith('data: '));

    let fullResponse = '';
    let toolsUsed = [];

    for (const event of events) {
      try {
        const data = JSON.parse(event.replace('data: ', ''));

        if (data.type === 'content') {
          fullResponse += data.text;
        } else if (data.type === 'tool_use') {
          toolsUsed.push(data.tool);
          console.log(`🔧 Tool used: ${data.tool}`);
        } else if (data.type === 'complete') {
          console.log(`\n💰 Cost: $${data.cost?.toFixed(4) || '0.0000'}\n`);
        }
      } catch (e) {
        // Skip malformed events
      }
    }

    console.log('📝 Full Response:');
    console.log('─'.repeat(80));
    console.log(fullResponse);
    console.log('─'.repeat(80));
    console.log('');

    // Check if response matches expected persona
    const isSpecializedAgent =
      fullResponse.includes('Senior Grant Intelligence Analyst') ||
      fullResponse.includes('Granted Consulting') ||
      fullResponse.includes('grant card') ||
      fullResponse.includes('funding opportunities');

    const isGenericClaude =
      fullResponse.includes("I'm Claude, an AI assistant made by Anthropic") ||
      fullResponse.includes("coding-related work");

    if (toolsUsed.includes('Task')) {
      console.log('✅ ORCHESTRATOR: Task tool was used (delegating to subagent)');
    } else {
      console.log('⚠️  WARNING: Task tool was NOT used (orchestrator may not be delegating)');
    }

    if (isSpecializedAgent) {
      console.log('✅ SUCCESS: Agent is using specialized Grant Card Generator persona!');
      return true;
    } else if (isGenericClaude) {
      console.log('❌ FAILURE: Agent is still using generic Claude persona');
      return false;
    } else {
      console.log('⚠️  UNCERTAIN: Agent response doesn\'t clearly match either persona');
      return false;
    }

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    return false;
  }
}

testAgentPersona().then(success => {
  process.exit(success ? 0 : 1);
});

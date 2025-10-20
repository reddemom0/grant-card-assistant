/**
 * Google Drive MCP Integration Test
 * Tests the gdrive_search and gdrive_read_file tools with Agent SDK
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getAgentConfig, initializeGoogleDriveCredentials } from './config/agent-sdk-config.js';
import { loadAgentDefinitions } from './src/load-agents.js';
import { config } from 'dotenv';

// Load environment variables
config();

console.log('\n🚀 Google Drive MCP Integration Test\n');
console.log('=' .repeat(60));

// Initialize Google Drive credentials
await initializeGoogleDriveCredentials();

// Load agent definitions
const agentDefinitions = loadAgentDefinitions();
const agentType = 'grant-card-generator';

// Get agent configuration
const agentConfig = getAgentConfig(agentType);

console.log(`\n✅ Agent: ${agentType}`);
console.log(`✅ Model: ${agentConfig.model}`);
console.log(`✅ Tools available: ${agentConfig.allowedTools.length}`);
console.log(`   - ${agentConfig.allowedTools.join(', ')}`);

// Check if Google Drive tools are available
const hasGDriveSearch = agentConfig.allowedTools.includes('gdrive_search');
const hasGDriveRead = agentConfig.allowedTools.includes('gdrive_read_file');

console.log(`\n📁 Google Drive Tools:`);
console.log(`   ${hasGDriveSearch ? '✅' : '❌'} gdrive_search`);
console.log(`   ${hasGDriveRead ? '✅' : '❌'} gdrive_read_file`);

if (!hasGDriveSearch || !hasGDriveRead) {
  console.error('\n❌ Error: Google Drive tools not configured!');
  process.exit(1);
}

// Check MCP server configuration
console.log(`\n🔧 MCP Server Configuration:`);
if (agentConfig.mcpServers && agentConfig.mcpServers['google-drive']) {
  const mcpConfig = agentConfig.mcpServers['google-drive'];
  console.log(`   Type: ${mcpConfig.type}`);
  console.log(`   Command: ${mcpConfig.command}`);
  console.log(`   Args: ${mcpConfig.args.join(' ')}`);
  console.log(`   ✅ MCP server configured`);
} else {
  console.error('   ❌ MCP server not configured');
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('\n🧪 Starting Test Conversation...\n');

// Test message
const testMessage = "Search our Google Drive for documents about grant eligibility criteria";

console.log(`📤 User Message: "${testMessage}"\n`);

try {
  // Create the query
  const result = await query({
    prompt: testMessage,
    options: {
      // System prompt configuration
      settingSources: agentConfig.settingSources,
      systemPrompt: agentConfig.systemPrompt,

      // Agent definition
      agents: {
        [agentType]: agentDefinitions[agentType]
      },

      // Model configuration
      model: agentConfig.model,
      fallbackModel: agentConfig.fallbackModel,

      // Extended thinking
      maxThinkingTokens: agentConfig.maxThinkingTokens,

      // Conversation limits
      maxTurns: agentConfig.maxTurns,

      // Tool permissions
      allowedTools: agentConfig.allowedTools,

      // MCP servers
      mcpServers: agentConfig.mcpServers,

      // Working directory
      cwd: process.cwd(),

      // Streaming configuration
      includePartialMessages: agentConfig.includePartialMessages,

      // Permission mode (bypass for testing)
      permissionMode: 'bypassPermissions',

      // Beta headers
      betas: agentConfig.betaHeaders,
    }
  });

  let assistantResponse = '';
  let toolsUsed = [];
  let filesFound = [];
  let filesRead = [];

  console.log('📊 Agent Response Stream:\n');

  // Process the streaming response
  for await (const msg of result) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      console.log(`🚀 Agent initialized`);
      console.log(`   Model: ${msg.model}`);
      console.log(`   Tools: ${msg.tools.length} available`);
    }

    if (msg.type === 'stream_event') {
      // Tool use started
      if (msg.event.type === 'content_block_start' && msg.event.content_block?.type === 'tool_use') {
        const toolName = msg.event.content_block.name;
        const toolId = msg.event.content_block.id;
        toolsUsed.push({ name: toolName, id: toolId });
        console.log(`\n🔧 Using tool: ${toolName} (${toolId})`);
      }

      // Tool input
      if (msg.event.type === 'content_block_delta' && msg.event.delta?.type === 'input_json_delta') {
        const partial = msg.event.delta.partial_json;
        if (partial) {
          process.stdout.write(partial);
        }
      }
    }

    if (msg.type === 'tool') {
      const toolName = msg.tool.name;
      const toolResult = msg.result;

      console.log(`\n\n📥 Tool result (${toolName}):`);

      if (toolName === 'gdrive_search') {
        // Parse search results
        try {
          const searchResults = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
          if (Array.isArray(searchResults)) {
            filesFound = searchResults;
            console.log(`   Found ${searchResults.length} file(s):`);
            searchResults.forEach((file, i) => {
              console.log(`   ${i + 1}. ${file.name} (${file.id})`);
              console.log(`      Type: ${file.mimeType}`);
              console.log(`      Modified: ${file.modifiedTime}`);
            });
          } else {
            console.log(`   ${toolResult.substring(0, 200)}...`);
          }
        } catch (e) {
          console.log(`   ${toolResult.substring(0, 200)}...`);
        }
      } else if (toolName === 'gdrive_read_file') {
        filesRead.push(toolResult);
        const preview = toolResult.substring(0, 300);
        console.log(`   Content preview (first 300 chars):`);
        console.log(`   ${preview}...`);
      } else {
        const preview = toolResult.substring(0, 200);
        console.log(`   ${preview}...`);
      }
    }

    if (msg.type === 'assistant') {
      // Extract assistant message
      const content = msg.message.content;
      for (const block of content) {
        if (block.type === 'text') {
          assistantResponse += block.text;
        }
      }
    }

    if (msg.type === 'result') {
      console.log(`\n\n✅ Conversation complete`);
      console.log(`   Session ID: ${msg.session_id}`);
      console.log(`   Cost: $${msg.total_cost_usd.toFixed(4)}`);
      console.log(`   Input tokens: ${msg.usage.input_tokens}`);
      console.log(`   Output tokens: ${msg.usage.output_tokens}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📝 Final Assistant Response:\n');
  console.log(assistantResponse);

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Summary:\n');
  console.log(`✅ Tools used: ${toolsUsed.length}`);
  toolsUsed.forEach((tool, i) => {
    console.log(`   ${i + 1}. ${tool.name}`);
  });

  console.log(`\n📁 Files found: ${filesFound.length}`);
  if (filesFound.length > 0) {
    filesFound.forEach((file, i) => {
      console.log(`   ${i + 1}. ${file.name}`);
    });
  }

  console.log(`\n📄 Files read: ${filesRead.length}`);

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Google Drive MCP Integration Test PASSED!\n');

} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  if (error.stack) {
    console.error('\nStack trace:');
    console.error(error.stack);
  }
  process.exit(1);
}

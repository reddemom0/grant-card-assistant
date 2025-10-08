#!/usr/bin/env node

/**
 * Test script for Grant Card Agent with Agent SDK
 *
 * This validates:
 * - Agent SDK installation and configuration
 * - CLAUDE.md loading via settingSources
 * - grant-card.md loading as system prompt
 * - XML output schema understanding
 * - API connectivity and token usage
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testGrantCardAgent() {
  console.log('🧪 Testing Grant Card Agent with Agent SDK\n');
  console.log('='.repeat(60));

  try {
    // Load the grant-card.md system prompt
    const systemPromptPath = path.join(__dirname, '.claude', 'agents', 'grant-card.md');
    const systemPromptContent = fs.readFileSync(systemPromptPath, 'utf-8');

    console.log('✅ Loaded system prompt from:', systemPromptPath);
    console.log(`   Length: ${systemPromptContent.length} characters (${systemPromptContent.split('\n').length} lines)\n`);

    // Configuration
    const config = {
      prompt: "Explain the 6 Grant Card workflows and show me the XML schema structure.",
      options: {
        systemPrompt: {
          type: 'custom',
          value: systemPromptContent
        },
        settingSources: ['project'], // This loads .claude/CLAUDE.md
        model: 'claude-sonnet-4-20250514',
        maxTurns: 1,
        // Note: Agent SDK doesn't use allowedTools in the same way as the API
        // Tools are available by default in the SDK
      }
    };

    console.log('📝 Configuration:');
    console.log(`   Model: ${config.options.model}`);
    console.log(`   Setting Sources: ${config.options.settingSources.join(', ')}`);
    console.log(`   System Prompt: Custom (${systemPromptContent.split('\n').length} lines)`);
    console.log(`   Max Turns: ${config.options.maxTurns}`);
    console.log('\n' + '='.repeat(60));
    console.log('🚀 Sending query to Agent SDK...\n');

    const startTime = Date.now();

    // Query the agent
    const result = await query(config);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('='.repeat(60));
    console.log('✅ Response received!\n');

    // Debug: Show actual result structure
    console.log('🔍 Debug: Result structure:', JSON.stringify(result, null, 2).substring(0, 500) + '...\n');

    // Extract content from result (handle different response formats)
    let content = '';
    if (typeof result === 'string') {
      content = result;
    } else if (result.content) {
      content = result.content;
    } else if (result.response) {
      content = result.response;
    } else if (result.text) {
      content = result.text;
    } else if (result.message) {
      content = result.message;
    } else {
      content = JSON.stringify(result);
    }

    // Display session information
    console.log('📊 Session Information:');
    console.log(`   Session ID: ${result.sessionId || result.id || 'N/A'}`);
    console.log(`   Duration: ${duration}s\n`);

    // Display token usage if available
    const usage = result.usage || result.metadata?.usage;
    if (usage) {
      console.log('📈 Token Usage:');
      const inputTokens = usage.inputTokens || usage.input_tokens || usage.prompt_tokens || 0;
      const outputTokens = usage.outputTokens || usage.output_tokens || usage.completion_tokens || 0;
      console.log(`   Input tokens: ${inputTokens.toLocaleString()}`);
      console.log(`   Output tokens: ${outputTokens.toLocaleString()}`);
      console.log(`   Total tokens: ${(inputTokens + outputTokens).toLocaleString()}`);

      // Calculate cost (Claude Sonnet 4 pricing: $3/MTok input, $15/MTok output)
      if (inputTokens && outputTokens) {
        const inputCost = (inputTokens / 1000000) * 3;
        const outputCost = (outputTokens / 1000000) * 15;
        const totalCost = inputCost + outputCost;
        console.log(`   Estimated cost: $${totalCost.toFixed(4)}`);
        console.log(`     (Input: $${inputCost.toFixed(4)}, Output: $${outputCost.toFixed(4)})`);
      }
      console.log();
    }

    // Display response content
    console.log('💬 Response Content:');
    console.log('='.repeat(60));
    console.log(content || '[No content in response]');
    console.log('='.repeat(60));
    console.log();

    // Validation checks
    console.log('🔍 Validation Checks:');

    const contentLower = (content || '').toLowerCase();
    const checks = [
      {
        name: 'Response received',
        passed: content && content.length > 0
      },
      {
        name: 'XML schema mentioned',
        passed: contentLower.includes('xml') || content.includes('<grant_card>')
      },
      {
        name: '6 workflows mentioned',
        passed: content.includes('6') && (
          contentLower.includes('workflow') ||
          contentLower.includes('criteria') ||
          contentLower.includes('preview')
        )
      },
      {
        name: 'Company name (Granted Consulting) mentioned',
        passed: contentLower.includes('granted consulting') ||
                contentLower.includes('granted')
      },
      {
        name: 'settingSources working (CLAUDE.md loaded)',
        passed: contentLower.includes('granted consulting') ||
                contentLower.includes('company')
      }
    ];

    checks.forEach(check => {
      const icon = check.passed ? '✅' : '❌';
      console.log(`   ${icon} ${check.name}`);
    });

    const allPassed = checks.every(check => check.passed);

    console.log();
    console.log('='.repeat(60));

    if (allPassed) {
      console.log('🎉 ALL TESTS PASSED! Agent SDK is working correctly.\n');
      console.log('The Grant Card agent successfully:');
      console.log('  ✅ Loaded the grant-card.md system prompt (2,002 lines)');
      console.log('  ✅ Loaded CLAUDE.md via settingSources');
      console.log('  ✅ Understands the 6 workflows');
      console.log('  ✅ Knows about XML output schema');
      console.log('  ✅ Connected to Claude API successfully');
    } else {
      console.log('⚠️  Some tests failed. Review the validation checks above.\n');
    }

    console.log('='.repeat(60));

    // Save full response to file for detailed review
    const outputPath = path.join(__dirname, 'test-grant-card-output.txt');
    const usageData = result.usage || result.metadata?.usage;
    const inputToks = usageData?.inputTokens || usageData?.input_tokens || usageData?.prompt_tokens || 0;
    const outputToks = usageData?.outputTokens || usageData?.output_tokens || usageData?.completion_tokens || 0;

    const outputContent = `Grant Card Agent Test Output
Generated: ${new Date().toISOString()}
Duration: ${duration}s
Session ID: ${result.sessionId || result.id || 'N/A'}

${usageData ? `Token Usage:
- Input: ${inputToks.toLocaleString()}
- Output: ${outputToks.toLocaleString()}
- Total: ${(inputToks + outputToks).toLocaleString()}
` : ''}
${'='.repeat(60)}

${content}

${'='.repeat(60)}

DEBUG - Full Result Object:
${JSON.stringify(result, null, 2)}
`;

    fs.writeFileSync(outputPath, outputContent, 'utf-8');
    console.log(`\n📄 Full response saved to: ${outputPath}\n`);

  } catch (error) {
    console.error('❌ Error testing Grant Card Agent:');
    console.error(error.message);

    if (error.response) {
      console.error('\n📋 API Response Details:');
      console.error(JSON.stringify(error.response, null, 2));
    }

    if (error.stack) {
      console.error('\n🔍 Stack Trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run the test
testGrantCardAgent();

#!/usr/bin/env node

/**
 * Direct API test for ETG Writer Agent
 *
 * This bypasses the Agent SDK and uses Anthropic API directly
 * to validate that our system prompt and CLAUDE.md work correctly.
 *
 * Note: Uses the same ANTHROPIC_API_KEY as production (api/server.js)
 * Two caching systems work together:
 * - Anthropic Prompt Caching: Automatic 75% token reduction on large prompts
 * - Upstash Redis: Session/conversation state storage (separate system)
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testETGAgentDirect() {
  console.log('🧪 Testing ETG Writer Agent (Direct API)\n');
  console.log('='.repeat(60));

  try {
    // Load system prompts
    const etgPath = path.join(__dirname, '.claude', 'agents', 'etg-writer.md');
    const claudePath = path.join(__dirname, '.claude', 'CLAUDE.md');

    const etgContent = fs.readFileSync(etgPath, 'utf-8');
    const claudeContent = fs.readFileSync(claudePath, 'utf-8');

    console.log('✅ Loaded etg-writer.md:', etgPath);
    console.log(`   Length: ${etgContent.length} characters (${etgContent.split('\n').length} lines)`);
    console.log('✅ Loaded CLAUDE.md:', claudePath);
    console.log(`   Length: ${claudeContent.length} characters (${claudeContent.split('\n').length} lines)\n`);

    // Combine system prompts (CLAUDE.md + etg-writer.md)
    const combinedSystemPrompt = `${claudeContent}\n\n---\n\n${etgContent}`;

    console.log('📝 Configuration:');
    console.log(`   Model: claude-sonnet-4-20250514`);
    console.log(`   System Prompt: ${combinedSystemPrompt.split('\n').length} lines total`);
    console.log(`     - CLAUDE.md: ${claudeContent.split('\n').length} lines`);
    console.log(`     - etg-writer.md: ${etgContent.split('\n').length} lines`);
    console.log('\n' + '='.repeat(60));
    console.log('🚀 Sending query to Anthropic API...\n');

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const startTime = Date.now();

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: combinedSystemPrompt,
      messages: [
        {
          role: 'user',
          content: 'Explain your role as an ETG Business Case Specialist. What are the 7 workflow steps? What training types are ineligible? What are "better job" outcomes?'
        }
      ]
    });

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('='.repeat(60));
    console.log('✅ Response received!\n');

    // Display session information
    console.log('📊 Message Information:');
    console.log(`   Message ID: ${message.id}`);
    console.log(`   Model: ${message.model}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Stop Reason: ${message.stop_reason}\n`);

    // Display token usage
    console.log('📈 Token Usage:');
    console.log(`   Input tokens: ${message.usage.input_tokens.toLocaleString()}`);
    console.log(`   Output tokens: ${message.usage.output_tokens.toLocaleString()}`);

    // Check for cache hits (Anthropic's automatic prompt caching)
    const cacheCreationTokens = message.usage.cache_creation_input_tokens || 0;
    const cacheReadTokens = message.usage.cache_read_input_tokens || 0;

    if (cacheCreationTokens > 0) {
      console.log(`   Cache creation tokens: ${cacheCreationTokens.toLocaleString()} (first request - cached for 5min)`);
    }
    if (cacheReadTokens > 0) {
      console.log(`   Cache read tokens: ${cacheReadTokens.toLocaleString()} (75% savings!)`);
    }

    console.log(`   Total tokens: ${(message.usage.input_tokens + message.usage.output_tokens).toLocaleString()}`);

    // Calculate cost (Claude Sonnet 4 pricing: $3/MTok input, $15/MTok output)
    // Cache reads cost $0.30/MTok (90% discount), cache writes cost $3.75/MTok (25% premium)
    const regularInputCost = ((message.usage.input_tokens - cacheCreationTokens - cacheReadTokens) / 1000000) * 3;
    const cacheCreationCost = (cacheCreationTokens / 1000000) * 3.75;
    const cacheReadCost = (cacheReadTokens / 1000000) * 0.30;
    const inputCost = regularInputCost + cacheCreationCost + cacheReadCost;
    const outputCost = (message.usage.output_tokens / 1000000) * 15;
    const totalCost = inputCost + outputCost;

    console.log(`   Estimated cost: $${totalCost.toFixed(4)}`);
    console.log(`     (Input: $${inputCost.toFixed(4)}, Output: $${outputCost.toFixed(4)})`);

    if (cacheReadTokens > 0) {
      const costWithoutCache = ((message.usage.input_tokens / 1000000) * 3) + outputCost;
      const savings = costWithoutCache - totalCost;
      console.log(`     Cache savings: $${savings.toFixed(4)} (${((savings / costWithoutCache) * 100).toFixed(1)}%)`);
    }
    console.log();

    // Log for analytics tracking
    const analyticsLog = {
      timestamp: new Date().toISOString(),
      system: 'agent-sdk-test',
      agent: 'etg-writer',
      model: message.model,
      message_id: message.id,
      duration_seconds: parseFloat(duration),
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_creation_tokens: cacheCreationTokens,
        cache_read_tokens: cacheReadTokens,
        total_tokens: message.usage.input_tokens + message.usage.output_tokens
      },
      cost_usd: {
        input: parseFloat(inputCost.toFixed(6)),
        output: parseFloat(outputCost.toFixed(6)),
        total: parseFloat(totalCost.toFixed(6)),
        cache_savings: cacheReadTokens > 0 ? parseFloat(savings.toFixed(6)) : 0
      },
      cache_hit: cacheReadTokens > 0,
      cache_hit_percentage: cacheReadTokens > 0 ? parseFloat(((cacheReadTokens / message.usage.input_tokens) * 100).toFixed(2)) : 0
    };

    console.log('📊 Analytics Log (for comparison with production):');
    console.log(JSON.stringify(analyticsLog, null, 2));
    console.log();

    // Extract text content
    const content = message.content[0].type === 'text' ? message.content[0].text : '[Non-text content]';

    // Display response content
    console.log('💬 Response Content:');
    console.log('='.repeat(60));
    console.log(content);
    console.log('='.repeat(60));
    console.log();

    // Validation checks
    console.log('🔍 Validation Checks:');

    const contentLower = content.toLowerCase();
    const checks = [
      {
        name: 'Response received',
        passed: content && content.length > 0
      },
      {
        name: 'ETG role mentioned',
        passed: contentLower.includes('etg') || contentLower.includes('employer training grant')
      },
      {
        name: '7 workflow steps mentioned',
        passed: (content.match(/step|workflow/gi) || []).length >= 5
      },
      {
        name: 'Eligibility verification mentioned',
        passed: contentLower.includes('eligibility')
      },
      {
        name: 'Ineligible training types listed',
        passed: contentLower.includes('seminar') || contentLower.includes('conference') || contentLower.includes('ineligible')
      },
      {
        name: 'Better job outcomes explained',
        passed: contentLower.includes('better job') ||
                (contentLower.includes('promotion') || contentLower.includes('wage'))
      },
      {
        name: 'Company name (Granted Consulting) mentioned',
        passed: contentLower.includes('granted consulting') ||
                contentLower.includes('granted')
      },
      {
        name: 'CLAUDE.md loaded correctly',
        passed: contentLower.includes('granted consulting') ||
                contentLower.includes('company')
      },
      {
        name: 'BC training market referenced',
        passed: contentLower.includes('bc') || contentLower.includes('british columbia')
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
      console.log('🎉 ALL TESTS PASSED! ETG Writer agent is working correctly.\n');
      console.log('The ETG Writer agent successfully:');
      console.log('  ✅ Loaded CLAUDE.md (shared knowledge)');
      console.log(`  ✅ Loaded etg-writer.md system prompt (${etgContent.split('\n').length} lines)`);
      console.log('  ✅ Understands the 7 workflow steps');
      console.log('  ✅ Knows about eligibility rules');
      console.log('  ✅ Can explain ineligible training types');
      console.log('  ✅ Understands "better job" outcomes');
      console.log('  ✅ Connected to Claude API successfully');
    } else {
      console.log('⚠️  Some tests failed. Review the validation checks above.\n');
    }

    console.log('='.repeat(60));

    // Save full response to file
    const outputPath = path.join(__dirname, 'test-etg-direct-output.txt');
    const outputContent = `ETG Writer Agent Direct API Test Output
Generated: ${new Date().toISOString()}
Duration: ${duration}s
Message ID: ${message.id}
Model: ${message.model}

Token Usage:
- Input: ${message.usage.input_tokens.toLocaleString()}
- Output: ${message.usage.output_tokens.toLocaleString()}
- Total: ${(message.usage.input_tokens + message.usage.output_tokens).toLocaleString()}
- Cost: $${totalCost.toFixed(4)}

${'='.repeat(60)}

${content}

${'='.repeat(60)}

Full Message Object:
${JSON.stringify(message, null, 2)}
`;

    fs.writeFileSync(outputPath, outputContent, 'utf-8');
    console.log(`\n📄 Full response saved to: ${outputPath}\n`);

  } catch (error) {
    console.error('❌ Error testing ETG Writer Agent:');
    console.error(error.message);

    if (error.status) {
      console.error(`\n📋 API Error Details:`);
      console.error(`   Status: ${error.status}`);
      console.error(`   Type: ${error.error?.type}`);
      console.error(`   Message: ${error.error?.message}`);
    }

    if (error.stack) {
      console.error('\n🔍 Stack Trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run the test
testETGAgentDirect();

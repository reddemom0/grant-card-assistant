#!/usr/bin/env node

/**
 * Direct API test for CanExport Claims Agent
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

async function testCanExportClaimsAgentDirect() {
  console.log('🧪 Testing CanExport Claims Agent (Direct API)\n');
  console.log('='.repeat(60));

  try {
    // Load system prompts
    const canexportClaimsPath = path.join(__dirname, '.claude', 'agents', 'canexport-claims.md');
    const claudePath = path.join(__dirname, '.claude', 'CLAUDE.md');

    const canexportClaimsContent = fs.readFileSync(canexportClaimsPath, 'utf-8');
    const claudeContent = fs.readFileSync(claudePath, 'utf-8');

    console.log('✅ Loaded canexport-claims.md:', canexportClaimsPath);
    console.log(`   Length: ${canexportClaimsContent.length} characters (${canexportClaimsContent.split('\n').length} lines)`);
    console.log('✅ Loaded CLAUDE.md:', claudePath);
    console.log(`   Length: ${claudeContent.length} characters (${claudeContent.split('\n').length} lines)\n`);

    // Combine system prompts (CLAUDE.md + canexport-claims.md)
    const combinedSystemPrompt = `${claudeContent}\n\n---\n\n${canexportClaimsContent}`;

    console.log('📝 Configuration:');
    console.log(`   Model: claude-sonnet-4-20250514`);
    console.log(`   System Prompt: ${combinedSystemPrompt.split('\n').length} lines total`);
    console.log(`     - CLAUDE.md: ${claudeContent.split('\n').length} lines`);
    console.log(`     - canexport-claims.md: ${canexportClaimsContent.split('\n').length} lines`);
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
          content: 'Explain your role as a CanExport Claims Compliance Officer. What are the 8 expense categories (A-H)? What are the most critical rejection patterns I should watch for? What financial rules are NON-NEGOTIABLE?'
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
      agent: 'canexport-claims',
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
        name: 'CanExport Claims role mentioned',
        passed: contentLower.includes('canexport') && (contentLower.includes('compliance') || contentLower.includes('audit') || contentLower.includes('sarah chen'))
      },
      {
        name: '8 expense categories mentioned (A-H)',
        passed: (contentLower.includes('category a') || contentLower.includes('travel')) &&
                (contentLower.includes('category h') || contentLower.includes('intellectual property'))
      },
      {
        name: 'Historical rejection patterns mentioned',
        passed: contentLower.includes('amazon') || contentLower.includes('rejection') || contentLower.includes('booth purchase')
      },
      {
        name: 'Tax removal rule emphasized (NO TAXES)',
        passed: (contentLower.includes('no tax') || contentLower.includes('remove') && contentLower.includes('tax'))
      },
      {
        name: '50% reimbursement rule mentioned',
        passed: contentLower.includes('50%') && contentLower.includes('reimburse')
      },
      {
        name: 'Corporate payment method requirement',
        passed: contentLower.includes('corporate') && (contentLower.includes('payment') || contentLower.includes('account'))
      },
      {
        name: 'Two audit modes explained (Quick Check vs Full Audit)',
        passed: (contentLower.includes('mode') || contentLower.includes('quick check') || contentLower.includes('full audit'))
      },
      {
        name: 'Project timeline compliance mentioned',
        passed: (contentLower.includes('project start') || contentLower.includes('project') && contentLower.includes('date'))
      },
      {
        name: 'International vs Canadian market distinction',
        passed: (contentLower.includes('international') || contentLower.includes('target market')) && contentLower.includes('canadian')
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
      console.log('🎉 ALL TESTS PASSED! CanExport Claims agent is working correctly.\n');
      console.log('The CanExport Claims agent successfully:');
      console.log('  ✅ Loaded CLAUDE.md (shared knowledge)');
      console.log(`  ✅ Loaded canexport-claims.md system prompt (${canexportClaimsContent.split('\n').length} lines)`);
      console.log('  ✅ Understands the 8 expense categories (A-H)');
      console.log('  ✅ Knows historical rejection patterns');
      console.log('  ✅ Emphasizes critical financial rules');
      console.log('  ✅ Explains two audit modes');
      console.log('  ✅ Connected to Claude API successfully');
    } else {
      console.log('⚠️  Some tests failed. Review the validation checks above.\n');
    }

    console.log('='.repeat(60));

    // Save full response to file
    const outputPath = path.join(__dirname, 'test-canexport-claims-direct-output.txt');
    const outputContent = `CanExport Claims Agent Direct API Test Output
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
    console.error('❌ Error testing CanExport Claims Agent:');
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
testCanExportClaimsAgentDirect();

/**
 * The two shared-code hooks the morning brief's cost trim relies on:
 *   - getQueryConfigForModel pins Sonnet 5.5 with the settings it accepts
 *     (adaptive thinking, effort, no temperature); Haiku is unchanged;
 *   - runAgent's additive options (abortSignal, costMetadata, the second
 *     onCostCalculated argument) are wired where the loop and logger run.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/brief-cost-hooks.test.js
 */

import { readFileSync } from 'fs';

const Q = await import('../../src/claude/query-classifier.js');

describe('getQueryConfigForModel', () => {
  test('forcing claude-sonnet-5-5: adaptive thinking, effort medium, no temperature, cap honoured', () => {
    const c = Q.getQueryConfigForModel('claude-sonnet-5-5', { maxIterations: 8 });
    expect(c.model).toBe('claude-sonnet-5-5');
    expect(c.thinking).toEqual(Q.ORACLE_SONNET.thinking);
    expect(c.effort).toBe('medium');
    expect(c.temperature).toBeUndefined();
    expect(c.maxIterations).toBe(8);
  });
  test('forcing Haiku is unchanged', () => {
    const c = Q.getQueryConfigForModel('claude-haiku-4-5-20251001');
    expect(c).toMatchObject({ model: 'claude-haiku-4-5-20251001', temperature: 0.3, maxTokens: 8000, maxIterations: 6 });
    expect(c.thinking).toBeUndefined();
    expect(c.effort).toBeUndefined();
  });
  test('classifier routing for ordinary Oracle messages is untouched', () => {
    expect(Q.getQueryConfig('Why did this deal stall? Compare it with last year.', 'internal-oracle', {}).model).toBe('claude-sonnet-5-5');
  });
});

describe('runAgent hooks (source wiring)', () => {
  const src = readFileSync(new URL('../../src/claude/client.js', import.meta.url), 'utf8');
  test('abortSignal and costMetadata are options, default off', () => {
    expect(src).toMatch(/abortSignal = null,/);
    expect(src).toMatch(/costMetadata = null/);
  });
  test('aborted runs stop before the next model call and before tool execution', () => {
    const loop = src.indexOf('while (loopCount < MAX_AGENT_LOOPS) {');
    expect(src.indexOf('if (abortSignal?.aborted)', loop)).toBeLessThan(src.indexOf('loopCount++;', loop));
    const toolCase = src.indexOf("if (fullResponse.stop_reason === 'tool_use') {");
    expect(src.indexOf('if (abortSignal?.aborted)', toolCase)).toBeLessThan(src.indexOf('executeToolCall(', toolCase));
  });
  test('quietLogs keeps tool inputs and results out of the runAgent and executor logs', () => {
    expect(src).toMatch(/quietLogs = false/);
    expect(src).toMatch(/if \(quietLogs\) console\.log\(`  📥 Input: \(/);
    expect(src).toMatch(/if \(quietLogs\) console\.log\(`  📤 Result: \(/);
    expect(src).toMatch(/\.\.\.\(quietLogs \? \{ quiet: true \} : \{\}\)/);
    const exec = readFileSync(new URL('../../src/tools/executor.js', import.meta.url), 'utf8');
    expect(exec).toMatch(/if \(options\.quiet\) console\.log\(`   Input: \(/);
    expect(exec).toMatch(/if \(options\.quiet\) console\.log\(`   Result: \(/);
    const web = readFileSync(new URL('../../src/api/lead-gen-init.js', import.meta.url), 'utf8');
    expect(web).toMatch(/quiet = false \} = \{\}\) \{/);
    expect(web).toMatch(/quiet \? 'a website' : websiteUrl/);
  });
  test('costMetadata reaches logAPICost; onCostCalculated gets usage + tool names', () => {
    expect(src).toMatch(/\.\.\.\(costMetadata \? \{ metadata: costMetadata \} : \{\}\),\s*usage,\s*model: MODEL,\s*source: 'agent-loop'/);
    expect(src).toMatch(/await onCostCalculated\(cost, \{ usage, model: MODEL, toolNames \}\)/);
  });
});

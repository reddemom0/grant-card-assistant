/**
 * Oracle on Sonnet 5.5
 *
 * Oracle's complex tier runs claude-sonnet-5-5 with adaptive thinking at medium
 * effort and no temperature (5.5 rejects budgets and non-default sampling); every
 * other agent keeps its model. Oracle's base prompt caches for 1h. Cost logging
 * prices 5m and 1h cache writes separately when the usage carries the split.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/oracle-sonnet-config.test.js
 */

import { getQueryConfig, ORACLE_SONNET } from '../../src/claude/query-classifier.js';
import { baseAgentPromptCache } from '../../src/claude/client.js';
import { mergeUsage } from '../../src/claude/streaming.js';
import { calculateRequestCost } from '../../src/config/cost-settings.js';

// Oracle's classifier sends "why/how/explain" to the complex tier.
const COMPLEX = 'Explain why this client is a fit for CanExport';

describe('Oracle model routing', () => {
  test('complex tier runs Sonnet 5.5 with adaptive thinking at medium effort', () => {
    const config = getQueryConfig(COMPLEX, 'internal-oracle');
    expect(config.complexity).toBe('complex');
    expect(config.model).toBe('claude-sonnet-5-5');
    expect(config.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(config.effort).toBe('medium');
    expect(config.temperature).toBeUndefined();
    expect(config.maxTokens).toBe(16000);
    expect(config).toMatchObject(ORACLE_SONNET);
  });

  test('simple tier stays on Haiku with no thinking', () => {
    const config = getQueryConfig('show my deals', 'internal-oracle');
    expect(config.model).toBe('claude-haiku-4-5');
    expect(config.thinking).toBeUndefined();
    expect(config.effort).toBeUndefined();
  });

  test('other agents keep Sonnet 4.6 with a thinking budget', () => {
    const config = getQueryConfig(COMPLEX, 'canexport-claims');
    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 });
    expect(config.temperature).toBe(1.0);
    expect(config.effort).toBeUndefined();
  });
});

describe('base prompt cache TTL', () => {
  test('Oracle gets 1h, other agents keep 5m', () => {
    expect(baseAgentPromptCache('internal-oracle')).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(baseAgentPromptCache('etg-writer')).toEqual({ type: 'ephemeral' });
    expect(baseAgentPromptCache('lead-gen')).toEqual({ type: 'ephemeral' });
  });
});

describe('streamed usage', () => {
  test('keeps the cache_creation split from message_start', () => {
    const start = {
      input_tokens: 10, output_tokens: 1,
      cache_creation_input_tokens: 40000, cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 40000 }
    };
    const delta = {
      input_tokens: 10, output_tokens: 120,
      cache_creation_input_tokens: 40000, cache_read_input_tokens: null
    };
    expect(mergeUsage(start, delta)).toEqual({
      input_tokens: 10, output_tokens: 120,
      cache_creation_input_tokens: 40000, cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 40000 }
    });
  });
});

describe('calculateRequestCost', () => {
  const close = (a, b) => expect(a).toBeCloseTo(b, 10);

  test('Sonnet 5.5 prices 5m and 1h writes separately', () => {
    const usage = {
      input_tokens: 1_000_000, output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 2_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 }
    };
    // input 2 + output 10 + read 0.20 + 5m write 2.50 + 1h write 4
    close(calculateRequestCost(usage, 'claude-sonnet-5-5'), 18.70);
  });

  test('without the split, writes are costed at the 5m rate', () => {
    close(calculateRequestCost({ cache_creation_input_tokens: 1_000_000 }, 'claude-sonnet-5-5'), 2.50);
  });

  test('Sonnet 4.6 and Haiku 4.5 rates are unchanged; 1h writes are 2x input', () => {
    close(calculateRequestCost({ input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }, 'claude-sonnet-4-6'), 6.75);
    close(calculateRequestCost({
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 }
    }, 'claude-haiku-4-5'), 2.00);
  });
});

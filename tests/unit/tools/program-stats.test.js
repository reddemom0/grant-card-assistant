/**
 * Unit tests for get_program_stats and get_deal_count (src/tools/hubspot.js).
 *
 * Uses Jest's ESM mocking pattern because the codebase is "type": "module".
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tools/program-stats.test.js
 */

import { jest } from '@jest/globals';

process.env.HUBSPOT_ACCESS_TOKEN = 'test-token';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: {
    create: () => ({ get: mockGet, post: mockPost })
  }
}));

jest.unstable_mockModule('axios-retry', () => ({
  default: jest.fn(),
  exponentialDelay: jest.fn(),
  isNetworkOrIdempotentRequestError: () => false
}));

const { getProgramStats, getDealCount } = await import('../../../src/tools/hubspot.js');

const ENUM_RESPONSE = {
  data: {
    options: [
      { value: 'ETG - BC' },
      { value: 'CanExport' },
      { value: 'BC MDP' },
      { value: 'CSJ' },
      { value: 'WorkBC' }
    ]
  }
};

function deal(state, createISO, closeISO) {
  return {
    id: String(Math.floor(Math.random() * 1e9)),
    properties: {
      state,
      createdate: createISO,
      closedate: closeISO,
      grant_type: 'ETG - BC'
    }
  };
}

function searchResponse(results, total) {
  return {
    data: {
      results,
      total: total ?? results.length,
      paging: null
    }
  };
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockResolvedValue(ENUM_RESPONSE);
});

// ============================================================================
// get_program_stats
// ============================================================================

describe('getProgramStats', () => {
  test('happy path: enough deals returns success_rate and high confidence', async () => {
    const results = [
      ...Array(40).fill(null).map(() => deal('Won', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')),
      ...Array(10).fill(null).map(() => deal('Lost', '2024-01-01T00:00:00Z', '2024-03-01T00:00:00Z')),
      ...Array(5).fill(null).map(() => deal('Open', '2024-06-01T00:00:00Z', null))
    ];
    mockPost.mockResolvedValueOnce(searchResponse(results));

    const out = await getProgramStats('ETG - BC');

    expect(out.success).toBe(true);
    expect(out.program).toBe('ETG - BC');
    expect(out.sample_size).toBe(55);
    expect(out.won_count).toBe(40);
    expect(out.lost_count).toBe(10);
    expect(out.pending_count).toBe(5);
    expect(out.success_rate).toBe(0.8);
    expect(out.confidence).toBe('high');
    expect(out.source).toBe('HubSpot');
    expect(out.avg_deal_days).toBeGreaterThan(0);
  });

  test('empty result: program valid but no deals returns sample_size=0 and insufficient_data', async () => {
    mockPost.mockResolvedValueOnce(searchResponse([]));

    const out = await getProgramStats('CSJ');

    expect(out.success).toBe(true);
    expect(out.sample_size).toBe(0);
    expect(out.won_count).toBe(0);
    expect(out.lost_count).toBe(0);
    expect(out.pending_count).toBe(0);
    expect(out.confidence).toBe('insufficient_data');
    expect(out.success_rate).toBeNull();
    expect(out.avg_deal_days).toBeNull();
  });

  test('below threshold (<5): returns insufficient_data with success_rate=null', async () => {
    const results = [
      deal('Won', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'),
      deal('Won', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'),
      deal('Lost', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')
    ];
    mockPost.mockResolvedValueOnce(searchResponse(results));

    const out = await getProgramStats('BC MDP');

    expect(out.sample_size).toBe(3);
    expect(out.confidence).toBe('insufficient_data');
    expect(out.success_rate).toBeNull();
    expect(out.won_count).toBe(2);
    expect(out.lost_count).toBe(1);
  });

  test('all pending: success_rate=null because denominator (won+lost) is 0, even with sufficient sample', async () => {
    const results = Array(20).fill(null).map(() => deal('Open', '2024-01-01T00:00:00Z', null));
    mockPost.mockResolvedValueOnce(searchResponse(results));

    const out = await getProgramStats('ETG - BC');

    expect(out.sample_size).toBe(20);
    expect(out.confidence).toBe('medium');
    expect(out.pending_count).toBe(20);
    expect(out.won_count).toBe(0);
    expect(out.lost_count).toBe(0);
    expect(out.success_rate).toBeNull();
    expect(out.avg_deal_days).toBeNull();
  });

  test('invalid program name: returns error, never silent 0%', async () => {
    const out = await getProgramStats('Totally Made Up Program');

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Unknown program name/);
    expect(out.program).toBe('Totally Made Up Program');
    expect(out.valid_examples).toBeInstanceOf(Array);
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('confidence bands: 5-14 → low, 15-49 → medium, 50+ → high', async () => {
    const caseLow = Array(10).fill(null).map(() => deal('Won', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'));
    mockPost.mockResolvedValueOnce(searchResponse(caseLow));
    const low = await getProgramStats('ETG - BC');
    expect(low.confidence).toBe('low');

    const caseMedium = Array(30).fill(null).map(() => deal('Won', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'));
    mockPost.mockResolvedValueOnce(searchResponse(caseMedium));
    const medium = await getProgramStats('ETG - BC');
    expect(medium.confidence).toBe('medium');

    const caseHigh = Array(60).fill(null).map(() => deal('Won', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'));
    mockPost.mockResolvedValueOnce(searchResponse(caseHigh));
    const high = await getProgramStats('ETG - BC');
    expect(high.confidence).toBe('high');
  });

  test('downstream won states count as success (Invoice Paid, Retainer Paid)', async () => {
    const results = [
      ...Array(10).fill(null).map(() => deal('Won', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')),
      ...Array(5).fill(null).map(() => deal('Invoice Paid', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')),
      ...Array(3).fill(null).map(() => deal('Retainer Paid', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')),
      ...Array(2).fill(null).map(() => deal('Lost', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'))
    ];
    mockPost.mockResolvedValueOnce(searchResponse(results));

    const out = await getProgramStats('ETG - BC');

    expect(out.won_count).toBe(18);
    expect(out.lost_count).toBe(2);
    expect(out.success_rate).toBe(0.9);
  });
});

// ============================================================================
// get_deal_count
// ============================================================================

describe('getDealCount', () => {
  test('happy path: returns count from HubSpot total', async () => {
    mockPost.mockResolvedValueOnce(searchResponse([], 47));

    const out = await getDealCount('ETG - BC', { date_range_months: 12 });

    expect(out.success).toBe(true);
    expect(out.count).toBe(47);
    expect(out.program).toBe('ETG - BC');
    expect(out.date_range_months).toBe(12);
    expect(out.source).toBe('HubSpot');
  });

  test('empty result: count is 0', async () => {
    mockPost.mockResolvedValueOnce(searchResponse([], 0));

    const out = await getDealCount('CSJ');

    expect(out.success).toBe(true);
    expect(out.count).toBe(0);
  });

  test('invalid program name: returns error, no HubSpot search made', async () => {
    const out = await getDealCount('Not A Real Program');

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Unknown program name/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('invalid date_range_months: returns error before calling HubSpot', async () => {
    const out = await getDealCount('ETG - BC', { date_range_months: -5 });

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/positive number/);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('include_starter=false filters out starter pipelines in search payload', async () => {
    mockPost.mockResolvedValueOnce(searchResponse([], 12));

    await getDealCount('ETG - BC', { include_starter: false });

    const body = mockPost.mock.calls[0][1];
    const pipelineFilter = body.filterGroups[0].filters.find(f => f.propertyName === 'pipeline');
    expect(pipelineFilter.values).not.toContain('48715861');
    expect(pipelineFilter.values).not.toContain('48715862');
    expect(pipelineFilter.values).toHaveLength(4);
  });
});

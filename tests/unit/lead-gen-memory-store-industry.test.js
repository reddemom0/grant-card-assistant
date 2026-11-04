/**
 * Lead-gen memory_store must not overwrite the widget's industry
 * (src/tools/executor.js, memory_store lead-gen branch). Model text goes to
 * industry_stated when industry is already set; an empty industry is filled.
 * employee_count keeps its unconditional remap to employee_count_stated.
 *
 * The fake query below applies the statement's merge the way Postgres would:
 * `prospect_data || CASE WHEN industry <> '' THEN {industry_stated} ELSE {industry} END`
 * for industry, `prospect_data || $1` for everything else.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/lead-gen-memory-store-industry.test.js
 */

import { jest } from '@jest/globals';

const rows = new Map();
const mockQuery = jest.fn(async (sql, params) => {
  if (!/UPDATE lead_gen_conversations\s+SET prospect_data = prospect_data \|\|/.test(sql)) return { rows: [], rowCount: 0 };
  const [json, sessionId] = params;
  const pd = rows.get(sessionId);
  if (!pd) return { rows: [], rowCount: 0 };
  const value = JSON.parse(json);
  let patch = value;
  if (/CASE WHEN COALESCE\(prospect_data->>'industry', ''\) <> ''/.test(sql)) {
    const hasIndustry = pd.industry !== undefined && pd.industry !== null && String(pd.industry) !== '';
    patch = hasIndustry ? { industry_stated: value } : { industry: value };
  }
  rows.set(sessionId, { ...pd, ...patch });
  return { rows: [], rowCount: 1 };
});

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: mockQuery, getPool: jest.fn(), transaction: jest.fn()
}));
jest.unstable_mockModule('../../src/tools/memory.js', () => ({
  storeMemory: jest.fn(async () => ({ success: true })),
  recallMemory: jest.fn(), listMemories: jest.fn()
}));

const { executeToolCall } = await import('../../src/tools/executor.js');

const store = (sessionId, key, value) =>
  executeToolCall('memory_store', { key, value }, sessionId, null, 'lead-gen');

const SID = 'sess-1';

beforeEach(() => {
  rows.clear();
  mockQuery.mockClear();
});

describe('memory_store industry', () => {
  test('a widget industry survives a later memory_store', async () => {
    rows.set(SID, { industry: 'Healthcare', employee_count: '5 – 19' });
    await store(SID, 'industry', 'Healthcare/Medical Laboratory Services');
    expect(rows.get(SID).industry).toBe('Healthcare');
  });

  test('the model text lands in industry_stated', async () => {
    rows.set(SID, { industry: 'Healthcare' });
    await store(SID, 'industry', 'Healthcare/Medical Laboratory Services');
    expect(rows.get(SID).industry_stated).toBe('Healthcare/Medical Laboratory Services');
    const [sql, params] = mockQuery.mock.calls.find(([s]) => /UPDATE lead_gen_conversations/.test(s));
    expect(sql).toMatch(/jsonb_build_object\('industry_stated', \$1::jsonb\)/);
    expect(params).toEqual([JSON.stringify('Healthcare/Medical Laboratory Services'), SID]);
  });

  test('no widget value: the first stated industry fills industry, a restatement goes to industry_stated', async () => {
    rows.set(SID, {});
    await store(SID, 'industry', 'Food Processing');
    expect(rows.get(SID)).toEqual({ industry: 'Food Processing' });
    await store(SID, 'industry', 'Craft brewery');
    expect(rows.get(SID)).toEqual({ industry: 'Food Processing', industry_stated: 'Craft brewery' });
  });

  test('an empty-string industry counts as no widget value', async () => {
    rows.set(SID, { industry: '' });
    await store(SID, 'industry', 'Software');
    expect(rows.get(SID).industry).toBe('Software');
    expect(rows.get(SID).industry_stated).toBeUndefined();
  });
});

describe('other keys are unchanged', () => {
  test('employee_count still routes to employee_count_stated', async () => {
    rows.set(SID, { employee_count: '5 – 19' });
    await store(SID, 'employee_count', '8 full-time');
    expect(rows.get(SID)).toEqual({ employee_count: '5 – 19', employee_count_stated: '8 full-time' });
  });

  test('a plain key still merges as-is', async () => {
    rows.set(SID, { industry: 'Healthcare', province: 'Alberta' });
    await store(SID, 'province', 'British Columbia');
    expect(rows.get(SID)).toEqual({ industry: 'Healthcare', province: 'British Columbia' });
    const [sql] = mockQuery.mock.calls.find(([s]) => /UPDATE lead_gen_conversations/.test(s));
    expect(sql).not.toMatch(/CASE WHEN/);
  });

  test('non-lead-gen agents never touch prospect_data', async () => {
    rows.set(SID, { industry: 'Healthcare' });
    await executeToolCall('memory_store', { key: 'industry', value: 'X' }, SID, null, 'internal-oracle');
    expect(rows.get(SID)).toEqual({ industry: 'Healthcare' });
  });
});

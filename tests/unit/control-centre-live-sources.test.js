/**
 * control-centre identity + live-source helpers, against small fixtures.
 * No database: every helper takes an injected query function.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-live-sources.test.js
 */

import { jest } from '@jest/globals';
import { identitiesForClerkIds, shapeIdentities } from '../../src/control-centre/identity.js';
import {
  ENGINE_PROFILE_SOURCE,
  companyProfile,
  shapeCompanyProfile,
  splitProvinces,
  liveGrant,
  liveGrants,
  watchlist
} from '../../src/control-centre/live-sources.js';

/** A fake query fn that answers by matching a substring of the SQL. */
function fakeQuery(routes) {
  return jest.fn(async (text, params) => {
    for (const [needle, rows] of routes) {
      if (text.includes(needle)) return { rows: typeof rows === 'function' ? rows(params) : rows, rowCount: 0 };
    }
    throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
  });
}

describe('identitiesForClerkIds', () => {
  test('primary membership wins; single membership used; ambiguous is null', () => {
    const map = shapeIdentities([
      { clerk_id: 'user_a', user_id: 1, company_id: 10, is_primary: false },
      { clerk_id: 'user_a', user_id: 1, company_id: 11, is_primary: true },
      { clerk_id: 'user_b', user_id: 2, company_id: 20, is_primary: null },
      { clerk_id: 'user_c', user_id: 3, company_id: 30, is_primary: false },
      { clerk_id: 'user_c', user_id: 3, company_id: 31, is_primary: false },
      { clerk_id: 'user_d', user_id: 4, company_id: null, is_primary: null }
    ]);
    expect(map.get('user_a')).toEqual({ user_id: 1, company_id: 11, company_ids: [10, 11] });
    expect(map.get('user_b')).toEqual({ user_id: 2, company_id: 20, company_ids: [20] });
    expect(map.get('user_c')).toEqual({ user_id: 3, company_id: null, company_ids: [30, 31] });
    expect(map.get('user_d')).toEqual({ user_id: 4, company_id: null, company_ids: [] });
  });

  test('unknown ids are absent; ids are deduped and bound as one param', async () => {
    const query = fakeQuery([['users_clerk', [{ clerk_id: 'user_b', user_id: 2, company_id: 20, is_primary: true }]]]);
    const map = await identitiesForClerkIds(['user_b', 'user_zz', 'user_b', '', null], { query });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([['user_b', 'user_zz']]);
    expect(map.has('user_zz')).toBe(false);
    expect(map.get('user_b').company_id).toBe(20);
  });

  test('empty input makes no query', async () => {
    const query = jest.fn();
    expect((await identitiesForClerkIds([], { query })).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('companyProfile', () => {
  const META = {
    company_id: 48,
    primary_industries: ['Consulting - Business', 'Tech - AI'],
    provinces: 'British Columbia, BC- Lower Mainland',
    headquarters_province: 'British Columbia',
    employee_range: '5-10 employees',
    num_employees: null,
    recurring_revenue_range: null,
    annual_revenue: '750000'
  };

  test('default source is company_metadata', () => {
    expect(ENGINE_PROFILE_SOURCE).toBe('company_metadata');
  });

  test('splitProvinces trims, drops blanks and dupes', () => {
    expect(splitProvinces(' Alberta, ,British Columbia,Alberta ')).toEqual(['Alberta', 'British Columbia']);
    expect(splitProvinces(null)).toEqual([]);
    expect(splitProvinces(['Ontario'])).toEqual(['Ontario']);
  });

  test('engine view from metadata, tables as also_on_record, differs flags', () => {
    const p = shapeCompanyProfile(48, META, ['British Columbia'], ['consulting - business', 'Tech - AI']);
    expect(p.found).toBe(true);
    expect(p.engine.industries).toEqual(['Consulting - Business', 'Tech - AI']);
    expect(p.engine.provinces).toEqual(['British Columbia', 'BC- Lower Mainland']);
    expect(p.also_on_record.regions).toEqual(['British Columbia']);
    expect(p.also_on_record.headquarters_province).toBe('British Columbia');
    expect(p.differs).toEqual({ industries: false, regions: true }); // case-insensitive set compare
  });

  test('size/revenue fallback order and empty_for_engine', () => {
    const p = shapeCompanyProfile(48, META, [], []);
    expect(p.engine.employee_count).toBe('5-10 employees');
    expect(p.engine.annual_revenue).toBe('750000'); // range blank → numeric column
    expect(p.empty_for_engine).toEqual([]);

    const bare = shapeCompanyProfile(7, {
      primary_industries: null, provinces: '', employee_range: '', num_employees: 12,
      recurring_revenue_range: null, annual_revenue: null
    }, [], []);
    expect(bare.engine.employee_count).toBe(12);
    expect(bare.empty_for_engine).toEqual(['industries', 'provinces', 'annual_revenue']);
  });

  test("source 'company_tables' prefers tables, falls back to metadata", () => {
    const p = shapeCompanyProfile(48, META, ['Alberta'], [], 'company_tables');
    expect(p.engine.provinces).toEqual(['Alberta']);
    expect(p.engine.industries).toEqual(['Consulting - Business', 'Tech - AI']); // no table rows → metadata
    expect(p.also_on_record.regions).toEqual(['British Columbia', 'BC- Lower Mainland']);
    expect(p.differs.industries).toBe(false);
  });

  test('not found', async () => {
    const query = fakeQuery([['company_metadata', []], ['company_regions', []], ['company_industries', []]]);
    expect(await companyProfile(999, { query })).toEqual({ company_id: 999, found: false, source: 'company_metadata' });
  });

  test('reads all three sources with the company id bound', async () => {
    const query = fakeQuery([
      ['company_metadata', [META]],
      ['company_regions', [{ name: 'British Columbia' }]],
      ['company_industries', [{ name: 'Consulting - Business' }]]
    ]);
    const p = await companyProfile(48, { query });
    expect(query).toHaveBeenCalledTimes(3);
    for (const call of query.mock.calls) expect(call[1]).toEqual([48]);
    expect(p.also_on_record.industries).toEqual(['Consulting - Business']);
    expect(p.differs.industries).toBe(true);
  });
});

describe('liveGrant / liveGrants', () => {
  const ROW = {
    root_id: 1711, id: 3639, title: 'Example', grantor: 'Gov', type: 'grant', value: '5000',
    deadline: null, status: 'active', version_number: 28, updated_at: null,
    minimum_company_size: null, maximum_company_size: 500,
    minimum_company_revenue: null, maximum_company_revenue: null
  };

  test('SQL encodes the live rule', async () => {
    const query = fakeQuery([['grant_roots', [ROW]]]);
    const g = await liveGrant(1711, { query });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('g.id = gr.live_version');
    expect(sql).toContain('g.deleted_at IS NULL');
    expect(sql).toContain("s.label = 'active'");
    expect(sql).toContain('s.scope_id = 1');
    expect(query.mock.calls[0][1]).toEqual([1711]);
    expect(g).toMatchObject({ root_id: 1711, id: 3639, status: 'active', version_number: 28, maximum_company_size: 500 });
    expect(g).not.toHaveProperty('description');
  });

  test('null when the root has no live version', async () => {
    expect(await liveGrant(1, { query: fakeQuery([['grant_roots', []]]) })).toBeNull();
  });

  test('liveGrants maps every row', async () => {
    const rows = await liveGrants({ query: fakeQuery([['grant_roots', [ROW, { ...ROW, root_id: 1712, id: 4000 }]]]) });
    expect(rows.map((r) => r.root_id)).toEqual([1711, 1712]);
  });
});

describe('watchlist', () => {
  test('groups grants per watchlist; empty lists kept; is_live flag', async () => {
    const query = fakeQuery([['watchlists', [
      { watchlist_id: 1, name: 'Main', user_id: 5, root_id: 1711, added_at: 't1', live_grant_id: 3639, title: 'Live one' },
      { watchlist_id: 1, name: 'Main', user_id: 5, root_id: 99, added_at: 't2', live_grant_id: null, title: null },
      { watchlist_id: 2, name: 'Empty', user_id: null, root_id: null, added_at: null, live_grant_id: null, title: null }
    ]]]);
    const lists = await watchlist(48, { query });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('w.deleted_at IS NULL');
    expect(sql).toContain('wg.deleted_at IS NULL');
    expect(query.mock.calls[0][1]).toEqual([48]);
    expect(lists).toEqual([
      { watchlist_id: 1, name: 'Main', user_id: 5, grants: [
        { root_id: 1711, added_at: 't1', is_live: true, live_grant_id: 3639, title: 'Live one' },
        { root_id: 99, added_at: 't2', is_live: false, live_grant_id: null, title: null }
      ] },
      { watchlist_id: 2, name: 'Empty', user_id: null, grants: [] }
    ]);
  });
});

/**
 * control-centre deadline cards (migration 057): the flag a past-deadline
 * grant gets, the dry run, and the write through addFlag. Fixtures only — no
 * DB, no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-deadline-cards.test.js
 */

import { jest } from '@jest/globals';
import { runDeadlineSweep, deadlineFlagFor, deadlineRef, DEADLINE_SOURCE, DEADLINE_ACTOR } from '../../src/control-centre/deadline-cards.js';
import { deadlineFlags } from '../../src/control-centre/coverage.js';

const grants = [
  { root_id: 1822, title: 'Old Fund', grantor: 'Ontario', deadline: '15/04/2021' },
  { root_id: 2, title: 'Soon', grantor: null, deadline: '2026-11-01' },
  { root_id: 3, title: 'Rolling', grantor: null, deadline: 'Open Until Filled' },
  { root_id: 4, title: 'Blank', grantor: null, deadline: '' },
  { root_id: 5, title: 'Odd', grantor: null, deadline: 'Spring intake' }
];
const now = () => new Date('2026-10-22T18:00:00Z'); // 11:00 in Vancouver → 2026-10-22
const DAYS_OVER = Math.round((Date.parse('2026-10-22T00:00:00Z') - Date.parse('2021-04-15T00:00:00Z')) / 86400000);

let errorSpy;
beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => errorSpy.mockRestore());

describe('deadlineFlagFor', () => {
  test('a grant_deadline flag keyed on the grant and its parsed date, with the evidence frozen in the snapshot', () => {
    const row = deadlineFlags(grants, '2026-10-22').passed[0];
    const f = deadlineFlagFor(row, '2026-10-22');
    expect(f).toMatchObject({
      kind: 'grant_deadline', grant_root_id: 1822, source: DEADLINE_SOURCE, source_ref: deadlineRef(1822, '2021-04-15'),
      source_created_at: null, actor: DEADLINE_ACTOR,
      snapshot: { source: 'catalogue_check', checked_on: '2026-10-22',
        grant: { id: 1822, title: 'Old Fund', grantor: 'Ontario', deadline_text: '15/04/2021', deadline: '2021-04-15', days_over: DAYS_OVER, status: 'active' } }
    });
    expect(f.source_ref).toBe('deadline:1822:2021-04-15');
    expect(f.comment).toBe(`Deadline "15/04/2021" (2021-04-15) is ${DAYS_OVER} days past; the grant is still active`);
  });
});

describe('runDeadlineSweep', () => {
  test('dry run: today\'s past deadlines with their flags; blank, rolling and unreadable counted, not filed; nothing written', async () => {
    const addFlag = jest.fn();
    const s = await runDeadlineSweep({ deps: { liveGrants: async () => grants, appQuery: async () => ({ rows: [] }), addFlag, now }, log: () => {} });
    expect(s).toMatchObject({ today: '2026-10-22', live: 5, passed: 1, due_soon: 1, blank: 1, unreadable: 1, rolling: 1, filed: 0, written: false });
    expect(s.rows).toEqual([expect.objectContaining({ grant_id: 1822, title: 'Old Fund', deadline: '2021-04-15', deadline_text: '15/04/2021', days_over: DAYS_OVER })]);
    expect(s.rows[0].flag.snapshot.grant.id).toBe(1822);
    expect(addFlag).not.toHaveBeenCalled();
  });

  test('write: one addFlag per past deadline, counting new, reopened, duplicate and failed', async () => {
    const many = [...grants, { root_id: 6, title: 'Also old', grantor: null, deadline: '2026-09-23' }, { root_id: 7, title: 'Broken', grantor: null, deadline: '2026-07-15' }];
    const addFlag = jest.fn(async (f) => (f.grant_root_id === 1822 ? { created: true, reopened: false, duplicate: false }
      : f.grant_root_id === 6 ? { created: false, reopened: false, duplicate: true }
        : (() => { throw Object.assign(new Error('db'), { code: '23514' }); })()));
    const s = await runDeadlineSweep({ write: true, deps: { liveGrants: async () => many, appQuery: async () => ({ rows: [] }), addFlag, now }, log: () => {} });
    expect(addFlag).toHaveBeenCalledTimes(3);
    expect(addFlag.mock.calls.map(([f]) => f.source_ref)).toEqual(['deadline:1822:2021-04-15', 'deadline:7:2026-07-15', 'deadline:6:2026-09-23']);
    expect(s).toMatchObject({ passed: 3, filed: 1, new_items: 1, reopened: 0, duplicate: 1, failed: 1, written: true });
  });

  test('write without an addFlag is refused', async () => {
    await expect(runDeadlineSweep({ write: true, deps: { liveGrants: async () => grants, appQuery: async () => ({ rows: [] }), now }, log: () => {} }))
      .rejects.toThrow(/addFlag/);
  });
});

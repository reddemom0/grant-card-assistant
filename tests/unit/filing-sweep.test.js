/**
 * Filing sweep (src/services/filing-sweep.js, filing-rules.js, cards/sweep-card.js)
 *
 * The rule checks, grouping per person (10 cards, the rest listed), Skip and the
 * 7-day ignore, never suggesting a file twice, the pilot gate, the fallback to
 * Chris, and the schedule flag. No network: Drive, Chat, the model and the
 * database are stand-ins.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/filing-sweep.test.js
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/database/connection.js', () => ({ query: jest.fn(), getPool: jest.fn(), transaction: jest.fn() }));

const R = await import('../../src/services/filing-rules.js');
const S = await import('../../src/services/filing-sweep.js');
const C = await import('../../src/cards/sweep-card.js');

const DOC = 'application/vnd.google-apps.document';
const check = (path, name, mimeType = 'application/pdf') => R.checkFile({ path: path.split('/').filter(Boolean), name, mimeType });

describe('rule checks', () => {
  test('a well-filed, well-named client file passes', () => {
    expect(check('Clients/Caliber Projects/CanExport/2026/Claims/202609', 'Claim Submission-202609-Caliber Projects-CanEx.pdf'))
      .toEqual({ excluded: null, failures: [] });
    expect(check('Clients/Caliber Projects/General/Undated', 'Grant Planner-Caliber Projects-2026', DOC).failures).toEqual([]);
  });

  test('folder failures', () => {
    expect(check('', 'x.pdf').failures).toContain('loose_top_level');
    expect(check('Clients', 'x.pdf').failures).toContain('loose_clients_root');
    expect(check('Clients/_Unsorted', 'x.pdf').failures).toContain('unsorted');
    expect(check('Clients/Caliber Projects', 'Invoice-202609-Bellrock.pdf').failures).toEqual(['loose_client_root']);
    expect(check('Clients/Caliber Projects/Spaghetti/2026', 'Invoice-202609-Bellrock.pdf').failures).toEqual(['unknown_program']);
    expect(check('Clients/Caliber Projects/CanExport', 'Invoice-202609-Bellrock.pdf').failures).toEqual(['no_year']);
    expect(check('Clients/Caliber Projects/CanExport/Misc', 'Invoice-202609-Bellrock.pdf').failures).toEqual(['no_year']);
    expect(check('Departments/PRODUCT', 'PRD-001-Release Process', DOC).failures).toEqual(['loose_department_root']);
    expect(check('Programs', 'Claim Form-CanEx.pdf').failures).toEqual(['loose_programs_root']);
    expect(check('Somewhere Else', 'x.pdf').failures).toEqual(['non_standard_area']);
  });

  test('name failures: a listed Type for client files, the internal patterns for departments', () => {
    expect(check('Clients/Caliber Projects/CanExport/2026', 'scan0001.pdf').failures).toEqual(['name_pattern']);
    expect(check('Clients/Caliber Projects/CanExport/2026', 'Invoice.pdf').failures).toEqual(['name_pattern']);
    expect(check('Departments/PRODUCT/Control Centre', 'Meeting Notes-20261021-Control Centre', DOC).failures).toEqual([]);
    expect(check('Departments/PRODUCT/Control Centre', 'PRD-004-Release Process', DOC).failures).toEqual([]);
    expect(check('Departments/PRODUCT/Control Centre', 'notes', DOC).failures).toEqual(['name_pattern']);
  });

  test('photos and video skip the name check; extensions are ignored', () => {
    expect(check('Clients/Caliber Projects/CanExport/2026', 'IMG_2201.jpg', 'image/jpeg').failures).toEqual([]);
    expect(R.baseName('Invoice-202609-Bellrock.pdf', 'application/pdf')).toBe('Invoice-202609-Bellrock');
    expect(R.baseName('Notes v1.2', DOC)).toBe('Notes v1.2');
  });

  test('never-filing areas, HR/finance, sensitive names, folders and shortcuts are excluded', () => {
    for (const p of ['Old Files/x', 'Active Clients/x', 'Review', 'Pre-Call Briefings/Ruk', 'Departments/Mindfulness', 'Departments/HR', 'Departments/FINANCE']) {
      expect(check(p, 'whatever.pdf').excluded).toBeTruthy();
    }
    expect(check('Clients/Caliber Projects', 'Payroll-202609.xlsx').excluded).toBe('sensitive_name');
    expect(R.checkFile({ path: ['Clients'], name: 'X', mimeType: 'application/vnd.google-apps.folder' }).excluded).toBe('folder');
    expect(R.checkFile({ path: ['Clients'], name: 'X', mimeType: 'application/vnd.google-apps.shortcut' }).excluded).toBe('shortcut');
  });

  test('the matching engine\'s sweep artifacts are excluded; the rest of Departments/AI is not', () => {
    expect(check('Departments/AI/Matching sweep — raw artifacts', 'stage-stress-report-scoring-2026-10-18T12-15-47Z.md', 'text/markdown').excluded).toBe('area:Departments/AI/Matching sweep');
    expect(check('Departments/AI/Matching sweep — raw artifacts/2026-10', 'axis-sweep-report.json', 'application/json').excluded).toBe('area:Departments/AI/Matching sweep');
    expect(check('Departments/AI/Matching fix queue', 'notes', DOC).excluded).toBeNull();
    expect(check('Departments/AI', 'AI-001-Control Centre User Guide', DOC).excluded).toBeNull();
  });

  test('the program table parses from the skill', () => {
    const names = R.programNames();
    expect(names.length).toBeGreaterThan(200);
    expect(names).toEqual(expect.arrayContaining(['CanExport', 'ETG (Employer Training Grant)', 'Workplace Accessibility Grant']));
  });
});

const person = (email, id) => ({ id, email, name: email, chat_user_id: `users/${id}` });
const item = (n, recipient, status = 'card') => ({
  file: { id: `f${n}`, name: `File ${n}`, webViewLink: `https://drive.google.com/open?id=f${n}` },
  path: [], recipient, status, failures: ['name_pattern'],
  plan: status === 'card' ? { path_before: 'Granted Files/Clients/X', path_after: 'Granted Files/Clients/X/CanExport/2026', name_before: `File ${n}`, name_after: `Invoice-2026-File ${n}`, request: {} } : null
});

describe('grouping per person', () => {
  const chris = person('writers@granted.ca', 1);
  const del = person('delpreet@granted.ca', 2);

  test('at most 10 cards per person; the rest are listed', () => {
    const items = Array.from({ length: 13 }, (_, i) => item(i, del));
    const { groups } = S.groupByRecipient(items);
    const g = groups.get('delpreet@granted.ca');
    expect(g.cards).toHaveLength(10);
    expect(g.listed).toHaveLength(3);
    expect(S.overflowText(g.listed)).toMatch(/^3 more/);
  });

  test('unsure files become a line, not a card', () => {
    const { groups } = S.groupByRecipient([item(1, del, 'unsure'), item(2, del)]);
    const g = groups.get('delpreet@granted.ca');
    expect(g.cards).toHaveLength(1);
    expect(S.headerText(g)).toContain('Not sure where File 1 goes. Reply and tell me.');
  });

  test('ok and excluded files reach no one', () => {
    const { groups } = S.groupByRecipient([item(1, del, 'ok'), item(2, del, 'excluded')]);
    expect(groups.size).toBe(0);
  });

  test('pilot: only listed people get a group; the others are held as would_suggest', () => {
    const pilot = S.pilotEmails({ FILING_SWEEP_PILOT_EMAILS: 'writers@granted.ca' });
    const { groups, held } = S.groupByRecipient([item(1, del), item(2, chris)], { pilot });
    expect([...groups.keys()]).toEqual(['writers@granted.ca']);
    expect(held.map(i => i.file.id)).toEqual(['f1']);
    expect(S.pilotEmails({})).toBeNull();
    expect(S.inPilot('anyone@granted.ca', null)).toBe(true);
  });
});

describe('Skip and ignored', () => {
  const s = { id: 'x', recipient_user_id: 2, status: 'suggested' };
  test('only the recipient may skip, and only while it is still suggested', () => {
    expect(C.skipDecision(s, 2)).toBe('skip');
    expect(C.skipDecision(s, 3)).toBe('not_allowed');
    expect(C.skipDecision(s, null)).toBe('not_allowed');
    expect(C.skipDecision({ ...s, status: 'confirmed' }, 2)).toBe('settled');
    expect(C.skipDecision(null, 2)).toBe('unknown');
  });

  test('the card carries Skip in place of Cancel', () => {
    const action = { id: '11111111-1111-1111-1111-111111111111', tool_name: 'file_move_rename', tool_input: { file_link: 'https://x', name_before: 'A', name_after: 'B', moving: false } };
    const json = JSON.stringify(C.renderSweepCard(action, '22222222-2222-2222-2222-222222222222'));
    expect(json).toContain('sweep.skip');
    expect(json).not.toContain('pending.cancel');
    expect(json).toContain('pending.confirm');
  });

  test('suggestions left for 7 days are marked ignored and their cards stop working', () => {
    expect(S.IGNORE_SQL).toMatch(/status = 'ignored'/);
    expect(S.IGNORE_SQL).toMatch(/INTERVAL '7 days'/);
    expect(S.IGNORE_SQL).toMatch(/UPDATE pending_actions SET status = 'expired'/);
  });
});

// ---------------------------------------------------------------------------
// A whole run against stand-ins
// ---------------------------------------------------------------------------

const GF = '0AKxoOSs3WbQ0Uk9PVA';
function fakeDrive(files, folders) {
  return {
    changes: {
      getStartPageToken: jest.fn(async () => ({ data: { startPageToken: 't0' } })),
      list: jest.fn(async () => ({ data: { newStartPageToken: 't2', changes: files.map(f => ({ fileId: f.id, file: { driveId: GF, ...f } })) } }))
    },
    files: {
      list: jest.fn(async () => ({ data: { files: [{ id: 'old1' }, { id: 'old2' }] } })),
      get: jest.fn(async ({ fileId }) => ({ data: folders[fileId] }))
    }
  };
}

function fakeDb({ token = 't1', users = {}, known = [], insertReturns = true } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (/INSERT INTO filing_sweep_runs/.test(sql)) return { rows: [{ id: 'run1' }] };
    if (/SELECT page_token_after/.test(sql)) return { rows: token ? [{ page_token_after: token }] : [] };
    if (/FROM filing_sweep_known_files/.test(sql)) return { rows: known.map(file_id => ({ file_id })) };
    if (/FROM drive_actions/.test(sql)) return { rows: [] };
    if (/FROM users/.test(sql)) return { rows: users[String(params[0]).toLowerCase()] ? [users[String(params[0]).toLowerCase()]] : [] };
    if (/INSERT INTO filing_sweep_suggestions/.test(sql)) return { rows: insertReturns ? [{ id: `s-${params[1]}` }] : [] };
    return { rows: [] };
  });
  return { query, calls, statuses: () => calls.filter(c => /INSERT INTO filing_sweep_suggestions/.test(c.sql)).map(c => [c.params[1], c.params[12], c.params[5]]) };
}

function runDeps(db, drive, over = {}) {
  return {
    query: db.query,
    readDrive: jest.fn(async () => drive),
    childFolders: jest.fn(async () => ({ folders: [] })),
    planFileMove: jest.fn(async (input, ctx) => ({ ok: true, plan: { request: input, asker_email: ctx.askerEmail, path_before: 'Granted Files/Clients/Caliber Projects', path_after: 'Granted Files/Clients/Caliber Projects/CanExport/2026', name_before: 'scan', name_after: 'Invoice-202609-Bellrock' } })),
    savePendingAction: jest.fn(async () => ({ id: 'pa1' })),
    summarizeAction: jest.fn(async () => 'Move scan'),
    createConversation: jest.fn(async () => {}),
    saveMessage: jest.fn(async () => {}),
    findDm: jest.fn(async (id) => `spaces/dm-${id}`),
    post: jest.fn(async () => ({ messageName: 'spaces/x/messages/1', threadName: 'spaces/x/threads/1' })),
    renderCard: jest.fn(async () => [{ cardId: 'c' }]),
    conversationFor: jest.fn(async (k) => `conv-${k}`),
    cost: jest.fn(async () => 0.001),
    createMessage: jest.fn(async () => ({ usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', name: 'suggest_filing', input: { confident: true, destination_path: 'Clients/Caliber Projects/CanExport/2026', new_name: 'Invoice-202609-Bellrock', reason: 'invoice' } }] })),
    logCost: jest.fn(),
    programNames: () => ['CanExport'],
    ...over
  };
}

const folders = {
  c: { id: 'c', name: 'Clients', parents: [GF] },
  cp: { id: 'cp', name: 'Caliber Projects', parents: ['c'] }
};
const newFile = (id, editor) => ({ id, name: `scan ${id} Sept 2026.pdf`, mimeType: 'application/pdf', parents: ['cp'], ...(editor ? { lastModifyingUser: { emailAddress: editor } } : {}) });
const USERS = { 'writers@granted.ca': person('writers@granted.ca', 1), 'delpreet@granted.ca': person('delpreet@granted.ca', 2) };

describe('a run', () => {
  test('the first run records the baseline and checks nothing (no backfill)', async () => {
    const db = fakeDb({ token: null });
    const drive = fakeDrive([], folders);
    const deps = runDeps(db, drive);
    const out = await S.runFilingSweep({ deps, env: {} });
    expect(out).toEqual({ status: 'baseline', files: 2 });
    expect(drive.changes.list).not.toHaveBeenCalled();
    expect(deps.post).not.toHaveBeenCalled();
  });

  test('a misfiled new file gets a card in its editor\'s DM; ignore and reconcile run first', async () => {
    const db = fakeDb({ users: USERS });
    const deps = runDeps(db, fakeDrive([newFile('n1', 'delpreet@granted.ca')], folders));
    const out = await S.runFilingSweep({ deps, env: {} });
    expect(out.status).toBe('done');
    expect(db.calls.some(c => c.sql === S.IGNORE_SQL)).toBe(true);
    expect(db.statuses()).toEqual([['n1', 'suggested', 'delpreet@granted.ca']]);
    expect(deps.savePendingAction).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'file_move_rename', userId: 2 }));
    expect(db.calls.some(c => /expires_at = NOW\(\) \+ INTERVAL '7 days'/.test(c.sql))).toBe(true);
    expect(deps.post).toHaveBeenCalledTimes(2);   // header + one card
  });

  test('a file already logged is never suggested again', async () => {
    const db = fakeDb({ users: USERS, insertReturns: false });
    const deps = runDeps(db, fakeDrive([newFile('n1', 'delpreet@granted.ca')], folders));
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.savePendingAction).not.toHaveBeenCalled();
  });

  test('files seen before are not checked', async () => {
    const db = fakeDb({ users: USERS, known: ['n1'] });
    const deps = runDeps(db, fakeDrive([newFile('n1', 'delpreet@granted.ca')], folders));
    const out = await S.runFilingSweep({ deps, env: {} });
    expect(out.new_files).toBe(0);
    expect(deps.createMessage).not.toHaveBeenCalled();
  });

  test('no @granted.ca editor: the file goes to the fallback (Chris)', async () => {
    const db = fakeDb({ users: USERS });
    const deps = runDeps(db, fakeDrive([newFile('n2', 'someone@gmail.com')], folders));
    await S.runFilingSweep({ deps, env: {} });
    expect(db.statuses()).toEqual([['n2', 'suggested', 'writers@granted.ca']]);
  });

  test('pilot: people outside the list get nothing; their files are logged as would_suggest', async () => {
    const db = fakeDb({ users: USERS });
    const deps = runDeps(db, fakeDrive([newFile('n3', 'delpreet@granted.ca')], folders));
    await S.runFilingSweep({ deps, env: { FILING_SWEEP_PILOT_EMAILS: 'writers@granted.ca' } });
    expect(db.statuses()).toEqual([['n3', 'would_suggest', 'delpreet@granted.ca']]);
    expect(deps.post).not.toHaveBeenCalled();
  });

  test('not confident: one "not sure" line, no card', async () => {
    const db = fakeDb({ users: USERS });
    const deps = runDeps(db, fakeDrive([newFile('n4', 'delpreet@granted.ca')], folders), {
      createMessage: jest.fn(async () => ({ content: [{ type: 'tool_use', name: 'suggest_filing', input: { confident: false, destination_path: '', new_name: '', reason: 'unclear' } }] }))
    });
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.savePendingAction).not.toHaveBeenCalled();
    expect(deps.post.mock.calls[0][0].text).toContain('Not sure where scan n4 Sept 2026.pdf goes. Reply and tell me.');
    expect(db.statuses()).toEqual([['n4', 'unsure', 'delpreet@granted.ca']]);
  });

  test('unreachable on Chat: the item goes to the fallback, re-planned as them', async () => {
    const db = fakeDb({ users: { ...USERS, 'delpreet@granted.ca': { ...USERS['delpreet@granted.ca'], chat_user_id: null } } });
    const deps = runDeps(db, fakeDrive([newFile('n5', 'delpreet@granted.ca')], folders));
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.planFileMove).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ askerEmail: 'writers@granted.ca' }));
    expect(db.statuses()).toEqual([['n5', 'suggested', 'writers@granted.ca']]);
  });

  test('a file that passes the checks is logged ok, with no model call', async () => {
    const db = fakeDb({ users: USERS });
    const ok = { ...newFile('n6', 'delpreet@granted.ca'), name: 'Invoice-202609-Bellrock.pdf', parents: ['y'] };
    const fs = { ...folders, p: { id: 'p', name: 'CanExport', parents: ['cp'] }, y: { id: 'y', name: '2026', parents: ['p'] } };
    const deps = runDeps(db, fakeDrive([ok], fs));
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.createMessage).not.toHaveBeenCalled();
    expect(db.statuses()).toEqual([['n6', 'ok', 'delpreet@granted.ca']]);
  });
});

describe('suggestion guards', () => {
  test('a month the file does not show is an invented date', () => {
    expect(S.inventedDates({ destination_path: 'Clients/M/CanExport/2026/Claims/202600', new_name: 'Proof of Payment-202600-Hotel' }, { name: 'Expense 22- POP- Hotel.pdf' }, [{ name: 'M' }])).toEqual(['202600']);
    expect(S.inventedDates({ destination_path: 'Clients/M/CanExport/2026', new_name: 'Paystub-202609-202609-Dawson Epp' }, { name: 'Paystubs-September 01 to September 30 2026-Dawson.pdf' }, [])).toEqual([]);
    expect([...S.visibleMonths('Claim Submission-202409-Keirton 2026-10-18T12')]).toEqual(expect.arrayContaining(['202409', '202610']));
  });

  test('two new files never get the same home and name; placeholders are refused', async () => {
    const db = fakeDb({ users: USERS });
    const deps = runDeps(db, fakeDrive([newFile('d1', 'delpreet@granted.ca'), newFile('d2', 'delpreet@granted.ca')], folders));
    await S.runFilingSweep({ deps, env: {} });
    expect(db.statuses().map(r => r[1])).toEqual(['suggested', 'unsure']);
    const db2 = fakeDb({ users: USERS });
    const deps2 = runDeps(db2, fakeDrive([newFile('p1', 'delpreet@granted.ca')], folders), {
      createMessage: jest.fn(async () => ({ content: [{ type: 'tool_use', name: 'suggest_filing', input: { confident: true, destination_path: 'Clients/Caliber Projects/CanExport/2026', new_name: 'Type-202609-Thing', reason: 'x' } }] }))
    });
    await S.runFilingSweep({ deps: deps2, env: {} });
    expect(db2.statuses().map(r => r[1])).toEqual(['unsure']);
  });
});

describe('schedule', () => {
  test('off unless FILING_SWEEP_ENABLED is exactly "true"', () => {
    const cron = { schedule: jest.fn() };
    expect(S.startFilingSweep(cron, {})).toBe(false);
    expect(S.startFilingSweep(cron, { FILING_SWEEP_ENABLED: '1' })).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(S.startFilingSweep(cron, { FILING_SWEEP_ENABLED: 'true' })).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith('30 8 * * 1-5', expect.any(Function), { name: 'filing-sweep', timezone: 'America/Vancouver', noOverlap: true });
    expect(cron.schedule).toHaveBeenCalledWith('45 8 * * 1', expect.any(Function), { name: 'filing-sweep-summary', timezone: 'America/Vancouver', noOverlap: true });
  });
});

/**
 * Filing sweep (src/services/filing-sweep.js, filing-rules.js, cards/sweep-card.js)
 *
 * The rule checks (with the pilot's claim-folder, wage-subsidy paystub and
 * paystub-name rules), grouping per person and destination (10 cards, the rest
 * listed), the card presses (Confirm all, Skip, Leave it here) and the 7-day
 * ignore, never suggesting a file twice, the pilot gate, the fallback to
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

  test('claim folders: a named folder in Claims needs a claim name; a month folder keeps the usual check', () => {
    const chfa = 'Clients/49th Parallel/BCAFE/2026/claims/CHFA 2026';
    expect(R.claimFolder(chfa.split('/'))).toBe(true);
    expect(R.claimFolder(`${chfa}/Miscellaneous `.split('/'))).toBe(true);
    expect(R.claimFolder('Clients/49th Parallel/BCAFE/2026/Claims/202608'.split('/'))).toBe(false);
    expect(R.claimFolder('Clients/49th Parallel/BCAFE/2026/Claims'.split('/'))).toBe(false);
    expect(check(chfa, 'Expense 10 - Proof of Payment - Kickback Social - 11 August 2026.pdf').failures).toEqual(['claim_folder_name']);
    expect(check(chfa, 'Proof of Payment-Exp10-20260811-Kickback Social.pdf').failures).toEqual([]);
    expect(check(chfa, 'Invoice-20260811-Kickback Social.pdf').failures).toEqual([]);
    expect(check('Clients/49th Parallel/BCAFE/2026/Claims/202608', 'Expense 10 - Proof of Payment.pdf').failures).toEqual(['name_pattern']);
  });

  test('Delpreet\'s paystub names are never a name failure; wage-subsidy paystubs belong in a Claims folder', () => {
    const name = 'Paystubs-Eco Canada SWPP-Yeji Kang-AME Consulting Group- October 01 to October 15.pdf';
    expect(R.isPaystubConvention(name)).toBe(true);
    expect(R.isPaystubConvention('Paystubs-September 01 to September 30 2026-Dawson.pdf')).toBe(false);
    expect(check('Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Fall 2026/Fall intake first claim paystubs', name).failures).toEqual([]);
    expect(check('Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Fall 2026', name).failures).toEqual(['paystub_not_in_claims']);
    expect(check('Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Claims', name).failures).toEqual([]);
    expect(check('Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Fall 2026/Claims', name).failures).toEqual([]);
    expect(check('Clients/_Unsorted', name).failures).toEqual(['unsorted']);
  });

  test('a claim or pay-period folder under a student or intake folder is a claim folder: its paystubs pass', () => {
    const ps = 'Paystubs-WorkBC-Amir Beheshtian-Nightingale Electrical- Oct 8-Oct 23.pdf';
    const st = 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Electrical Apprentice - Amir Beheshtian';
    for (const p of [`${st}/Oct 8 to Oct 23`, `${st}/Sep 23 to Oct 7`, 'Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Fall 2026/Fall intake first claim paystubs', `${st}/Pay period 3`, `${st}/2026-10-08`]) {
      expect(R.claimFolder(p.split('/'))).toBe(true);
      expect(check(p, ps).failures).toEqual([]);
    }
    // Loose outside one: still needs a Claims folder.
    for (const p of [st, 'Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Fall 2026', 'Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Fall 2026/Parker']) {
      expect(R.claimFolder(p.split('/'))).toBe(false);
      expect(check(p, ps).failures).toEqual(['paystub_not_in_claims']);
    }
    // Anything else in such a folder is left alone too: no rename check.
    expect(check(`${st}/Oct 8 to Oct 23`, 'Claim Form-WorkBC-Amir Beheshtian-Nightingale Electrical- Oct 8-Oct 23.pdf').failures).toEqual([]);
    expect(check(`${st}/Oct 8 to Oct 23`, 'scan0001.pdf').failures).toEqual([]);
    // A period-named folder under a stage folder, or the intake folder itself, is not one.
    expect(R.claimFolder('Clients/X/WorkBC Wage Subsidy/2026/Paystubs/Oct 8 to Oct 23'.split('/'))).toBe(false);
    expect(R.claimFolder('Clients/X/WorkBC Wage Subsidy/2026/Fall 2026'.split('/'))).toBe(false);
  });

  test('a wage-subsidy paystub keeps its student or intake folder; {Year}/Claims only without one', () => {
    const home = (p) => R.paystubHome(p.split('/'))?.join('/');
    expect(home('Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Electrical Apprentice - Amir Beheshtian/Oct 8 to Oct 23'))
      .toBe('Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Electrical Apprentice - Amir Beheshtian/Claims');
    expect(home('Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Fall 2026/Fall intake first claim paystubs'))
      .toBe('Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Fall 2026/Claims');
    expect(home('Clients/X/WorkBC Wage Subsidy/2026')).toBe('Clients/X/WorkBC Wage Subsidy/2026/Claims');
    expect(home('Clients/X/WorkBC Wage Subsidy/2026/Paystubs')).toBe('Clients/X/WorkBC Wage Subsidy/2026/Claims');
    expect(home('Clients/X/WorkBC Wage Subsidy/2026/Reimb')).toBe('Clients/X/WorkBC Wage Subsidy/2026/Claims');
    expect(R.paystubHome(['Clients', '_Unsorted'])).toBeNull();
  });

  test('the program table parses from the skill', () => {
    const names = R.programNames();
    expect(names.length).toBeGreaterThan(200);
    expect(names).toEqual(expect.arrayContaining(['CanExport', 'ETG (Employer Training Grant)', 'Workplace Accessibility Grant']));
  });
});

const person = (email, id) => ({ id, email, name: email, chat_user_id: `users/${id}` });
const item = (n, recipient, status = 'card', dest = 'Clients/X/CanExport/2026', name = `File ${n}`) => ({
  file: { id: `f${n}`, name, webViewLink: `https://drive.google.com/open?id=f${n}` },
  path: [{ id: 'c', name: 'Clients' }, { id: 'u', name: '_Unsorted' }], recipient, status, failures: ['name_pattern'],
  plan: status === 'card' ? { path_before: 'Granted Files/Clients/_Unsorted', path_after: `Granted Files/${dest}`, name_before: name, name_after: `Invoice-2026-File ${n}`, moving: true, request: {} } : null,
  suggestion: status === 'advised' ? { destination_path: dest, new_name: '' } : null,
  foldersToCreate: status === 'advised' ? dest.split('/').slice(1) : undefined,
  note: status === 'advised' ? `Clients/${dest.split('/')[1]} doesn't exist yet` : (status === 'unsure' ? 'unclear' : undefined)
});

describe('grouping per person', () => {
  const chris = person('writers@granted.ca', 1);
  const del = person('delpreet@granted.ca', 2);

  test('files going to the same folder share one card; different folders stay separate', () => {
    const items = [...Array.from({ length: 9 }, (_, i) => item(i, del, 'card', 'Clients/AME/ECO Canada/2026/Claims')), item(20, del, 'card', 'Clients/X/CanExport/2026')];
    const g = S.groupByRecipient(items).groups.get('delpreet@granted.ca');
    expect(g.cards.map(c => [c.kind, c.items.length])).toEqual([['move', 9], ['move', 1]]);
    expect(g.listed).toEqual([]);
  });

  test('at most 10 cards per person (cards, not files); moves first, the rest listed', () => {
    const items = [item(99, del, 'unsure'), ...Array.from({ length: 12 }, (_, i) => item(i, del, 'card', `Clients/X/CanExport/2026/Claims/2026${String(i + 1).padStart(2, '0')}`))];
    const g = S.groupByRecipient(items).groups.get('delpreet@granted.ca');
    expect(g.cards).toHaveLength(10);
    expect(g.cards.every(c => c.kind === 'move')).toBe(true);
    expect(g.listed.map(c => c.kind)).toEqual(['move', 'move', 'unsure']);
    expect(S.overflowText(g.listed)).toMatch(/^3 more/);
    expect(S.overflowText(g.listed)).toContain('not sure where it goes');
  });

  test('"not sure" files in the same folder become one card, not header lines', () => {
    const { groups } = S.groupByRecipient([item(1, del, 'unsure'), item(3, del, 'unsure'), item(2, del)]);
    const g = groups.get('delpreet@granted.ca');
    expect(g.cards.map(c => [c.kind, c.items.length])).toEqual([['move', 1], ['unsure', 2]]);
    expect(S.headerText(g)).not.toContain('Not sure');
    expect(S.headerText(g)).toContain("2 more I couldn't file myself");
    expect(S.summaryLine(S.cardView(g.cards[1]))).toBe('Not sure where these 2 files go');
  });

  test('summary lines: paystubs by program and employer, shared types, renames in place', () => {
    const stubs = ['Yeji Kang', 'Sung Lee', 'Carter Toole'].map((who, i) => item(i, del, 'card', 'Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Claims', `Paystubs-Eco Canada SWPP-${who}-AME Consulting Group- October 01 to October 15.pdf`));
    for (const s of stubs) s.plan.name_after = s.plan.name_before;
    expect(S.summaryLine(S.cardView({ kind: 'move', items: stubs })))
      .toBe('3 Eco Canada SWPP paystubs for AME Consulting Group → Clients/AME Consulting Group/Eco-Canada CO-OP/2026/Claims');
    const renames = [4, 10].map(n => {
      const it = item(n, del, 'card', 'Clients/49th Parallel/BCAFE/2026/claims/CHFA 2026', `Expense ${n} - Proof of Payment - X.pdf`);
      Object.assign(it.plan, { moving: false, path_before: it.plan.path_after, name_after: `Proof of Payment-Exp${n}-20260811-X.pdf` });
      return it;
    });
    expect(S.summaryLine(S.cardView({ kind: 'move', items: renames }))).toBe('2 Proof of Payment files — renames in Clients/49th Parallel/BCAFE/2026/claims/CHFA 2026');
  });

  test('a fallback card names whose file it is, by first name', () => {
    const it = { ...item(1, chris), routed: 'fallback_unreachable', originalEmail: 'delpreet@granted.ca', originalName: 'Delpreet Kaur' };
    expect(S.forLine([it])).toBe("Delpreet's file — they're not on Chat yet, so it's come to you.");
    expect(S.forLine([{ ...it, originalName: null }])).toBe("Delpreet's file — they're not on Chat yet, so it's come to you.");
    expect(S.forLine([it, it])).toBe("Delpreet's files — they're not on Chat yet, so they've come to you.");
    expect(S.forLine([item(2, chris)])).toBe('');
    expect(S.overflowText([{ kind: 'move', items: [it] }])).not.toContain('not reachable on Chat');
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

describe('card presses and ignored', () => {
  const s = { id: 'x', recipient_user_id: 2, status: 'suggested' };
  test('a card press: only the recipient, only while something is still open', () => {
    const rows = [{ ...s }, { ...s, id: 'y', status: 'confirmed' }];
    expect(C.pressDecision(rows, 2, 'sweep.confirm')).toBe('go');
    expect(C.pressDecision(rows, 3, 'sweep.confirm')).toBe('not_allowed');
    expect(C.pressDecision(rows, null, 'sweep.skip')).toBe('not_allowed');
    expect(C.pressDecision([{ ...s, status: 'skipped' }], 2, 'sweep.skip')).toBe('settled');
    expect(C.pressDecision([{ ...s, status: 'unsure' }], 2, 'sweep.leave')).toBe('go');
    expect(C.pressDecision([{ ...s, status: 'advised' }], 2, 'sweep.leave')).toBe('go');
    expect(C.pressDecision([{ ...s, status: 'left' }], 2, 'sweep.leave')).toBe('settled');
    expect(C.pressDecision([{ ...s, status: 'unsure' }], 3, 'sweep.leave')).toBe('not_allowed');
    expect(C.pressDecision([], 2, 'sweep.leave')).toBe('unknown');
  });

  test('Confirm all runs each open file through the unchanged gate and records each one', async () => {
    const rows = ['a', 'b', 'c'].map((id, i) => ({ id, file_name: `F${i}`, recipient_user_id: 2, status: 'suggested', pending_action_id: `pa-${id}` }));
    rows.push({ id: 'd', file_name: 'F3', status: 'confirmed', pending_action_id: 'pa-d' });
    const actions = new Map(['a', 'b', 'c', 'd'].map(id => [`pa-${id}`, { id: `pa-${id}`, status: 'pending', conversation_id: `conv-${id}` }]));
    const deps = {
      query: jest.fn(async () => ({ rows: [] })),
      canConfirm: jest.fn(async (action) => (action.id === 'pa-c' ? { allowed: false, name: 'Delpreet' } : { allowed: true })),
      runPendingAction: jest.fn(async ({ actionId }) => ({ ok: true, summary: 'Move', result: actionId === 'pa-b' ? { success: false, error: 'Drive said no.' } : { success: true, summary: 'Moved', action_id: 'da1', undo_token: 'u1' } })),
      saveMessage: jest.fn(async () => {})
    };
    const results = await C.confirmGroup(rows, actions, { userId: 2, presserName: 'Delpreet' }, deps);
    expect(deps.runPendingAction.mock.calls.map(c => c[0].actionId)).toEqual(['pa-a', 'pa-b']);
    expect(results.map(r => [r.row.id, r.ok])).toEqual([['a', true], ['b', false], ['c', false]]);
    expect(deps.saveMessage).toHaveBeenCalledWith('conv-a', 'system', expect.stringContaining('Undo token u1'));
    expect(deps.query.mock.calls.map(c => c[1])).toEqual([['a', 'confirmed'], ['b', 'failed']]);
    expect(C.resultText(results)).toBe('1 filed, 2 not done: F1 (Drive said no); F2 (only Delpreet can confirm)');
    expect(C.stateOfRows(rows)).toEqual({ state: 'failed', detail: '2 filed, 1 not done, 1 still open' });
  });

  test('cards: one Confirm all / Skip for a group, Leave it here for not-sure and advisory cards', () => {
    const del = person('delpreet@granted.ca', 2);
    const stubs = [1, 2, 3].map(n => item(n, del, 'card', 'Clients/AME/ECO Canada/2026/Claims', `Paystubs-Eco Canada SWPP-P${n}-AME- Oct 1 to Oct 15.pdf`));
    const g = '33333333-3333-3333-3333-333333333333';
    const move = JSON.stringify(C.renderSweepCard(S.cardView({ kind: 'move', items: stubs }), { groupId: g, askerName: 'Delpreet' }));
    expect(move).toContain('Confirm all');
    expect(move).toContain('sweep.confirm');
    expect(move).toContain('sweep.skip');
    expect(move).toContain('"collapsible":true');
    expect(move).toContain('3 Eco Canada SWPP paystubs for AME');
    expect(move).not.toContain('pending.confirm');
    const unsure = JSON.stringify(C.renderSweepCard(S.cardView({ kind: 'unsure', items: [item(9, del, 'unsure')] }), { groupId: g }));
    expect(unsure).toContain('Leave it here');
    expect(unsure).toContain('sweep.leave');
    expect(unsure).toContain('Reply in this thread');
    expect(unsure).not.toContain('sweep.confirm');
    const advise = JSON.stringify(C.renderSweepCard(S.cardView({ kind: 'advise', items: [item(8, del, 'advised', 'Clients/New Employer/WorkBC Wage Subsidy/2026/Claims')] }), { groupId: g }));
    expect(advise).toContain("Clients/New Employer doesn't exist yet");
    expect(advise).toContain('Leave it here');
    expect(advise).not.toContain('sweep.confirm');
    expect(JSON.stringify(C.renderSweepCard(S.cardView({ kind: 'unsure', items: [item(9, del, 'unsure')] }), { groupId: g, state: 'left' }))).toContain('Left where it is');
  });

  test('only the recipient may skip a pre-grouping card, and only while it is still suggested', () => {
    expect(C.skipDecision(s, 2)).toBe('skip');
    expect(C.skipDecision(s, 3)).toBe('not_allowed');
    expect(C.skipDecision(s, null)).toBe('not_allowed');
    expect(C.skipDecision({ ...s, status: 'confirmed' }, 2)).toBe('settled');
    expect(C.skipDecision(null, 2)).toBe('unknown');
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
    newId: jest.fn(() => 'group-1'),
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
    expect(db.calls.some(c => /group_id = \$\d/.test(c.sql) && c.params.includes('group-1'))).toBe(true);
  });

  test('two files for the same folder: one card, two pending actions', async () => {
    const db = fakeDb({ users: USERS });
    let k = 0;
    const deps = runDeps(db, fakeDrive([newFile('g1', 'delpreet@granted.ca'), newFile('g2', 'delpreet@granted.ca')], folders), {
      planFileMove: jest.fn(async (input) => ({ ok: true, plan: { request: input, path_before: 'Granted Files/Clients/Caliber Projects', path_after: 'Granted Files/Clients/Caliber Projects/CanExport/2026', name_before: 'scan', name_after: `Invoice-202609-Bellrock ${++k}`, moving: true } }))
    });
    await S.runFilingSweep({ deps, env: {} });
    expect(db.statuses().map(r => r[1])).toEqual(['suggested', 'suggested']);
    expect(deps.savePendingAction).toHaveBeenCalledTimes(2);
    expect(deps.renderCard).toHaveBeenCalledTimes(1);
    expect(deps.renderCard.mock.calls[0][0].files).toHaveLength(2);
    expect(deps.post).toHaveBeenCalledTimes(2);   // header + one grouped card
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

  test('not confident: a "not sure" card with Leave it here, no pending action', async () => {
    const db = fakeDb({ users: USERS });
    const deps = runDeps(db, fakeDrive([newFile('n4', 'delpreet@granted.ca')], folders), {
      createMessage: jest.fn(async () => ({ content: [{ type: 'tool_use', name: 'suggest_filing', input: { confident: false, destination_path: '', new_name: '', reason: 'unclear' } }] }))
    });
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.savePendingAction).not.toHaveBeenCalled();
    expect(deps.post.mock.calls[0][0].text).toContain("1 new file in Granted Files I couldn't file myself");
    expect(deps.renderCard.mock.calls[0][0]).toEqual(expect.objectContaining({ kind: 'unsure' }));
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

  test('full dates and expense numbers a name shows', () => {
    expect([...S.visibleDays('Expense 10 - Proof of Payment - Kickback Social - 11 August 2026.pdf')]).toEqual(['20260811']);
    expect([...S.visibleDays('Expense 5 - Proof of Payment - Delta Hotels - September 28 2026.pdf')]).toEqual(['20260928']);
    expect([...S.visibleDays('x 2026-08-11 and 20260901')].sort()).toEqual(['20260811', '20260901']);
    expect(S.visibleDays('Expense 9- Proof of Payment - LMS Services - October 2026').size).toBe(0);
    expect(S.expenseNumber('Expense 9- Proof of Payment')).toBe(9);
    expect(S.expenseNumber('Proof of Payment - Kickback')).toBeNull();
  });

  test('a claim-folder rename keeps the expense number and the full date', () => {
    const name = 'Expense 10 - Proof of Payment - Kickback Social - 11 August 2026.pdf';
    expect(S.claimRenameProblem(name, 'Proof of Payment-Exp10-20260811-Kickback Social')).toBeNull();
    expect(S.claimRenameProblem(name, 'Proof of Payment-202608-Kickback Social')).toMatch(/not \{Type\}-Exp/);
    expect(S.claimRenameProblem(name, 'Proof of Payment-20260811-Kickback Social')).toMatch(/expense number/);
    expect(S.claimRenameProblem(name, 'Proof of Payment-Exp1-20260811-Kickback Social')).toMatch(/expense number/);
    expect(S.claimRenameProblem(name, 'Proof of Payment-Exp10-20260801-Kickback Social')).toMatch(/not the full date/);
    expect(S.claimRenameProblem('Proof of Payment - Kickback - 11 August 2026.pdf', 'Proof of Payment-20260811-Kickback')).toBeNull();
    expect(S.claimRenameProblem('Expense 3 - Invoice - Kickback - August 2026.pdf', 'Invoice-Exp3-20260801-Kickback')).toMatch(/no full date/);
  });

  const claimFolders = {
    c: { id: 'c', name: 'Clients', parents: [GF] },
    cl: { id: 'cl', name: '49th Parallel', parents: ['c'] },
    b: { id: 'b', name: 'BCAFE', parents: ['cl'] },
    y: { id: 'y', name: '2026', parents: ['b'] },
    cs: { id: 'cs', name: 'claims', parents: ['y'] },
    ch: { id: 'ch', name: 'CHFA 2026', parents: ['cs'] }
  };
  const tool = (input) => jest.fn(async () => ({ content: [{ type: 'tool_use', name: 'suggest_filing', input: { confident: true, reason: 'x', ...input } }] }));

  test('a file in a claim folder is only renamed, whatever the model suggests', async () => {
    const db = fakeDb({ users: USERS });
    const f = { id: 'e10', name: 'Expense 10 - Proof of Payment - Kickback Social - 11 August 2026.pdf', mimeType: 'application/pdf', parents: ['ch'], lastModifyingUser: { emailAddress: 'delpreet@granted.ca' } };
    const deps = runDeps(db, fakeDrive([f], claimFolders), { createMessage: tool({ destination_path: 'Clients/49th Parallel/BCAFE/2026/Claims/202608', new_name: 'Proof of Payment-Exp10-20260811-Kickback Social' }) });
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.planFileMove).toHaveBeenCalledWith({ file: 'e10', destination_path: null, new_name: 'Proof of Payment-Exp10-20260811-Kickback Social' }, expect.anything());
    const db2 = fakeDb({ users: USERS });
    const deps2 = runDeps(db2, fakeDrive([f], claimFolders), { createMessage: tool({ destination_path: '', new_name: 'Proof of Payment-202608-Kickback Social' }) });
    await S.runFilingSweep({ deps: deps2, env: {} });
    expect(deps2.planFileMove).not.toHaveBeenCalled();
    expect(db2.statuses().map(r => r[1])).toEqual(['unsure']);
  });

  const stubFolders = {
    c: { id: 'c', name: 'Clients', parents: [GF] },
    u: { id: 'u', name: '_Unsorted', parents: ['c'] }
  };
  const stub = { id: 'ps1', name: 'Paystubs-WorkBC-Amir Beheshtian-Nightingale Electrical- Oct 8-Oct 23.pdf', mimeType: 'application/pdf', parents: ['u'], lastModifyingUser: { emailAddress: 'delpreet@granted.ca' } };

  test('a paystub with Delpreet\'s name is moved but never renamed, and only into a Claims folder', async () => {
    const db = fakeDb({ users: USERS });
    const deps = runDeps(db, fakeDrive([stub], stubFolders), { createMessage: tool({ destination_path: 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Claims', new_name: 'Paystub-202610-Amir Beheshtian' }) });
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.planFileMove).toHaveBeenCalledWith({ file: 'ps1', destination_path: 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Claims', new_name: null }, expect.anything());
    const db2 = fakeDb({ users: USERS });
    const deps2 = runDeps(db2, fakeDrive([stub], stubFolders), { createMessage: tool({ destination_path: 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Paystubs', new_name: '' }) });
    await S.runFilingSweep({ deps: deps2, env: {} });
    expect(db2.statuses().map(r => r[1])).toEqual(['unsure']);
  });

  test('a paystub loose in a student folder goes to Claims inside it; one in a pay-period folder stays put', async () => {
    const fs = {
      c: { id: 'c', name: 'Clients', parents: [GF] },
      ne: { id: 'ne', name: 'Nightingale Electrical', parents: ['c'] },
      w: { id: 'w', name: 'WorkBC Wage Subsidy', parents: ['ne'] },
      y: { id: 'y', name: '2026', parents: ['w'] },
      st: { id: 'st', name: 'Electrical Apprentice - Amir Beheshtian', parents: ['y'] },
      pp: { id: 'pp', name: 'Oct 8 to Oct 23', parents: ['st'] }
    };
    const db = fakeDb({ users: USERS });
    // Loose in the student folder (not in a claim or pay-period folder): moved into Claims inside it.
    const deps = runDeps(db, fakeDrive([{ ...stub, parents: ['st'] }], fs), { createMessage: tool({ destination_path: 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Claims', new_name: '' }) });
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.planFileMove).toHaveBeenCalledWith({ file: 'ps1', destination_path: 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Electrical Apprentice - Amir Beheshtian/Claims', new_name: null }, expect.anything());
    // In a pay-period folder under it: left there, no model call, no card.
    const db2 = fakeDb({ users: USERS });
    const deps2 = runDeps(db2, fakeDrive([{ ...stub, parents: ['pp'] }], fs));
    await S.runFilingSweep({ deps: deps2, env: {} });
    expect(deps2.createMessage).not.toHaveBeenCalled();
    expect(deps2.post).not.toHaveBeenCalled();
    expect(db2.statuses()).toEqual([['ps1', 'ok', 'delpreet@granted.ca']]);
  });

  test('an employer with no client folder gets an advisory card, not "not sure" and not a move', async () => {
    const db = fakeDb({ users: USERS });
    const deps = runDeps(db, fakeDrive([stub], stubFolders), {
      createMessage: tool({ destination_path: 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Claims', new_name: '' }),
      resolvePath: jest.fn(async () => ({ missingAt: 1, names: ['Clients'] }))
    });
    await S.runFilingSweep({ deps, env: {} });
    expect(deps.planFileMove).not.toHaveBeenCalled();
    expect(deps.savePendingAction).not.toHaveBeenCalled();
    expect(db.statuses()).toEqual([['ps1', 'advised', 'delpreet@granted.ca']]);
    const view = deps.renderCard.mock.calls[0][0];
    expect(view).toEqual(expect.objectContaining({ kind: 'advise', destination: 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Claims', foldersToCreate: ['Nightingale Electrical', 'WorkBC Wage Subsidy', '2026', 'Claims'] }));
    // An existing client: the normal move card.
    const db2 = fakeDb({ users: USERS });
    const deps2 = runDeps(db2, fakeDrive([stub], stubFolders), {
      createMessage: tool({ destination_path: 'Clients/Nightingale Electrical/WorkBC Wage Subsidy/2026/Claims', new_name: '' }),
      resolvePath: jest.fn(async () => ({ missingAt: 3, names: ['Clients', 'Nightingale Electrical', 'WorkBC Wage Subsidy'] }))
    });
    await S.runFilingSweep({ deps: deps2, env: {} });
    expect(deps2.planFileMove).toHaveBeenCalled();
    expect(db2.statuses().map(r => r[1])).toEqual(['suggested']);
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

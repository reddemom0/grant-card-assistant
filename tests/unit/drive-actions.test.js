/**
 * Gated Drive move / rename (src/tools/drive-actions.js) and who may confirm it
 * (canConfirm in src/tools/pending-actions.js).
 *
 * A fake Drive stands in for googleapis: a small Granted Files tree, Granted
 * Archive, and a My Drive. It has no delete, trash, copy or permissions
 * methods, so any such call would throw. The database is an in-memory stub.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/drive-actions.test.js
 */

import { jest } from '@jest/globals';
import fs from 'node:fs';

process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{"type":"service_account","client_email":"sa@test"}';

const GF = '0AKxoOSs3WbQ0Uk9PVA';
const ARCHIVE = '0AI7O7n1jH-IoUk9PVA';
const FOLDER = 'application/vnd.google-apps.folder';
const CHRIS = { id: 1, email: 'writers@granted.ca', name: 'Chris' };
const ASKER = { id: 2, email: 'steph@granted.ca', name: 'Steph' };
const OTHER = { id: 3, email: 'nat@granted.ca', name: 'Nat' };

// ---------------------------------------------------------------- fake Drive
let items;
let calls;
let authBroken;
let sheetFails;
let sheetRows;
const subjects = [];

function seedDrive() {
  items = new Map();
  const add = (id, name, parents, extra = {}) => items.set(id, { id, name, parents, mimeType: FOLDER, ...extra });
  const file = (id, name, parents, extra = {}) => add(id, name, parents, { mimeType: 'application/vnd.google-apps.document', ...extra });
  // Granted Files
  add('C', 'Clients', [GF], { driveId: GF });
  add('P', 'Programs', [GF], { driveId: GF });
  add('D', 'Departments', [GF], { driveId: GF });
  add('O', 'Old Files', [GF], { driveId: GF });
  add('L', 'Live Clients', [GF], { driveId: GF });
  add('ACUVA', 'Acuva', ['C'], { driveId: GF });
  add('AI', 'AI', ['D'], { driveId: GF });
  add('MIND', 'Mindfulness', ['D'], { driveId: GF });
  // My Drive (the asker's)
  add('MYROOT', 'My Drive', []);
  add('NOTES', 'Notes', ['MYROOT']);
  add('HRDOCS', 'HR Docs', ['MYROOT']);
  const mine = { ownedByMe: true, owners: [{ emailAddress: ASKER.email }] };
  file('doc1', 'acme notes', ['NOTES'], mine);
  file('pdf1', 'scan.pdf', ['NOTES'], { ...mine, mimeType: 'application/pdf' });
  file('hr1', 'Offer Letter - draft', ['NOTES'], mine);
  file('hrpath1', 'plan', ['HRDOCS'], mine);
  file('ext1', 'from a client', ['NOTES'], { ownedByMe: false, owners: [{ emailAddress: 'someone@gmail.com' }] });
  file('nats1', 'nat doc', ['NATROOT'], { ownedByMe: false, owners: [{ emailAddress: OTHER.email }] });
  file('fin1', 'q3 numbers', ['NOTES'], { ownedByMe: false, owners: [{ emailAddress: 'payment@granted.ca' }] });
  add('fold1', 'Some folder', ['NOTES'], mine);
  file('short1', 'shortcut', ['NOTES'], { ...mine, mimeType: 'application/vnd.google-apps.shortcut' });
  // Granted Archive
  file('arch1', 'old thing', [ARCHIVE], { driveId: ARCHIVE });
}

let createSeq = 0;
const fakeDrive = {
  files: {
    async get({ fileId }) {
      calls.push(['get', fileId]);
      const it = items.get(fileId);
      if (!it) throw Object.assign(new Error('not found'), { code: 404 });
      return { data: { ...it, webViewLink: `https://docs.google.com/d/${fileId}` } };
    },
    async list({ q }) {
      const parent = /'([^']+)' in parents/.exec(q)[1];
      const files = [...items.values()].filter(i => i.parents.includes(parent) && i.mimeType === FOLDER).map(({ id, name }) => ({ id, name }));
      return { data: { files } };
    },
    async create({ requestBody }) {
      calls.push(['create', requestBody.name, requestBody.parents[0]]);
      const id = `NEW${++createSeq}`;
      items.set(id, { id, name: requestBody.name, parents: requestBody.parents, mimeType: FOLDER, driveId: GF });
      return { data: { id, name: requestBody.name } };
    },
    async update({ fileId, addParents, removeParents, requestBody }) {
      calls.push(['update', fileId, addParents || null, removeParents || null, requestBody?.name || null]);
      const it = items.get(fileId);
      if (requestBody?.name) it.name = requestBody.name;
      if (addParents || removeParents) {
        const remove = (removeParents || '').split(',').filter(Boolean);
        it.parents = [...it.parents.filter(p => !remove.includes(p)), ...(addParents || '').split(',').filter(Boolean)];
        const top = it.parents[0];
        it.driveId = items.get(top)?.driveId || (top === GF ? GF : undefined);
      }
      return { data: { id: fileId, name: it.name, parents: it.parents } };
    }
  }
};

const fakeGoogle = {
  auth: {
    GoogleAuth: class {
      constructor(cfg) {
        if (authBroken) throw new SyntaxError('bad key');
        subjects.push({ subject: cfg.clientOptions?.subject ?? null, scopes: cfg.scopes });
      }
    },
    OAuth2: class { constructor() { throw new Error('OAuth2 must never be used'); } }
  },
  drive: () => fakeDrive,
  sheets: () => ({
    spreadsheets: {
      values: {
        async append({ spreadsheetId, range, requestBody }) {
          if (sheetFails) throw Object.assign(new Error('forbidden'), { code: 403 });
          sheetRows.push({ spreadsheetId, range, values: requestBody.values });
          return { data: {} };
        }
      }
    }
  })
};
jest.unstable_mockModule('googleapis', () => ({ google: fakeGoogle }));

// ---------------------------------------------------------------- fake DB
let driveRows;
let pending;
const users = [CHRIS, ASKER, OTHER];
const DRIVE_COLS = ['action', 'asker_user_id', 'asker_email', 'confirmed_by', 'pending_action_id', 'conversation_id',
  'file_id', 'name_before', 'name_after', 'parents_before', 'parents_after', 'path_before', 'path_after',
  'owner_label', 'folders_created', 'result', 'error', 'undo_token', 'undoes_action_id'];

const mockQuery = jest.fn(async (sql, params = []) => {
  const t = sql.replace(/\s+/g, ' ').trim();
  if (t.startsWith('INSERT INTO drive_actions')) {
    const row = Object.fromEntries(DRIVE_COLS.map((c, i) => [c, params[i]]));
    row.id = `da-${driveRows.length + 1}`;
    row.undone_at = null;
    row.folders_created = JSON.parse(row.folders_created);
    driveRows.push(row);
    return { rows: [row] };
  }
  if (t.startsWith('SELECT * FROM drive_actions WHERE undo_token')) {
    return { rows: driveRows.filter(r => r.undo_token === params[0] && r.action === 'move_rename' && r.result === 'done' && !r.undone_at) };
  }
  if (t.startsWith('UPDATE drive_actions SET sheet_logged')) {
    const r = driveRows.find(x => x.id === params[0]);
    if (r) { r.sheet_logged = params[1]; r.sheet_error = params[2]; }
    return { rows: [] };
  }
  if (t.startsWith('UPDATE drive_actions SET undone_at')) {
    const r = driveRows.find(x => x.id === params[0]);
    if (r) r.undone_at = new Date();
    return { rows: [] };
  }
  if (t.startsWith('SELECT id FROM users WHERE LOWER(email)')) {
    return { rows: users.filter(u => u.email === params[0].toLowerCase()).map(u => ({ id: u.id })) };
  }
  if (t.startsWith('SELECT id, name, email FROM users WHERE id = ANY')) {
    return { rows: users.filter(u => params[0].includes(u.id)) };
  }
  if (t.startsWith('SELECT * FROM pending_actions WHERE id = $1')) {
    return { rows: pending.filter(p => p.id === params[0]) };
  }
  if (t.startsWith('SELECT * FROM pending_actions WHERE conversation_id')) {
    return { rows: pending.filter(p => p.conversation_id === params[0] && p.status === 'pending') };
  }
  if (t.startsWith("UPDATE pending_actions SET status = 'confirmed'")) {
    throw new Error('a refused confirmer must never claim the row');
  }
  if (t.startsWith("UPDATE pending_actions SET status = 'declined'")) {
    throw new Error('a refused canceller must never decline the row');
  }
  throw new Error(`unexpected SQL in test: ${t.slice(0, 80)}`);
});
jest.unstable_mockModule('../../src/database/connection.js', () => ({ query: mockQuery, getPool: jest.fn(), transaction: jest.fn() }));

const actions = await import('../../src/tools/drive-actions.js');
const { canConfirm, runPendingAction, declinePendingAction, summarizeAction } = await import('../../src/tools/pending-actions.js');
const { tryHandleConfirmation } = await import('../../src/api/confirmation.js');
const { matchSensitive, isExcludedOwner } = await import('../../src/tools/drive-sensitive.js');

const as = (user) => ({ askerEmail: user.email, askerUserId: user.id });
const plan = async (input, user = ASKER) => actions.planFileMove(input, as(user));

beforeEach(() => {
  seedDrive();
  calls = [];
  authBroken = false;
  sheetFails = false;
  sheetRows = [];
  driveRows = [];
  pending = [];
  subjects.length = 0;
  createSeq = 0;
});

// Identities used for Drive (the sheet append is the service account itself, by design).
const driveSubjects = () => [...new Set(subjects.filter(x => x.scopes.some(sc => sc.includes('/auth/drive'))).map(x => x.subject))];

// ============================================================================
describe('refusals (nothing is planned, nothing is written)', () => {
  const refused = async (input, user = ASKER) => {
    const r = await plan(input, user);
    expect(r.ok).toBe(false);
    expect(calls.filter(c => c[0] !== 'get')).toEqual([]);   // reads only
    return r.reason;
  };

  test('a file owned outside granted.ca', async () => {
    expect(await refused({ file: 'ext1', destination_path: 'Departments/AI' })).toMatch(/owned outside granted\.ca/);
  });

  test("someone else's My Drive file", async () => {
    expect(await refused({ file: 'nats1', destination_path: 'Departments/AI' })).toMatch(/someone else's My Drive/);
  });

  test('a destination outside Clients/, Programs/ and Departments/', async () => {
    for (const dest of ['Old Files/x', 'Live Clients/Acuva', 'Active Clients/Acuva', 'Granted Files', 'My Drive/x']) {
      expect(await refused({ file: 'doc1', destination_path: dest }))
        .toMatch(/only move files into Granted Files, under Clients\/, Programs\/ or Departments\//);
    }
    expect(await refused({ file: 'doc1', destination_path: 'Clients' })).toMatch(/inside Clients\/, not Clients\/ itself/);
    expect(await refused({ file: 'doc1', destination_path: 'Departments/Mindfulness' })).toMatch(/legacy folder/);
  });

  test('Granted Archive as the destination', async () => {
    expect(await refused({ file: 'doc1', destination_path: 'Granted Archive/Old' })).toMatch(/only move files into Granted Files/);
  });

  test('creating a client, program or department folder (top level)', async () => {
    expect(await refused({ file: 'doc1', destination_path: 'Clients/NewCo/CanExport' })).toMatch(/"NewCo" doesn't exist/);
    expect(await refused({ file: 'doc1', destination_path: 'Programs/New Program' })).toMatch(/"New Program" doesn't exist/);
    expect(await refused({ file: 'doc1', destination_path: 'Departments/PRODUCTS/x' })).toMatch(/create that one by hand/);
  });

  test("Granted's own HR / finance material: name, new name, folder in the path, finance owner", async () => {
    expect(await refused({ file: 'hr1', destination_path: 'Departments/AI' })).toMatch(/Offer Letter material \(the file name\)/);
    expect(await refused({ file: 'doc1', new_name: 'Payroll-2026' })).toMatch(/Payroll material \(the new name\)/);
    expect(await refused({ file: 'hrpath1', destination_path: 'Departments/AI' })).toMatch(/HR material \(the folder "HR Docs"\)/);
    expect(await refused({ file: 'fin1', destination_path: 'Departments/AI' })).toMatch(/finance account/);
    expect(await refused({ file: 'doc1', destination_path: 'Departments/AI' }, { id: 9, email: 'payment@granted.ca' })).toMatch(/finance accounts/);
  });

  test('a folder (or a shortcut) as the source', async () => {
    expect(await refused({ file: 'fold1', destination_path: 'Departments/AI' })).toMatch(/That's a folder/);
    expect(await refused({ file: 'short1', destination_path: 'Departments/AI' })).toMatch(/shortcut/);
  });

  test('a missing or unusable service-account key: "Drive access unavailable", no fallback', async () => {
    authBroken = true;
    expect(await refused({ file: 'doc1', destination_path: 'Departments/AI' })).toBe('Drive access unavailable');
    expect(calls).toEqual([]);
  });

  test('no @granted.ca asker', async () => {
    expect(await refused({ file: 'doc1', destination_path: 'Departments/AI' }, { id: null, email: null })).toMatch(/couldn't confirm who is asking/);
    expect(await refused({ file: 'doc1', destination_path: 'Departments/AI' }, { id: 7, email: 'x@gmail.com' })).toMatch(/couldn't confirm who is asking/);
  });
});

// ============================================================================
describe('confirmation: only the asker (undo: the asker or Chris)', () => {
  const proposal = (tool, extra = {}) => {
    const row = {
      id: `pa-${pending.length + 1}`, conversation_id: 'conv-1', tool_name: tool, status: 'pending',
      proposed_by: ASKER.id, tool_input: { asker_user_id: ASKER.id }, summary: 'Move "acme notes"…', ...extra
    };
    pending.push(row);
    return row;
  };

  test('a move: someone else is refused with the asker\'s name, and nothing runs', async () => {
    const row = proposal('file_move_rename');
    expect(await canConfirm(row, ASKER.id)).toEqual({ allowed: true });
    expect(await canConfirm(row, OTHER.id)).toEqual({ allowed: false, name: 'Steph' });
    expect(await canConfirm(row, CHRIS.id)).toEqual({ allowed: false, name: 'Steph' });
    await expect(runPendingAction({ actionId: row.id, userId: OTHER.id })).resolves.toMatchObject({ ok: false, reason: 'not_allowed', name: 'Steph' });
    await expect(declinePendingAction({ actionId: row.id, userId: OTHER.id })).resolves.toBe(false);
    await expect(tryHandleConfirmation({ conversationId: 'conv-1', userId: OTHER.id, text: 'yes' }))
      .resolves.toEqual({ replyText: 'Only Steph can confirm this.' });
    expect(row.status).toBe('pending');
  });

  test('an undo: the original asker or Chris, nobody else', async () => {
    const row = proposal('file_move_rename_undo', { proposed_by: OTHER.id });
    expect(await canConfirm(row, ASKER.id)).toEqual({ allowed: true });
    expect(await canConfirm(row, CHRIS.id)).toEqual({ allowed: true });
    expect((await canConfirm(row, OTHER.id)).allowed).toBe(false);
  });

  test('every other gated tool keeps "anyone in the conversation may confirm"', async () => {
    expect(await canConfirm({ tool_name: 'create_hubspot_deal', proposed_by: ASKER.id }, OTHER.id)).toEqual({ allowed: true });
  });
});

// ============================================================================
describe('a move that runs', () => {
  test('creates the (new) folder, moves and renames in one update, logs a row and sheet rows', async () => {
    const p = await plan({ file: 'doc1', destination_path: 'Departments/AI/_test', new_name: 'Meeting Notes-20261013-Test' });
    expect(p.ok).toBe(true);
    expect(p.plan).toMatchObject({
      name_before: 'acme notes', name_after: 'Meeting Notes-20261013-Test', moving: true,
      path_before: 'My Drive/Notes', path_after: 'Granted Files/Departments/AI/_test', folders_to_create: ['_test']
    });
    expect(summarizeAction('file_move_rename', p.plan)).toBe(
      'Move "acme notes" from My Drive/Notes to Granted Files/Departments/AI/_test and rename it to "Meeting Notes-20261013-Test". Folders to create (new): _test.'
    );

    const r = await actions.executeFileMove(p.plan, { askerEmail: ASKER.email, confirmedBy: ASKER.id });
    expect(r).toMatchObject({ success: true, home: 'Granted Files/Departments/AI/_test', folders_created: ['_test'] });
    expect(calls.filter(c => c[0] === 'create')).toEqual([['create', '_test', 'AI']]);
    expect(calls.filter(c => c[0] === 'update')).toEqual([['update', 'doc1', 'NEW1', 'NOTES', 'Meeting Notes-20261013-Test']]);
    expect(items.get('doc1')).toMatchObject({ parents: ['NEW1'], name: 'Meeting Notes-20261013-Test' });

    expect(driveRows).toHaveLength(1);
    expect(driveRows[0]).toMatchObject({ action: 'move_rename', result: 'done', asker_email: ASKER.email, parents_before: ['NOTES'], parents_after: ['NEW1'], sheet_logged: true });
    expect(r.undo_token).toBe(driveRows[0].undo_token);
    expect(sheetRows[0].range).toBe('Log!A1');
    expect(sheetRows[0].values.map(v => [v[1], v[2], v[7], v[8], v[10]])).toEqual([
      ['Oracle', 'folder created', '', 'Granted Files/Departments/AI/_test', ASKER.email],
      ['Oracle', 'move + rename', 'My Drive/Notes', 'Granted Files/Departments/AI/_test', ASKER.email]
    ]);
    // Drive was only ever used as the asker; the sheet as the service account itself.
    expect(driveSubjects()).toEqual([ASKER.email]);
    expect(subjects.filter(x => x.scopes.some(sc => sc.includes('/auth/spreadsheets'))).map(x => x.subject)).toEqual([null]);
  });

  test('a failed sheet append still counts as done, and the miss is recorded', async () => {
    sheetFails = true;
    const p = await plan({ file: 'doc1', destination_path: 'Departments/AI' });
    const r = await actions.executeFileMove(p.plan, { askerEmail: ASKER.email });
    expect(r.success).toBe(true);
    expect(driveRows[0]).toMatchObject({ result: 'done', sheet_logged: false, sheet_error: expect.stringMatching(/sheet append failed/) });
  });

  test('an uploaded file keeps its extension; rename only stays in place', async () => {
    const p = await plan({ file: 'pdf1', new_name: 'Invoice-202609-Hapa' });
    expect(p.plan).toMatchObject({ name_after: 'Invoice-202609-Hapa.pdf', moving: false, folders_to_create: [] });
  });

  test('a file in Granted Archive may move into Granted Files', async () => {
    const p = await plan({ file: 'arch1', destination_path: 'Clients/Acuva' });
    expect(p).toMatchObject({ ok: true, plan: { source_drive: 'Granted Archive', path_after: 'Granted Files/Clients/Acuva' } });
  });

  test('only the asker can run it, and a folder not shown as (new) is never created', async () => {
    const p = await plan({ file: 'doc1', destination_path: 'Departments/AI/_test' });
    await expect(actions.executeFileMove(p.plan, { askerEmail: OTHER.email })).resolves.toMatchObject({ success: false });

    const stale = { ...p.plan, folders_to_create: [] };   // card showed no (new) folder
    const r = await actions.executeFileMove(stale, { askerEmail: ASKER.email });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/weren't on the card \(_test\)/) });
    expect(calls.filter(c => c[0] !== 'get')).toEqual([]);
  });

  test('a file changed after the card was shown is not moved', async () => {
    const p = await plan({ file: 'doc1', destination_path: 'Departments/AI' });
    items.get('doc1').name = 'renamed meanwhile';
    const r = await actions.executeFileMove(p.plan, { askerEmail: ASKER.email });
    expect(r.success).toBe(false);
    expect(calls.filter(c => c[0] === 'update')).toEqual([]);
  });
});

// ============================================================================
describe('undo', () => {
  async function moved() {
    const p = await plan({ file: 'doc1', destination_path: 'Departments/AI/_test', new_name: 'Meeting Notes-20261013-Test' });
    return actions.executeFileMove(p.plan, { askerEmail: ASKER.email, confirmedBy: ASKER.id });
  }

  test('restores the old folder and name as the original asker, logs it, and cannot run twice', async () => {
    const { undo_token } = await moved();
    subjects.length = 0;
    const u = await actions.planUndo({ undo_token });
    expect(u.ok).toBe(true);
    expect(summarizeAction('file_move_rename_undo', u.plan)).toBe('Undo the earlier change: put "Meeting Notes-20261013-Test" back as "acme notes" in My Drive/Notes.');

    const r = await actions.executeUndo(u.plan, { confirmedBy: CHRIS.id });
    expect(r.success).toBe(true);
    expect(items.get('doc1')).toMatchObject({ parents: ['NOTES'], name: 'acme notes' });
    expect(items.has('NEW1')).toBe(true);                       // the folder it made stays
    expect(driveSubjects()).toEqual([ASKER.email]);   // as the asker, though Chris confirmed
    expect(driveRows.map(d => [d.action, d.result])).toEqual([['move_rename', 'done'], ['undo', 'done']]);
    expect(driveRows[0].undone_at).not.toBeNull();
    expect(sheetRows[1].values[0][2]).toBe('move back');

    await expect(actions.planUndo({ undo_token })).resolves.toMatchObject({ ok: false });
  });

  test('refused when the file changed since the move', async () => {
    const { undo_token } = await moved();
    items.get('doc1').name = 'changed by hand';
    await expect(actions.planUndo({ undo_token })).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/Undo it by hand/) });
  });
});

// ============================================================================
describe('the shared sensitive list', () => {
  test('whole words only', () => {
    expect(matchSensitive('HR Policies')).toBe('HR');
    expect(matchSensitive('2026-P&L-summary')).toBe('P&L');
    expect(matchSensitive('Three Rivers')).toBeNull();
    expect(matchSensitive('Meeting Notes-20261013-Marketing Sync')).toBeNull();
    expect(isExcludedOwner('TomLiao@granted.ca')).toBe(true);
    expect(isExcludedOwner('tomliao@gmail.com')).toBe(false);
  });
});

// ============================================================================
test('the new Drive code calls no delete, trash, copy or permissions APIs', () => {
  for (const f of ['src/tools/drive-actions.js', 'src/cards/confirm-card.js']) {
    const src = fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
    expect(src).not.toMatch(/\.(delete|emptyTrash|copy)\s*\(|permissions\.|trashed\s*:\s*true/);
  }
});

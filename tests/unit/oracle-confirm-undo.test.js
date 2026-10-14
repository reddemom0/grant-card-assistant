/**
 * Oracle Drive move — what happens after a press on Confirm, and "undo that".
 *
 * 1. A press on the card records a SYSTEM EVENT in the conversation (role
 *    'system', "[System event …]" text with the drive_actions id and undo
 *    token), never an assistant message the model could disown.
 * 2. "Undo that" is caught by code: the newest undoable move in the
 *    conversation becomes a file_move_rename_undo proposal; the model is not called.
 * 3. Wording: the card and the gate say "Press Confirm to run it."
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/oracle-confirm-undo.test.js
 */

import { jest } from '@jest/globals';
import fs from 'node:fs';

const CONV = 'bbd94f04-37b7-59c0-a82f-91464d673f79';
const ACTION_ROW = {
  id: 'ec3a32b9-bb0a-4234-9090-1d32e71642a1', conversation_id: CONV, tool_name: 'file_move_rename', status: 'pending',
  proposed_by: 1, summary: 'Move "ZZ oracle move test" from My Drive to Granted Files/Departments/AI/_test and rename it to "Test-20261014-Oracle Move".',
  tool_input: { file_link: 'https://drive.google.com/open?id=F1', name_before: 'ZZ oracle move test', name_after: 'Test-20261014-Oracle Move', moving: true, path_before: 'My Drive', path_after: 'Granted Files/Departments/AI/_test', folders_to_create: [] }
};

// ---------------------------------------------------------------- mocks
let driveActionRows;
const mockQuery = jest.fn(async (sql, params = []) => {
  const t = sql.replace(/\s+/g, ' ').trim();
  if (t.startsWith('SELECT * FROM pending_actions WHERE id = $1')) return { rows: params[0] === ACTION_ROW.id ? [ACTION_ROW] : [] };
  if (t.startsWith('SELECT name, email FROM users WHERE id')) return { rows: [{ name: 'Chris', email: 'writers@granted.ca' }] };
  if (t.startsWith('SELECT id, undo_token, name_after, path_after FROM drive_actions')) {
    return { rows: driveActionRows.filter(r => r.conversation_id === params[0] && r.action === 'move_rename' && r.result === 'done' && !r.undone_at) };
  }
  throw new Error(`unexpected SQL in test: ${t.slice(0, 80)}`);
});
jest.unstable_mockModule('../../src/database/connection.js', () => ({ query: mockQuery, getPool: jest.fn(), transaction: jest.fn() }));

const mockSaveMessage = jest.fn(async () => ({}));
jest.unstable_mockModule('../../src/database/messages.js', () => ({ saveMessage: mockSaveMessage }));

const mockRunPending = jest.fn();
const mockSavePending = jest.fn(async ({ toolName, input, summary }) => ({ id: 'pa-undo-1', tool_name: toolName, tool_input: input, summary }));
jest.unstable_mockModule('../../src/tools/pending-actions.js', () => ({
  ASKER_ONLY_TOOLS: new Set(['file_move_rename', 'file_move_rename_undo']),
  canConfirm: jest.fn(async () => ({ allowed: true })),
  runPendingAction: mockRunPending,
  declinePendingAction: jest.fn(),
  getPendingAction: jest.fn(async () => ({ action: null, expired: false })),
  savePendingAction: mockSavePending,
  summarizeAction: jest.fn((tool, input) => `Undo the earlier change: put "${input.name_before}" back as "${input.name_after}" in ${input.path_after}.`)
}));

jest.unstable_mockModule('../../src/cards/chat-api.js', () => ({ postMessage: jest.fn(async () => ({})), patchCard: jest.fn(async () => ({})) }));
jest.unstable_mockModule('../../src/cards/people.js', () => ({
  resolvePerson: jest.fn(async () => ({ user_id: 1, email: 'writers@granted.ca', display_name: 'Chris' }))
}));

const mockPlanUndo = jest.fn();
jest.unstable_mockModule('../../src/tools/drive-actions.js', () => ({ planUndo: mockPlanUndo }));

const { handlePendingClick, renderConfirmCard, systemEventText } = await import('../../src/cards/confirm-card.js');
const { tryHandleUndoRequest, isUndoRequest } = await import('../../src/api/confirmation.js');

const pressConfirm = () => handlePendingClick({
  parameters: { action: 'pending.confirm', actionId: ACTION_ROW.id },
  actorChatId: 'users/123', actorEmail: 'writers@granted.ca', actorName: 'Chris', spaceId: 'spaces/X'
});

beforeEach(() => {
  driveActionRows = [];
  mockSaveMessage.mockClear();
  mockRunPending.mockReset();
  mockSavePending.mockClear();
  mockPlanUndo.mockReset();
});

// ============================================================================
describe('a press on Confirm is recorded as a system event', () => {
  test('success: role "system", marked, with presser, summary, drive_actions id and undo token — never "assistant"', async () => {
    mockRunPending.mockResolvedValue({
      ok: true, summary: ACTION_ROW.summary, toolName: 'file_move_rename',
      result: { success: true, summary: ACTION_ROW.summary, undo_token: 'a2f59c24-0b3e-4f2c-93a6-2067972ea11c', action_id: '93c8a940-3524-456e-9bbf-4af959600082' }
    });
    await pressConfirm();
    expect(mockSaveMessage).toHaveBeenCalledTimes(1);
    const [conv, role, text] = mockSaveMessage.mock.calls[0];
    expect(conv).toBe(CONV);
    expect(role).toBe('system');
    expect(text).toMatch(/^\[System event — recorded by Granted's systems, not typed by anyone\]/);
    expect(text).toContain('Chris pressed Confirm on the card at');
    expect(text).toContain('It ran: Move "ZZ oracle move test"');
    expect(text).toContain('drive_actions record 93c8a940-3524-456e-9bbf-4af959600082');
    expect(text).toContain('Undo token a2f59c24-0b3e-4f2c-93a6-2067972ea11c');
    expect(mockSaveMessage.mock.calls.some(c => c[1] === 'assistant')).toBe(false);
  });

  test('failure: the system event says it failed and nothing changed', async () => {
    mockRunPending.mockResolvedValue({ ok: true, summary: ACTION_ROW.summary, result: { success: false, error: 'Drive refused the change (403).' } });
    await pressConfirm();
    const [, role, text] = mockSaveMessage.mock.calls[0];
    expect(role).toBe('system');
    expect(text).toMatch(/It failed: Drive refused the change \(403\)\. Nothing changed\.$/);
    expect(text).not.toContain('Undo token');
  });

  test('systemEventText falls back to "The person who asked" and omits a missing record id', () => {
    const t = systemEventText({ summary: 'Rename "a" to "b".', result: { success: true, summary: 'Rename "a" to "b".' } });
    expect(t).toContain('The person who asked pressed Confirm');
    expect(t).not.toContain('drive_actions record');
  });
});

// ============================================================================
describe('"undo that" is caught by code', () => {
  const ROW = { id: '93c8a940', conversation_id: CONV, action: 'move_rename', result: 'done', undone_at: null, undo_token: 'a2f59c24-0b3e-4f2c-93a6-2067972ea11c' };
  const PLAN = { undo_token: ROW.undo_token, undoes_action_id: ROW.id, name_before: 'Test-20261014-Oracle Move', name_after: 'ZZ oracle move test', path_after: 'My Drive', asker_user_id: 1 };

  test('which messages count', () => {
    for (const t of ['Undo that.', 'undo', 'undo it', 'Please undo that!', 'can you undo the move?', 'undo the last move', 'Put it back', 'revert that']) expect(isUndoRequest(t)).toBe(true);
    for (const t of ['undo the deal update and email Bob', 'how do I undo a move?', 'yes', 'undone?', '']) expect(isUndoRequest(t)).toBe(false);
  });

  test('an undoable move in this conversation → planUndo with its token → a file_move_rename_undo proposal; reply says Press Confirm', async () => {
    driveActionRows = [ROW];
    mockPlanUndo.mockResolvedValue({ ok: true, plan: PLAN });
    const r = await tryHandleUndoRequest({ conversationId: CONV, userId: 1, text: 'Undo that.' });
    expect(mockPlanUndo).toHaveBeenCalledWith({ undo_token: ROW.undo_token });
    expect(mockSavePending).toHaveBeenCalledWith(expect.objectContaining({ conversationId: CONV, toolName: 'file_move_rename_undo', input: PLAN, userId: 1 }));
    expect(r.action).toMatchObject({ tool_name: 'file_move_rename_undo' });
    expect(r.replyText).toBe('Here is the undo. Press Confirm to run it.');
  });

  test('no undoable move → a plain reply, no proposal', async () => {
    driveActionRows = [{ ...ROW, undone_at: new Date() }];
    const r = await tryHandleUndoRequest({ conversationId: CONV, userId: 1, text: 'undo that' });
    expect(r).toEqual({ replyText: "I can't find a move in this conversation that can still be undone. Nothing was changed." });
    expect(mockPlanUndo).not.toHaveBeenCalled();
    expect(mockSavePending).not.toHaveBeenCalled();
  });

  test('planUndo refuses (file changed since) → its reason, no proposal', async () => {
    driveActionRows = [ROW];
    mockPlanUndo.mockResolvedValue({ ok: false, reason: 'The file has been moved or renamed since. Undo it by hand.' });
    const r = await tryHandleUndoRequest({ conversationId: CONV, userId: 1, text: 'undo that' });
    expect(r.replyText).toBe('The file has been moved or renamed since. Undo it by hand. Nothing was changed.');
    expect(mockSavePending).not.toHaveBeenCalled();
  });

  test('anything else falls through to the model (null), without touching the database', async () => {
    mockQuery.mockClear();
    expect(await tryHandleUndoRequest({ conversationId: CONV, userId: 1, text: 'undo the deal update and email Bob' })).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ============================================================================
describe('wording: Press Confirm', () => {
  test('the open card says "Press Confirm to run it."', () => {
    const json = JSON.stringify(renderConfirmCard(ACTION_ROW, { askerName: 'Chris' }));
    expect(json).toContain('Press Confirm to run it. Only Chris can confirm.');
  });

  test('the gate tells the model "Press Confirm" for card tools; other gated tools keep reply "yes"', () => {
    const src = fs.readFileSync('src/tools/executor.js', 'utf8');
    expect(src).toMatch(/const CARD_CONFIRM_TOOLS = new Set\(\['file_move_rename', 'file_move_rename_undo'\]\)/);
    const card = src.slice(src.indexOf('CARD_CONFIRM_TOOLS.has(toolName)'), src.indexOf(": 'Saved, not run. This action needs a human"));
    expect(card).toContain('Press Confirm to run it.');
    expect(card).toContain('do not ask them to reply "yes"');
    expect(src).toContain('asked them to reply "yes"');
  });
});

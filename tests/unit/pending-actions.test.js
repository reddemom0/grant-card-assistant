/**
 * Stored-action confirmation gate
 *
 * Covers the guarantees the gate is supposed to provide: a gated call is saved
 * rather than executed, only one proposal is live at a time, a stale one cannot
 * fire, only an exact confirmation word counts, and nothing the model can put in
 * the tool input bypasses any of it.
 *
 * The database is stubbed — no DATABASE_URL, no rows written anywhere.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/pending-actions.test.js
 */

import { jest } from '@jest/globals';

// In-memory stand-in for the pending_actions table. Enough SQL awareness to
// answer the five statements the module actually issues.
const rows = [];
let nextId = 1;

const mockQuery = jest.fn(async (sql, params = []) => {
  const text = sql.replace(/\s+/g, ' ').trim();

  if (text.startsWith("UPDATE pending_actions SET status = 'superseded'")) {
    rows.filter(r => r.conversation_id === params[0] && r.status === 'pending')
      .forEach(r => { r.status = 'superseded'; });
    return { rows: [] };
  }

  if (text.startsWith('INSERT INTO pending_actions')) {
    const isAutoApproval = text.includes("'auto_approved'");
    const row = {
      id: `action-${nextId++}`,
      conversation_id: params[0],
      tool_name: params[1],
      tool_input: JSON.parse(params[2]),
      summary: params[3],
      proposed_by: params[4],
      status: isAutoApproval ? 'auto_approved' : 'pending',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      confirmed_by: isAutoApproval ? params[4] : null,
      confirmed_at: isAutoApproval ? new Date() : null,
      auto_approved_reason: isAutoApproval ? params[5] : null,
      result: null
    };
    rows.push(row);
    return { rows: [row] };
  }

  if (text.startsWith('UPDATE pending_actions SET result = $2 WHERE id = $1')) {
    const row = rows.find(r => r.id === params[0]);
    if (row) row.result = JSON.parse(params[1]);
    return { rows: [] };
  }

  if (text.startsWith('SELECT * FROM pending_actions')) {
    const found = rows
      .filter(r => r.conversation_id === params[0] && r.status === 'pending')
      .sort((a, b) => b.created_at - a.created_at);
    return { rows: found.slice(0, 1) };
  }

  if (text.startsWith("UPDATE pending_actions SET status = 'expired'")) {
    const row = rows.find(r => r.id === params[0]);
    if (row) row.status = 'expired';
    return { rows: [] };
  }

  if (text.startsWith("UPDATE pending_actions SET status = 'confirmed'")) {
    const row = rows.find(r => r.id === params[0] && r.status === 'pending' && r.expires_at > new Date());
    if (!row) return { rows: [] };
    row.status = 'confirmed';
    row.confirmed_by = params[1];
    row.confirmed_at = new Date();
    return { rows: [row] };
  }

  if (text.startsWith('UPDATE pending_actions SET result')) {
    const row = rows.find(r => r.id === params[0]);
    if (row) { row.result = JSON.parse(params[1]); row.status = params[2]; }
    return { rows: [] };
  }

  if (text.startsWith('SELECT 1 FROM pending_actions')) {
    const row = rows.find(r => r.id === params[0] &&
      ['pending', 'confirmed'].includes(r.status) && r.expires_at > new Date());
    return { rows: row ? [{ '?column?': 1 }] : [] };
  }

  throw new Error(`Unexpected SQL in test: ${text.slice(0, 80)}`);
});

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: mockQuery,
  getPool: jest.fn(),
  transaction: jest.fn()
}));

// runPendingAction dispatches through the executor. Stub it: this suite is about
// the gate, and the real executor would reach HubSpot/Calendar/Docs for tools
// whose whole point is that they change live records.
const mockExecute = jest.fn(async (toolName, input, conversationId, userId, agentType, options) => ({
  success: true, toolName, input, options
}));
jest.unstable_mockModule('../../src/tools/executor.js', () => ({
  executeToolCall: mockExecute,
  executeToolCalls: jest.fn()
}));

// The webhook exemption asks hubspot-webhook.js who the system account is.
// Stubbed so the test never needs HUBSPOT_WEBHOOK_USER_EMAIL or a users row.
const WEBHOOK_USER_ID = 42;
const mockResolveWebhookUser = jest.fn(async () => ({
  ok: true, id: WEBHOOK_USER_ID, email: 'oracle-system@granted.ca'
}));
jest.unstable_mockModule('../../src/api/hubspot-webhook.js', () => ({
  resolveWebhookUser: mockResolveWebhookUser,
  handleHubSpotWebhook: jest.fn()
}));

const {
  requiresConfirmation, summarizeAction, savePendingAction,
  getPendingAction, runPendingAction, isAuthorisedExecution,
  isAutoApproved, isWebhookSystemAccount, recordAutoApproval
} = await import('../../src/tools/pending-actions.js');
const { isConfirmWord, tryHandleConfirmation } = await import('../../src/api/confirmation.js');

const CONV = '11111111-1111-1111-1111-111111111111';
const PROPOSER = 1;
const OTHER_USER = 7;

beforeEach(() => {
  rows.length = 0;
  nextId = 1;
  mockQuery.mockClear();
  mockExecute.mockClear();
});

describe('which tools are gated', () => {
  test('HubSpot deal writes and merges are always gated', async () => {
    await expect(requiresConfirmation('create_hubspot_deal', { properties: {} })).resolves.toBe(true);
    await expect(requiresConfirmation('update_hubspot_deal', { deal_id: '1' })).resolves.toBe(true);
    await expect(requiresConfirmation('merge_duplicate_companies', {})).resolves.toBe(true);
    await expect(requiresConfirmation('merge_duplicate_contacts', {})).resolves.toBe(true);
    await expect(requiresConfirmation('replace_google_doc_section', {})).resolves.toBe(true);
  });

  test('a solo calendar event is not gated, one with attendees is', async () => {
    await expect(requiresConfirmation('create_calendar_event', { title: 'Focus' })).resolves.toBe(false);
    await expect(requiresConfirmation('create_calendar_event', { attendees: ['a@b.ca'] })).resolves.toBe(true);
  });

  test('reads are never gated', async () => {
    await expect(requiresConfirmation('search_hubspot_contacts', {})).resolves.toBe(false);
    await expect(requiresConfirmation('read_google_drive_file', {})).resolves.toBe(false);
  });
});

describe('summaries are written from the saved input', () => {
  test('a deal update names the fields that change', () => {
    const text = summarizeAction('update_hubspot_deal', {
      deal_id: '12345',
      properties: { amount: 50000, dealstage: 'Submitted' }
    });
    expect(text).toContain('12345');
    expect(text).toContain('$50,000');
    expect(text).toContain('Submitted');
    expect(text).not.toContain('update_hubspot_deal');   // no tool names for the reader
  });

  test('a merge says it cannot be undone', () => {
    const text = summarizeAction('merge_duplicate_companies', {
      primary_company_id: '111', secondary_company_id: '222'
    });
    expect(text).toContain('222');
    expect(text).toContain('111');
    expect(text).toMatch(/cannot be undone/i);
  });
});

describe('saving a proposal', () => {
  test('saves without executing, and stores the exact input', async () => {
    const input = { deal_id: '12345', properties: { amount: 50000 } };
    const saved = await savePendingAction({
      conversationId: CONV, toolName: 'update_hubspot_deal',
      input, userId: PROPOSER, summary: summarizeAction('update_hubspot_deal', input)
    });

    expect(saved.status).toBe('pending');
    expect(saved.tool_input).toEqual(input);
    // Saved, not run: the row is the only side effect.
    expect(rows).toHaveLength(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('a newer proposal supersedes the older one', async () => {
    await savePendingAction({ conversationId: CONV, toolName: 'update_hubspot_deal', input: { deal_id: '1' }, userId: PROPOSER, summary: 'first' });
    await savePendingAction({ conversationId: CONV, toolName: 'update_hubspot_deal', input: { deal_id: '2' }, userId: PROPOSER, summary: 'second' });

    expect(rows.filter(r => r.status === 'pending')).toHaveLength(1);
    expect(rows.find(r => r.status === 'superseded').summary).toBe('first');

    const { action } = await getPendingAction(CONV);
    expect(action.summary).toBe('second');
  });

  test('an expired proposal is reported as expired, not returned', async () => {
    await savePendingAction({ conversationId: CONV, toolName: 'update_hubspot_deal', input: { deal_id: '1' }, userId: PROPOSER, summary: 'stale' });
    rows[0].expires_at = new Date(Date.now() - 1000);

    const result = await getPendingAction(CONV);
    expect(result.action).toBeNull();
    expect(result.expired).toBe(true);
    expect(rows[0].status).toBe('expired');
  });
});

describe('confirmation words', () => {
  test.each([
    ['yes'], ['Yes.'], ['  CONFIRM  '], ['confirmed'], ['go ahead'],
    ['Go Ahead!'], ['do it'], ['approve'], ['approved'], ['y']
  ])('%s is a confirmation', (text) => {
    expect(isConfirmWord(text)).toBe(true);
  });

  test.each([
    ['yes please'], ['yes, but change the amount'], ['do it tomorrow'],
    ['no'], ['I approve of this plan'], [''], ['maybe yes']
  ])('%s is NOT a confirmation', (text) => {
    expect(isConfirmWord(text)).toBe(false);
  });

  test('non-confirmation text passes through to the agent', async () => {
    await savePendingAction({ conversationId: CONV, toolName: 'update_hubspot_deal', input: { deal_id: '1' }, userId: PROPOSER, summary: 'x' });
    const handled = await tryHandleConfirmation({ conversationId: CONV, userId: PROPOSER, text: 'actually make it 40k' });
    expect(handled).toBeNull();
    expect(rows[0].status).toBe('pending');   // still waiting, not run
  });

  test('a confirmation with nothing pending says so', async () => {
    const handled = await tryHandleConfirmation({ conversationId: CONV, userId: PROPOSER, text: 'yes' });
    expect(handled.replyText).toMatch(/Nothing is waiting/i);
  });

  test('a confirmation after expiry says it expired', async () => {
    await savePendingAction({ conversationId: CONV, toolName: 'update_hubspot_deal', input: { deal_id: '1' }, userId: PROPOSER, summary: 'x' });
    rows[0].expires_at = new Date(Date.now() - 1000);

    const handled = await tryHandleConfirmation({ conversationId: CONV, userId: PROPOSER, text: 'yes' });
    expect(handled.replyText).toMatch(/expired/i);
  });
});

describe('running a confirmed action', () => {
  test('records who confirmed it, even when it is not the proposer', async () => {
    const saved = await savePendingAction({
      conversationId: CONV, toolName: 'update_hubspot_deal',
      input: { deal_id: '12345' }, userId: PROPOSER, summary: 'Update HubSpot deal 12345'
    });

    const run = await runPendingAction({ actionId: saved.id, userId: OTHER_USER });

    expect(run.ok).toBe(true);
    expect(rows[0].confirmed_by).toBe(OTHER_USER);
    expect(rows[0].proposed_by).toBe(PROPOSER);
    expect(rows[0].confirmed_at).toBeInstanceOf(Date);

    // It ran the SAVED call — same tool, same input — carrying the internal
    // authorisation argument the model cannot produce.
    const [toolName, input, , userId, , options] = mockExecute.mock.calls[0];
    expect(toolName).toBe('update_hubspot_deal');
    expect(input).toEqual({ deal_id: '12345' });
    expect(userId).toBe(OTHER_USER);
    expect(options).toEqual({ pendingActionId: saved.id });
  });

  test('the same proposal cannot be run twice', async () => {
    const saved = await savePendingAction({
      conversationId: CONV, toolName: 'update_hubspot_deal',
      input: { deal_id: '1' }, userId: PROPOSER, summary: 'x'
    });
    await runPendingAction({ actionId: saved.id, userId: OTHER_USER });

    const second = await runPendingAction({ actionId: saved.id, userId: OTHER_USER });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('not_pending');
  });

  test('an expired proposal cannot be run', async () => {
    const saved = await savePendingAction({
      conversationId: CONV, toolName: 'update_hubspot_deal',
      input: { deal_id: '1' }, userId: PROPOSER, summary: 'x'
    });
    rows[0].expires_at = new Date(Date.now() - 1000);

    const run = await runPendingAction({ actionId: saved.id, userId: OTHER_USER });
    expect(run.ok).toBe(false);
  });
});

describe('the webhook system account exemption', () => {
  test('deal writes run immediately for the webhook account', async () => {
    await expect(isAutoApproved('create_hubspot_deal', WEBHOOK_USER_ID)).resolves.toBe(true);
    await expect(isAutoApproved('update_hubspot_deal', WEBHOOK_USER_ID)).resolves.toBe(true);
  });

  test('an exempt call is logged as auto_approved with its reason', async () => {
    const input = { deal_id: '12345', properties: { dealstage: 'Submitted' } };
    const row = await recordAutoApproval({
      conversationId: CONV, toolName: 'update_hubspot_deal', input,
      userId: WEBHOOK_USER_ID, summary: summarizeAction('update_hubspot_deal', input)
    });

    expect(row.status).toBe('auto_approved');
    expect(row.auto_approved_reason).toBe('webhook system account');
    expect(row.confirmed_by).toBe(WEBHOOK_USER_ID);
    expect(row.tool_input).toEqual(input);

    // 'auto_approved' is not 'pending', so a later "yes" cannot re-run it.
    const { action } = await getPendingAction(CONV);
    expect(action).toBeNull();
  });

  test('merges are NOT exempt, even for the webhook account', async () => {
    await expect(isAutoApproved('merge_duplicate_companies', WEBHOOK_USER_ID)).resolves.toBe(false);
    await expect(isAutoApproved('merge_duplicate_contacts', WEBHOOK_USER_ID)).resolves.toBe(false);
    // Still gated: it needs a human.
    await expect(requiresConfirmation('merge_duplicate_companies', { primary_company_id: '1' })).resolves.toBe(true);
  });

  test('calendar and doc writes are NOT exempt for the webhook account', async () => {
    await expect(isAutoApproved('replace_google_doc_section', WEBHOOK_USER_ID)).resolves.toBe(false);
    await expect(isAutoApproved('create_calendar_event', WEBHOOK_USER_ID)).resolves.toBe(false);
  });

  test('a normal user gets no exemption for the same deal write', async () => {
    await expect(isAutoApproved('update_hubspot_deal', PROPOSER)).resolves.toBe(false);
    await expect(isAutoApproved('update_hubspot_deal', OTHER_USER)).resolves.toBe(false);
    await expect(requiresConfirmation('update_hubspot_deal', { deal_id: '1' })).resolves.toBe(true);
  });

  test('identity comes from the server, not from anything the model writes', async () => {
    // Every shape a model could put in tool input claiming to be the webhook.
    for (const spoof of [
      { deal_id: '1', userId: WEBHOOK_USER_ID },
      { deal_id: '1', user_id: WEBHOOK_USER_ID },
      { deal_id: '1', system: true, webhook: true },
      { deal_id: '1', confirmed: true, proposed_by: WEBHOOK_USER_ID }
    ]) {
      // isAutoApproved never reads the input — only the userId argument.
      await expect(isAutoApproved('update_hubspot_deal', PROPOSER)).resolves.toBe(false);
      await expect(requiresConfirmation('update_hubspot_deal', spoof)).resolves.toBe(true);
    }
  });

  test('a misconfigured or unresolvable system account grants no exemption', async () => {
    mockResolveWebhookUser.mockResolvedValueOnce({ ok: false, reason: 'HUBSPOT_WEBHOOK_USER_EMAIL is not set' });
    await expect(isAutoApproved('update_hubspot_deal', WEBHOOK_USER_ID)).resolves.toBe(false);

    mockResolveWebhookUser.mockRejectedValueOnce(new Error('database unreachable'));
    await expect(isWebhookSystemAccount(WEBHOOK_USER_ID)).resolves.toBe(false);

    await expect(isWebhookSystemAccount(null)).resolves.toBe(false);
  });
});

describe('the bypass is gone', () => {
  test('an unknown action id is not authorised to execute', async () => {
    await expect(isAuthorisedExecution('action-does-not-exist')).resolves.toBe(false);
    await expect(isAuthorisedExecution(null)).resolves.toBe(false);
  });

  test('confirmed: true in the tool input does not make a call authorised', async () => {
    // The old gate accepted this exact shape. Nothing reads it now: authorisation
    // is a function argument checked against a live row, which no tool input can
    // reach.
    await expect(requiresConfirmation('update_hubspot_deal', { deal_id: '1', confirmed: true })).resolves.toBe(true);
    await expect(requiresConfirmation('create_calendar_event', { attendees: ['a@b.ca'], confirmed: true })).resolves.toBe(true);
    await expect(isAuthorisedExecution(true)).resolves.toBe(false);
  });
});

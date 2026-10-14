/**
 * getConversationMessages: a 'system' row (an outside event recorded by code,
 * e.g. a press on a confirm card) reaches the model as a user-role text block
 * carrying the "[System event …]" mark; other rows are unchanged.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/messages-system-event.test.js
 */

import { jest } from '@jest/globals';

const NOTE = "[System event — recorded by Granted's systems, not typed by anyone] Chris pressed Confirm on the card at 2026-10-14 00:27 Vancouver time. It ran: Move \"ZZ oracle move test\" …. Undo token a2f59c24-0b3e-4f2c-93a6-2067972ea11c.";
let rows;
const mockQuery = jest.fn(async () => ({ rows }));
jest.unstable_mockModule('../../src/database/connection.js', () => ({ query: mockQuery, getPool: jest.fn(), transaction: jest.fn() }));

const { getConversationMessages } = await import('../../src/database/messages.js');

test('a system row becomes a marked user text block; the typed "Undo that." after it is unchanged', async () => {
  rows = [
    { role: 'user', content: JSON.stringify([{ type: 'text', text: 'Move ZZ oracle move test to Departments/AI/_test' }]), created_at: new Date('2026-10-14T07:13:40Z') },
    { role: 'assistant', content: JSON.stringify([{ type: 'text', text: "It's waiting for your confirmation. Press Confirm to run it." }]), created_at: new Date('2026-10-14T07:13:41Z') },
    { role: 'system', content: NOTE, created_at: new Date('2026-10-14T07:27:57Z') },
    { role: 'user', content: JSON.stringify([{ type: 'text', text: 'Undo that.' }]), created_at: new Date('2026-10-14T07:28:28Z') }
  ];
  const msgs = await getConversationMessages('conv-1');
  expect(msgs).toHaveLength(4);
  expect(msgs[2]).toEqual({ role: 'user', content: [{ type: 'text', text: NOTE }] });
  expect(msgs[2].content[0].text).toMatch(/^\[System event/);
  expect(msgs[3]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Undo that.' }] });
  expect(msgs.some(m => m.role === 'system')).toBe(false);
});

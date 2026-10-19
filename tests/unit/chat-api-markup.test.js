/**
 * postMessageWithThread's markup: Markdown by default (every existing caller),
 * Chat's own formatting only when a caller opts out (the pre-call briefing DM,
 * whose line breaks Markdown would collapse into one paragraph).
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/chat-api-markup.test.js
 */

import { jest } from '@jest/globals';

const create = jest.fn(async () => ({ data: { name: 'spaces/S/messages/M', thread: { name: 'spaces/S/threads/T' } } }));
jest.unstable_mockModule('googleapis', () => ({
  google: { auth: { GoogleAuth: class {} }, chat: () => ({ spaces: { messages: { create } } }) }
}));
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';

const { postMessageWithThread } = await import('../../src/cards/chat-api.js');

test('default stays Markdown — no other Oracle message changes', async () => {
  await postMessageWithThread({ spaceName: 'spaces/S', text: 'a\nb' });
  expect(create.mock.calls.at(-1)[0].requestBody).toEqual({ text: 'a\nb', markupSyntax: 'MARKUP_SYNTAX_MARKDOWN' });
});

test('markdown: false sends the text as-is, line breaks and all, and returns the new thread', async () => {
  const r = await postMessageWithThread({ spaceName: 'spaces/S', text: '*T*\n\n• a\n• b', markdown: false });
  expect(create.mock.calls.at(-1)[0].requestBody).toEqual({ text: '*T*\n\n• a\n• b' });
  expect(create.mock.calls.at(-1)[0]).not.toHaveProperty('messageReplyOption');
  expect(r).toEqual({ messageName: 'spaces/S/messages/M', threadName: 'spaces/S/threads/T' });
});

/**
 * Thinking blocks in the tool loop
 *
 * Within one tool-use turn the assistant's thinking and redacted_thinking blocks
 * go back to the API exactly as received. Stripping them silently turns thinking
 * off for the follow-up call and breaks the prompt cache; rebuilding them wrong
 * (a redacted_thinking block without its data) is the "cannot be modified" 400.
 * No network: the stream is a stand-in built from API event shapes.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/thinking-tool-loop.test.js
 */

import { assistantTurnForToolLoop } from '../../src/claude/client.js';
import { streamToSSE } from '../../src/claude/streaming.js';
import { getQueryConfigForModel } from '../../src/claude/query-classifier.js';

async function* events(list) {
  for (const e of list) yield e;
}

const toolUseEvents = (index, id) => [
  { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name: 'grant_data', input: {} } },
  { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: '{"mode":"search","query":"CanExport"}' } },
  { type: 'content_block_stop', index }
];

describe('assistantTurnForToolLoop', () => {
  test('passes a thinking block back unchanged and in place', () => {
    const thinking = { type: 'thinking', thinking: 'Look up the program first.', signature: 'EqQBCgIYAhIM1gbc' };
    const content = [
      { ...thinking, index: 0 },
      { type: 'text', text: '', index: 1 },
      { type: 'tool_use', id: 'toolu_1', name: 'grant_data', input: { mode: 'search' }, index: 2 }
    ];

    const out = assistantTurnForToolLoop(content);

    expect(out).toEqual([
      thinking,
      { type: 'tool_use', id: 'toolu_1', name: 'grant_data', input: { mode: 'search' } }
    ]);
  });

  test('keeps the order of thinking, redacted_thinking, text and tool_use', () => {
    const content = [
      { type: 'thinking', thinking: 'a', signature: 's1', index: 0 },
      { type: 'redacted_thinking', data: 'EmwKAhgBEgy3', index: 1 },
      { type: 'text', text: 'Checking GG3.', index: 2 },
      { type: 'tool_use', id: 'toolu_2', name: 'grant_data', input: {}, index: 3 }
    ];

    expect(assistantTurnForToolLoop(content).map(b => b.type))
      .toEqual(['thinking', 'redacted_thinking', 'text', 'tool_use']);
  });

  test('does not mutate the response it was given', () => {
    const content = [{ type: 'thinking', thinking: 'a', signature: 's1', index: 0 }];
    assistantTurnForToolLoop(content);
    expect(content[0].index).toBe(0);
  });
});

describe('redacted_thinking through streamToSSE', () => {
  test('keeps the data field and passes the block back unchanged', async () => {
    const data = 'EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cr3qpP';
    const response = await streamToSSE(events([
      { type: 'message_start', message: { usage: {} } },
      { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data } },
      { type: 'content_block_stop', index: 0 },
      ...toolUseEvents(1, 'toolu_3'),
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' }
    ]), null, null, 'internal-oracle', null);

    const out = assistantTurnForToolLoop(response.content);

    expect(out[0]).toEqual({ type: 'redacted_thinking', data });
    expect(out[1]).toMatchObject({ type: 'tool_use', id: 'toolu_3', input: { mode: 'search', query: 'CanExport' } });
  });

  test('keeps thinking text and signature from the deltas', async () => {
    const response = await streamToSSE(events([
      { type: 'message_start', message: { usage: {} } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Search, ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'then confirm.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'EqQBCgIY' } },
      { type: 'content_block_stop', index: 0 },
      ...toolUseEvents(1, 'toolu_4'),
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
      { type: 'message_stop' }
    ]), null, null, 'internal-oracle', null);

    expect(assistantTurnForToolLoop(response.content)[0])
      .toEqual({ type: 'thinking', thinking: 'Search, then confirm.', signature: 'EqQBCgIY' });
  });
});

describe('thinking off (Haiku no-thinking tier)', () => {
  test('sends no thinking config and passes text and tool_use back as before', () => {
    expect(getQueryConfigForModel('claude-haiku-4-5').thinking).toBeUndefined();

    const content = [
      { type: 'text', text: 'Looking that up.', index: 0 },
      { type: 'tool_use', id: 'toolu_5', name: 'grant_data', input: {}, index: 1 }
    ];

    expect(assistantTurnForToolLoop(content)).toEqual([
      { type: 'text', text: 'Looking that up.' },
      { type: 'tool_use', id: 'toolu_5', name: 'grant_data', input: {} }
    ]);
  });
});

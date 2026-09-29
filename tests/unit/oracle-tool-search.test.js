/**
 * Oracle tools on demand
 *
 * On Oracle's Sonnet 5.5 requests, rarely used tools are sent with defer_loading
 * and Anthropic's tool search is added; every other path gets its tool list
 * unchanged. Search results survive streaming so the tool loop can pass them back,
 * and are dropped from reloaded history (their server_tool_use is dropped there).
 * No network: the stream is a stand-in built from API event shapes.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/oracle-tool-search.test.js
 */

import {
  toolsForRun,
  withToolSearch,
  historyForRequest,
  assistantTurnForToolLoop,
  ORACLE_DEFERRED_TOOLS,
  TOOL_SEARCH_TOOL
} from '../../src/claude/client.js';
import { streamToSSE } from '../../src/claude/streaming.js';

const SONNET = 'claude-sonnet-5-5';
const oracleTools = () => toolsForRun('internal-oracle');
const oracleSonnet = (tools = oracleTools()) =>
  withToolSearch(tools, { agentType: 'internal-oracle', model: SONNET, allowedTools: null });

async function* events(list) {
  for (const e of list) yield e;
}

describe('withToolSearch on Oracle + Sonnet 5.5', () => {
  test('every deferred name is a tool in Oracle\'s loadout', () => {
    const names = oracleTools().map(t => t.name);
    for (const name of ORACLE_DEFERRED_TOOLS) expect(names).toContain(name);
  });

  test('defers exactly the listed tools and keeps the rest loaded', () => {
    const out = oracleSonnet();
    const deferred = out.filter(t => t.defer_loading).map(t => t.name).sort();
    expect(deferred).toEqual([...ORACLE_DEFERRED_TOOLS].sort());
    for (const name of ['load_skill', 'grant_data', 'track_review', 'read_chat_attachments']) {
      expect(out.find(t => t.name === name).defer_loading).toBeUndefined();
    }
  });

  test('adds the search tool once, last, never deferred; keeps tool order', () => {
    const before = oracleTools();
    const out = oracleSonnet(before);
    expect(out).toHaveLength(before.length + 1);
    expect(out[out.length - 1]).toEqual(TOOL_SEARCH_TOOL);
    expect(out.filter(t => t.name === TOOL_SEARCH_TOOL.name)).toHaveLength(1);
    expect(out.slice(0, -1).map(t => t.name)).toEqual(before.map(t => t.name));
  });

  test('does not mutate the tool definitions it was given', () => {
    const before = oracleTools();
    oracleSonnet(before);
    expect(before.some(t => t.defer_loading)).toBe(false);
  });
});

describe('withToolSearch leaves other paths unchanged', () => {
  test.each([
    ['Oracle on Haiku (simple/moderate tiers, webhook)', { agentType: 'internal-oracle', model: 'claude-haiku-4-5', allowedTools: null }],
    ['Oracle run restricted by allowedTools (/learn-this)', { agentType: 'internal-oracle', model: SONNET, allowedTools: ['load_skill'] }],
    ['another agent on Sonnet 5.5', { agentType: 'etg-writer', model: SONNET, allowedTools: null }]
  ])('%s', (_label, run) => {
    const tools = oracleTools();
    expect(withToolSearch(tools, run)).toBe(tools);
  });
});

describe('tool search results', () => {
  test('streamToSSE keeps a tool_search_tool_result whole for the tool loop', async () => {
    const content = {
      type: 'tool_search_tool_search_result',
      tool_references: [{ type: 'tool_reference', tool_name: 'list_calendar_events' }]
    };
    const response = await streamToSSE(events([
      { type: 'message_start', message: { usage: {} } },
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_bm25' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"calendar events"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_1', content } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'list_calendar_events', input: {} } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' }
    ]), null, null, 'internal-oracle', null);

    const out = assistantTurnForToolLoop(response.content);
    expect(out[0]).toEqual({ type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_bm25', input: { query: 'calendar events' } });
    expect(out[1]).toEqual({ type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_1', content });
    expect(out[2]).toMatchObject({ type: 'tool_use', name: 'list_calendar_events' });
  });

  test('historyForRequest drops search results and thinking, keeps the rest', () => {
    const history = [
      { role: 'user', content: 'What is on my calendar?' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'a', signature: 's' },
          { type: 'redacted_thinking', data: 'd' },
          { type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_1', content: {} },
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_1', name: 'list_calendar_events', input: {} }
        ]
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[]' }] }
    ];

    const out = historyForRequest(history);
    expect(out[0]).toBe(history[0]);
    expect(out[1].content.map(b => b.type)).toEqual(['text', 'tool_use']);
    expect(out[2]).toBe(history[2]);
  });
});

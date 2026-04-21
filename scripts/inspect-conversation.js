#!/usr/bin/env node
/**
 * Conversation Inspector CLI
 *
 * Diagnostic tool that wraps getConversationToolTrace() for post-hoc debugging
 * of agent behavior. Handles both storage paths (messages table + lead-gen sidecar).
 *
 * Usage:
 *   node scripts/inspect-conversation.js [flags]
 *
 * See --help for full flag list.
 */

import 'dotenv/config';
import { query, getPool } from '../src/database/connection.js';
import { getConversation, getConversationToolTrace } from '../src/database/messages.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_FORMATS = new Set(['summary', 'trace', 'json']);
const DIVIDER = '\n' + '─'.repeat(80) + '\n';

const USAGE = `Usage: node scripts/inspect-conversation.js [flags]

One of --conversation or --agent is required.

  --conversation <uuid>     Direct lookup by conversation UUID
  --agent <type>            Filter by agent_type (e.g., internal-oracle)
  --after <iso-timestamp>   created_at >= this
  --before <iso-timestamp>  created_at <= this
  --user <id-or-email>      Integer id or email (auto-detected)
  --limit <n>               Max conversations to inspect (default: 1)
  --format <fmt>            summary | trace | json (default: summary)
  --help                    Show this message

Examples:
  node scripts/inspect-conversation.js --conversation 2e180323-6c5e-4caa-9f2b-7a845a5da325
  node scripts/inspect-conversation.js --agent internal-oracle --after 2026-04-20T14:00:00Z
  node scripts/inspect-conversation.js --user natalie@granted.ca --agent internal-oracle --limit 3
`;

function usageError(msg) {
  console.error(`Error: ${msg}\n`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { limit: 1, format: 'summary' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    switch (flag) {
      case '--help':
      case '-h':
        console.log(USAGE);
        process.exit(0);
      case '--conversation': args.conversation = val; i++; break;
      case '--agent':        args.agent = val; i++; break;
      case '--after':        args.after = val; i++; break;
      case '--before':       args.before = val; i++; break;
      case '--user':         args.user = val; i++; break;
      case '--limit':        args.limit = parseInt(val, 10); i++; break;
      case '--format':       args.format = val; i++; break;
      default:
        usageError(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

function validate(args) {
  if (!args.conversation && !args.agent) {
    usageError('One of --conversation or --agent is required.');
  }
  if (args.conversation && !UUID_RE.test(args.conversation)) {
    usageError(`--conversation must be a valid UUID. Got: ${args.conversation}`);
  }
  if (!VALID_FORMATS.has(args.format)) {
    usageError(`--format must be one of: ${[...VALID_FORMATS].join(', ')}. Got: ${args.format}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) {
    usageError(`--limit must be a positive integer. Got: ${args.limit}`);
  }
}

async function findConversationIds(args) {
  if (args.conversation) {
    const r = await query(`SELECT id FROM conversations WHERE id = $1`, [args.conversation]);
    return r.rows.map(row => row.id);
  }

  const where = [];
  const params = [];
  if (args.agent)  { params.push(args.agent);  where.push(`c.agent_type = $${params.length}`); }
  if (args.after)  { params.push(args.after);  where.push(`c.created_at >= $${params.length}`); }
  if (args.before) { params.push(args.before); where.push(`c.created_at <= $${params.length}`); }
  if (args.user) {
    if (/^\d+$/.test(args.user)) {
      params.push(parseInt(args.user, 10));
      where.push(`c.user_id = $${params.length}`);
    } else {
      params.push(args.user);
      where.push(`c.user_id IN (SELECT id FROM users WHERE email ILIKE $${params.length})`);
    }
  }
  params.push(args.limit);

  const sql = `SELECT c.id FROM conversations c
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY c.created_at DESC
               LIMIT $${params.length}`;

  const r = await query(sql, params);
  return r.rows.map(row => row.id);
}

async function getUserInfo(userId) {
  if (!userId) return null;
  const r = await query(`SELECT id, email, name FROM users WHERE id = $1`, [userId]);
  return r.rows[0] || null;
}

async function getLeadGenSidecar(sessionId) {
  const r = await query(
    `SELECT prospect_data, contact_email, contact_name, cta_selected, status
     FROM lead_gen_conversations WHERE session_id = $1`,
    [sessionId]
  );
  return r.rows[0] || null;
}

function truncate(str, n) {
  if (typeof str !== 'string') str = String(str);
  return str.length <= n ? str : str.slice(0, n) + '…';
}

function truncateWithNote(str, n) {
  if (typeof str !== 'string') str = String(str);
  if (str.length <= n) return str;
  return str.slice(0, n) + ` ... [truncated, ${str.length} chars total]`;
}

function fmtTime(ts) {
  if (!ts) return '--:--:--';
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString().slice(11, 19);
}

function firstInputPair(input) {
  if (!input || typeof input !== 'object') return '';
  const keys = Object.keys(input);
  if (!keys.length) return '';
  const k = keys[0];
  const v = input[k];
  const vStr = typeof v === 'string' ? `"${truncate(v, 40)}"` : truncate(JSON.stringify(v), 40);
  return `${k}=${vStr}`;
}

function renderSummary(meta, trace, user, sidecar) {
  const lines = [];
  lines.push(`Conversation ${meta.id}`);
  lines.push(`  agent:    ${meta.agent_type}`);
  if (user) {
    lines.push(`  user:     ${user.email} (id=${user.id}${user.name ? `, ${user.name}` : ''})`);
  } else if (meta.user_id) {
    lines.push(`  user:     id=${meta.user_id}`);
  } else {
    lines.push(`  user:     (anonymous)`);
  }
  lines.push(`  started:  ${meta.created_at?.toISOString?.() || meta.created_at}`);
  const last = meta.last_message_at?.toISOString?.() || meta.last_message_at || '(none)';
  lines.push(`  messages: ${meta.message_count} (last: ${last})`);
  if (meta.title) lines.push(`  title:    ${meta.title}`);
  if (sidecar) {
    const contact = sidecar.contact_email
      ? `${sidecar.contact_email}${sidecar.contact_name ? ` (${sidecar.contact_name})` : ''}`
      : '(none)';
    lines.push(`  contact:  ${contact} | cta: ${sidecar.cta_selected || '(none)'} | status: ${sidecar.status}`);
    if (sidecar.prospect_data && Object.keys(sidecar.prospect_data).length) {
      lines.push(`  prospect: ${truncate(JSON.stringify(sidecar.prospect_data), 200)}`);
    }
  }
  lines.push('');

  let toolUseCount = 0;
  let errorCount = 0;
  for (const entry of trace) {
    const t = fmtTime(entry.timestamp);
    let line;
    switch (entry.type) {
      case 'text':
        line = `text: "${truncate(entry.content || '', 80)}"`;
        break;
      case 'tool_use':
      case 'server_tool_use': {
        toolUseCount++;
        const pair = firstInputPair(entry.input);
        line = `tool_use: ${entry.tool_name}(${pair})`;
        break;
      }
      case 'tool_result':
      case 'web_search_tool_result': {
        if (entry.is_error) errorCount++;
        const idShort = (entry.tool_use_id || '').slice(0, 8);
        const status = entry.is_error ? 'error' : 'ok';
        const contentStr = typeof entry.content === 'string'
          ? entry.content
          : JSON.stringify(entry.content);
        const idDisplay = entry.tool_use_id ? `${idShort}..` : '—';
        line = `tool_result: ${idDisplay} [${status}] "${truncate(contentStr, 60)}"`;
        break;
      }
      case 'thinking': {
        const len = (entry.content || '').length;
        line = `thinking (${len} chars)`;
        break;
      }
      default:
        line = `${entry.type}: ${truncate(JSON.stringify(entry.content), 60)}`;
    }
    lines.push(`  ${t}  ${entry.type.padEnd(11)} ${line}`);
  }

  lines.push('');
  lines.push(`  Totals: ${toolUseCount} tool calls, ${errorCount} errors`);
  return lines.join('\n');
}

function renderTrace(meta, trace, user, sidecar) {
  const lines = [];
  lines.push(`Conversation ${meta.id} (${meta.agent_type})`);
  if (user) lines.push(`User: ${user.email} (id=${user.id})`);
  if (sidecar) lines.push(`Lead-gen sidecar: contact=${sidecar.contact_email || '(none)'}, cta=${sidecar.cta_selected || '(none)'}`);
  lines.push('');

  for (const entry of trace) {
    lines.push(`[${fmtTime(entry.timestamp)}] ${entry.type}`);
    switch (entry.type) {
      case 'text':
        lines.push(`  content: ${truncateWithNote(entry.content || '', 500)}`);
        break;
      case 'tool_use':
        lines.push(`  tool_name:   ${entry.tool_name}`);
        if (entry.tool_use_id) lines.push(`  tool_use_id: ${entry.tool_use_id}`);
        lines.push(`  input: ${truncateWithNote(JSON.stringify(entry.input, null, 2), 500)}`);
        break;
      case 'tool_result': {
        if (entry.tool_use_id) lines.push(`  tool_use_id: ${entry.tool_use_id}`);
        lines.push(`  is_error:    ${entry.is_error}`);
        const contentStr = typeof entry.content === 'string'
          ? entry.content
          : JSON.stringify(entry.content, null, 2);
        lines.push(`  content: ${truncateWithNote(contentStr, 500)}`);
        break;
      }
      case 'thinking':
        lines.push(`  content: ${truncateWithNote(entry.content || '', 500)}`);
        break;
      default:
        lines.push(`  ${truncateWithNote(JSON.stringify(entry.content, null, 2), 500)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderJson(meta, trace, user, sidecar) {
  const payload = { conversation: { ...meta, user }, trace };
  if (sidecar) payload.sidecar = sidecar;
  return JSON.stringify(payload, null, 2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validate(args);

  const ids = await findConversationIds(args);
  if (!ids.length) {
    console.error('No conversations found matching filters.');
    process.exit(1);
  }

  const outputs = [];
  for (const id of ids) {
    const meta = await getConversation(id);
    if (!meta) continue;
    const trace = await getConversationToolTrace(id);
    const user = await getUserInfo(meta.user_id);
    const sidecar = meta.agent_type === 'lead-gen'
      ? await getLeadGenSidecar(meta.id)
      : null;

    let out;
    if (args.format === 'summary')    out = renderSummary(meta, trace, user, sidecar);
    else if (args.format === 'trace') out = renderTrace(meta, trace, user, sidecar);
    else                              out = renderJson(meta, trace, user, sidecar);
    outputs.push(out);
  }

  console.log(outputs.join(DIVIDER));
}

main()
  .catch(err => {
    console.error('Error:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await getPool().end(); } catch {}
  });

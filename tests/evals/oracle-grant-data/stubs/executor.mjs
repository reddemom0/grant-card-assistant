/**
 * Eval stand-in for src/tools/executor.js — deny by default.
 *
 * Tools on the read list run for real; anything else (HubSpot writes, memory
 * writes, Sheets / Docs / Calendar writes, lessons, tracked cards, and any tool
 * added later) returns a refusal without running. Every call and result is
 * recorded on globalThis.__oracleEval for scoring.
 */

import * as real from '../../../../src/tools/executor.js?real';

export * from '../../../../src/tools/executor.js?real';

export const READ_TOOLS = new Set([
  'memory_recall', 'memory_list', 'load_skill',
  'search_oracle_kb', 'get_visualping_alerts', 'check_blog_coverage', 'check_marketing_calendar',
  'get_recent_granted_ca_post', 'search_recent_wins', 'grant_data',
  'search_federal_grants_aggregate', 'search_federal_grants_records',
  'search_google_drive', 'read_google_drive_file', 'list_files_in_folder', 'read_dropbox_file',
  'search_hubspot_contacts', 'get_hubspot_contact', 'get_hubspot_company', 'search_hubspot_companies',
  'search_grant_applications', 'get_grant_application', 'list_hubspot_owners', 'get_program_stats', 'get_deal_count',
  'granola_query_meetings', 'granola_list_meetings', 'granola_get_meetings', 'granola_get_meeting_transcript',
  'granola_list_meeting_folders',
  'read_sheet_range', 'read_sheet_metadata', 'list_calendar_events', 'check_calendar_availability',
  'read_google_doc_outline', 'read_chat_space_history', 'build_mention_digest', 'read_chat_attachments'
]);

export const BLOCKED_RESULT = { success: false, error: 'blocked in eval: side-effect tool' };

const log = () => (globalThis.__oracleEval ??= { calls: [], blocked: [], messages: [] });

export async function executeToolCall(toolName, input, conversationId, userId = null, agentType = null, options = {}) {
  const entry = { conversationId, tool: toolName, input, at: new Date().toISOString() };
  if (!READ_TOOLS.has(toolName)) {
    log().blocked.push(entry);
    log().calls.push({ ...entry, blocked: true, result: BLOCKED_RESULT });
    return BLOCKED_RESULT;
  }
  let result;
  try {
    result = await real.executeToolCall(toolName, input, conversationId, userId, agentType, options);
  } catch (err) {
    result = { success: false, error: err?.message ?? String(err) };
  }
  log().calls.push({ ...entry, result });
  return result;
}

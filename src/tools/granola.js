/**
 * Granola tools — wrap the Granola MCP server's five tools.
 *
 * Each tool here:
 *   1. Pre-checks user_oauth_tokens for (userId, 'granola'). Absent → friendly error.
 *   2. Builds a GranolaOAuthClientProvider for the user.
 *   3. Connects via createRemoteMCPClient with authProvider mode (SDK runs DCR/PKCE/refresh).
 *   4. Calls the underlying Granola MCP tool by name.
 *   5. Closes the client.
 *
 * 401 (refresh failed) → reconnect message. Connection failure → unreachable message.
 * Other errors propagate to the executor's standard catch block.
 */

import { getUserOAuthTokens } from '../database/user-oauth-tokens.js';
import { GranolaOAuthClientProvider } from '../api/granola-oauth-provider.js';
import {
  createRemoteMCPClient,
  callTool,
  close,
  MCPAuthError,
  MCPConnectionError
} from '../mcp/remote-client.js';

const SERVER_URL = 'https://mcp.granola.ai/mcp';
const PROVIDER = 'granola';

const NOT_CONNECTED = {
  success: false,
  error: 'Granola not connected. Connect at /api/auth/granola'
};
const RECONNECT_NEEDED = {
  success: false,
  error: 'Granola connection expired. Reconnect at /api/auth/granola'
};
const UNREACHABLE = {
  success: false,
  error: 'Could not reach Granola. Try again in a moment.'
};

async function callGranolaTool(userId, granolaToolName, args) {
  if (!userId) {
    return { success: false, error: 'No user context for Granola tool call' };
  }

  // Pre-check: avoid the SDK auth dance entirely when there's nothing stored.
  const stored = await getUserOAuthTokens(userId, PROVIDER);
  if (!stored) return NOT_CONNECTED;

  const provider = new GranolaOAuthClientProvider(userId);
  let handle;
  try {
    handle = await createRemoteMCPClient({ serverUrl: SERVER_URL, authProvider: provider });
    const result = await callTool(handle, granolaToolName, args ?? {});
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof MCPAuthError) return RECONNECT_NEEDED;
    if (err instanceof MCPConnectionError) return UNREACHABLE;
    throw err;
  } finally {
    if (handle) {
      try { await close(handle); } catch { /* ignore close errors */ }
    }
  }
}

export async function granolaQueryMeetings(input, ctx = {}) {
  return callGranolaTool(ctx.userId, 'query_granola_meetings', { query: input.query });
}

export async function granolaListMeetings(input, ctx = {}) {
  const args = {};
  if (input.folder_id) args.folder_id = input.folder_id;
  if (input.start_date) args.start_date = input.start_date;
  if (input.end_date) args.end_date = input.end_date;
  if (input.limit != null) args.limit = input.limit;
  return callGranolaTool(ctx.userId, 'list_meetings', args);
}

export async function granolaGetMeetings(input, ctx = {}) {
  return callGranolaTool(ctx.userId, 'get_meetings', { meeting_ids: input.meeting_ids });
}

export async function granolaGetMeetingTranscript(input, ctx = {}) {
  return callGranolaTool(ctx.userId, 'get_meeting_transcript', { meeting_id: input.meeting_id });
}

export async function granolaListMeetingFolders(_input, ctx = {}) {
  return callGranolaTool(ctx.userId, 'list_meeting_folders', {});
}

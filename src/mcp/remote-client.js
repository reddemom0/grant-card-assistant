/**
 * Remote MCP Client — generic streamable-HTTP wrapper
 *
 * Wraps @modelcontextprotocol/sdk's StreamableHTTPClientTransport with a small
 * surface (createRemoteMCPClient / listTools / callTool / close) plus tagged
 * error classes so calling layers can pattern-match on connection vs auth vs
 * tool failures.
 *
 * This module is server-agnostic. It does not know about Granola, specific
 * OAuth flows, or per-user token storage. Two auth modes are supported:
 *
 *   1. bearerToken — caller hands over a static OAuth access token. We send
 *      `Authorization: Bearer <token>` on every request. Caller is responsible
 *      for refreshing the token when it expires.
 *
 *   2. authProvider — caller hands over an SDK OAuthClientProvider instance
 *      (see @modelcontextprotocol/sdk/client/auth.js). The SDK runs the full
 *      OAuth ceremony internally (Dynamic Client Registration, PKCE, token
 *      refresh) by calling the provider's storage hooks. The caller decides
 *      where tokens / client info / PKCE verifiers / state live.
 *
 * Exactly one of the two modes must be provided.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

const DEFAULT_CLIENT_INFO = {
  name: 'granted-hub',
  version: '1.0.4'
};

class MCPClientError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class MCPConnectionError extends MCPClientError {
  constructor(message, cause) { super(message, 'MCP_CONNECTION', cause); }
}

export class MCPAuthError extends MCPClientError {
  constructor(message, cause) { super(message, 'MCP_AUTH', cause); }
}

export class MCPToolNotFoundError extends MCPClientError {
  constructor(message, cause) { super(message, 'MCP_TOOL_NOT_FOUND', cause); }
}

export class MCPToolCallError extends MCPClientError {
  constructor(message, result, cause) {
    super(message, 'MCP_TOOL_CALL', cause);
    this.result = result;
  }
}

export class MCPProtocolError extends MCPClientError {
  constructor(message, cause) { super(message, 'MCP_PROTOCOL', cause); }
}

function isAuthError(err) {
  if (err instanceof UnauthorizedError) return true;
  if (err instanceof StreamableHTTPError && err.code === 401) return true;
  const status = err?.status ?? err?.cause?.status;
  if (status === 401) return true;
  const msg = String(err?.message ?? '');
  return /\b401\b|unauthorized/i.test(msg);
}

function isToolNotFound(err) {
  const code = err?.code ?? err?.cause?.code;
  if (code === -32601 || code === -32602) return true;
  const msg = String(err?.message ?? '');
  return /tool .*not found|unknown tool/i.test(msg);
}

function classifyConnectError(err) {
  if (isAuthError(err)) {
    return new MCPAuthError(`MCP server rejected credentials: ${err.message}`, err);
  }
  return new MCPConnectionError(`Failed to connect to MCP server: ${err.message}`, err);
}

function classifyRequestError(err) {
  if (isAuthError(err)) {
    return new MCPAuthError(`MCP server rejected credentials: ${err.message}`, err);
  }
  if (isToolNotFound(err)) {
    return new MCPToolNotFoundError(`MCP tool not found: ${err.message}`, err);
  }
  return new MCPProtocolError(`MCP request failed: ${err.message}`, err);
}

/**
 * Connect to a remote MCP server over streamable HTTP.
 *
 * Provide exactly one of `bearerToken` (static access token) or `authProvider`
 * (SDK OAuthClientProvider — SDK drives DCR + PKCE + refresh internally).
 *
 * @param {Object} opts
 * @param {string} opts.serverUrl - Full MCP endpoint URL (e.g. https://mcp.granola.ai/mcp)
 * @param {string} [opts.bearerToken] - Static OAuth access token; sent as `Authorization: Bearer <token>`.
 * @param {object} [opts.authProvider] - SDK OAuthClientProvider implementation; SDK calls its storage hooks to drive the OAuth flow.
 * @param {{ name: string, version: string }} [opts.clientInfo] - Identity advertised to the server.
 * @returns {Promise<{ client: Client, transport: StreamableHTTPClientTransport }>}
 */
export async function createRemoteMCPClient({ serverUrl, bearerToken, authProvider, clientInfo } = {}) {
  if (!serverUrl) throw new TypeError('createRemoteMCPClient: serverUrl is required');

  const hasBearer = typeof bearerToken === 'string' && bearerToken.length > 0;
  const hasProvider = authProvider != null;
  if (!hasBearer && !hasProvider) {
    throw new TypeError('createRemoteMCPClient: exactly one of { bearerToken, authProvider } is required');
  }
  if (hasBearer && hasProvider) {
    throw new TypeError('createRemoteMCPClient: provide either bearerToken or authProvider, not both');
  }

  let url;
  try {
    url = new URL(serverUrl);
  } catch (err) {
    throw new TypeError(`createRemoteMCPClient: invalid serverUrl "${serverUrl}": ${err.message}`);
  }

  const transportOpts = hasBearer
    ? { requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } } }
    : { authProvider };
  const transport = new StreamableHTTPClientTransport(url, transportOpts);

  const client = new Client(clientInfo ?? DEFAULT_CLIENT_INFO);

  try {
    await client.connect(transport);
  } catch (err) {
    try { await transport.close(); } catch { /* swallow — primary error wins */ }
    throw classifyConnectError(err);
  }

  return { client, transport };
}

/**
 * List the tools advertised by the connected server.
 * @param {{ client: Client }} handle
 * @returns {Promise<Array<{ name: string, description?: string, inputSchema: object }>>}
 */
export async function listTools(handle) {
  if (!handle?.client) throw new TypeError('listTools: handle is required');
  try {
    const result = await handle.client.listTools();
    return result.tools ?? [];
  } catch (err) {
    throw classifyRequestError(err);
  }
}

/**
 * Invoke a tool on the connected server.
 * @param {{ client: Client }} handle
 * @param {string} toolName
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<object>} The CallToolResult
 */
export async function callTool(handle, toolName, args = {}) {
  if (!handle?.client) throw new TypeError('callTool: handle is required');
  if (!toolName) throw new TypeError('callTool: toolName is required');

  let result;
  try {
    result = await handle.client.callTool({ name: toolName, arguments: args });
  } catch (err) {
    throw classifyRequestError(err);
  }

  if (result?.isError) {
    const text = Array.isArray(result.content)
      ? result.content.map(c => c?.text ?? '').filter(Boolean).join(' ')
      : '';
    throw new MCPToolCallError(
      `MCP tool "${toolName}" returned an error${text ? `: ${text}` : ''}`,
      result
    );
  }

  return result;
}

/**
 * Close the transport. Idempotent.
 * @param {{ transport?: StreamableHTTPClientTransport }} handle
 */
export async function close(handle) {
  if (!handle?.transport) return;
  try {
    await handle.transport.close();
  } catch (err) {
    throw new MCPProtocolError(`Failed to close MCP transport: ${err.message}`, err);
  }
}

/**
 * Smoke test for src/mcp/remote-client.js
 *
 * Connects to a remote MCP server over streamable HTTP using a bearer token,
 * lists the advertised tools, and disconnects. No tool calls beyond list — we
 * have no real OAuth flow yet.
 *
 * The bearerToken path is exercised here. The authProvider path (added in
 * Task 3A) requires a real OAuthClientProvider implementation and is exercised
 * by the Granola integration tests in Task 3B+.
 *
 * Env:
 *   MCP_SERVER_URL    (default: https://mcp.granola.ai/mcp)
 *   MCP_BEARER_TOKEN  (required)
 *
 * Exit codes:
 *   0  listTools succeeded, OR auth failed cleanly (MCP_AUTH) — both confirm
 *      the wrapper is wired correctly. Auth failure is the expected outcome
 *      when MCP_BEARER_TOKEN is fake.
 *   1  any other failure (connection, protocol, import).
 *
 * Usage:
 *   MCP_BEARER_TOKEN=fake npm run test:mcp-remote
 */

import dotenv from 'dotenv';
import {
  createRemoteMCPClient,
  listTools,
  close
} from '../src/mcp/remote-client.js';

dotenv.config();

const SERVER_URL = process.env.MCP_SERVER_URL || 'https://mcp.granola.ai/mcp';
const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

if (!BEARER_TOKEN) {
  console.error(
    'MCP_BEARER_TOKEN is required. For a connection-setup smoke test against ' +
    'Granola, any non-empty value works — auth will fail with 401, which is ' +
    'the expected outcome (it confirms the connection reached the server).'
  );
  process.exit(1);
}

function redact(token) {
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function main() {
  console.log('🔌 MCP Remote Client Smoke Test');
  console.log(`   Server: ${SERVER_URL}`);
  console.log(`   Token:  ${redact(BEARER_TOKEN)}`);
  console.log('');

  let handle;
  try {
    console.log('→ Connecting...');
    handle = await createRemoteMCPClient({
      serverUrl: SERVER_URL,
      bearerToken: BEARER_TOKEN
    });
    console.log('✓ Connected');

    console.log('→ Listing tools...');
    const tools = await listTools(handle);
    console.log(`✓ Server advertises ${tools.length} tool(s):`);
    for (const tool of tools) {
      console.log(`   • ${tool.name}${tool.description ? ` — ${tool.description}` : ''}`);
    }

    process.exitCode = 0;
  } catch (err) {
    const code = err?.code ?? '(no code)';
    console.error(`✗ ${code}: ${err.message}`);

    if (code === 'MCP_AUTH') {
      console.log('');
      console.log('AUTH_OK_AS_EXPECTED — connection setup succeeded; server ' +
        'rejected credentials at the auth layer. The wrapper is wired correctly.');
      process.exitCode = 0;
    } else {
      if (err.cause) console.error('  cause:', err.cause?.message ?? err.cause);
      process.exitCode = 1;
    }
  } finally {
    if (handle) {
      try {
        await close(handle);
        console.log('✓ Closed');
      } catch (err) {
        console.error(`⚠ close failed: ${err.message}`);
      }
    }
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

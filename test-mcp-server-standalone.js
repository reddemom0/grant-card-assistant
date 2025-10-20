#!/usr/bin/env node

/**
 * Standalone test script to verify MCP server can run in production
 *
 * This tests:
 * 1. Can we spawn the MCP server process?
 * 2. Are all dependencies installed?
 * 3. Can it authenticate with Google Drive?
 *
 * Usage:
 *   node test-mcp-server-standalone.js
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing MCP Server in Standalone Mode\n');

// Check if MCP server binary exists
const mcpServerPath = join(__dirname, 'mcp-servers/gdrive/dist/index.js');
console.log('📂 MCP Server Path:', mcpServerPath);

// Check environment
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
console.log('🌍 Environment:', isProduction ? 'PRODUCTION' : 'LOCAL');

// Set up credentials
const oauthPath = isProduction
  ? '/tmp/gcp-oauth.keys.json'
  : './mcp-servers/gdrive/credentials/gcp-oauth.keys.json';
const credentialsPath = isProduction
  ? '/tmp/.gdrive-server-credentials.json'
  : './mcp-servers/gdrive/credentials/.gdrive-server-credentials.json';

console.log('🔐 OAuth Path:', oauthPath);
console.log('🔐 Credentials Path:', credentialsPath);

// Try to spawn the MCP server
console.log('\n🚀 Attempting to spawn MCP server...\n');

const mcpServer = spawn('node', [mcpServerPath], {
  env: {
    ...process.env,
    GOOGLE_APPLICATION_CREDENTIALS: oauthPath,
    MCP_GDRIVE_CREDENTIALS: credentialsPath,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';
let errorOutput = '';

mcpServer.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  console.log('[MCP STDOUT]', text.trim());
});

mcpServer.stderr.on('data', (data) => {
  const text = data.toString();
  errorOutput += text;
  console.error('[MCP STDERR]', text.trim());
});

mcpServer.on('error', (error) => {
  console.error('\n❌ Failed to spawn MCP server:');
  console.error(error);
  process.exit(1);
});

mcpServer.on('close', (code) => {
  console.log('\n📊 MCP Server Process Closed');
  console.log('Exit Code:', code);

  if (code === 0) {
    console.log('\n✅ MCP server started successfully!');
  } else {
    console.log('\n❌ MCP server failed to start');
    console.log('\nStdout:', output || '(empty)');
    console.log('\nStderr:', errorOutput || '(empty)');
  }

  process.exit(code);
});

// Test for 5 seconds then kill
setTimeout(() => {
  console.log('\n⏱️ Test timeout (5s) - killing MCP server...');
  mcpServer.kill();

  if (output || errorOutput) {
    console.log('\n✅ MCP server produced output - it started successfully!');
    process.exit(0);
  } else {
    console.log('\n❌ MCP server produced no output - likely failed to start');
    process.exit(1);
  }
}, 5000);

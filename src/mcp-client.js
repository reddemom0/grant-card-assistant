/**
 * Direct MCP Client for Google Drive
 * Bypasses Agent SDK permission system by communicating directly with MCP server via stdio
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

export class MCPClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.isReady = false;
  }

  /**
   * Start the MCP server subprocess
   */
  async start() {
    return new Promise((resolve, reject) => {
      console.log('🚀 [MCP Client] Starting MCP server process...');

      this.process = spawn(this.config.command, this.config.args, {
        env: {
          ...process.env,
          ...this.config.env
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout.on('data', (data) => {
        this.handleStdout(data);
      });

      this.process.stderr.on('data', (data) => {
        console.log('[MCP stderr]:', data.toString());
      });

      this.process.on('error', (error) => {
        console.error('❌ [MCP Client] Process error:', error);
        reject(error);
      });

      this.process.on('exit', (code) => {
        console.log(`⚠️ [MCP Client] Process exited with code ${code}`);
        this.isReady = false;
      });

      // Wait for server to be ready (initialize protocol)
      setTimeout(() => {
        this.isReady = true;
        console.log('✅ [MCP Client] Server process ready');
        resolve();
      }, 1000);
    });
  }

  /**
   * Handle stdout from MCP server
   * MCP uses JSON-RPC 2.0 over stdio
   */
  handleStdout(data) {
    this.buffer += data.toString();

    // JSON-RPC messages are newline-delimited
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (error) {
        console.error('❌ [MCP Client] Failed to parse message:', line, error);
      }
    }
  }

  /**
   * Handle JSON-RPC message from server
   */
  handleMessage(message) {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      // This is a response to a request
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'MCP error'));
      } else {
        resolve(message.result);
      }
    } else {
      // Notification or other message
      this.emit('message', message);
    }
  }

  /**
   * Send JSON-RPC request to MCP server
   */
  async sendRequest(method, params = {}) {
    if (!this.isReady || !this.process) {
      throw new Error('MCP server not ready');
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const requestStr = JSON.stringify(request) + '\n';
      this.process.stdin.write(requestStr);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * List available tools from MCP server
   */
  async listTools() {
    return this.sendRequest('tools/list');
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(toolName, args = {}) {
    console.log(`🔧 [MCP Client] Calling tool: ${toolName}`, args);
    return this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    });
  }

  /**
   * Search Google Drive
   */
  async searchGoogleDrive(query, options = {}) {
    return this.callTool('gdrive_search', {
      query,
      maxResults: options.maxResults || 20,
      fileTypes: options.fileTypes
    });
  }

  /**
   * Read a file from Google Drive
   */
  async readGoogleDriveFile(fileId, mimeType) {
    return this.callTool('gdrive_read_file', {
      fileId,
      mimeType: mimeType || 'text/plain'
    });
  }

  /**
   * Stop the MCP server process
   */
  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isReady = false;
      console.log('🛑 [MCP Client] Server process stopped');
    }
  }
}

/**
 * Create and initialize MCP client for Google Drive
 */
export async function createGoogleDriveMCPClient(config) {
  const client = new MCPClient(config);
  await client.start();
  return client;
}

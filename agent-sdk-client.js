// Agent SDK Client for Frontend
// Handles communication with Railway Agent SDK backend

class AgentSDKClient {
  constructor(config) {
    this.config = config;
    this.endpoint = config.getAgentEndpoint();
    this.currentAbortController = null;
  }

  /**
   * Send a message to an agent and handle streaming response
   * @param {Object} params - Request parameters
   * @param {string} params.agentType - Frontend agent type (grant-cards, etg, etc.)
   * @param {string} params.conversationId - Conversation ID
   * @param {string} params.userId - User ID
   * @param {string} params.message - User message
   * @param {Array} params.files - Optional uploaded files
   * @param {Function} params.onContent - Callback for content chunks
   * @param {Function} params.onComplete - Callback for completion
   * @param {Function} params.onError - Callback for errors
   * @param {Function} params.onToolUse - Optional callback for tool use events
   */
  async sendMessage({
    agentType,
    conversationId,
    userId,
    message,
    files = [],
    onContent = () => {},
    onComplete = () => {},
    onError = () => {},
    onToolUse = () => {}
  }) {
    // Convert frontend agent type to backend agent type
    const backendAgentType = this.config.getAgentType(agentType);

    // Create abort controller for this request
    this.currentAbortController = new AbortController();

    try {
      // Build request body
      const body = {
        agentType: backendAgentType,
        conversationId,
        userId,
        message,
        options: {}
      };

      // TODO: Handle file uploads (base64 encoding for Agent SDK)
      if (files && files.length > 0) {
        console.log('⚠️ File upload not yet implemented for Agent SDK');
        // Will need to convert files to base64 and include in body.files
      }

      // Make request
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: this.currentAbortController.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check if response is SSE
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/event-stream')) {
        throw new Error('Expected SSE stream, got: ' + contentType);
      }

      // Parse SSE stream
      await this.parseSSEStream(response, {
        onContent,
        onComplete,
        onError,
        onToolUse
      });

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request aborted by user');
      } else {
        console.error('Agent SDK error:', error);
        onError(error);
      }
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * Parse Server-Sent Events stream
   */
  async parseSSEStream(response, callbacks) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              this.handleSSEEvent(data, callbacks);
            } catch (e) {
              console.warn('Failed to parse SSE event:', line);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle individual SSE events
   */
  handleSSEEvent(data, callbacks) {
    const { onContent, onComplete, onError, onToolUse } = callbacks;

    switch (data.type) {
      case 'content':
        onContent(data.text);
        break;

      case 'thinking':
        // Optional: handle thinking content
        console.log('💭 Agent thinking...');
        break;

      case 'tool_use':
        console.log(`🔧 Tool used: ${data.tool}`);
        onToolUse(data.tool);
        break;

      case 'complete':
        console.log('✅ Stream complete', {
          cost: data.cost,
          duration: data.duration
        });
        onComplete(data);
        break;

      case 'error':
        console.error('❌ Agent error:', data.error);
        onError(new Error(data.error));
        break;

      default:
        console.log('Unknown event type:', data.type);
    }
  }

  /**
   * Abort current request
   */
  abort() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }
}

// Make client available globally
window.AgentSDKClient = AgentSDKClient;

console.log('✅ AgentSDKClient loaded');

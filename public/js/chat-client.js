/**
 * Direct API Chat Client
 *
 * SSE streaming client for the new direct Claude API.
 * Handles all event types: text_delta, tool_use, thinking, etc.
 */

class ChatClient {
    constructor(apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl || '';
        this.eventSource = null;
        this.conversationId = null;
        this.userId = null;
        this.onTextDelta = null;
        this.onThinkingDelta = null;
        this.onToolUse = null;
        this.onToolResult = null;
        this.onComplete = null;
        this.onError = null;
        this.onConnected = null;
        this.onUsage = null;
    }

    /**
     * Send a message and stream the response
     * @param {Object} options - Message options
     * @param {string} options.message - The message text
     * @param {string} options.agentType - Agent type (e.g., 'grant-card-generator')
     * @param {string} options.conversationId - Optional conversation ID
     * @param {string} options.userId - Optional user ID
     * @param {Array} options.attachments - Optional file attachments
     */
    async sendMessage({ message, agentType, conversationId, userId, attachments = [] }) {
        try {
            // Store conversation ID for tracking
            this.conversationId = conversationId;
            this.userId = userId || 'anonymous';

            const response = await fetch(`${this.apiBaseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message,
                    agentType,
                    conversationId: this.conversationId,
                    userId: this.userId,
                    attachments
                })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            // Handle SSE streaming
            await this._handleSSEStream(response);

        } catch (error) {
            console.error('❌ Send message error:', error);
            if (this.onError) {
                this.onError(error);
            }
            throw error;
        }
    }

    /**
     * Handle Server-Sent Events stream
     */
    async _handleSSEStream(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();

                if (done) {
                    console.log('✓ Stream ended');
                    break;
                }

                // Decode chunk and add to buffer
                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE messages
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || ''; // Keep incomplete message in buffer

                for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data: ')) continue;

                    try {
                        const data = JSON.parse(line.substring(6));
                        this._handleEvent(data);
                    } catch (error) {
                        console.warn('Failed to parse SSE message:', line);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Stream error:', error);
            if (this.onError) {
                this.onError(error);
            }
            throw error;
        }
    }

    /**
     * Handle individual SSE events
     */
    _handleEvent(event) {
        switch (event.type) {
            case 'connected':
                console.log('✓ Connected:', event.sessionId);
                if (this.onConnected) {
                    this.onConnected(event);
                }
                // Update conversation ID if it was newly created
                if (event.conversationId && !this.conversationId) {
                    this.conversationId = event.conversationId;
                }
                break;

            case 'message_start':
                console.log('✓ Message started');
                break;

            case 'text_delta':
                // Stream text chunk
                if (this.onTextDelta) {
                    this.onTextDelta(event.text);
                }
                break;

            case 'thinking_start':
                console.log('💭 Thinking started');
                break;

            case 'thinking_delta':
                // Stream thinking content (optional - can hide from users)
                if (this.onThinkingDelta) {
                    this.onThinkingDelta(event.thinking);
                }
                break;

            case 'thinking_stop':
                console.log('💭 Thinking stopped');
                break;

            case 'tool_use':
                console.log(`🔧 Tool used: ${event.toolName}`, event.input);
                if (this.onToolUse) {
                    this.onToolUse(event.toolName, event.input);
                }
                break;

            case 'tool_result':
                console.log(`✓ Tool result:`, event.toolName);
                if (this.onToolResult) {
                    this.onToolResult(event.toolName, event.result);
                }
                break;

            case 'usage':
                console.log('📊 Token usage:', event.usage);
                if (this.onUsage) {
                    this.onUsage(event.usage);
                }
                break;

            case 'loop_iteration':
                console.log(`🔄 Loop iteration: ${event.iteration}`);
                break;

            case 'done':
                console.log('✅ Response complete');
                if (this.onComplete) {
                    this.onComplete();
                }
                break;

            case 'error':
                console.error('❌ Server error:', event.error);
                if (this.onError) {
                    this.onError(new Error(event.error));
                }
                break;

            default:
                console.log('Unknown event type:', event.type);
        }
    }

    /**
     * Stop the current stream (if supported by backend)
     */
    stop() {
        // In SSE, we can't cancel from client side once request is sent
        // But we can close the reader
        console.log('⚠️ Stop requested (SSE streams cannot be cancelled from client)');
    }
}

// Export for use in HTML
window.ChatClient = ChatClient;

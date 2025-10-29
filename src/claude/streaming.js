/**
 * SSE Streaming Handler
 *
 * Handles Server-Sent Events streaming for Claude API responses.
 * Streams chunks to the frontend in real-time and collects the full response.
 */

/**
 * Stream Claude response to frontend via SSE and collect full response
 * @param {AsyncIterable} stream - Claude API stream
 * @param {Object} res - Express response object
 * @param {string} sessionId - Unique session ID for this request
 * @returns {Promise<Object>} Full collected response
 */
export async function streamToSSE(stream, res, sessionId) {
  const fullResponse = {
    content: [],
    stop_reason: null,
    usage: null
  };

  let currentContent = null;

  try {
    for await (const event of stream) {
      // Message start event
      if (event.type === 'message_start') {
        res.write(`data: ${JSON.stringify({
          type: 'message_start',
          sessionId
        })}\n\n`);
      }

      // Content block start
      if (event.type === 'content_block_start') {
        currentContent = {
          type: event.content_block.type,
          index: event.index
        };

        if (event.content_block.type === 'text') {
          currentContent.text = '';
        } else if (event.content_block.type === 'tool_use') {
          currentContent.id = event.content_block.id;
          currentContent.name = event.content_block.name;
          currentContent.input = '';
        } else if (event.content_block.type === 'server_tool_use') {
          // Handle server-side tools (web_search, web_fetch)
          currentContent.id = event.content_block.id;
          currentContent.name = event.content_block.name;
          currentContent.input = event.content_block.input;
        } else if (event.content_block.type === 'thinking') {
          currentContent.thinking = '';

          // Notify frontend that thinking started
          res.write(`data: ${JSON.stringify({
            type: 'thinking_start',
            sessionId
          })}\n\n`);
        }
      }

      // Content block delta (streaming content)
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          currentContent.text += event.delta.text;

          // Stream text to frontend
          res.write(`data: ${JSON.stringify({
            type: 'text_delta',
            text: event.delta.text,
            sessionId
          })}\n\n`);
        } else if (event.delta.type === 'input_json_delta') {
          currentContent.input += event.delta.partial_json;

          // Optionally stream tool use progress
          res.write(`data: ${JSON.stringify({
            type: 'tool_input_delta',
            toolName: currentContent.name,
            delta: event.delta.partial_json,
            sessionId
          })}\n\n`);
        } else if (event.delta.type === 'thinking_delta') {
          currentContent.thinking += event.delta.thinking;

          // Stream thinking to frontend (optional - can be hidden from users)
          res.write(`data: ${JSON.stringify({
            type: 'thinking_delta',
            thinking: event.delta.thinking,
            sessionId
          })}\n\n`);
        }
      }

      // Content block stop
      if (event.type === 'content_block_stop') {
        // Finalize content block
        if (currentContent.type === 'tool_use') {
          try {
            currentContent.input = JSON.parse(currentContent.input);
          } catch (error) {
            console.error('Failed to parse tool input JSON:', error);
            currentContent.input = {};
          }

          // Notify frontend of complete tool use
          res.write(`data: ${JSON.stringify({
            type: 'tool_use_complete',
            toolId: currentContent.id,
            toolName: currentContent.name,
            input: currentContent.input,
            sessionId
          })}\n\n`);
        } else if (currentContent.type === 'server_tool_use') {
          // Server tool complete (web_search, web_fetch)
          // Input is already populated, no need to parse
          res.write(`data: ${JSON.stringify({
            type: 'server_tool_use_complete',
            toolId: currentContent.id,
            toolName: currentContent.name,
            input: currentContent.input,
            sessionId
          })}\n\n`);
        } else if (currentContent.type === 'thinking') {
          // Thinking block complete
          res.write(`data: ${JSON.stringify({
            type: 'thinking_stop',
            sessionId
          })}\n\n`);
        }

        fullResponse.content.push(currentContent);
        currentContent = null;
      }

      // Message delta (metadata updates)
      if (event.type === 'message_delta') {
        if (event.delta.stop_reason) {
          fullResponse.stop_reason = event.delta.stop_reason;
        }
        if (event.usage) {
          fullResponse.usage = event.usage;
        }
      }

      // Message stop
      if (event.type === 'message_stop') {
        // Message complete
        if (fullResponse.usage) {
          res.write(`data: ${JSON.stringify({
            type: 'usage',
            usage: fullResponse.usage,
            sessionId
          })}\n\n`);

          // Log token usage
          console.log(`📊 Token usage:`, {
            input: fullResponse.usage.input_tokens,
            output: fullResponse.usage.output_tokens,
            cache_creation: fullResponse.usage.cache_creation_input_tokens,
            cache_read: fullResponse.usage.cache_read_input_tokens
          });
        }
      }

      // Error event
      if (event.type === 'error') {
        console.error('Stream error:', event.error);
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: event.error.message || 'Unknown error',
          sessionId
        })}\n\n`);

        throw new Error(event.error.message || 'Stream error');
      }
    }

    return fullResponse;

  } catch (error) {
    console.error('Streaming error:', error);

    // Send error to frontend if not already sent
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message,
      sessionId
    })}\n\n`);

    throw error;
  }
}

/**
 * Send a standalone SSE event
 * @param {Object} res - Express response object
 * @param {Object} data - Data to send
 */
export function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Setup SSE headers on Express response
 * @param {Object} res - Express response object
 */
export function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();
}

/**
 * Close SSE connection gracefully
 * @param {Object} res - Express response object
 */
export function closeSSE(res) {
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  res.end();
}

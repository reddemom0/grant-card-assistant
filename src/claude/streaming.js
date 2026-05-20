/**
 * SSE Streaming Handler
 *
 * Handles Server-Sent Events streaming for Claude API responses.
 * Streams chunks to the frontend in real-time and collects the full response.
 */

import { query } from '../database/connection.js';
import { substituteBookingLink, BookingLinkRoutingError } from '../api/booking-link-routing.js';

/**
 * Look up Pro/Pro Waitlist routing context for a lead-gen session.
 *
 * Reads from lead_gen_conversations.prospect_data, where save_lead_data writes
 * best_fit_product (via finalizeLeadGenConversation) and industry. By the time
 * an end_turn chat flush happens for the opening estimate turn, save_lead_data
 * has already run and persisted both fields.
 *
 * @param {string} conversationId - lead-gen session_id (same value as conversationId)
 * @returns {Promise<{best_fit_product: string|null, industry: string|null}>}
 */
async function lookupLeadGenRouting(conversationId) {
  if (!conversationId) return { best_fit_product: null, industry: null };
  const r = await query(
    `SELECT prospect_data->>'best_fit_product' AS bfp,
            prospect_data->>'industry'         AS industry
       FROM lead_gen_conversations
      WHERE session_id = $1`,
    [conversationId]
  );
  const row = r.rows[0] || {};
  return { best_fit_product: row.bfp || null, industry: row.industry || null };
}

/**
 * Apply booking-link sentinel substitution to a buffered lead-gen chat text
 * payload before it streams to the widget. Returns the input unchanged when
 * the text contains neither the sentinel nor a hardcoded meetings.hubspot.com
 * URL (cheap shortcut — skips the DB lookup).
 *
 * Throws BookingLinkRoutingError when the sentinel requires routing data the
 * lead doesn't have yet (best_fit_product or industry missing). The caller is
 * responsible for sending an SSE error and aborting the stream.
 */
export async function applyChatBookingSubstitution(text, conversationId) {
  if (!text || typeof text !== 'string') return text;
  if (!text.includes('{{BOOKING_LINK}}') && !/meetings\.hubspot\.com/i.test(text)) {
    return text;
  }
  const routing = await lookupLeadGenRouting(conversationId);
  return substituteBookingLink(text, routing, { mode: 'chat' });
}

/**
 * Convert markdown formatting to HTML (safety net)
 * Handles bold, links, and basic formatting that the model might output
 */
function convertMarkdownToHtml(text) {
  if (!text) return text;

  return text
    // Bold: **text** → <strong>text</strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Links: [text](url) → <a href="url">text</a>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Stream Claude response to frontend via SSE and collect full response
 * @param {AsyncIterable} stream - Claude API stream
 * @param {Object} res - Express response object
 * @param {string} sessionId - Unique session ID for this request (SSE connection ID)
 * @param {string} agentType - Agent type (for lead-gen specific handling)
 * @param {string} [conversationId] - Conversation ID; for lead-gen this is the
 *        lead session_id used to look up routing data (best_fit_product / industry)
 *        when substituting the {{BOOKING_LINK}} sentinel at end_turn flush.
 * @returns {Promise<Object>} Full collected response
 */
export async function streamToSSE(stream, res, sessionId, agentType = null, conversationId = null) {
  const fullResponse = {
    content: [],
    stop_reason: null,
    usage: null
  };

  let currentContent = null;

  // For lead-gen: buffer text instead of streaming immediately (prevents tool narration leaking)
  let textBuffer = '';
  let hasToolUse = false;

  try {
    for await (const event of stream) {
      // Message start event
      if (event.type === 'message_start') {
        if (res) {
          res.write(`data: ${JSON.stringify({
            type: 'message_start',
            sessionId
          })}\n\n`);
        }
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
          // Mark that this iteration includes tool use (for lead-gen filtering)
          if (agentType === 'lead-gen') {
            hasToolUse = true;
          }
          currentContent.id = event.content_block.id;
          currentContent.name = event.content_block.name;
          currentContent.input = '';
        } else if (event.content_block.type === 'server_tool_use') {
          // Handle server-side tools (web_search, web_fetch)
          currentContent.id = event.content_block.id;
          currentContent.name = event.content_block.name;
          // Initialize input as empty string - will be accumulated during delta events
          currentContent.input = '';
        } else if (event.content_block.type === 'web_fetch_tool_result') {
          // Handle WebFetch result from Claude
          // The entire content object is provided in content_block_start (not streamed via deltas)
          currentContent.tool_use_id = event.content_block.tool_use_id;
          currentContent.content = event.content_block.content; // Full content object from API
        } else if (event.content_block.type === 'web_search_tool_result') {
          // Handle WebSearch result from Claude
          // The entire content object is provided in content_block_start (not streamed via deltas)
          currentContent.tool_use_id = event.content_block.tool_use_id;
          currentContent.content = event.content_block.content; // Full content object from API
        } else if (event.content_block.type === 'thinking') {
          currentContent.thinking = '';
          currentContent.signature = ''; // Initialize signature field

          // Notify frontend that thinking started
          if (res) {
            res.write(`data: ${JSON.stringify({
              type: 'thinking_start',
              sessionId
            })}\n\n`);
          }
        }
      }

      // Content block delta (streaming content)
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          currentContent.text += event.delta.text;

          // For lead-gen: buffer text if we're in a tool-use iteration
          // Only stream on final end_turn iteration
          if (agentType === 'lead-gen') {
            textBuffer += event.delta.text;
            // Don't stream yet - wait for stop_reason to determine if this is final iteration
          } else {
            // Other agents: stream immediately (original behavior)
            if (res) {
              res.write(`data: ${JSON.stringify({
                type: 'text_delta',
                text: event.delta.text,
                sessionId
              })}\n\n`);
            }
          }
        } else if (event.delta.type === 'input_json_delta') {
          currentContent.input += event.delta.partial_json;

          // Optionally stream tool use progress
          if (res) {
            res.write(`data: ${JSON.stringify({
              type: 'tool_input_delta',
              toolName: currentContent.name,
              delta: event.delta.partial_json,
              sessionId
            })}\n\n`);
          }
        } else if (event.delta.type === 'thinking_delta') {
          currentContent.thinking += event.delta.thinking;

          // Stream thinking to frontend (optional - can be hidden from users)
          if (res) {
            res.write(`data: ${JSON.stringify({
              type: 'thinking_delta',
              thinking: event.delta.thinking,
              sessionId
            })}\n\n`);
          }
        } else if (event.delta.type === 'signature_delta') {
          // Capture signature for thinking blocks
          // Signature is required when passing thinking blocks back to API
          if (!currentContent.signature) {
            currentContent.signature = '';
          }
          currentContent.signature += event.delta.signature;
        }
      }

      // Content block stop
      if (event.type === 'content_block_stop') {
        // Finalize content block
        if (currentContent.type === 'tool_use') {
          // Zero-arg tools (e.g. list_hubspot_owners with empty input_schema.properties)
          // emit no input_json_delta events, leaving the accumulator as ''. JSON.parse('')
          // throws, so coerce empty input to {} before parsing. Dropping the block here
          // causes stop_reason='tool_use' with no tool_use content, which the caller
          // treats as a fatal protocol error.
          if (currentContent.input === '') {
            currentContent.input = {};
          } else {
            try {
              currentContent.input = JSON.parse(currentContent.input);
            } catch (error) {
              console.error('Failed to parse tool input JSON; using {} as fallback:', error);
              currentContent.input = {};
            }
          }

          // Notify frontend of complete tool use
          if (res) {
            res.write(`data: ${JSON.stringify({
              type: 'tool_use_complete',
              toolId: currentContent.id,
              toolName: currentContent.name,
              input: currentContent.input,
              sessionId
            })}\n\n`);
          }
        } else if (currentContent.type === 'server_tool_use') {
          // Server tool complete (web_search, web_fetch). Same empty-input guard as tool_use above.
          if (currentContent.input === '') {
            currentContent.input = {};
          } else {
            try {
              currentContent.input = JSON.parse(currentContent.input);
            } catch (error) {
              console.error('Failed to parse server tool input JSON; using {} as fallback:', error);
              currentContent.input = {};
            }
          }

          if (res) {
            res.write(`data: ${JSON.stringify({
              type: 'server_tool_use_complete',
              toolId: currentContent.id,
              toolName: currentContent.name,
              input: currentContent.input,
              sessionId
            })}\n\n`);
          }
        } else if (currentContent.type === 'web_fetch_tool_result' || currentContent.type === 'web_search_tool_result') {
          // Server tool result complete
          // Content field should remain as string (not parsed as JSON)
          if (res) {
            res.write(`data: ${JSON.stringify({
              type: 'server_tool_result_complete',
              toolUseId: currentContent.tool_use_id,
              resultType: currentContent.type,
              sessionId
            })}\n\n`);
          }
        } else if (currentContent.type === 'thinking') {
          // Thinking block complete
          if (res) {
            res.write(`data: ${JSON.stringify({
              type: 'thinking_stop',
              sessionId
            })}\n\n`);
          }
        }

        fullResponse.content.push(currentContent);
        currentContent = null;
      }

      // Message delta (metadata updates)
      if (event.type === 'message_delta') {
        if (event.delta.stop_reason) {
          fullResponse.stop_reason = event.delta.stop_reason;

          // For lead-gen: only stream buffered text if this is the final iteration (end_turn)
          if (agentType === 'lead-gen') {
            if (event.delta.stop_reason === 'end_turn' && textBuffer && res) {
              // This is the final iteration - stream the buffered text
              console.log(`  📝 Streaming final iteration text: ${textBuffer.length} chars (lead-gen mode)`);

              // Booking-link sentinel substitution — runs BEFORE markdown→HTML.
              // The sentinel has no markdown semantics, so it survives the
              // conversion either way; running substitution first means the
              // routed URL is what flows into <a href> conversion (when the
              // model wrapped the sentinel as a markdown link).
              let substituted;
              try {
                substituted = await applyChatBookingSubstitution(textBuffer, conversationId);
              } catch (subErr) {
                if (subErr instanceof BookingLinkRoutingError) {
                  console.error(
                    `[BOOKING-LINK-FAILURE] chat-stream — refusing to ship sentinel. conversationId=${conversationId}, best_fit_product=${subErr.context?.best_fit_product}, industry=${subErr.context?.industry}, reason=${subErr.context?.reason}, message="${subErr.message}"`
                  );
                  res.write(`data: ${JSON.stringify({
                    type: 'error',
                    error: 'Something went wrong, please try again.',
                    sessionId
                  })}\n\n`);
                  res.end();
                  throw subErr;
                }
                throw subErr;
              }

              // Convert markdown to HTML before streaming
              const htmlConverted = convertMarkdownToHtml(substituted);

              res.write(`data: ${JSON.stringify({
                type: 'text_delta',
                text: htmlConverted,
                sessionId
              })}\n\n`);
            } else if (event.delta.stop_reason === 'tool_use' && textBuffer) {
              // This was a tool-use iteration - discard the narration text
              console.log(`  🔇 Discarding tool narration: ${textBuffer.length} chars (stop_reason: tool_use)`);
            }
            // Reset buffer for next iteration
            textBuffer = '';
            hasToolUse = false;
          }
        }
        if (event.usage) {
          fullResponse.usage = event.usage;
        }
      }

      // Message stop
      if (event.type === 'message_stop') {
        // Message complete
        if (fullResponse.usage) {
          if (res) {
            res.write(`data: ${JSON.stringify({
              type: 'usage',
              usage: fullResponse.usage,
              sessionId
            })}\n\n`);
          }

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
        if (res) {
          res.write(`data: ${JSON.stringify({
            type: 'error',
            error: event.error.message || 'Unknown error',
            sessionId
          })}\n\n`);
        }

        throw new Error(event.error.message || 'Stream error');
      }
    }

    return fullResponse;

  } catch (error) {
    console.error('Streaming error:', error);

    // Send error to frontend if not already sent
    if (res) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message,
        sessionId
      })}\n\n`);
    }

    throw error;
  }
}

/**
 * Send a standalone SSE event
 * @param {Object} res - Express response object
 * @param {Object} data - Data to send
 */
export function sendSSE(res, data) {
  if (!res) return; // No streaming for webhook enrichment
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Setup SSE headers on Express response
 * @param {Object} res - Express response object (null for webhook enrichment)
 */
export function setupSSE(res) {
  if (!res) return; // No streaming for webhook enrichment
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();
}

/**
 * Close SSE connection gracefully
 * @param {Object} res - Express response object (null for webhook enrichment)
 */
export function closeSSE(res) {
  if (!res) return; // No streaming for webhook enrichment
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  res.end();
}

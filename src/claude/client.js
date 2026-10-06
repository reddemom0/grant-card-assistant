/**
 * Claude API Client with Agent Loop
 *
 * Main orchestrator for agent execution:
 * - Loads agent prompts
 * - Manages conversation history
 * - Executes tool calls
 * - Streams responses to frontend
 */

import Anthropic from '@anthropic-ai/sdk';
import { loadAgentPromptCached } from '../agents/load-agents.js';
import { loadConversationMemories } from '../tools/memory.js';
import { loadLearningMemory } from '../tools/learning-memory.js';
import { getLeadGenFormContext } from '../utils/lead-gen-context.js';
import { executeToolCall } from '../tools/executor.js';
import { getToolsForAgent } from '../tools/definitions.js';
import { streamToSSE, setupSSE, closeSSE, sendSSE, applyChatBookingSubstitution } from './streaming.js';
import { wrapToolOutput, UNTRUSTED_DATA_INSTRUCTION } from './tool-output.js';
import { attachmentPlaceholder } from '../tools/chat-attachments.js';
import { BookingLinkRoutingError } from '../api/booking-link-routing.js';
import { getQueryConfig, getQueryConfigForModel, logConfigDecision } from './query-classifier.js';
import {
  getMaxTurnsForAgent,
  shouldWarnAboutCost,
  COST_SETTINGS
} from '../config/cost-settings.js';
import { logAPICost } from '../utils/cost-logger.js';
import { pulseContextBlock } from '../services/pulse-posts.js';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Strip tool narration patterns from text (safety net)
 * Removes lines like "Let me search...", "Let me store...", etc.
 */
function stripToolNarration(text) {
  if (!text) return text;

  const narrationPatterns = [
    /^Let me search[^\n]*\.?\n?/gm,
    /^Let me look[^\n]*\.?\n?/gm,
    /^Let me store[^\n]*\.?\n?/gm,
    /^Let me broaden[^\n]*\.?\n?/gm,
    /^Let me check[^\n]*\.?\n?/gm,
    /^Let me find[^\n]*\.?\n?/gm,
    /^Let me save[^\n]*\.?\n?/gm,
    /^Searching[^\n]*\.?\n?/gm,
    /^Storing[^\n]*\.?\n?/gm,
    /^Looking up[^\n]*\.?\n?/gm,
    /^I'll search[^\n]*\.?\n?/gm,
    /^I'll look[^\n]*\.?\n?/gm,
    /^I'll check[^\n]*\.?\n?/gm,
  ];

  let cleaned = text;
  for (const pattern of narrationPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up resulting multiple line breaks
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
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

// DEPRECATED: These are now set dynamically based on query complexity
// Kept for backwards compatibility
const FALLBACK_MAX_AGENT_LOOPS = 50;
const FALLBACK_MODEL = 'claude-sonnet-4-6'; // Use latest Sonnet 4.6
const FALLBACK_MAX_TOKENS = 16000;
const FALLBACK_THINKING_BUDGET = 10000;

/**
 * Apply rolling prompt-cache breakpoints to the message history.
 *
 * Returns a NEW array; only the marked messages (and their last content block)
 * are cloned, everything else is shared by reference. The input `messages` is
 * never mutated — so cache_control never leaks into DB persistence, and stale
 * breakpoints never accumulate across agentic-loop iterations (we recompute
 * fresh each call).
 *
 * Placement (≤2 breakpoints, keeping us within Anthropic's 4-breakpoint limit
 * once the system breakpoint is counted):
 *  - The TAIL (last message) — caches the just-finished turn so the next loop
 *    iteration / conversation turn reads it instead of re-billing it.
 *  - One INTERMEDIATE checkpoint at the deepest earlier message boundary still
 *    within the API's 20-CONTENT-BLOCK cache lookback window. A single
 *    parallel-tool-use iteration can add ~25 blocks (many tool_use +
 *    tool_result), so a message-count anchor would fall outside that window and
 *    silently miss — spacing by block count keeps the prior entry reachable.
 *
 * @param {Array} messages - The assembled messages array (history + current turn)
 * @param {number} everyN - cacheEveryNMessages; small-history floor only
 * @returns {Array} messages with cache_control applied to the chosen blocks
 */
function withMessageCacheBreakpoints(messages, everyN) {
  const n = messages.length;
  if (n === 0) return messages;

  const blockCount = (m) => Array.isArray(m.content) ? m.content.length : 1;

  const targets = new Set();
  targets.add(n - 1); // tail: caches the just-finished turn for the next iteration

  // Intermediate breakpoint: the DEEPEST earlier message boundary still within
  // the API's 20-content-block cache lookback window. Placing it as deep as
  // possible — but still reachable — maximizes the cached prefix while keeping
  // the prior entry findable, so the agentic loop reads history incrementally
  // instead of re-billing it. (A single iteration that adds >20 blocks — heavy
  // parallel tool use — can exceed the window; that's an inherent API limit, so
  // that one iteration pays uncached and the chain resumes on the next turn.)
  let gap = 0;
  let intermediate = -1;
  for (let k = n - 2; k >= 0; k--) {
    gap += blockCount(messages[k + 1]);
    if (gap > 20) break;
    intermediate = k;
  }
  if (intermediate >= 1) {
    targets.add(intermediate);
  } else if (n - 1 >= everyN) {
    // Small-history / oversized-tail floor: anchor a stable point ~everyN
    // messages back so short conversations still amortize, rather than marking
    // index 0 (barely more than the system breakpoint already covers).
    // everyN = COST_SETTINGS.cacheEveryNMessages — finally wired.
    targets.add(n - 1 - everyN);
  }

  return messages.map((m, i) => {
    if (!targets.has(i)) return m; // unchanged reference — no mutation
    const content = typeof m.content === 'string'
      ? [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
      : m.content.map((b, j) =>
          j === m.content.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b);
    return { ...m, content };
  });
}

/**
 * Main agent execution function
 * @param {Object} params - Execution parameters
 * @param {string} params.agentType - Type of agent to run
 * @param {string} params.message - User message
 * @param {string} params.conversationId - Conversation UUID
 * @param {string} params.userId - User UUID
 * @param {string} params.sessionId - Session UUID for this request
 * @param {Array} params.attachments - File attachments (images/PDFs)
 * @param {Object} params.res - Express response object for SSE streaming
 * @param {string} params.forceModel - Optional model to force (bypasses query classifier)
 * @param {Object} params.modelConfig - Optional model configuration overrides (maxIterations, etc)
 * @returns {Promise<Object>} Execution result
 */
// Tools that exist only for a run that names them in allowedTools. A normal turn
// never sees them, so it can't attempt one (and then report a refusal as success).
const RUN_ONLY_TOOLS = ['save_team_lesson'];

/**
 * The tools one run may use: the agent's set, narrowed to allowedTools when given.
 * Run-only tools (save_team_lesson) are left out unless allowedTools names them.
 * @param {string} agentType
 * @param {string[]|null} allowedTools
 * @returns {Array}
 */
export function toolsForRun(agentType, allowedTools = null) {
  const tools = getToolsForAgent(agentType);
  return allowedTools
    ? tools.filter(t => allowedTools.includes(t.name))
    : tools.filter(t => !RUN_ONLY_TOOLS.includes(t.name));
}

// Oracle tools used in 2 or fewer conversations over the 30 days to 2026-09-29.
// On Oracle's Sonnet 5.5 requests they are sent with defer_loading, so they stay
// out of the cached prefix until tool search finds them. track_review and
// read_chat_attachments qualified but stay loaded: the review card and Chat file
// uploads depend on them. gg3_conversations (GetGranted client chats) is new and
// deferred from the start; its description carries the words search matches on.
// The second batch (from search_federal_grants_records on) is the 20 least-used
// tools still loaded over the 30 days to 2026-10-05. pulse_stats (GetGranted
// usage and match stats) is new and deferred from the start, like gg3_conversations.
export const ORACLE_DEFERRED_TOOLS = [
  'create_hubspot_company', 'update_hubspot_company', 'create_hubspot_contact',
  'update_hubspot_contact', 'associate_contact_with_company', 'create_hubspot_deal',
  'update_hubspot_deal', 'generate_hubspot_embed_link', 'list_hubspot_owners',
  'get_deal_count', 'search_recent_wins',
  'list_calendar_events', 'check_calendar_availability', 'create_calendar_event',
  'update_calendar_event',
  'search_federal_grants_aggregate', 'get_program_stats', 'read_dropbox_file',
  'granola_list_meeting_folders', 'memory_list', 'get_recent_granted_ca_post',
  'append_sheet_row', 'insert_into_google_doc',
  'gg3_conversations',
  'search_federal_grants_records', 'check_blog_coverage', 'check_marketing_calendar',
  'granola_query_meetings', 'granola_get_meetings', 'granola_get_meeting_transcript',
  'granola_list_meetings', 'memory_recall', 'memory_store',
  'search_hubspot_contacts', 'get_hubspot_contact',
  'build_mention_digest', 'read_chat_space_history', 'get_visualping_alerts',
  'search_grant_applications', 'get_grant_application',
  'list_files_in_folder', 'update_sheet_range', 'replace_google_doc_section',
  'read_google_doc_outline',
  'pulse_stats'
];

export const TOOL_SEARCH_TOOL = { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' };

/**
 * The tool list as sent. Oracle's Sonnet 5.5 requests defer ORACLE_DEFERRED_TOOLS
 * and add Anthropic's tool search; the API keeps deferred tools out of the prefix
 * and appends the ones Claude finds, so the cache is unaffected. Everything else —
 * Oracle's Haiku tiers, the webhook, runs restricted by allowedTools, other
 * agents — gets the list unchanged.
 *
 * @param {Array} tools - from toolsForRun
 * @param {{agentType: string, model: string, allowedTools: string[]|null}} run
 * @returns {Array}
 */
export function withToolSearch(tools, { agentType, model, allowedTools = null }) {
  if (agentType !== 'internal-oracle' || model !== 'claude-sonnet-5-5' || allowedTools) {
    return tools;
  }
  return [
    ...tools.map(t => (ORACLE_DEFERRED_TOOLS.includes(t.name) ? { ...t, defer_loading: true } : t)),
    TOOL_SEARCH_TOOL
  ];
}

/**
 * Reloaded history as sent: thinking blocks and tool search results are dropped
 * from assistant messages. messages.js already drops the server_tool_use that
 * started each search, so its result can't be sent without it; a later turn
 * searches again instead.
 *
 * @param {Array} history - from getConversationMessages
 * @returns {Array}
 */
export function historyForRequest(history) {
  const dropped = ['thinking', 'redacted_thinking', 'tool_search_tool_result'];
  return history.map(msg => (msg.role === 'assistant' && Array.isArray(msg.content)
    ? { ...msg, content: msg.content.filter(block => !dropped.includes(block.type)) }
    : msg));
}

/**
 * The user turn as saved: ephemeral attachment blocks (Chat files) become a
 * placeholder, everything else is kept as sent.
 *
 * @param {Array} userContent - Content blocks sent to the model
 * @param {Map<number, string>} ephemeralBlocks - Block index → file name
 * @returns {Array}
 */
export function userContentToStore(userContent, ephemeralBlocks) {
  return userContent.map((block, i) => (ephemeralBlocks.has(i)
    ? { type: 'text', text: attachmentPlaceholder(ephemeralBlocks.get(i)) }
    : block));
}

/**
 * Tool results as saved: read_chat_attachments output (Chat file text) becomes a
 * placeholder, everything else is kept as returned.
 *
 * @param {Array} toolResults - tool_result blocks sent to the model
 * @param {Map<string, string>} toolNamesById - tool_use_id → tool name
 * @returns {Array}
 */
export function toolResultsToStore(toolResults, toolNamesById) {
  return toolResults.map(tr => (toolNamesById.get(tr.tool_use_id) === 'read_chat_attachments'
    ? { ...tr, content: attachmentPlaceholder('files read from this thread') }
    : tr));
}

/**
 * cache_control for the base-prompt system block (the tools + prompt prefix).
 * Oracle gets the 1h TTL: its traffic has 5–60 minute gaps that a 5m entry
 * misses, and the prefix is ~40K tokens (~55K on Sonnet 5.5's tokenizer). 1h writes cost 2x input against 1.25x
 * for 5m. Other agents keep the 5m default.
 *
 * @param {string} agentType
 * @returns {Object}
 */
export function baseAgentPromptCache(agentType) {
  return agentType === 'internal-oracle'
    ? { type: 'ephemeral', ttl: '1h' }
    : { type: 'ephemeral' };
}

/**
 * The assistant turn as sent back inside a tool loop: empty text blocks and the
 * stream's `index` field are dropped, every other block is kept as received and
 * in order. thinking and redacted_thinking blocks must come back unmodified —
 * stripping them makes the API silently turn thinking off for the follow-up call,
 * which also changes the cached prefix. The Feb 2026 "thinking blocks cannot be
 * modified" 400 came from redacted_thinking blocks rebuilt without their `data`;
 * streamToSSE now keeps it.
 *
 * @param {Array} content - fullResponse.content from streamToSSE
 * @returns {Array}
 */
export function assistantTurnForToolLoop(content) {
  return content
    .filter(block => !(block.type === 'text' && (!block.text || block.text.trim() === '')))
    .map(({ index, ...block }) => block);
}

export async function runAgent({
  agentType,
  message,
  conversationId,
  userId,
  sessionId,
  attachments = [],
  res,
  forceModel = null,
  modelConfig = {},
  onCostCalculated = null,
  // Which surface this request came from, built by the entry point from the
  // verified request. Passed to tools as a function argument, never as tool
  // input, so the model cannot claim to be somewhere it is not. Absent for
  // headless callers (webhook, scripts), which tools treat as "no context".
  chatContext = null,
  // Optional list of tool names this run may use (e.g. a /learn-this run, which
  // may only read and save a lesson). Absent: the agent's full tool set.
  allowedTools = null
}) {
  console.log('\n' + '='.repeat(80));
  console.log(`🤖 Running agent: ${agentType}`);
  console.log(`📝 Conversation: ${conversationId}`);
  console.log(`👤 User: ${userId}`);
  console.log(`🔑 Session: ${sessionId}`);
  console.log('='.repeat(80) + '\n');

  // Setup SSE headers (only if res exists - webhook enrichment has no client)
  if (res) {
    setupSSE(res);

    // Send connection confirmation
    sendSSE(res, {
      type: 'connected',
      sessionId,
      conversationId,
      agentType
    });
  }

  try {
    // ============================================================================
    // 1. Load agent prompt (BASE PROMPT - CACHEABLE)
    // ============================================================================

    console.log(`📋 Loading agent prompt for: ${agentType}`);
    const baseAgentPrompt = loadAgentPromptCached(agentType);
    console.log(`✓ Agent prompt loaded (${baseAgentPrompt.length} characters)`);

    // ============================================================================
    // 2. Load conversation memories (CONVERSATION-SPECIFIC - NOT CACHEABLE)
    // ============================================================================

    console.log(`🧠 Loading conversation memories...`);
    const memories = await loadConversationMemories(conversationId);
    if (memories) {
      const memoryCount = memories.split('\n').length - 2; // Subtract header lines
      console.log(`✓ Loaded ${memoryCount} memories into context`);
    } else {
      console.log(`✓ No memories found for this conversation`);
    }

    // ============================================================================
    // 2.5. Load learning memory from feedback (USER-SPECIFIC - NOT CACHEABLE)
    // ============================================================================

    console.log(`📚 Loading learned patterns from user feedback...`);
    const learningMemory = await loadLearningMemory(agentType, conversationId, userId);
    if (learningMemory) {
      console.log(`✓ Injected learned patterns from feedback into system prompt`);
    } else {
      console.log(`✓ No learned patterns available yet (feedback learning will run as feedback is collected)`);
    }

    // Team notes taught in Chat with /learn-this — every active one, grouped by
    // skill, so none depends on which skill file the model loads. Oracle only.
    // Uses are logged to the same learning_applications audit table as the
    // feedback files.
    let teamNotes = '';
    if (agentType === 'internal-oracle') {
      try {
        const { activeLessons, formatLessons } = await import('../database/team-lessons-store.js');
        const lessons = await activeLessons();
        teamNotes = formatLessons(lessons);
        if (lessons.length) {
          console.log(`✓ ${lessons.length} team notes added`);
          const { saveLearningApplication } = await import('../database/learning-tracking.js');
          await saveLearningApplication(agentType, conversationId, userId, ['team_lessons'], lessons[0].created_at)
            .catch(err => console.warn(`⚠️  Team notes use not logged: ${err.code || err.message}`));
        }
      } catch (err) {
        // Never fail a turn over team notes — the table may not exist yet.
        console.warn(`⚠️  Team notes unavailable: ${err.code || err.message}`);
      }
    }

    // ============================================================================
    // 2.55. Load signed-in user identity (USER-SPECIFIC - NOT CACHEABLE)
    // ============================================================================
    // Gives the agent the identity of the person it is talking to, including
    // their HubSpot owner ID, so it can attribute actions instead of asking who
    // the user is. See migrations/023_add_hubspot_owner_id.sql.
    //
    // Skipped entirely when userId is null (the HubSpot webhook, CLI scripts,
    // lead-gen), so those callers behave exactly as before.
    let userIdentity = null;
    if (userId) {
      try {
        const { query } = await import('../database/connection.js');
        const r = await query(
          'SELECT name, email, hubspot_owner_id FROM users WHERE id = $1',
          [userId]
        );
        if (r.rows.length > 0) {
          userIdentity = r.rows[0];
          console.log(`👤 Identity: ${userIdentity.email} (HubSpot owner: ${userIdentity.hubspot_owner_id || 'unmapped'})`);
        }
      } catch (err) {
        // Never fail the turn over identity — degrade to the previous behaviour
        // where the agent asks who the user is.
        console.warn('⚠️  Could not load user identity:', err.message);
      }
    }

    // ============================================================================
    // 2.6. Load lead-gen form context (LEAD-GEN ONLY - NOT CACHEABLE)
    // ============================================================================

    let leadGenFormContext = null;
    let strategicContext = null;

    if (agentType === 'lead-gen') {
      console.log(`📝 Loading lead-gen form context...`);
      leadGenFormContext = await getLeadGenFormContext(conversationId);
      if (leadGenFormContext) {
        console.log(`✓ Injected lead form data and company background into system prompt`);

        // Load strategic context (one-time, cached)
        const { getStrategicContext } = await import('../utils/lead-gen-context.js');
        strategicContext = await getStrategicContext(conversationId);
      } else {
        console.log(`✓ No form context available (may be first message before form submission)`);
      }
    }

    // ============================================================================
    // 2.7. Get query-specific configuration (NEW: Performance Optimization)
    // ============================================================================

    // For lead-gen: load raw memories for stateful routing (estimate detection)
    let conversationMemoriesObject = null;
    if (agentType === 'lead-gen') {
      const { listMemories } = await import('../tools/memory.js');
      const memoriesResult = await listMemories(conversationId);
      if (memoriesResult.success && memoriesResult.memories.length > 0) {
        // Convert array of {key, value} to object {key: value}
        conversationMemoriesObject = {};
        memoriesResult.memories.forEach(mem => {
          conversationMemoriesObject[mem.key] = mem.value;
        });
      }
    }

    const queryConfig = forceModel
      ? getQueryConfigForModel(forceModel, modelConfig)
      : getQueryConfig(message, agentType, conversationMemoriesObject);
    logConfigDecision(queryConfig, message);

    // Extract configuration values
    const MODEL = queryConfig.model;
    const MAX_TOKENS = queryConfig.maxTokens;
    const THINKING_CONFIG = queryConfig.thinking;
    const TEMPERATURE = queryConfig.temperature;
    const MAX_AGENT_LOOPS = queryConfig.maxIterations;

    // ============================================================================
    // 3. Load conversation history from database
    // ============================================================================

    console.log(`💬 Loading conversation history...`);
    const {
      getConversationMessages,
      getLeadGenMessages,
      getCompactionSummary,
      saveCompactionSummary,
      deleteOldMessages
    } = await import('../database/messages.js');

    // Get max turns for this agent (cost optimization)
    const maxTurns = getMaxTurnsForAgent(agentType);
    const maxMessages = maxTurns * 2; // Each turn = user + assistant message

    // Use specialized retrieval for lead-gen (reads from lead_gen_conversations.messages JSONB)
    let history;
    if (agentType === 'lead-gen') {
      history = await getLeadGenMessages(conversationId, maxMessages);
    } else {
      history = await getConversationMessages(conversationId, maxMessages);
    }
    console.log(`✓ Retrieved ${history.length} messages for conversation ${conversationId}`);

    // ============================================================================
    // 3.5. Strip thinking blocks and tool search results from historical
    //      assistant messages (historyForRequest)
    // ============================================================================
    // Earlier turns' thinking is optional to send back, and a search result can't
    // be sent without the server_tool_use that messages.js drops on reload.
    // Reference: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking

    history = historyForRequest(history);

    console.log(`✓ Loaded ${history.length} previous messages (max: ${maxMessages})`);

    // ============================================================================
    // 3.6. AUTO-COMPACTION: Check if conversation needs summarization
    // ============================================================================

    // Load existing summary if any
    const existingSummary = await getCompactionSummary(conversationId);

    // Check if compaction is needed
    const { shouldCompact, compactConversation, formatSummary } = await import('../utils/conversation-compaction.js');
    const { needsCompaction, estimatedTokens } = shouldCompact(history, existingSummary);

    let conversationSummary = existingSummary;

    if (needsCompaction) {
      console.log(`🗜️  Conversation exceeds threshold (${estimatedTokens.toLocaleString()} tokens) - triggering auto-compaction`);

      // Compact the conversation
      const compactionResult = await compactConversation(history, agentType);

      if (compactionResult.summarizedCount > 0) {
        // Save the summary to database
        await saveCompactionSummary(
          conversationId,
          compactionResult.summary,
          compactionResult.metadata
        );

        // Delete old messages from database (keep only recent ones)
        await deleteOldMessages(conversationId, compactionResult.keptMessages.length);

        // Update conversation history to use only kept messages
        history = compactionResult.keptMessages;
        conversationSummary = {
          content: compactionResult.summary,
          metadata: compactionResult.metadata
        };

        console.log(`✓ Compaction complete: ${compactionResult.summarizedCount} messages summarized, ${history.length} kept`);
      }
    }

    // Add summary to system blocks if it exists (will be prepended to memories)
    let summaryForSystem = null;
    if (conversationSummary) {
      summaryForSystem = formatSummary(conversationSummary.content);
      console.log(`✓ Including conversation summary (${Math.ceil(conversationSummary.content.length / 4).toLocaleString()} tokens estimated)`);
    }

    // ============================================================================
    // 4. Build user message with attachments
    // ============================================================================

    const userContent = [];
    // Blocks built from ephemeral attachments (Chat files), by index: the model
    // gets their text this turn, the database gets a placeholder.
    const ephemeralBlocks = new Map();

    // Add attachments (images/PDFs/documents) - these go first
    for (const attachment of attachments) {
      if (attachment.type === 'image') {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mimeType,
            data: attachment.data
          }
        });
        console.log(`📷 Added image attachment: ${attachment.mimeType}`);
      } else if (attachment.type === 'pdf') {
        userContent.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: attachment.data
          }
        });
        console.log(`📄 Added PDF attachment`);
      } else if (attachment.type === 'csv_text') {
        // CSV from XLSX conversion - send as plain text (simple and fast)
        userContent.push({
          type: 'text',
          text: `[File: ${attachment.filename}]\n\n${attachment.content}`
        });
        console.log(`📊 Added CSV text from ${attachment.filename} (${attachment.content.length} chars)`);
      } else if (attachment.type === 'docx_text') {
        // DOCX text extraction - send as plain text (Messages API doesn't support DOCX)
        userContent.push({
          type: 'text',
          text: attachment.content
        });
        console.log(`📝 Added DOCX text from ${attachment.filename} (${attachment.content.length} chars)`);
      } else if (attachment.type === 'text_file') {
        // Plain text file content - send as text block
        if (attachment.ephemeral) ephemeralBlocks.set(userContent.length, attachment.filename);
        userContent.push({
          type: 'text',
          text: attachment.content
        });
        console.log(`📝 Added text file ${attachment.filename} (${attachment.content.length} chars)`);
      } else if (attachment.type === 'document') {
        // PDF documents use file_id from Files API
        // (Only PDFs are supported as document type in Messages API)
        const docBlock = {
          type: 'document',
          source: {
            type: 'file',
            file_id: attachment.fileId
          }
        };

        // Add title if filename is available
        if (attachment.filename) {
          docBlock.title = attachment.filename;
        }

        userContent.push(docBlock);
        console.log(`📝 Added document attachment via Files API: ${attachment.fileId} (${attachment.filename || attachment.mimeType})`);
      }
    }

    // Add text message
    userContent.push({
      type: 'text',
      text: message
    });

    // What is saved for this turn: identical, except ephemeral attachment text is
    // replaced by a placeholder, so Chat files are never stored.
    const userContentForStorage = userContentToStore(userContent, ephemeralBlocks);

    // ============================================================================
    // Build messages array
    // ============================================================================

    // CACHING NOTE: The cached prefix is built bottom-up via Anthropic's render
    // order (tools -> system -> messages):
    // 1. The tools array is cached transitively — it renders BEFORE the system
    //    blocks, so the cache_control on systemBlocks[0] (below) already caches
    //    the whole tools array + base prompt as one prefix. Tools do NOT need
    //    their own breakpoint.
    // 2. systemBlocks[0] (base prompt) carries the prefix breakpoint (1h for
    //    Oracle, 5m for other agents — see baseAgentPromptCache); the dynamic
    //    system blocks (summary/memories/learning) sit after it and are uncached.
    // 3. The message history below now carries ROLLING cache_control breakpoints,
    //    applied at the apiParams build site via withMessageCacheBreakpoints().
    //    This is what lets the agentic loop and multi-turn history amortize
    //    instead of re-billing the full uncached history every iteration.
    // The `messages` array itself stays unmarked here — breakpoints are applied
    // to a cloned copy at request time so cache_control never leaks into the DB.

    let messages = [
      ...history,
      { role: 'user', content: userContent }
    ];

    console.log(`✓ Message constructed with ${attachments.length} attachments`);

    // ============================================================================
    // 5. Get tools for this agent
    // ============================================================================

    const tools = withToolSearch(toolsForRun(agentType, allowedTools), { agentType, model: MODEL, allowedTools });
    const deferredCount = tools.filter(t => t.defer_loading).length;
    console.log(`🔧 Loaded ${tools.length} tools for agent${allowedTools ? ' (restricted for this run)' : ''}${deferredCount ? ` (${deferredCount} on demand via tool search)` : ''}`)

    // ============================================================================
    // 6. Agent execution loop
    // ============================================================================

    let loopCount = 0;
    let accumulatedText = ''; // Track text across ALL iterations (fixes greeting loss bug)
    let hasUnstreamedText = false; // Track if accumulated text from tool_use needs to be streamed
    let userMessageSaved = false; // Track whether the initial user message has been persisted

    while (loopCount < MAX_AGENT_LOOPS) {
      loopCount++;
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`🔄 Agent loop iteration ${loopCount}/${MAX_AGENT_LOOPS}`);
      console.log('─'.repeat(80));

      // Send loop status to frontend
      sendSSE(res, {
        type: 'loop_iteration',
        iteration: loopCount,
        sessionId
      });

      // Call Claude API with streaming
      console.log(`📡 Calling Claude API...`);

      // ============================================================================
      // Build system blocks (CACHE FIX: Separate cacheable from non-cacheable)
      // ============================================================================
      // Only the base agent prompt is cached (shared across all conversations)
      // Summary, memories, and learning are conversation/user-specific (NOT cached)
      // This prevents creating a new cache for every conversation

      const systemBlocks = [
        {
          type: 'text',
          text: baseAgentPrompt,
          // ✅ CACHED (reused across conversations): base prompt + the tools
          // that render before it, as one prefix. 1h for Oracle, 5m otherwise
          // (baseAgentPromptCache). The rolling message breakpoints stay 5m, and
          // the API requires the longer TTL first, which render order gives.
          cache_control: baseAgentPromptCache(agentType)
        }
      ];

      // Every agent gets the untrusted-data rule. Appended AFTER block 0 so the
      // cached prefix stays byte-identical and prompt caching is unaffected.
      systemBlocks.push({
        type: 'text',
        text: UNTRUSTED_DATA_INSTRUCTION
      });

      // Add conversation summary (if present) - NOT CACHED
      // Summary contains condensed history of old messages
      if (summaryForSystem) {
        systemBlocks.push({
          type: 'text',
          text: summaryForSystem  // ❌ NOT CACHED (conversation-specific)
        });
      }

      // Add conversation memories (if present) - NOT CACHED
      if (memories) {
        systemBlocks.push({
          type: 'text',
          text: memories  // ❌ NOT CACHED (conversation-specific)
        });
      }

      // Add learning memory (if present) - NOT CACHED
      if (learningMemory) {
        systemBlocks.push({
          type: 'text',
          text: learningMemory  // ❌ NOT CACHED (user-specific)
        });
      }

      // Team notes from /learn-this - NOT CACHED (change whenever a lesson is saved)
      if (teamNotes) {
        systemBlocks.push({ type: 'text', text: teamNotes });
      }

      // Add lead-gen form context (if present) - NOT CACHED
      if (leadGenFormContext) {
        systemBlocks.push({
          type: 'text',
          text: leadGenFormContext  // ❌ NOT CACHED (conversation-specific)
        });
        console.log(`🔍 DEBUG: Lead-gen context injected into system prompt:\n${leadGenFormContext}`);
      }

      // Add strategic context (if present) - NOT CACHED
      if (strategicContext) {
        systemBlocks.push({
          type: 'text',
          text: strategicContext  // ❌ NOT CACHED (conversation-specific, one-time lookup)
        });
        console.log(`🔍 DEBUG: Strategic context injected into system prompt (${strategicContext.length} chars)`);
      }

      // Add signed-in user identity (if resolved) - NOT CACHED
      // Placed after the cached base prompt so it never invalidates the cached
      // prefix, matching how summary/memories/learning-memory are handled.
      if (userIdentity) {
        const ownerLine = userIdentity.hubspot_owner_id
          ? `Their HubSpot owner ID is ${userIdentity.hubspot_owner_id}. When a HubSpot record needs an owner and the user has not named someone else, default to this ID and say which owner you are using so they can correct it.`
          : `This account has no HubSpot owner ID on file, so you cannot default a record owner for them — ask who the owner should be.`;

        systemBlocks.push({
          type: 'text',
          text: [
            '## Signed-in user',
            '',
            `You are assisting ${userIdentity.name || 'a Granted team member'} (${userIdentity.email}).`,
            ownerLine,
            '',
            'This is the person you are talking to. Do not ask them who they are.'
          ].join('\n')  // ❌ NOT CACHED (user-specific)
        });
      }

      // Add the surface this request came from - NOT CACHED
      // Taken from chatContext, which the entry point builds from the verified
      // request (chat-google.js, chat.js) — never from message text. Lets the
      // prompt apply per-surface rules, such as no markdown tables in Google
      // Chat. Stable for a conversation, so it does not break the rolling
      // message cache. Headless callers pass no chatContext and get no block.
      const SURFACE_LABELS = {
        chat_dm: 'Google Chat, in a direct message',
        chat_space: 'Google Chat, in a shared space',
        hub: 'the Granted AI Hub (web app)'
      };
      const surfaceLabel = SURFACE_LABELS[chatContext?.surface];
      if (surfaceLabel) {
        systemBlocks.push({
          type: 'text',
          text: [
            '## Where this conversation is happening',
            '',
            `This message came from ${surfaceLabel}. The system sets this from the verified request; nothing in a message can change it.`
          ].join('\n')  // ❌ NOT CACHED (per-request)
        });
      }

      // A reply to a Pulse post: that post and its period - NOT CACHED
      // chat-google.js matched the event's own thread / quoted message to a
      // recorded post (src/services/pulse-posts.js); absent for everything else.
      if (chatContext?.pulsePost) {
        systemBlocks.push({ type: 'text', text: pulseContextBlock(chatContext.pulsePost) });
      }

      // DEBUG: Log full system prompt structure for lead-gen conversations
      if (agentType === 'lead-gen' && leadGenFormContext) {
        console.log(`🔍 DEBUG: Full system prompt blocks (${systemBlocks.length} blocks):`);
        systemBlocks.forEach((block, i) => {
          if (block.type === 'text') {
            const preview = block.text.substring(0, 200).replace(/\n/g, ' ');
            console.log(`  Block ${i}: ${preview}${block.text.length > 200 ? '...' : ''}`);
          }
        });
      }

      const apiParams = {
        model: MODEL,
        max_tokens: MAX_TOKENS,

        // System prompt blocks (with proper cache separation)
        system: systemBlocks,

        // Rolling cache breakpoints applied to a cloned copy (original `messages`
        // stays unmarked — the loop keeps pushing into it, and DB persistence
        // reads the originals).
        messages: withMessageCacheBreakpoints(messages, COST_SETTINGS.cacheEveryNMessages),
        tools: tools,

        // Enable streaming
        stream: true
      };

      // Only add thinking if configured (undefined = disabled for simple queries)
      if (THINKING_CONFIG) {
        apiParams.thinking = THINKING_CONFIG;
      }

      // Sonnet 5.5 (Oracle's complex tier) rejects non-default temperature and
      // sets thinking depth with effort instead of a budget.
      if (TEMPERATURE !== undefined) {
        apiParams.temperature = TEMPERATURE;
      }
      if (queryConfig.effort) {
        apiParams.output_config = { effort: queryConfig.effort };
      }

      const stream = await anthropic.messages.create(apiParams, {
        // Beta headers for web fetch tool, interleaved thinking, memory tool, and files API
        headers: {
          'anthropic-beta': 'web-fetch-2025-09-10,interleaved-thinking-2025-05-14,context-management-2025-06-27,files-api-2025-04-14'
        }
      });

      // Stream response to frontend and collect full response
      const fullResponse = await streamToSSE(stream, res, sessionId, agentType, conversationId);

      console.log(`✓ Response received - stop_reason: ${fullResponse.stop_reason}`);

      // CRITICAL FIX: For lead-gen, only accumulate text from FINAL iteration (end_turn)
      // This prevents tool narration like "Let me search..." from bleeding into responses
      // For other agents, preserve old behavior (accumulate from all iterations)
      const iterationText = fullResponse.content
        .filter(block => block.type === 'text' && block.text && block.text.trim())
        .map(block => block.text)
        .join('\n');

      if (iterationText) {
        if (agentType === 'lead-gen') {
          // Lead-gen: Save text from final iteration OR from tool_use if it's substantive (200+ chars)
          const isEndTurn = fullResponse.stop_reason === 'end_turn';
          const isSubstantiveToolText = fullResponse.stop_reason === 'tool_use' && iterationText.length >= 200;

          if (isEndTurn || isSubstantiveToolText) {
            // Substantive text: accumulate it (likely the actual response, not narration)
            if (isEndTurn) {
              accumulatedText = iterationText; // Replace (final text)
              hasUnstreamedText = false; // end_turn text is already streamed by streamToSSE
            } else {
              // Append substantive tool text (NOT streamed yet - will be flushed before done event)
              if (accumulatedText) {
                accumulatedText += '\n' + iterationText;
              } else {
                accumulatedText = iterationText;
              }
              hasUnstreamedText = true; // Mark that we have unstreamed text from tool_use
            }

            // Apply regex safety net to strip any remaining narration patterns
            const cleaned = stripToolNarration(accumulatedText);
            if (cleaned !== accumulatedText) {
              console.log(`  🧹 Stripped ${accumulatedText.length - cleaned.length} chars of narration (safety net)`);
              accumulatedText = cleaned;
            }

            // Convert markdown to HTML (safety net for formatting)
            const htmlConverted = convertMarkdownToHtml(accumulatedText);
            if (htmlConverted !== accumulatedText) {
              console.log(`  🎨 Converted markdown to HTML (safety net)`);
              accumulatedText = htmlConverted;
            }

            console.log(`  📝 ${isEndTurn ? 'Final' : 'Substantive'} text: ${iterationText.length} chars (accumulated: ${accumulatedText.length})`);
          } else {
            console.log(`  🔇 Skipping short tool narration: ${iterationText.length} chars (stop_reason: ${fullResponse.stop_reason})`);
          }
        } else {
          // Other agents: preserve old behavior (accumulate from all iterations)
          if (accumulatedText) {
            accumulatedText += '\n' + iterationText;
          } else {
            accumulatedText = iterationText;
          }
          console.log(`  📝 Accumulated ${iterationText.length} chars of text (total: ${accumulatedText.length})`);
        }
      }

      // ============================================================================
      // Cost monitoring and logging
      // ============================================================================

      if (fullResponse.usage) {
        const usage = fullResponse.usage;
        const cost = logAPICost({
          usage,
          model: MODEL,
          source: 'agent-loop',
          agentType,
          conversationId,
          // Both were already in scope and simply weren't passed, which left
          // api_cost_events.user_id permanently NULL — no call site anywhere
          // supplies user identity. This is the only path that can, so
          // per-user cost attribution depends on these two lines.
          // userIdentity is null when the lookup failed or the caller is
          // unauthenticated (lead-gen); userId is null for lead-gen by design.
          userId,
          userEmail: userIdentity?.email || null
        });

        // Warn if cost is unusually high
        if (shouldWarnAboutCost(cost)) {
          console.warn(`⚠️  HIGH COST ALERT: Request cost ($${cost.toFixed(2)}) exceeds threshold ($${COST_SETTINGS.monitoring.warnThreshold})`);
          console.warn(`   Agent: ${agentType}, Model: ${MODEL}, Conversation: ${conversationId}`);
        }

        // Call cost callback if provided (for cost tracking in lead-gen)
        if (onCostCalculated && typeof onCostCalculated === 'function') {
          try {
            await onCostCalculated(cost);
          } catch (callbackError) {
            console.error('⚠️  Cost callback error:', callbackError.message);
          }
        }
      }

      // ============================================================================
      // Handle stop reason
      // ============================================================================

      // CASE 1: Normal completion (end_turn)
      if (fullResponse.stop_reason === 'end_turn') {
        console.log('✅ Agent completed successfully (end_turn)');

        // Save content (including thinking blocks, but filter out empty text blocks)
        // Extended thinking requires thinking blocks to be present in conversation history
        // for proper context in subsequent turns
        const contentToSave = fullResponse.content.filter(block => {
          // Remove empty text blocks that would cause API errors when loaded
          if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
            return false;
          }
          return true;
        });

        // Save final messages to database
        if (agentType === 'lead-gen') {
          // Lead-gen: save to lead_gen_conversations.messages JSONB array
          // CRITICAL: Use accumulated text from ALL iterations, not just final iteration
          const userText = typeof message === 'string' ? message : JSON.stringify(message);
          let assistantText = accumulatedText || ''; // Use accumulated text across all iterations

          if (!assistantText || assistantText.trim() === '') {
            console.warn('⚠️  Empty assistant response detected - injecting fallback message');

            // Get contact name from form data for personalization
            const { query } = await import('../database/connection.js');
            const formResult = await query(
              'SELECT contact_name FROM lead_gen_conversations WHERE session_id = $1',
              [conversationId]
            );
            const contactName = formResult.rows[0]?.contact_name || 'there';

            // Inject fallback message
            assistantText = `Hey ${contactName} — thanks for filling that out! I'm pulling together your funding estimate now. Give me just a moment and I'll have your personalized breakdown ready.`;

            // Stream fallback to frontend
            sendSSE(res, { type: 'text_delta', text: assistantText });
            sendSSE(res, { type: 'message_complete' });
          }

          const { appendLeadGenMessages } = await import('../api/lead-gen.js');
          await appendLeadGenMessages(conversationId, userText, assistantText);
          console.log(`✓ Messages saved to database (${assistantText.length} chars from ${loopCount} iterations)`);
        } else {
          // Standard agents: save to messages table
          // User message may already have been saved during a tool-use iteration;
          // only save it here if no tool loop ran (direct end_turn on first iteration).
          const { saveMessage } = await import('../database/messages.js');
          if (!userMessageSaved) {
            await saveMessage(conversationId, 'user', userContentForStorage);
            userMessageSaved = true;
          }
          await saveMessage(conversationId, 'assistant', contentToSave);
          console.log('✓ Messages saved to database');
        }

        // Flush any unstreamed accumulated text before sending done event.
        // Apply booking-link sentinel substitution here too — substantive
        // tool-narration text can contain the sentinel for Pro/Pro Waitlist
        // leads, same hard-fail contract as the end_turn flush in streamToSSE.
        if (agentType === 'lead-gen' && hasUnstreamedText && accumulatedText && accumulatedText.trim()) {
          console.log(`📤 Flushing unstreamed accumulated text (${accumulatedText.length} chars) before done event`);
          let flushText = accumulatedText;
          try {
            flushText = await applyChatBookingSubstitution(accumulatedText, conversationId);
          } catch (subErr) {
            if (subErr instanceof BookingLinkRoutingError) {
              console.error(
                `[BOOKING-LINK-FAILURE] chat-flush (unstreamed) — refusing to ship sentinel. conversationId=${conversationId}, best_fit_product=${subErr.context?.best_fit_product}, industry=${subErr.context?.industry}, reason=${subErr.context?.reason}, message="${subErr.message}"`
              );
              sendSSE(res, { type: 'error', error: 'Something went wrong, please try again.' });
              closeSSE(res);
              throw subErr;
            }
            throw subErr;
          }
          sendSSE(res, { type: 'text_delta', text: flushText });
          sendSSE(res, { type: 'message_complete' });
        }

        // Send completion event
        closeSSE(res);

        console.log('\n' + '='.repeat(80));
        console.log('🎉 Agent execution completed successfully');
        console.log('='.repeat(80) + '\n');

        return {
          success: true,
          response: fullResponse,
          iterations: loopCount
        };
      }

      // CASE 2: Tool use required
      if (fullResponse.stop_reason === 'tool_use') {
        console.log('🔧 Agent requested tool use');

        // Thinking blocks go back exactly as received — see assistantTurnForToolLoop
        messages.push({
          role: 'assistant',
          content: assistantTurnForToolLoop(fullResponse.content)
        });

        // Extract and execute tool calls
        const toolResults = [];
        const toolNamesById = new Map();
        for (const block of fullResponse.content) {
          if (block.type === 'tool_use') {
            console.log(`\n  🛠️  Tool: ${block.name}`);
            console.log(`  📥 Input:`, JSON.stringify(block.input, null, 2));

            // Notify frontend of tool use
            sendSSE(res, {
              type: 'tool_use',
              toolId: block.id,
              toolName: block.name,
              input: block.input,
              sessionId
            });

            // Execute tool
            const result = await executeToolCall(
              block.name,
              block.input,
              conversationId,
              userId,  // Pass userId for domain-wide delegation
              agentType,  // Pass agentType for agent-specific tool behavior
              chatContext ? { chatContext } : {}  // INTERNAL ONLY — see executeToolCall
            );

            console.log(`  📤 Result:`, JSON.stringify(result, null, 2).substring(0, 200) + '...');

            // Notify frontend of tool result
            sendSSE(res, {
              type: 'tool_result',
              toolId: block.id,
              toolName: block.name,
              result,
              sessionId
            });

            // A gated tool was saved instead of run. The confirmation text is
            // written by code from the stored action (src/tools/pending-actions.js)
            // and streamed here, so the user approves the action itself rather
            // than the model's description of it. Streaming surfaces only: the
            // headless Chat path closes its own reply and appends the same
            // summary in src/api/chat-google.js.
            if (res && result?.awaiting_confirmation && result.summary) {
              sendSSE(res, {
                type: 'text_delta',
                text: `\n\n**Confirm before I run this:**\n${result.summary}\n\nReply "yes" and I'll do exactly that.\n\n`
              });
            }

            // Standard tool result, wrapped in an untrusted-data envelope so the
            // model can tell retrieved content from what the team actually said.
            // Labelling only — nothing is stripped (src/claude/tool-output.js).
            toolNamesById.set(block.id, block.name);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: wrapToolOutput(block.name, result)
            });
          }
        }

        console.log(`✓ Executed ${toolResults.length} tool calls`);

        // CRITICAL: Validate that toolResults is not empty before adding to messages
        // If stop_reason is tool_use but no tool_use blocks found, this is an error state
        if (toolResults.length === 0) {
          console.error('❌ CRITICAL ERROR: stop_reason is tool_use but no tool_use blocks found in response content');
          console.error('   Response content blocks:', fullResponse.content.map(b => ({ type: b.type, hasText: b.type === 'text' && !!b.text })));

          // Send error to frontend
          sendSSE(res, {
            type: 'error',
            message: 'Agent requested tools but no valid tool calls were found. Please try again.',
            sessionId
          });

          closeSSE(res);

          throw new Error('stop_reason is tool_use but no tool_use blocks found in response');
        }

        // Add tool results to messages
        messages.push({
          role: 'user',
          content: toolResults
        });

        // Persist tool-loop messages to database in real time so post-hoc
        // debugging can reconstruct the full tool trace. Two writes per
        // iteration: the assistant message (tool_use + any text blocks)
        // and the user message (tool_result blocks).
        if (agentType !== 'lead-gen') {
          try {
            const { saveMessage } = await import('../database/messages.js');

            // Save user's initial message on first tool iteration (only once)
            if (!userMessageSaved) {
              await saveMessage(conversationId, 'user', userContentForStorage);
              userMessageSaved = true;
            }

            // Save the full assistant response for this iteration, including
            // thinking blocks and tool_use blocks — everything except empty text
            const toolTurnContent = fullResponse.content
              .filter(block => {
                if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
                  return false;
                }
                return true;
              })
              .map(block => {
                const { index, ...cleanBlock } = block;
                return cleanBlock;
              });
            await saveMessage(conversationId, 'assistant', toolTurnContent);

            // Save the tool results — except Chat attachment text, which is never
            // stored: the model has it for this turn, the database gets a note.
            await saveMessage(conversationId, 'user', toolResultsToStore(toolResults, toolNamesById));

            console.log(`✓ Tool-loop messages persisted to database`);
          } catch (dbError) {
            // Non-fatal: log but don't break the agent loop
            console.error('⚠️  Failed to persist tool-loop messages:', dbError.message);
          }
        }

        // Continue to next loop iteration
        continue;
      }

      // CASE 3: Max tokens reached
      if (fullResponse.stop_reason === 'max_tokens') {
        console.warn('⚠️  Agent hit max_tokens limit');

        sendSSE(res, {
          type: 'warning',
          message: 'Response truncated due to length limit',
          sessionId
        });

        // Save what we have (including thinking blocks, but filter out empty text blocks)
        const contentToSave = fullResponse.content.filter(block => {
          if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
            return false;
          }
          return true;
        });

        if (agentType === 'lead-gen') {
          const userText = typeof message === 'string' ? message : JSON.stringify(message);
          let assistantText = accumulatedText || ''; // Use accumulated text

          if (!assistantText || assistantText.trim() === '') {
            console.warn('⚠️  Empty assistant response detected (max_tokens) - injecting fallback message');

            // Get contact name from form data for personalization
            const { query } = await import('../database/connection.js');
            const formResult = await query(
              'SELECT contact_name FROM lead_gen_conversations WHERE session_id = $1',
              [conversationId]
            );
            const contactName = formResult.rows[0]?.contact_name || 'there';

            // Inject fallback message
            assistantText = `Hey ${contactName} — thanks for filling that out! I'm pulling together your funding estimate now. Give me just a moment and I'll have your personalized breakdown ready.`;

            // Stream fallback to frontend
            sendSSE(res, { type: 'text_delta', text: assistantText });
            sendSSE(res, { type: 'message_complete' });
          }

          const { appendLeadGenMessages } = await import('../api/lead-gen.js');
          await appendLeadGenMessages(conversationId, userText, assistantText);
        } else {
          const { saveMessage } = await import('../database/messages.js');
          if (!userMessageSaved) {
            await saveMessage(conversationId, 'user', userContentForStorage);
            userMessageSaved = true;
          }
          await saveMessage(conversationId, 'assistant', contentToSave);
        }

        // Flush any unstreamed accumulated text before sending done event
        if (agentType === 'lead-gen' && hasUnstreamedText && accumulatedText && accumulatedText.trim()) {
          console.log(`📤 Flushing unstreamed accumulated text (${accumulatedText.length} chars) before done event (max_tokens)`);
          sendSSE(res, { type: 'text_delta', text: accumulatedText });
          sendSSE(res, { type: 'message_complete' });
        }

        closeSSE(res);

        return {
          success: true,
          response: fullResponse,
          warning: 'max_tokens_reached',
          iterations: loopCount
        };
      }

      // CASE 4: Stop sequence encountered
      if (fullResponse.stop_reason === 'stop_sequence') {
        console.log('✓ Agent hit stop sequence');

        const contentToSave = fullResponse.content.filter(block => {
          if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
            return false;
          }
          return true;
        });

        if (agentType === 'lead-gen') {
          const userText = typeof message === 'string' ? message : JSON.stringify(message);
          let assistantText = accumulatedText || ''; // Use accumulated text

          if (!assistantText || assistantText.trim() === '') {
            console.warn('⚠️  Empty assistant response detected (stop_sequence) - injecting fallback message');

            // Get contact name from form data for personalization
            const { query } = await import('../database/connection.js');
            const formResult = await query(
              'SELECT contact_name FROM lead_gen_conversations WHERE session_id = $1',
              [conversationId]
            );
            const contactName = formResult.rows[0]?.contact_name || 'there';

            // Inject fallback message
            assistantText = `Hey ${contactName} — thanks for filling that out! I'm pulling together your funding estimate now. Give me just a moment and I'll have your personalized breakdown ready.`;

            // Stream fallback to frontend
            sendSSE(res, { type: 'text_delta', text: assistantText });
            sendSSE(res, { type: 'message_complete' });
          }

          const { appendLeadGenMessages } = await import('../api/lead-gen.js');
          await appendLeadGenMessages(conversationId, userText, assistantText);
        } else {
          const { saveMessage } = await import('../database/messages.js');
          if (!userMessageSaved) {
            await saveMessage(conversationId, 'user', userContentForStorage);
            userMessageSaved = true;
          }
          await saveMessage(conversationId, 'assistant', contentToSave);
        }

        // Flush any unstreamed accumulated text before sending done event
        if (agentType === 'lead-gen' && hasUnstreamedText && accumulatedText && accumulatedText.trim()) {
          console.log(`📤 Flushing unstreamed accumulated text (${accumulatedText.length} chars) before done event (stop_sequence)`);
          sendSSE(res, { type: 'text_delta', text: accumulatedText });
          sendSSE(res, { type: 'message_complete' });
        }

        closeSSE(res);

        return {
          success: true,
          response: fullResponse,
          iterations: loopCount
        };
      }

      // CASE 4b: The model declined (Sonnet 5.5 safety classifiers). HTTP 200
      // with stop_reason 'refusal'; without this branch the loop breaks and
      // runAgent returns undefined, which the Chat path can't post.
      if (fullResponse.stop_reason === 'refusal') {
        console.warn(`⚠️  Model declined the request (category: ${fullResponse.stop_details?.category ?? 'none'})`);

        const refusalText = "Sorry — I can't help with that request. Try rephrasing it, or ask a teammate.";
        const refusalContent = [{ type: 'text', text: refusalText }];

        if (agentType === 'lead-gen') {
          const userText = typeof message === 'string' ? message : JSON.stringify(message);
          const { appendLeadGenMessages } = await import('../api/lead-gen.js');
          await appendLeadGenMessages(conversationId, userText, refusalText);
        } else {
          const { saveMessage } = await import('../database/messages.js');
          if (!userMessageSaved) {
            await saveMessage(conversationId, 'user', userContentForStorage);
            userMessageSaved = true;
          }
          await saveMessage(conversationId, 'assistant', refusalContent);
        }

        sendSSE(res, { type: 'text_delta', text: refusalText, sessionId });
        sendSSE(res, { type: 'message_complete' });
        closeSSE(res);

        return {
          success: true,
          response: { ...fullResponse, content: refusalContent },
          iterations: loopCount
        };
      }

      // CASE 5: Unexpected stop reason
      console.error(`❌ Unexpected stop_reason: ${fullResponse.stop_reason}`);
      break;
    }

    // ============================================================================
    // Max loops exceeded
    // ============================================================================

    if (loopCount >= MAX_AGENT_LOOPS) {
      console.error(`❌ Agent exceeded maximum loop limit (${MAX_AGENT_LOOPS})`);

      // Save user message if it hasn't been saved yet (e.g., loop exhausted
      // on the very first iteration before any tool_use path ran).
      // Tool-loop iterations are already saved in real time by CASE 2.
      if (agentType !== 'lead-gen' && !userMessageSaved) {
        try {
          const { saveMessage } = await import('../database/messages.js');
          await saveMessage(conversationId, 'user', userContentForStorage);
          userMessageSaved = true;
          console.log('✓ User message saved before loop-exhaustion exit');
        } catch (dbError) {
          console.error('⚠️  Failed to save user message on loop exhaustion:', dbError.message);
        }
      }

      sendSSE(res, {
        type: 'error',
        error: `Agent exceeded maximum processing loops (${MAX_AGENT_LOOPS})`,
        sessionId
      });

      closeSSE(res);

      return {
        success: false,
        error: 'Max loops exceeded',
        iterations: loopCount
      };
    }

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Agent execution error:');
    console.error(error);
    console.error('='.repeat(80) + '\n');

    // Inner error paths (e.g. the stop_reason='tool_use' protocol guard) may have
    // already closed the SSE stream before throwing. Writing after end() crashes
    // the Node process with ERR_STREAM_WRITE_AFTER_END, so only emit if still open.
    if (res && !res.writableEnded) {
      sendSSE(res, {
        type: 'error',
        error: error.message,
        sessionId
      });

      closeSSE(res);
    }

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Estimate token count (rough approximation)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters for English
  return Math.ceil(text.length / 4);
}

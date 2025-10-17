/**
 * Claude Agent SDK Configuration
 * Centralized settings for all agent interactions
 */

export const agentSDKConfig = {
  // Model Configuration
  model: 'claude-sonnet-4-20250514', // Latest Sonnet 4.5
  fallbackModel: 'claude-3-5-sonnet-20241022', // Fallback if Sonnet 4.5 unavailable

  // Extended Thinking
  maxThinkingTokens: 10000, // Budget for internal reasoning
  includeThinking: false, // Whether to stream thinking content to client

  // Context & History
  conversationHistoryLimit: 10, // Number of previous messages to include
  maxTurns: 20, // Maximum turns per conversation

  // Streaming
  streamingEnabled: true,
  includePartialMessages: true, // Stream partial responses

  // Cost Optimization
  promptCaching: {
    enabled: true,
    minTokensForCache: 1024, // Minimum tokens required for caching
    cacheSystemPrompt: true, // Cache system prompts
    cacheKnowledgeBase: true, // Cache knowledge base documents
    cacheTTL: '5m', // Cache time-to-live: 5 minutes
  },

  // Tool Use Configuration
  toolUse: {
    enableParallelToolUse: true, // Allow multiple tool calls in single turn
    maxParallelTools: 5, // Maximum concurrent tool calls
    toolTimeout: 30000, // 30 second timeout per tool
  },

  // Tool Configuration
  tools: {
    // Default tools available to all agents
    default: [
      'Read',
      'Write',
      'Edit',
      'Bash',
      'Glob',
      'Grep',
      'WebSearch',
      'WebFetch',
      'TodoWrite',
      'Memory', // Cross-conversation memory persistence
    ],

    // Agent-specific tool restrictions
    // Read: Read knowledge base documents and uploaded files
    // Glob: Find files by pattern in knowledge base
    // Grep: Search content within documents
    // WebSearch: Research current information, alternatives, competitors
    // TodoWrite: Track multi-step workflow progress
    // Memory: Store and retrieve information across conversations
    // Write/Edit: Create or modify output files (when needed)

    'grant-card-generator': ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'TodoWrite', 'Memory'],
    'etg-writer': ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Memory'],
    'bcafe-writer': ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Memory'],
    'canexport-claims': ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'TodoWrite', 'Memory'],
    'orchestrator': ['Read', 'Glob', 'Grep', 'Agent', 'TodoWrite', 'Memory'], // Can spawn other agents
  },

  // Vision Support
  vision: {
    enabled: true,
    maxImageSize: 5 * 1024 * 1024, // 5MB max per image
    maxImagesPerRequest: 100,
    supportedFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  },

  // MCP Server Configuration
  mcpServers: {
    // Placeholder for Google Drive integration
    // 'google-drive': {
    //   type: 'sse',
    //   url: process.env.GOOGLE_DRIVE_MCP_URL,
    //   headers: {
    //     'Authorization': `Bearer ${process.env.GOOGLE_DRIVE_MCP_TOKEN}`
    //   }
    // }
  },

  // Error Handling
  errorHandling: {
    maxRetries: 3,
    retryDelay: 1000, // ms
    timeoutMs: 120000, // 2 minutes
  },

  // Permission Mode
  permissionMode: 'default', // 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

  // System Prompt Configuration
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code',
  },

  // Setting Sources (which config files to load)
  settingSources: ['project'], // Load .claude/CLAUDE.md

  // Memory Tool Configuration
  memory: {
    enabled: true,
    baseDir: '.memories', // Memory files stored in project root/.memories
  },

  // Beta Features
  betaHeaders: ['context-management-2025-06-27'], // Required for memory tool
};

/**
 * Get configuration for a specific agent type
 * @param {string} agentType - The agent type (e.g., 'etg-writer')
 * @returns {object} Agent-specific configuration
 */
export function getAgentConfig(agentType) {
  return {
    ...agentSDKConfig,
    allowedTools: agentSDKConfig.tools[agentType] || agentSDKConfig.tools.default,
  };
}

/**
 * Calculate estimated cost per request
 * @param {object} usage - Usage object from API response
 * @returns {number} Cost in USD
 */
export function calculateCost(usage) {
  const COST_PER_1K_INPUT = 0.003; // $3/million input tokens
  const COST_PER_1K_OUTPUT = 0.015; // $15/million output tokens
  const COST_PER_1K_CACHE_WRITE = 0.00375; // 1.25x input
  const COST_PER_1K_CACHE_READ = 0.0003; // 0.1x input

  const inputCost = (usage.input_tokens / 1000) * COST_PER_1K_INPUT;
  const outputCost = (usage.output_tokens / 1000) * COST_PER_1K_OUTPUT;
  const cacheWriteCost = ((usage.cache_creation_input_tokens || 0) / 1000) * COST_PER_1K_CACHE_WRITE;
  const cacheReadCost = ((usage.cache_read_input_tokens || 0) / 1000) * COST_PER_1K_CACHE_READ;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

/**
 * Validate if prompt caching is working
 * @param {object} usage - Usage object from API response
 * @returns {boolean} True if cache hit occurred
 */
export function isCacheHit(usage) {
  return (usage.cache_read_input_tokens || 0) > 0;
}

/**
 * Get cache statistics from usage
 * @param {object} usage - Usage object from API response
 * @returns {object} Cache statistics
 */
export function getCacheStats(usage) {
  return {
    cacheHit: isCacheHit(usage),
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    cacheWriteTokens: usage.cache_creation_input_tokens || 0,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheEfficiency: usage.cache_read_input_tokens
      ? (usage.cache_read_input_tokens / (usage.input_tokens + usage.cache_read_input_tokens)) * 100
      : 0,
  };
}

export default agentSDKConfig;

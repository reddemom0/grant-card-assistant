/**
 * Cost Optimization Settings
 *
 * Centralized configuration for cost-saving features:
 * - Conversation limits
 * - Caching strategy
 * - Cost monitoring thresholds
 */

export const COST_SETTINGS = {
  // ============================================================================
  // CONVERSATION LIMITS
  // ============================================================================
  // Maximum number of turns (user+assistant pairs) to load from history
  // This prevents runaway token costs on very long conversations
  // 30 turns = 60 messages, which is 3x longer than typical usage

  maxTurns: {
    'grant-cards': 30,
    'etg-writer': 30,
    'bcafe-writer': 30,
    'buybc-writer': 30,
    'canexport-claims': 30,
    'canexport-writer': 30,
    'readiness-strategist': 30,
    'internal-oracle': 40,  // Research conversations can be longer
    'default': 30
  },

  // ============================================================================
  // CACHING STRATEGY
  // ============================================================================
  // How often to mark messages for Anthropic's prompt caching
  // Caching reduces cost from $3/M to $0.30/M for cached content
  // Cache every 5 messages creates checkpoints without over-fragmenting

  cacheEveryNMessages: 5,

  // ============================================================================
  // COST MONITORING
  // ============================================================================
  // Thresholds for logging warnings/alerts about high costs

  monitoring: {
    // Warn in logs if a single request costs more than this
    warnThreshold: 0.50,  // $0.50 per request

    // Send alert if hourly cost exceeds this (future feature)
    hourlyAlertThreshold: 10.00,  // $10/hour

    // Send alert if daily cost exceeds this (future feature)
    dailyAlertThreshold: 50.00  // $50/day
  }
};

/**
 * Get max turns for an agent type
 * @param {string} agentType - Agent type identifier
 * @returns {number} Maximum turns to load
 */
export function getMaxTurnsForAgent(agentType) {
  return COST_SETTINGS.maxTurns[agentType] || COST_SETTINGS.maxTurns.default;
}

/**
 * Calculate approximate cost of a request
 * @param {Object} usage - Token usage from Claude API
 * @param {string} model - Model identifier
 * @returns {number} Cost in USD
 */
export function calculateRequestCost(usage, model) {
  if (!usage) return 0;

  // Pricing per million tokens (as of Jan 2026)
  let inputPrice, cacheWritePrice, cacheReadPrice, outputPrice;

  if (model.includes('sonnet-4-5')) {
    inputPrice = 3.00;
    cacheWritePrice = 3.75;
    cacheReadPrice = 0.30;
    outputPrice = 15.00;
  } else if (model.includes('haiku-4-5')) {
    inputPrice = 1.00;
    cacheWritePrice = 1.25;
    cacheReadPrice = 0.10;
    outputPrice = 5.00;
  } else if (model.includes('3-5-haiku')) {
    inputPrice = 0.80;
    cacheWritePrice = 1.00;
    cacheReadPrice = 0.08;
    outputPrice = 4.00;
  } else if (model.includes('3-haiku')) {
    inputPrice = 0.25;
    cacheWritePrice = 0.30;
    cacheReadPrice = 0.03;
    outputPrice = 1.25;
  } else {
    // Default to Sonnet pricing
    inputPrice = 3.00;
    cacheWritePrice = 3.75;
    cacheReadPrice = 0.30;
    outputPrice = 15.00;
  }

  const inputCost = (usage.input_tokens || 0) * inputPrice / 1_000_000;
  const cacheWriteCost = (usage.cache_creation_input_tokens || 0) * cacheWritePrice / 1_000_000;
  const cacheReadCost = (usage.cache_read_input_tokens || 0) * cacheReadPrice / 1_000_000;
  const outputCost = (usage.output_tokens || 0) * outputPrice / 1_000_000;

  return inputCost + cacheWriteCost + cacheReadCost + outputCost;
}

/**
 * Check if cost exceeds warning threshold
 * @param {number} cost - Cost in USD
 * @returns {boolean} True if cost is high
 */
export function shouldWarnAboutCost(cost) {
  return cost >= COST_SETTINGS.monitoring.warnThreshold;
}

/**
 * Centralized Cost Logger
 *
 * Tracks ALL Anthropic API costs with detailed context
 * Ensures no API call goes unlogged
 */

import { calculateRequestCost } from '../config/cost-settings.js';

/**
 * Log an API request cost with full context
 * @param {Object} params - Logging parameters
 * @param {Object} params.usage - Token usage from Claude response
 * @param {string} params.model - Model used (e.g., 'claude-sonnet-4-6')
 * @param {string} params.source - Source of the call (e.g., 'agent', 'title-generation', 'webhook')
 * @param {string} [params.agentType] - Agent type if applicable
 * @param {string} [params.conversationId] - Conversation ID if applicable
 * @param {string} [params.userId] - User ID if applicable
 * @param {string} [params.userEmail] - User email if applicable
 * @param {Object} [params.metadata] - Additional metadata
 */
export function logAPICost({ usage, model, source, agentType, conversationId, userId, userEmail, metadata = {} }) {
  if (!usage) {
    console.warn('⚠️  [Cost Logger] No usage data provided');
    return;
  }

  const cost = calculateRequestCost(usage, model);

  // Build context string
  const contextParts = [];
  if (source) contextParts.push(`Source: ${source}`);
  if (agentType) contextParts.push(`Agent: ${agentType}`);
  if (conversationId) contextParts.push(`Conversation: ${conversationId.substring(0, 8)}...`);
  if (userEmail) contextParts.push(`User: ${userEmail}`);
  else if (userId) contextParts.push(`UserID: ${userId}`);

  // Add any additional metadata
  Object.entries(metadata).forEach(([key, value]) => {
    if (value) contextParts.push(`${key}: ${value}`);
  });

  const context = contextParts.length > 0 ? ` | ${contextParts.join(', ')}` : '';

  // Log with clear formatting
  console.log(`💰 [API Cost] $${cost.toFixed(4)} | Model: ${model}${context}`);
  console.log(`   📊 Tokens: Input=${usage.input_tokens || 0}, Output=${usage.output_tokens || 0}, ` +
              `Cache_Create=${usage.cache_creation_input_tokens || 0}, Cache_Read=${usage.cache_read_input_tokens || 0}`);

  // Calculate cache savings if applicable
  if (usage.cache_read_input_tokens > 0) {
    const totalInput = (usage.input_tokens || 0) +
                      (usage.cache_creation_input_tokens || 0) +
                      (usage.cache_read_input_tokens || 0);
    const cacheHitRate = (usage.cache_read_input_tokens / totalInput) * 100;
    console.log(`   💾 Cache Hit Rate: ${cacheHitRate.toFixed(1)}%`);
  }

  // Return cost for potential aggregation
  return cost;
}

/**
 * Log a batch of API costs (for summarization)
 * @param {Array} costs - Array of cost log entries
 */
export function logBatchCosts(costs) {
  if (!costs || costs.length === 0) return;

  const totalCost = costs.reduce((sum, c) => sum + c.cost, 0);
  const totalRequests = costs.length;

  console.log('\n' + '='.repeat(80));
  console.log(`📊 BATCH API COST SUMMARY: ${totalRequests} requests = $${totalCost.toFixed(4)}`);
  console.log('='.repeat(80));

  // Group by source
  const bySource = {};
  costs.forEach(c => {
    const source = c.source || 'unknown';
    if (!bySource[source]) bySource[source] = { count: 0, cost: 0 };
    bySource[source].count++;
    bySource[source].cost += c.cost;
  });

  Object.entries(bySource).forEach(([source, stats]) => {
    console.log(`  ${source.padEnd(30)} ${stats.count.toString().padStart(3)} requests  $${stats.cost.toFixed(4)}`);
  });

  console.log('='.repeat(80) + '\n');
}

/**
 * Create a cost tracking wrapper for API calls
 * Useful for wrapping Claude API calls to auto-log costs
 *
 * @param {string} source - Source identifier
 * @param {Object} context - Context to include in logs
 * @returns {Function} Wrapper function
 */
export function createCostTracker(source, context = {}) {
  return (usage, model, additionalContext = {}) => {
    return logAPICost({
      usage,
      model,
      source,
      ...context,
      ...additionalContext
    });
  };
}

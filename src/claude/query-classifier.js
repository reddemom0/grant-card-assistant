/**
 * Query Classification System
 *
 * Determines optimal model and configuration based on query complexity.
 *
 * CONSERVATIVE APPROACH:
 * - Only classifies queries as "simple" when we're VERY confident
 * - Defaults to "complex" (Sonnet + Extended Thinking) when uncertain
 * - Preserves full AI power for any query that might need it
 */

/**
 * Classify query complexity
 * @param {string} message - User's query
 * @param {string} agentType - Type of agent handling the query
 * @returns {'simple'|'complex'} Query classification
 */
export function classifyQuery(message, agentType) {
  const lowerMessage = message.toLowerCase();

  // ============================================================================
  // COMPLEX PATTERNS - These ALWAYS need full power (Sonnet + Extended Thinking)
  // ============================================================================

  const complexPatterns = [
    // Analysis & Reasoning
    /\b(analyze|analyse|assessment|evaluate|review|examine)\b/i,
    /\b(eligibility|eligible|qualify|qualifies)\b/i,
    /\b(compliance|compliant|regulations?)\b/i,

    // Auditing & Validation (canexport-claims agent specialty)
    /\b(audit|verify|validate|check.*expense|check.*claim)\b/i,
    /\b(reimbursement|reimbursable|allowable)\b/i,
    /\b(budget|financial|cost|expense).*\b(review|analysis|breakdown)\b/i,

    // Document Processing
    /\b(compare|comparison|difference|versus|vs\.)\b/i,
    /\b(summarize|summary|extract|parse)\b/i,

    // Writing & Generation
    /\b(write|create|generate|draft|compose)\b/i,
    /\b(recommend|suggestion|advice|should)\b/i,

    // Complex queries
    /\b(why|how|explain|reasoning|rationale)\b/i,
    /\b(what if|scenario|hypothetical)\b/i,

    // Multi-step operations
    /\b(and then|after that|next|also)\b/i,
    /\b(both.*and|either.*or)\b/i,
  ];

  // Check if query matches complex patterns
  if (complexPatterns.some(pattern => pattern.test(lowerMessage))) {
    return 'complex';
  }

  // ============================================================================
  // SIMPLE PATTERNS - Basic lookups, status checks, retrieval
  // ============================================================================

  const simplePatterns = [
    // Status checks (most common simple query)
    /^(has|have).*\b(been approved|been submitted|been paid|received)\b/i,
    /^(is|are).*\b(approved|submitted|complete|ready|available)\b/i,
    /^(what|what's|whats) (is )?the status (of|for)/i,
    /^(when|when's|whens) (was|were|did).*\b(approved|submitted|paid)\b/i,

    // Simple retrieval
    /^(find|search|lookup|look up|get|show|display|list)\b/i,
    /^(can you find|can you show|can you get|can you list)\b/i,

    // Simple questions with specific answers
    /^(what|who|where|which) (is|are|was|were) (the|a|an)/i,
    /^(how (much|many)).*\b(left|remaining|available|total)\b/i,
  ];

  // Check if query matches simple patterns
  if (simplePatterns.some(pattern => pattern.test(lowerMessage))) {
    return 'simple';
  }

  // ============================================================================
  // AGENT-SPECIFIC DEFAULTS
  // ============================================================================

  // CanExport Claims agent: Default to complex (auditing requires precision)
  if (agentType === 'canexport-claims') {
    return 'complex';
  }

  // ============================================================================
  // DEFAULT: When in doubt, use full power
  // ============================================================================

  return 'complex';
}

/**
 * Get optimal model for query
 * @param {string} queryComplexity - 'simple' or 'complex'
 * @returns {string} Model identifier
 */
export function getModelForQuery(queryComplexity) {
  if (queryComplexity === 'simple') {
    return 'claude-haiku-4-5'; // Fast, cost-effective
  }

  return 'claude-sonnet-4-20250514'; // Full power
}

/**
 * Get extended thinking configuration
 * @param {string} queryComplexity - 'simple' or 'complex'
 * @returns {Object|undefined} Thinking configuration (undefined = disabled)
 */
export function getThinkingConfig(queryComplexity) {
  if (queryComplexity === 'simple') {
    // Simple queries: Disable extended thinking for speed
    // Return undefined to omit thinking parameter entirely
    return undefined;
  }

  // Complex queries: Full thinking budget
  return {
    type: 'enabled',
    budget_tokens: 10000
  };
}

/**
 * Get max tokens based on query complexity
 * @param {string} queryComplexity - 'simple' or 'complex'
 * @returns {number} Max tokens
 */
export function getMaxTokens(queryComplexity) {
  if (queryComplexity === 'simple') {
    return 8000; // Shorter responses expected
  }

  return 16000; // Allow longer analysis
}

/**
 * Get temperature based on query complexity
 * @param {string} queryComplexity - 'simple' or 'complex'
 * @returns {number} Temperature value
 */
export function getTemperature(queryComplexity) {
  if (queryComplexity === 'simple') {
    return 0.3; // More focused, less verbose
  }

  return 0.7; // Balanced for analysis
}

/**
 * Get iteration limit based on query complexity
 * @param {string} queryComplexity - 'simple' or 'complex'
 * @returns {number} Max iterations
 */
export function getIterationLimit(queryComplexity) {
  if (queryComplexity === 'simple') {
    return 6; // Should resolve quickly
  }

  return 20; // Allow thorough exploration
}

/**
 * Get complete configuration for query
 * @param {string} message - User's query
 * @param {string} agentType - Type of agent
 * @returns {Object} Complete configuration
 */
export function getQueryConfig(message, agentType) {
  const complexity = classifyQuery(message, agentType);

  return {
    complexity,
    model: getModelForQuery(complexity),
    thinking: getThinkingConfig(complexity),
    maxTokens: getMaxTokens(complexity),
    temperature: getTemperature(complexity),
    maxIterations: getIterationLimit(complexity),

    // Metadata for logging
    metadata: {
      messageLength: message.length,
      agentType,
      classifiedAs: complexity,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Log configuration decision (for monitoring and refinement)
 * @param {Object} config - Configuration object
 * @param {string} message - User's query
 */
export function logConfigDecision(config, message) {
  const preview = message.substring(0, 100);

  console.log('🎯 Query Configuration:');
  console.log(`   Query: "${preview}${message.length > 100 ? '...' : ''}"`);
  console.log(`   Complexity: ${config.complexity}`);
  console.log(`   Model: ${config.model}`);
  console.log(`   Extended Thinking: ${config.thinking ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   Max Tokens: ${config.maxTokens}`);
  console.log(`   Temperature: ${config.temperature}`);
  console.log(`   Max Iterations: ${config.maxIterations}`);
  console.log('');
}

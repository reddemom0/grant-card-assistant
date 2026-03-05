/**
 * Query Classification System
 *
 * Determines optimal model and configuration based on query complexity.
 *
 * THREE-TIER APPROACH (Optimized for cost efficiency):
 * - SIMPLE: Greetings, continuations, basic lookups → Haiku, no thinking
 * - MODERATE: Writing, review, basic analysis → Haiku WITH thinking
 * - COMPLEX: Deep reasoning, compliance, strategic work → Sonnet WITH thinking
 *
 * This approach leverages Haiku 4.5's extended thinking support for moderate tasks,
 * significantly reducing costs while maintaining quality.
 */

/**
 * Classify query complexity
 * @param {string} message - User's query
 * @param {string} agentType - Type of agent handling the query
 * @param {Object} conversationMemories - Optional: conversation memories for stateful routing
 * @returns {'simple'|'moderate'|'complex'} Query classification
 */
export function classifyQuery(message, agentType, conversationMemories = null) {
  const lowerMessage = message.toLowerCase();

  // ============================================================================
  // TIER 3: COMPLEX - Deep reasoning requiring Sonnet + Full Extended Thinking
  // ============================================================================

  const complexPatterns = [
    // Deep reasoning & explanation
    /\b(why|how|explain|reasoning|rationale)\b/i,
    /\b(what if|scenario|hypothetical)\b/i,

    // Compliance & Audit (high-stakes analysis)
    /\b(compliance|compliant|audit|regulations?)\b/i,
    /\b(reimbursement|reimbursable|allowable)\b/i,

    // Strategic recommendations
    /\b(recommend|recommendation|strategy|strategic|should.*consider)\b/i,
    /\b(advice|guidance|suggest)\b/i,

    // Multi-step operations
    /\b(and then|after that|first.*then)\b/i,
    /\b(both.*and.*also)\b/i,

    // Comparisons requiring deep analysis
    /\b(compare|comparison|versus|vs\.|difference between)\b/i,
  ];

  // ============================================================================
  // AGENT-SPECIFIC CLASSIFICATION OVERRIDES
  // ============================================================================

  // Lead-gen agent: Haiku with extended thinking for ALL turns.
  // Extended thinking gives Haiku reasoning room for activity assessment,
  // estimate synthesis, and pushback handling — without Sonnet's latency.
  // Sonnet caused 15-24s response times and Railway timeouts.
  // Haiku + thinking: 5-8s responses, quality reasoning, no timeouts.
  if (agentType === 'lead-gen') {
    console.log('🎯 Lead-gen routing: HAIKU + THINKING (moderate tier)');
    return 'moderate';
  }

  // CanExport Claims agent: ALWAYS use complex (auditing requires maximum precision)
  if (agentType === 'canexport-claims') {
    return 'complex';
  }

  // Readiness Strategist: Default to complex (high-stakes strategic assessments)
  if (agentType === 'readiness-strategist') {
    // Only greetings/continuations are simple
    const greetingContinuationPatterns = [
      /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it)$/i,
      /^[0-9]{1,2}\.?$/,
      /^(continue|next|more|go ahead|proceed)$/i,
    ];

    if (greetingContinuationPatterns.some(p => p.test(lowerMessage))) {
      return 'simple';
    }

    // Everything else is strategic work requiring Sonnet
    return 'complex';
  }

  // Internal Oracle: Optimize for lookup/research/synthesis workflows
  if (agentType === 'internal-oracle') {
    // Complex: Synthesis across sources and strategic reasoning (needs Sonnet)
    const synthesisPatterns = [
      /\b(synthesize|synthesis|combine|integrate|cross-reference)\b/i,
      /\b(why|how|explain|reasoning|rationale)\b/i,
      /\b(recommend|strategy|should.*consider|advice)\b/i,
      /\b(compare|comparison|versus|vs\.|difference between)\b/i,
      /\b(across|between).*\b(sources|systems|departments)\b/i,
    ];

    if (synthesisPatterns.some(p => p.test(lowerMessage))) {
      return 'complex';
    }

    // Moderate: Research and enrichment (web search + summarization, Haiku+thinking)
    const researchPatterns = [
      /\b(research|enrich|enrichment|analyze|investigate)\b/i,
      /\b(find.*about|tell me about|learn about)\b/i,
      /\b(gather|collect|compile).*\b(information|data|details)\b/i,
      /\b(summarize|summary).*\b(from|across)\b/i,
    ];

    if (researchPatterns.some(p => p.test(lowerMessage))) {
      return 'moderate';
    }

    // Simple: Pure lookups and retrieval (Haiku, no thinking)
    const lookupPatterns = [
      /^(show|list|get|find|display|search)\b/i,
      /^(what is|who is|where is|when is)\b/i,
      /^(how many|how much)\b/i,
    ];

    if (lookupPatterns.some(p => p.test(lowerMessage))) {
      return 'simple';
    }

    // Default to complex for Oracle (strategic knowledge work requires Sonnet)
    // Oracle is designed for deep reasoning, multi-step analysis, and synthesis
    // Most queries benefit from Sonnet's full reasoning capabilities
    return 'complex';
  }

  // ============================================================================
  // GENERAL PATTERN MATCHING (for agents without specific overrides)
  // ============================================================================

  // Check if query matches complex patterns
  if (complexPatterns.some(pattern => pattern.test(lowerMessage))) {
    return 'complex';
  }

  // ============================================================================
  // TIER 2: MODERATE - Tasks benefiting from thinking but not requiring Sonnet
  // ============================================================================

  const moderatePatterns = [
    // Writing & Generation
    /\b(write|create|generate|draft|compose)\b/i,

    // Document review (not deep audit)
    /\b(review|check|verify)\b/i,

    // Basic analysis
    /\b(analyze|analyse|assess|evaluate|examine)\b/i,

    // Summarization
    /\b(summarize|summary|extract|parse)\b/i,

    // Eligibility (general, not compliance-focused)
    /\b(eligible|eligibility|qualify|qualifies)\b/i,
  ];

  // Check if query matches moderate patterns
  if (moderatePatterns.some(pattern => pattern.test(lowerMessage))) {
    return 'moderate';
  }

  // ============================================================================
  // TIER 1: SIMPLE - Greetings, continuations, basic lookups
  // ============================================================================

  const simplePatterns = [
    // Greetings & social
    /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it)$/i,
    /^(good morning|good afternoon|good evening)$/i,

    // Continuations
    /^[0-9]{1,2}\.?$/,  // Numbers like "1", "2.", "10"
    /^(continue|next|more|go ahead|proceed)$/i,

    // Simple retrieval
    /^(show|list|get|find) (me )?(all |the )?[a-z]+$/i,

    // Status checks
    /^(what|what's|whats) (is )?the status/i,
    /^(has|have).*\b(been approved|been submitted|been paid|received)\b/i,
    /^(is|are).*\b(approved|submitted|complete|ready|available)\b/i,

    // Simple questions with specific answers
    /^(what|who|where|which) (is|are|was|were) (the|a|an)/i,
  ];

  // Check if query matches simple patterns
  if (simplePatterns.some(pattern => pattern.test(lowerMessage))) {
    return 'simple';
  }

  // Character count check: Very short queries without complex keywords → simple
  if (message.length < 15 && !complexPatterns.some(p => p.test(lowerMessage))) {
    return 'simple';
  }

  // ============================================================================
  // DEFAULT: Moderate tier (balanced approach)
  // ============================================================================
  // Changed from defaulting to 'complex' - most queries benefit from thinking
  // but don't need Sonnet's full power

  return 'moderate';
}

/**
 * Get optimal model for query
 * @param {string} queryComplexity - 'simple', 'moderate', or 'complex'
 * @returns {string} Model identifier
 */
export function getModelForQuery(queryComplexity) {
  if (queryComplexity === 'complex') {
    return 'claude-sonnet-4-5-20250929'; // Full power - Sonnet 4.5
  }

  // Both simple and moderate use Haiku (moderate adds extended thinking)
  return 'claude-haiku-4-5'; // Fast, cost-effective
}

/**
 * Get extended thinking configuration
 * @param {string} queryComplexity - 'simple', 'moderate', or 'complex'
 * @returns {Object|undefined} Thinking configuration (undefined = disabled)
 */
export function getThinkingConfig(queryComplexity) {
  if (queryComplexity === 'simple') {
    // Simple queries: Disable extended thinking for speed
    // Return undefined to omit thinking parameter entirely
    return undefined;
  }

  if (queryComplexity === 'moderate') {
    // Moderate queries: Enhanced thinking budget (Haiku + thinking)
    // Increased to 6000 tokens based on A/B test results (2026-02-04)
    return {
      type: 'enabled',
      budget_tokens: 6000
    };
  }

  // Complex queries: Full thinking budget (Sonnet + thinking)
  return {
    type: 'enabled',
    budget_tokens: 10000
  };
}

/**
 * Get max tokens based on query complexity
 * @param {string} queryComplexity - 'simple', 'moderate', or 'complex'
 * @returns {number} Max tokens
 */
export function getMaxTokens(queryComplexity) {
  if (queryComplexity === 'simple') {
    return 8000; // Shorter responses expected
  }

  if (queryComplexity === 'moderate') {
    return 12000; // Medium-length responses
  }

  return 16000; // Allow longer analysis for complex queries
}

/**
 * Get temperature based on query complexity
 * @param {string} queryComplexity - 'simple', 'moderate', or 'complex'
 * @returns {number} Temperature value
 */
export function getTemperature(queryComplexity) {
  if (queryComplexity === 'simple') {
    return 0.3; // More focused, less verbose (no thinking)
  }

  // IMPORTANT: When extended thinking is enabled, Anthropic requires temperature = 1.0
  // See: https://docs.claude.com/en/docs/build-with-claude/extended-thinking
  // Both moderate and complex use thinking, so both need temperature = 1.0
  return 1.0; // Required for extended thinking
}

/**
 * Get iteration limit based on query complexity
 * @param {string} queryComplexity - 'simple', 'moderate', or 'complex'
 * @returns {number} Max iterations
 */
export function getIterationLimit(queryComplexity) {
  if (queryComplexity === 'simple') {
    return 6; // Should resolve quickly
  }

  if (queryComplexity === 'moderate') {
    return 10; // Moderate exploration
  }

  return 20; // Allow thorough exploration for complex queries
}

/**
 * Get complete configuration for query
 * @param {string} message - User's query
 * @param {string} agentType - Type of agent
 * @param {Object} conversationMemories - Optional: conversation memories for stateful routing
 * @returns {Object} Complete configuration
 */
export function getQueryConfig(message, agentType, conversationMemories = null) {
  const complexity = classifyQuery(message, agentType, conversationMemories);

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
 * Get configuration for a forced model (bypasses query classification)
 * @param {string} model - Model identifier to force
 * @param {Object} overrides - Optional configuration overrides
 * @param {number} overrides.maxIterations - Custom iteration limit
 * @returns {Object} Complete configuration for the forced model
 */
export function getQueryConfigForModel(model, overrides = {}) {
  // Determine if this is Haiku or Sonnet
  const isHaiku = model.includes('haiku');

  return {
    complexity: isHaiku ? 'simple' : 'complex',
    model: model,
    thinking: isHaiku ? undefined : { type: 'enabled', budget_tokens: 10000 },
    maxTokens: isHaiku ? 8000 : 16000,
    temperature: isHaiku ? 0.3 : 1.0,
    maxIterations: overrides.maxIterations || (isHaiku ? 6 : 20),

    metadata: {
      forcedModel: true,
      modelName: model,
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
  console.log(`   Model: ${config.model}${config.metadata?.forcedModel ? ' (FORCED)' : ''}`);
  console.log(`   Extended Thinking: ${config.thinking ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   Max Tokens: ${config.maxTokens}`);
  console.log(`   Temperature: ${config.temperature}`);
  console.log(`   Max Iterations: ${config.maxIterations}`);
  console.log('');
}

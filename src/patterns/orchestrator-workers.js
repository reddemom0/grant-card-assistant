/**
 * Orchestrator-Workers Pattern
 *
 * Based on: Anthropic Cookbook - patterns/agents/orchestrator_workers.ipynb
 * https://github.com/anthropics/anthropic-cookbook/tree/main/patterns/agents
 *
 * Concept:
 * - Sonnet 4.5 acts as orchestrator (plans strategy, breaks down tasks)
 * - Haiku 4.5 acts as workers (executes specific subtasks in parallel)
 * - Orchestrator synthesizes worker results
 *
 * Benefits:
 * - 60-80% cost reduction on complex multi-step queries
 * - Faster execution through parallelization
 * - Better at complex reasoning (Sonnet) + efficient execution (Haiku)
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Orchestrator: Plans and coordinates work
 * Uses Sonnet for strategic thinking
 */
async function orchestrate(userQuery, context = {}) {
  console.log('🎯 Orchestrator: Planning approach...');

  const planPrompt = `You are an orchestrator AI. Break down this complex query into 3-5 independent subtasks that can be executed in parallel.

User Query: ${userQuery}

${context.hubspotAccess ? 'You have access to HubSpot CRM data.' : ''}
${context.availableTools ? `Available tools: ${context.availableTools.join(', ')}` : ''}

Output a JSON array of subtasks:
[
  {
    "id": "task_1",
    "description": "Query HubSpot for companies with 3+ FTE and $300K+ revenue",
    "tool": "hubspot_search",
    "complexity": "simple"
  },
  {
    "id": "task_2",
    "description": "Filter results by CanExport eligibility criteria",
    "tool": "eligibility_filter",
    "complexity": "simple",
    "dependsOn": ["task_1"]
  },
  {
    "id": "task_3",
    "description": "Analyze strategic fit and prioritize by opportunity",
    "tool": "strategic_analysis",
    "complexity": "complex",
    "dependsOn": ["task_2"]
  }
]

Rules:
- Mark tasks as "simple" (use Haiku) or "complex" (use Sonnet)
- Tasks without dependsOn can run in parallel
- Keep task descriptions clear and actionable`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: planPrompt
    }]
  });

  const planText = response.content[0].text;
  const plan = JSON.parse(planText.match(/\[[\s\S]*\]/)[0]);

  console.log(`✓ Orchestrator created plan with ${plan.length} tasks`);
  return plan;
}

/**
 * Worker: Executes a specific subtask
 * Uses Haiku for cost efficiency (or Sonnet if complex)
 */
async function executeTask(task, toolResults = {}) {
  const model = task.complexity === 'complex' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5';
  console.log(`🔨 Worker (${model}): Executing ${task.id}...`);

  // Build context from dependency results
  let contextStr = '';
  if (task.dependsOn) {
    for (const depId of task.dependsOn) {
      if (toolResults[depId]) {
        contextStr += `\nResult from ${depId}:\n${toolResults[depId]}\n`;
      }
    }
  }

  const workerPrompt = `Execute this task: ${task.description}

${contextStr}

Provide a clear, concise result that can be used by other tasks or for final synthesis.`;

  const response = await anthropic.messages.create({
    model: model,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: workerPrompt
    }]
  });

  const result = response.content[0].text;
  console.log(`✓ Worker completed ${task.id}`);

  return {
    taskId: task.id,
    result: result,
    model: model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  };
}

/**
 * Execute tasks respecting dependencies
 * Parallelizes independent tasks
 */
async function executePlan(plan) {
  const results = {};
  const executed = new Set();

  // Separate tasks by dependency levels
  const tasksByLevel = [];
  let currentLevel = plan.filter(t => !t.dependsOn || t.dependsOn.length === 0);

  while (currentLevel.length > 0) {
    tasksByLevel.push(currentLevel);

    const executedIds = new Set([...executed, ...currentLevel.map(t => t.id)]);
    currentLevel = plan.filter(t =>
      !executedIds.has(t.id) &&
      t.dependsOn &&
      t.dependsOn.every(depId => executedIds.has(depId))
    );
  }

  console.log(`📊 Execution plan: ${tasksByLevel.length} parallel waves`);

  // Execute each level in parallel
  for (let level = 0; level < tasksByLevel.length; level++) {
    const tasks = tasksByLevel[level];
    console.log(`\n🌊 Wave ${level + 1}: ${tasks.length} tasks in parallel`);

    const promises = tasks.map(task => executeTask(task, results));
    const levelResults = await Promise.all(promises);

    for (const result of levelResults) {
      results[result.taskId] = result.result;
      executed.add(result.taskId);
    }
  }

  return results;
}

/**
 * Synthesizer: Combines worker results into final answer
 * Uses Sonnet for quality synthesis
 */
async function synthesize(userQuery, plan, workerResults) {
  console.log('🎨 Orchestrator: Synthesizing final response...');

  const resultsStr = Object.entries(workerResults)
    .map(([taskId, result]) => `\n### ${taskId}\n${result}`)
    .join('\n');

  const synthesisPrompt = `Original user query: ${userQuery}

Worker task results:
${resultsStr}

Synthesize these results into a comprehensive, well-structured response to the user's original query.
Present the information clearly with appropriate formatting (bullet points, headings, etc.).
Focus on actionable insights.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: synthesisPrompt
    }]
  });

  console.log('✓ Orchestrator completed synthesis');

  return {
    answer: response.content[0].text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens
    }
  };
}

/**
 * Main orchestrator-workers function
 * Public API for the pattern
 */
export async function orchestratorWorkers(userQuery, context = {}) {
  console.log('\n════════════════════════════════════════');
  console.log('🚀 ORCHESTRATOR-WORKERS PATTERN');
  console.log('════════════════════════════════════════\n');

  const startTime = Date.now();
  let totalCost = 0;

  try {
    // Step 1: Orchestrator plans
    const plan = await orchestrate(userQuery, context);

    // Step 2: Workers execute plan
    const workerResults = await executePlan(plan);

    // Step 3: Orchestrator synthesizes
    const synthesis = await synthesize(userQuery, plan, workerResults);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Calculate costs (simplified)
    // Sonnet: $3/M input, $15/M output
    // Haiku: $1/M input, $5/M output
    totalCost = synthesis.usage.inputTokens * 0.000003 + synthesis.usage.outputTokens * 0.000015;

    console.log('\n════════════════════════════════════════');
    console.log('✅ ORCHESTRATOR-WORKERS COMPLETE');
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`💰 Estimated cost: $${totalCost.toFixed(4)}`);
    console.log('════════════════════════════════════════\n');

    return {
      answer: synthesis.answer,
      plan: plan,
      workerResults: workerResults,
      duration: duration,
      estimatedCost: totalCost
    };

  } catch (error) {
    console.error('❌ Orchestrator-workers pattern failed:', error);
    throw error;
  }
}

/**
 * Helper: Detect if query is complex enough to benefit from orchestrator-workers
 */
export function shouldUseOrchestratorWorkers(query) {
  const complexitySignals = [
    /show.*and.*(?:also|then|plus)/i, // Multiple requests
    /compare.*with/i, // Comparison tasks
    /analyz.*(?:previous|historical)/i, // Multi-source analysis
    /qualified.*(?:and|plus).*previous/i, // Multiple datasets
    /all.*(?:who|that|which)/i // Broad queries needing filtering
  ];

  return complexitySignals.some(pattern => pattern.test(query));
}

/**
 * Example usage:
 *
 * import { orchestratorWorkers, shouldUseOrchestratorWorkers } from './patterns/orchestrator-workers.js';
 *
 * const query = "Show me qualified CanExport clients and previous applicants who should reapply";
 *
 * if (shouldUseOrchestratorWorkers(query)) {
 *   const result = await orchestratorWorkers(query, {
 *     hubspotAccess: true,
 *     availableTools: ['hubspot_search', 'eligibility_filter']
 *   });
 *   console.log(result.answer);
 *   console.log(`Cost: $${result.estimatedCost}`);
 * }
 */

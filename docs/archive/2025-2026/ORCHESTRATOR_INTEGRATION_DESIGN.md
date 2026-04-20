# Orchestrator-Workers Integration Design

**Goal:** Route complex multi-step queries through orchestrator-workers pattern to execute subtasks in parallel

**Estimated Savings:** $150-200/month (targets expensive 10-20 loop conversations)

---

## Problem Statement

**Current Flow (Sequential):**
```
User: "Show me qualified CanExport clients and previous applicants who should reapply"

Loop 1: Query HubSpot for companies with 3+ FTE ($0.08)
Loop 2: Filter by revenue requirements ($0.08)
Loop 3: Check CanExport eligibility ($0.08)
Loop 4: Query previous applications ($0.08)
Loop 5: Cross-reference data ($0.08)
Loop 6: Analyze readiness ($0.08)
Loop 7: Prioritize by opportunity ($0.08)
Loop 8: Format results ($0.08)

Total: 8 loops × $0.08 = $0.64, takes 40 seconds
```

**Orchestrator Flow (Parallel):**
```
User: Same query

Planning (Orchestrator/Sonnet): Break into subtasks ($0.05)

Workers (Parallel execution):
├─ Worker 1 (Haiku): Query companies 3+ FTE → $0.03
├─ Worker 2 (Haiku): Query previous apps → $0.03
└─ Worker 3 (Haiku): Get eligibility rules → $0.02

Synthesis (Orchestrator/Sonnet): Combine results ($0.05)

Total: $0.18, takes 15 seconds (60% cost savings, 62% faster)
```

---

## Architecture Design

### 1. Query Detection

**When to use orchestrator?**

Detect queries that will likely need 5+ tool calls:

```javascript
const orchestratorPatterns = [
  // Multi-entity queries
  /\b(all|every).*\b(who|that|which)\b/i,  // "all clients who..."
  /\b(both|and).*\b(previous|historical|past)\b/i,  // "current and previous"

  // Multi-step operations
  /\b(qualified|eligible).*\b(and|plus|also)\b.*\b(previous|should|ready)\b/i,
  /\b(compare|cross-reference).*\b(with|against)\b/i,
  /\b(analyze|evaluate).*\b(and|then).*\b(recommend|prioritize)\b/i,

  // Broad research queries
  /\b(research|find|identify).*\b(all|potential|possible)\b/i,
];

function shouldUseOrchestrator(query, agentType) {
  // Only for oracle agent (does complex research)
  if (agentType !== 'internal-oracle') return false;

  // Check patterns
  return orchestratorPatterns.some(p => p.test(query));
}
```

**Conservative approach:** Only trigger for Oracle agent on multi-step patterns

---

### 2. Orchestrator Flow Integration

**File:** `src/api/chat.js` (line ~120, after validation, BEFORE runAgent)

```javascript
// After validation, before runAgent
const useOrchestrator = shouldUseOrchestrator(message, agentType);

if (useOrchestrator) {
  console.log('🎯 Routing to orchestrator-workers pattern');

  // Import orchestrator
  const { orchestratorWorkers } = await import('../patterns/orchestrator-workers.js');

  // Execute with orchestrator
  const result = await orchestratorWorkers(message, {
    conversationId,
    userId,
    agentType,
    res,  // For SSE streaming
    sessionId
  });

  // Save orchestrator result to conversation
  await saveOrchestratorResult(conversationId, message, result);

  // Return (skip normal runAgent flow)
  return;
}

// Otherwise continue with normal runAgent
await runAgent({ agentType, message, conversationId, userId, ... });
```

---

### 3. Tool Access for Workers

**Challenge:** Workers need access to same tools (HubSpot, Dropbox, etc.)

**Solution:** Pass tool executor to orchestrator

```javascript
// In orchestrator-workers.js
async function executeWorkerTask(task, context) {
  const { tools, executeToolCall } = context;

  // Build prompt for worker
  const workerPrompt = `Execute this task: ${task.description}

Available tools: ${tools.map(t => t.name).join(', ')}

Your task requires using tools. Make your plan and use tools to gather data.`;

  // Run worker with tool access
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    tools: tools,  // Same tools as main agent
    messages: [{ role: 'user', content: workerPrompt }],
    // ... handle tool use loop for this worker
  });

  return response;
}
```

**Import tools dynamically:**
```javascript
// In chat.js, pass to orchestrator
const { getToolsForAgent } = await import('../tools/definitions.js');
const tools = getToolsForAgent(agentType);

const result = await orchestratorWorkers(message, {
  ...context,
  tools,  // Pass tools
  executeToolCall  // Pass executor
});
```

---

### 4. Conversation Storage

**Challenge:** How to store orchestrator plan + worker results?

**Option A: Store as single assistant message**
```javascript
// After orchestrator completes
await saveMessage(conversationId, 'user', message);
await saveMessage(conversationId, 'assistant', {
  type: 'orchestrator_result',
  plan: orchestratorPlan,
  workerResults: results,
  finalAnswer: synthesis
});
```

**Option B: Store as tool use flow (mimics normal flow)**
```javascript
// Store orchestrator planning as assistant message with "tool use"
await saveMessage(conversationId, 'assistant', [
  { type: 'text', text: 'Breaking this into parallel tasks...' },
  { type: 'tool_use', id: 'orch_1', name: 'orchestrator_plan', input: { tasks } }
]);

// Store worker results as tool results
await saveMessage(conversationId, 'user', [
  { type: 'tool_result', tool_use_id: 'orch_1', content: JSON.stringify(results) }
]);

// Store synthesis
await saveMessage(conversationId, 'assistant', [
  { type: 'text', text: synthesis }
]);
```

**Recommendation:** Option B (mimics normal flow, easier for model to understand context)

---

### 5. UI/UX Progress Indication

**Stream orchestrator progress to frontend:**

```javascript
// In orchestrator-workers.js
async function orchestrate(query, context) {
  const { res, sessionId } = context;

  // Send planning event
  sendSSE(res, {
    type: 'orchestrator_planning',
    message: 'Breaking down your query into parallel tasks...',
    sessionId
  });

  const plan = await generatePlan(query);

  // Send plan to UI
  sendSSE(res, {
    type: 'orchestrator_plan',
    tasks: plan.map(t => ({ id: t.id, description: t.description })),
    sessionId
  });

  return plan;
}

async function executeWorkers(plan, context) {
  const { res, sessionId } = context;

  for (const task of plan) {
    // Notify task start
    sendSSE(res, {
      type: 'worker_started',
      taskId: task.id,
      description: task.description,
      sessionId
    });

    const result = await executeWorkerTask(task, context);

    // Notify task complete
    sendSSE(res, {
      type: 'worker_completed',
      taskId: task.id,
      sessionId
    });
  }
}
```

**Frontend updates needed:**
- Handle `orchestrator_planning` event
- Show task list with progress indicators
- Update as workers complete

---

### 6. Integration Checklist

**Step 1: Modify orchestrator-workers.js**
- [ ] Accept `context` parameter (tools, executeToolCall, res, sessionId)
- [ ] Implement tool use in worker execution
- [ ] Add SSE progress events
- [ ] Return results in format compatible with saveMessage

**Step 2: Modify chat.js**
- [ ] Add orchestrator detection logic
- [ ] Route to orchestrator before runAgent
- [ ] Pass tools and executors
- [ ] Save results to conversation

**Step 3: Update frontend (HTML files)**
- [ ] Add event handlers for orchestrator events
- [ ] Show task list UI
- [ ] Update progress indicators

**Step 4: Testing**
- [ ] Test with known expensive query
- [ ] Verify cost savings
- [ ] Verify quality maintained
- [ ] Test conversation continuity

---

## Risk Mitigation

**Risk 1: Tool execution in workers fails**
- Mitigation: Test with simple tool first (search_memory)
- Fallback: Catch errors, retry with main agent flow

**Risk 2: Synthesis quality degrades**
- Mitigation: Use Sonnet for synthesis (not Haiku)
- Test: Compare orchestrator results vs normal flow

**Risk 3: Conversation context breaks**
- Mitigation: Store results in standard message format
- Test: Send follow-up questions, verify context maintained

**Risk 4: Over-triggers on simple queries**
- Mitigation: Conservative patterns (only multi-step + Oracle agent)
- Monitor: Log orchestrator usage, tune patterns

---

## Implementation Timeline

**Phase 1: Core Pattern (4 hours)**
- Modify orchestrator to accept tools
- Test tool execution in workers
- Basic integration in chat.js

**Phase 2: Storage & Continuity (2 hours)**
- Implement message storage
- Test conversation continuity
- Handle errors gracefully

**Phase 3: UI Progress (2 hours)**
- Add SSE events
- Update frontend
- Polish user experience

**Total: 8 hours**

---

## Success Metrics

- 60%+ cost reduction on targeted queries (8+ loops)
- 40%+ speed improvement (parallel execution)
- No degradation in quality
- Seamless conversation continuity

**Target:** Save $150-200/month on the 10-15% of queries that are complex multi-step research


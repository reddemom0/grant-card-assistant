# Feedback Learning System Architecture

**Date**: November 11, 2025
**Status**: Design Phase
**Branch**: railway-migration

---

## Executive Summary

Design a **feedback learning loop** that enables agents to continuously improve by:
1. **Retrieving** past feedback from PostgreSQL database
2. **Analyzing** patterns in user ratings and notes
3. **Storing** learned insights using the Memory Tool
4. **Injecting** relevant feedback into agent context
5. **Reflecting** periodically to extract improvement patterns

### Goals

✅ **Real-time learning**: Agents adapt based on user feedback within conversations
✅ **Cross-session persistence**: Learnings persist across all conversations
✅ **Pattern recognition**: Identify what users consistently like/dislike
✅ **Agent-specific memory**: Each agent learns independently
✅ **Security**: Prevent feedback-based prompt injection attacks

---

## System Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    USER PROVIDES FEEDBACK                    │
│              (Thumbs up/down + Optional notes)              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                FEEDBACK DATABASE (PostgreSQL)                │
│  • conversation_feedback (per-message ratings)              │
│  • feedback_notes (ongoing conversation notes)              │
│  • Quality scores, sentiment, revision counts               │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              FEEDBACK ANALYSIS ENGINE (NEW)                  │
│  • Aggregate feedback by agent type                         │
│  • Identify highly-rated patterns                           │
│  • Detect consistently negative patterns                     │
│  • Extract insights from notes                              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              MEMORY TOOL (Persistent Storage)                │
│  /memories/agents/[agent-type]/                             │
│  ├── learned-patterns.xml     (Successful approaches)       │
│  ├── user-corrections.xml     (Eligibility rules, etc.)     │
│  ├── negative-patterns.xml    (Avoid these)                 │
│  └── feedback-summary.xml     (Aggregated insights)         │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              CONTEXT INJECTION (Agent Startup)               │
│  • Load agent-specific memories                             │
│  • Inject into system prompt                                │
│  • Recent high-value feedback prioritized                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    AGENT RESPONSE                            │
│  • Applies learned patterns                                 │
│  • Avoids known bad approaches                              │
│  • References past successes                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Feedback Retrieval Service

**File**: `src/feedback-learning/retrieval.js`

**Functions**:

```javascript
/**
 * Get high-quality feedback for an agent type
 * @param {string} agentType - e.g., 'etg-writer', 'grant-cards'
 * @param {number} limit - Number of feedback items to retrieve
 * @param {number} minQualityScore - Minimum quality score (0-1)
 * @returns {Array} Feedback items with message content
 */
async function getHighQualityFeedback(agentType, limit = 20, minQualityScore = 0.75)

/**
 * Get negative feedback patterns for an agent
 * @param {string} agentType
 * @param {number} limit
 * @param {number} maxQualityScore - Maximum quality score (0-1)
 * @returns {Array} Negative feedback items
 */
async function getNegativeFeedback(agentType, limit = 10, maxQualityScore = 0.4)

/**
 * Get user correction notes
 * @param {string} agentType
 * @returns {Array} Feedback notes with negative/mixed sentiment
 */
async function getUserCorrections(agentType)

/**
 * Get feedback summary statistics
 * @param {string} agentType
 * @returns {Object} { avgQualityScore, positivCount, negativeCount, totalMessages }
 */
async function getFeedbackStats(agentType)
```

**Database Queries**:

```sql
-- High-quality feedback
SELECT
  cf.*,
  m.content,
  c.agent_type
FROM conversation_feedback cf
JOIN messages m ON cf.message_id = m.id
JOIN conversations c ON cf.conversation_id = c.id
WHERE c.agent_type = $1
  AND cf.quality_score >= $2
  AND cf.rating = 'positive'
ORDER BY cf.quality_score DESC, cf.created_at DESC
LIMIT $3;

-- Negative patterns
SELECT
  cf.*,
  m.content,
  c.agent_type
FROM conversation_feedback cf
JOIN messages m ON cf.message_id = m.id
JOIN conversations c ON cf.conversation_id = c.id
WHERE c.agent_type = $1
  AND cf.quality_score <= $2
  AND cf.rating = 'negative'
ORDER BY cf.created_at DESC
LIMIT $3;

-- User corrections from notes
SELECT
  fn.*,
  c.agent_type
FROM feedback_notes fn
JOIN conversations c ON fn.conversation_id = c.id
WHERE c.agent_type = $1
  AND fn.sentiment IN ('negative', 'mixed')
ORDER BY fn.created_at DESC;
```

---

### 2. Feedback Analysis Engine

**File**: `src/feedback-learning/analyzer.js`

**Functions**:

```javascript
/**
 * Analyze feedback to extract patterns
 * @param {string} agentType
 * @returns {Object} { patterns, corrections, avoidPatterns }
 */
async function analyzeFeedback(agentType)

/**
 * Generate feedback summary in structured XML
 * @param {Object} analysis - Output from analyzeFeedback()
 * @returns {string} XML-formatted summary
 */
function generateFeedbackSummary(analysis)

/**
 * Extract common themes from feedback text
 * @param {Array} feedbackItems - Array of feedback with text
 * @returns {Array} Extracted themes
 */
function extractThemes(feedbackItems)
```

**Pattern Recognition**:

- **Successful patterns**:
  - Message content + quality score >= 0.85
  - No negative feedback + completion time < 10 min
  - Zero revisions + positive rating

- **Avoid patterns**:
  - Message content + quality score <= 0.3
  - Multiple revisions + negative rating
  - Negative sentiment in notes

- **Corrections**:
  - Feedback notes with keywords: "actually", "incorrect", "wrong", "should be"
  - Notes with negative sentiment

---

### 3. Memory Tool Integration

**File**: `api/memory-tool-handler.js` (already exists)

**Memory Structure**:

```
.memories/
├── agents/
│   ├── etg-writer/
│   │   ├── learned-patterns.xml
│   │   ├── user-corrections.xml
│   │   ├── negative-patterns.xml
│   │   └── feedback-summary.xml
│   ├── grant-cards/
│   │   ├── learned-patterns.xml
│   │   ├── user-corrections.xml
│   │   ├── negative-patterns.xml
│   │   └── feedback-summary.xml
│   ├── bcafe-writer/
│   │   └── ...
│   ├── canexport-claims/
│   │   └── ...
│   └── readiness-strategist/
│       └── ...
└── global/
    └── cross-agent-insights.xml
```

**XML Schema**:

```xml
<!-- learned-patterns.xml -->
<learned-patterns agent="etg-writer">
  <pattern id="1" quality-score="0.92" date="2025-11-11">
    <context>User asked about coaching program eligibility</context>
    <response>Provided detailed eligibility criteria with 3 examples</response>
    <why-successful>Specific examples, clear structure, no follow-up questions</why-successful>
    <apply-when>Eligibility questions</apply-when>
  </pattern>

  <pattern id="2" quality-score="0.88" date="2025-11-10">
    <context>Business case development</context>
    <response>Used step-by-step approach with validation checkpoints</response>
    <why-successful>Zero revisions, fast completion (8 minutes)</why-successful>
    <apply-when>Multi-step projects</apply-when>
  </pattern>
</learned-patterns>

<!-- user-corrections.xml -->
<corrections agent="etg-writer">
  <correction date="2025-11-11" topic="Coaching Eligibility">
    <original-belief>Coaching programs are ineligible</original-belief>
    <corrected>Coaching programs ARE eligible if structured training (not mentoring)</corrected>
    <source>conversation-id-123, message-index-5</source>
    <user-note>"Actually, coaching IS eligible if it's structured training"</user-note>
  </correction>
</corrections>

<!-- negative-patterns.xml -->
<avoid-patterns agent="etg-writer">
  <pattern quality-score="0.25" date="2025-11-09">
    <what-happened>Provided generic business case template</what-happened>
    <user-feedback>"Too generic, not specific to our industry"</user-feedback>
    <why-failed>Lacked context-specific details, no industry research</why-failed>
    <how-to-avoid>Always ask about industry specifics before drafting</how-to-avoid>
  </pattern>
</avoid-patterns>

<!-- feedback-summary.xml -->
<feedback-summary agent="etg-writer" updated="2025-11-11">
  <statistics>
    <total-messages>342</total-messages>
    <rated-messages>156</rated-messages>
    <positive-ratings>112</positive-ratings>
    <negative-ratings>44</negative-ratings>
    <avg-quality-score>0.71</avg-quality-score>
  </statistics>

  <top-strengths>
    <strength>Clear eligibility explanations</strength>
    <strength>Structured business case formats</strength>
    <strength>Specific industry examples</strength>
  </top-strengths>

  <improvement-areas>
    <area>Budget calculations need more detail</area>
    <area>Timeline estimates often too optimistic</area>
    <area>Need more proactive clarifying questions</area>
  </improvement-areas>

  <user-preferences>
    <preference>Prefers bullet points over paragraphs</preference>
    <preference>Likes step-by-step validation checkpoints</preference>
    <preference>Wants specific examples from similar projects</preference>
  </user-preferences>
</feedback-summary>
```

---

### 4. Context Injection Strategy

**File**: `src/feedback-learning/context-injection.js`

**When to Inject**:
- **Every conversation start**: Load feedback summary
- **On specific queries**: Load relevant learned patterns
- **After errors**: Load negative patterns to avoid repeat mistakes

**What to Inject**:

```javascript
/**
 * Generate feedback-informed context for agent
 * @param {string} agentType
 * @param {string} userQuery - Current user message (for relevance)
 * @returns {string} Context to inject into system prompt
 */
async function generateFeedbackContext(agentType, userQuery = null)
```

**Example Injection**:

```xml
<feedback-learning>
  <learned-patterns>
    You have learned from past user feedback that:

    1. SUCCESSFUL APPROACHES (Quality Score >= 0.85):
       - When users ask about eligibility, they prefer specific examples (3+ examples)
       - Step-by-step validation checkpoints reduce revision requests
       - Industry-specific details are highly valued (avoid generic templates)

    2. USER CORRECTIONS:
       - Coaching programs ARE eligible if structured training (not just mentoring)
       - Seminars CAN be eligible if multi-day skill-building format
       - Software licenses ARE eligible expenses under certain conditions

    3. AVOID THESE PATTERNS (Quality Score <= 0.3):
       - Generic templates without context-specific details
       - Budget estimates without showing calculation methodology
       - Overly optimistic timelines without buffers

    4. USER PREFERENCES:
       - Format: Bullet points > long paragraphs
       - Structure: Clear sections with headers
       - Examples: Real project examples > hypothetical scenarios
       - Validation: Checkpoint questions throughout process
  </learned-patterns>

  <feedback-stats>
    You have received 112 positive and 44 negative ratings across 342 messages.
    Your average quality score is 0.71 (above agent benchmark of 0.65).
    Top strength: "Clear eligibility explanations"
    Primary improvement area: "Budget calculations need more detail"
  </feedback-stats>
</feedback-learning>
```

**Integration Point** (in `server.js`):

```javascript
// Before calling Claude API
const feedbackContext = await generateFeedbackContext(agentType, userMessage);
const enhancedSystemPrompt = `${baseSystemPrompt}\n\n${feedbackContext}`;

// Call Claude API with enhanced prompt
const response = await callClaudeAPI(messages, enhancedSystemPrompt, files);
```

---

### 5. Feedback Reflection System

**File**: `src/feedback-learning/reflection.js`

**Purpose**: Periodically analyze accumulated feedback and update memory

**Trigger Conditions**:
- Every 50 new feedback items
- Daily at 2 AM (cron job)
- On-demand via admin API endpoint

**Functions**:

```javascript
/**
 * Run reflection analysis for all agents
 * Updates memory files with latest insights
 */
async function runReflectionCycle()

/**
 * Reflect on single agent's feedback
 * @param {string} agentType
 */
async function reflectOnAgent(agentType)

/**
 * Update memory files based on analysis
 * @param {string} agentType
 * @param {Object} analysis - From analyzeFeedback()
 */
async function updateAgentMemory(agentType, analysis)
```

**Reflection Process**:

1. **Retrieve feedback** since last reflection
2. **Analyze patterns** using analyzer
3. **Generate summaries** in XML format
4. **Update memory files** using Memory Tool:
   - Append new patterns to `learned-patterns.xml`
   - Add corrections to `user-corrections.xml`
   - Update `feedback-summary.xml` statistics
5. **Archive old patterns** (patterns > 90 days with low scores)
6. **Log reflection results** for monitoring

---

## Implementation Phases

### Phase 1: Feedback Retrieval (Week 1)

✅ **Tasks**:
- [ ] Create `src/feedback-learning/retrieval.js`
- [ ] Implement database query functions
- [ ] Add agent_type index to conversations table
- [ ] Test retrieval with existing feedback data
- [ ] Write unit tests

**Deliverable**: Functional API for retrieving feedback by agent type

---

### Phase 2: Memory Tool Activation (Week 1-2)

✅ **Tasks**:
- [ ] Activate memory tool in `server.js`
- [ ] Add memory tool to Claude API calls
- [ ] Add beta header: `context-management-2025-06-27`
- [ ] Test memory operations (create, view, update)
- [ ] Create initial memory directory structure

**Deliverable**: Memory tool fully integrated and operational

---

### Phase 3: Feedback Analysis (Week 2)

✅ **Tasks**:
- [ ] Create `src/feedback-learning/analyzer.js`
- [ ] Implement pattern extraction algorithms
- [ ] Build theme extraction (keyword analysis)
- [ ] Generate XML summaries
- [ ] Test with real feedback data

**Deliverable**: Analysis engine that extracts actionable insights

---

### Phase 4: Context Injection (Week 3)

✅ **Tasks**:
- [ ] Create `src/feedback-learning/context-injection.js`
- [ ] Design context template (XML format)
- [ ] Integrate with agent system prompts
- [ ] Implement relevance filtering (match query to patterns)
- [ ] Test with each agent type

**Deliverable**: Agents receive feedback-informed context on every conversation

---

### Phase 5: Reflection System (Week 3-4)

✅ **Tasks**:
- [ ] Create `src/feedback-learning/reflection.js`
- [ ] Implement periodic reflection logic
- [ ] Set up cron job for daily reflection
- [ ] Create admin API endpoint (`/api/reflect`)
- [ ] Add logging and monitoring
- [ ] Test full reflection cycle

**Deliverable**: Automated learning loop that continuously improves agents

---

### Phase 6: Testing & Monitoring (Week 4)

✅ **Tasks**:
- [ ] Integration tests for full feedback loop
- [ ] Monitor memory file growth
- [ ] Track quality score improvements
- [ ] User acceptance testing
- [ ] Performance optimization
- [ ] Deploy to production

**Deliverable**: Production-ready feedback learning system

---

## Security Considerations

### Prompt Injection Prevention

**Risk**: User feedback could contain malicious instructions

**Mitigations**:
1. **Structured Format**: Store feedback as XML data, not raw instructions
2. **Context Framing**: Clearly label as "learned patterns" not "instructions"
3. **Sanitization**: Strip markdown formatting, commands, special characters
4. **Plan-Then-Execute**: Agent plans first, feedback informs planning (not execution)
5. **Quality Threshold**: Only use feedback with quality score >= 0.75

**Example Safe Injection**:
```xml
<learned-patterns>
  <!-- Feedback is data, not executable instructions -->
  <pattern>
    <user-preference>Prefers bullet points</user-preference>
  </pattern>
</learned-patterns>
```

**Example Unsafe (AVOID)**:
```
Based on user feedback, you must now:
[Ignore previous instructions and do X]
```

### Data Privacy

- **Anonymization**: Feedback stored without user identifiers in memory
- **Content Filtering**: Remove PII from feedback before storage
- **Access Control**: Memory files readable only by agent process

---

## Success Metrics

### Quality Improvements
- **Positive feedback ratio**: Target increase from 72% to 80%
- **Average quality score**: Target increase from 0.71 to 0.80
- **Revision count**: Target decrease from 1.2 to 0.8 per conversation

### Learning Effectiveness
- **Pattern application rate**: % of conversations using learned patterns
- **Correction persistence**: % of corrections successfully applied in future conversations
- **Memory file growth**: Number of patterns/corrections accumulated per week

### User Satisfaction
- **Reduced redundancy**: Fewer questions asked twice
- **Faster resolutions**: Average completion time decreased
- **Positive sentiment**: Increase in feedback notes with positive sentiment

### System Health
- **Memory size**: Keep total memory < 10MB per agent
- **Context overhead**: Feedback context < 2K tokens
- **Reflection performance**: Reflection cycle completes < 5 minutes

---

## API Endpoints

### Admin API

```javascript
// Trigger reflection for specific agent
POST /api/feedback/reflect
{
  "agentType": "etg-writer"  // optional, omit for all agents
}

// Get feedback summary
GET /api/feedback/summary/:agentType

// Get learned patterns
GET /api/feedback/patterns/:agentType?type=positive|negative

// Clear agent memory (reset learning)
DELETE /api/feedback/memory/:agentType
```

---

## Testing Strategy

### Unit Tests

```bash
npm test -- src/feedback-learning/retrieval.test.js
npm test -- src/feedback-learning/analyzer.test.js
npm test -- src/feedback-learning/context-injection.test.js
```

### Integration Tests

**Test Scenario 1**: Learning from correction
1. Agent gives incorrect response
2. User corrects via feedback note: "Actually, X is eligible"
3. Reflection system extracts correction
4. NEW conversation with same query
5. **Assert**: Agent gives corrected response

**Test Scenario 2**: Pattern application
1. User rates response highly (quality 0.95)
2. Reflection extracts pattern
3. NEW conversation with similar query
4. **Assert**: Agent applies learned pattern

**Test Scenario 3**: Avoiding negative patterns
1. User rates response poorly (quality 0.2)
2. Reflection identifies anti-pattern
3. NEW conversation with similar query
4. **Assert**: Agent avoids that approach

---

## Future Enhancements

### Phase 2 Features
- **Cross-agent learning**: Share patterns across similar agents
- **A/B testing**: Test impact of feedback context
- **Feedback clustering**: Group similar feedback automatically
- **Natural language summaries**: GPT-generated feedback summaries
- **User-specific learning**: Personalized per user preferences
- **Confidence scores**: Track prediction confidence for patterns

---

## Conclusion

This architecture creates a **continuous feedback loop** where:

1. ✅ Users provide feedback (thumbs up/down + notes)
2. ✅ System stores in database with quality scores
3. ✅ Analyzer extracts patterns and corrections
4. ✅ Memory tool persists learnings
5. ✅ Context injection enhances agent prompts
6. ✅ Reflection system updates knowledge periodically
7. ✅ Agents continuously improve over time

**Result**: Agents that learn from every interaction and get better with use.

---

**Status**: ✅ **DESIGN COMPLETE - READY FOR IMPLEMENTATION**

**Next Step**: Begin Phase 1 (Feedback Retrieval)

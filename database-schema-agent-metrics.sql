-- Agent Performance Metrics Schema
-- Created: 2025-12-02
-- Purpose: Track success criteria for all agents (Grant Cards, ETG, BCAFE, CanExport, Readiness)

-- ============================================
-- 1. FEEDBACK TAGS (Structured Categorization)
-- ============================================

CREATE TABLE IF NOT EXISTS feedback_tags (
    id SERIAL PRIMARY KEY,
    feedback_id INTEGER REFERENCES conversation_feedback(id) ON DELETE CASCADE,
    note_id INTEGER REFERENCES feedback_notes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    -- Ensure tag is linked to either conversation_feedback OR feedback_notes (not both)
    CONSTRAINT tag_source_check CHECK (
        (feedback_id IS NOT NULL AND note_id IS NULL) OR
        (feedback_id IS NULL AND note_id IS NOT NULL)
    )
);

CREATE INDEX idx_feedback_tags_tag ON feedback_tags(tag);
CREATE INDEX idx_feedback_tags_feedback_id ON feedback_tags(feedback_id);
CREATE INDEX idx_feedback_tags_note_id ON feedback_tags(note_id);

-- Tag Categories:
-- ACCURACY ISSUES:
--   'missed-information', 'hallucination', 'wrong-data', 'incomplete-extraction'
-- FORMAT ISSUES:
--   'wrong-format', 'missing-sections', 'too-long', 'wrong-structure'
-- WORKFLOW ISSUES:
--   'already-asked', 'repeated-step', 'wrong-sequence', 'skipped-step'
-- INSTRUCTION FOLLOWING:
--   'not-what-i-asked', 'wrong-section', 'ignored-request', 'did-opposite'
-- CONTEXT USAGE:
--   'didnt-use-hubspot', 'asked-for-provided-info', 'ignored-uploaded-file'
-- SUCCESS INDICATORS:
--   'perfect', 'ready-to-submit', 'exactly-what-i-needed', 'great-work'

-- ============================================
-- 2. AGENT EVALUATIONS (Manual Spot Checks)
-- ============================================

CREATE TABLE IF NOT EXISTS agent_evaluations (
    id SERIAL PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    evaluator_id INTEGER REFERENCES users(id),
    evaluation_date TIMESTAMP DEFAULT NOW(),

    -- Success Criteria Scores (0-100 scale)
    accuracy_score FLOAT CHECK (accuracy_score >= 0 AND accuracy_score <= 100),
    workflow_score FLOAT CHECK (workflow_score >= 0 AND workflow_score <= 100),
    format_score FLOAT CHECK (format_score >= 0 AND format_score <= 100),
    instruction_following_score FLOAT CHECK (instruction_following_score >= 0 AND instruction_following_score <= 100),
    context_usage_score FLOAT CHECK (context_usage_score >= 0 AND context_usage_score <= 100),

    -- Overall Assessment
    overall_score FLOAT CHECK (overall_score >= 0 AND overall_score <= 100),
    verdict TEXT CHECK (verdict IN ('excellent', 'good', 'acceptable', 'needs-improvement', 'poor')),

    -- Specific Issues Found
    issues_found JSONB, -- Array of issue objects: {type, description, severity}
    strengths_noted JSONB, -- Array of strength objects: {area, description}

    -- Evaluation Notes
    notes TEXT,
    evaluation_type TEXT DEFAULT 'manual' CHECK (evaluation_type IN ('manual', 'automated', 'user_validation')),

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_evaluations_agent_type ON agent_evaluations(agent_type);
CREATE INDEX idx_agent_evaluations_date ON agent_evaluations(evaluation_date);
CREATE INDEX idx_agent_evaluations_conversation ON agent_evaluations(conversation_id);

-- ============================================
-- 3. AGENT METRICS DAILY ROLLUP
-- ============================================

CREATE TABLE IF NOT EXISTS agent_metrics_daily (
    id SERIAL PRIMARY KEY,
    agent_type TEXT NOT NULL,
    date DATE NOT NULL,

    -- Volume Metrics
    conversations_count INTEGER DEFAULT 0,
    messages_count INTEGER DEFAULT 0,
    unique_users INTEGER DEFAULT 0,

    -- Feedback Metrics
    total_feedback INTEGER DEFAULT 0,
    positive_feedback INTEGER DEFAULT 0,
    negative_feedback INTEGER DEFAULT 0,
    positive_feedback_rate FLOAT, -- percentage (0-100)

    -- Revision Metrics
    avg_revision_count FLOAT,
    median_revision_count FLOAT,
    max_revision_count INTEGER,

    -- Time Metrics
    avg_completion_time_seconds INTEGER,
    median_completion_time_seconds INTEGER,

    -- Success Criteria Metrics (from feedback_tags)
    accuracy_issues INTEGER DEFAULT 0, -- Count of accuracy-related tags
    format_issues INTEGER DEFAULT 0, -- Count of format-related tags
    workflow_issues INTEGER DEFAULT 0, -- Count of workflow-related tags
    instruction_issues INTEGER DEFAULT 0, -- Count of instruction-following tags
    context_issues INTEGER DEFAULT 0, -- Count of context-usage tags

    -- Success Indicator Counts
    success_indicators INTEGER DEFAULT 0, -- Count of positive tags

    -- Calculated Scores (0-100 scale)
    accuracy_score FLOAT, -- % conversations without accuracy issues
    workflow_score FLOAT, -- % conversations without workflow issues
    format_score FLOAT, -- % conversations without format issues
    instruction_score FLOAT, -- % conversations without instruction issues
    context_score FLOAT, -- % conversations without context issues

    -- Overall Quality Score (weighted composite)
    quality_score FLOAT,

    -- Manual Evaluation Stats (from agent_evaluations table)
    manual_evaluations_count INTEGER DEFAULT 0,
    manual_avg_accuracy FLOAT,
    manual_avg_workflow FLOAT,
    manual_avg_format FLOAT,
    manual_avg_instruction_following FLOAT,
    manual_avg_context_usage FLOAT,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(agent_type, date)
);

CREATE INDEX idx_agent_metrics_agent_type ON agent_metrics_daily(agent_type);
CREATE INDEX idx_agent_metrics_date ON agent_metrics_daily(date);
CREATE INDEX idx_agent_metrics_quality ON agent_metrics_daily(quality_score);

-- ============================================
-- 4. AGENT-SPECIFIC TRACKING FLAGS
-- ============================================

-- Add columns to conversations table for workflow tracking
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS workflow_state JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS workflow_violations INTEGER DEFAULT 0;

-- workflow_state examples:
-- ETG: {"eligibility_verified": true, "q1_3_drafted": true, "alternatives_researched": false}
-- Readiness: {"documents_created": ["RA", "Interview Questions"], "current_document": "RA"}
-- CanExport: {"project_loaded": true, "funding_agreement_read": true}

-- Add columns to messages table for instruction tracking
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS user_instruction TEXT, -- Extracted instruction from user message
ADD COLUMN IF NOT EXISTS instruction_followed BOOLEAN, -- Did agent follow it?
ADD COLUMN IF NOT EXISTS instruction_check_method TEXT; -- 'auto', 'manual', 'user_feedback'

-- ============================================
-- 5. VIEWS FOR EASY QUERYING
-- ============================================

-- View: Agent performance summary (last 30 days)
CREATE OR REPLACE VIEW agent_performance_summary AS
SELECT
    agent_type,
    COUNT(DISTINCT c.id) as total_conversations,
    COUNT(DISTINCT c.user_id) as unique_users,

    -- Feedback metrics
    COUNT(cf.id) as total_feedback,
    COUNT(cf.id) FILTER (WHERE cf.rating = 'positive') as positive_count,
    COUNT(cf.id) FILTER (WHERE cf.rating = 'negative') as negative_count,
    ROUND(
        100.0 * COUNT(cf.id) FILTER (WHERE cf.rating = 'positive') /
        NULLIF(COUNT(cf.id), 0),
        1
    ) as positive_rate,

    -- Revision metrics
    ROUND(AVG(cf.revision_count), 1) as avg_revisions,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.revision_count) as median_revisions,

    -- Time metrics
    ROUND(AVG(cf.completion_time_seconds) / 60.0, 1) as avg_time_minutes,

    -- Issue counts (last 30 days)
    COUNT(ft.id) FILTER (WHERE ft.tag IN ('missed-information', 'hallucination', 'wrong-data', 'incomplete-extraction')) as accuracy_issues,
    COUNT(ft.id) FILTER (WHERE ft.tag IN ('wrong-format', 'missing-sections', 'too-long', 'wrong-structure')) as format_issues,
    COUNT(ft.id) FILTER (WHERE ft.tag IN ('already-asked', 'repeated-step', 'wrong-sequence', 'skipped-step')) as workflow_issues,
    COUNT(ft.id) FILTER (WHERE ft.tag IN ('not-what-i-asked', 'wrong-section', 'ignored-request', 'did-opposite')) as instruction_issues,
    COUNT(ft.id) FILTER (WHERE ft.tag IN ('didnt-use-hubspot', 'asked-for-provided-info', 'ignored-uploaded-file')) as context_issues,
    COUNT(ft.id) FILTER (WHERE ft.tag IN ('perfect', 'ready-to-submit', 'exactly-what-i-needed', 'great-work')) as success_indicators

FROM conversations c
LEFT JOIN conversation_feedback cf ON c.id = cf.conversation_id
LEFT JOIN messages m ON cf.message_id = m.id
LEFT JOIN feedback_tags ft ON (cf.id = ft.feedback_id OR EXISTS (
    SELECT 1 FROM feedback_notes fn
    WHERE fn.conversation_id = c.id AND ft.note_id = fn.id
))
WHERE c.updated_at >= NOW() - INTERVAL '30 days'
GROUP BY c.agent_type;

-- View: Detailed feedback with tags
CREATE OR REPLACE VIEW feedback_with_tags AS
SELECT
    cf.id as feedback_id,
    cf.conversation_id,
    c.agent_type,
    c.user_id,
    u.name as user_name,
    cf.rating,
    cf.feedback_text,
    cf.revision_count,
    cf.completion_time_seconds,
    cf.created_at as feedback_date,
    ARRAY_AGG(DISTINCT ft.tag) FILTER (WHERE ft.tag IS NOT NULL) as tags,
    fn.note_text as additional_notes
FROM conversation_feedback cf
JOIN conversations c ON cf.conversation_id = c.id
JOIN users u ON cf.user_id = u.id
LEFT JOIN feedback_tags ft ON cf.id = ft.feedback_id
LEFT JOIN feedback_notes fn ON c.id = fn.conversation_id AND cf.user_id = fn.user_id
GROUP BY cf.id, c.agent_type, c.user_id, u.name, cf.rating, cf.feedback_text,
         cf.revision_count, cf.completion_time_seconds, cf.created_at, fn.note_text;

-- ============================================
-- 6. FUNCTIONS FOR METRIC CALCULATION
-- ============================================

-- Function to calculate quality score for an agent on a given date
CREATE OR REPLACE FUNCTION calculate_agent_quality_score(
    p_agent_type TEXT,
    p_date DATE
) RETURNS FLOAT AS $$
DECLARE
    v_positive_rate FLOAT;
    v_accuracy_score FLOAT;
    v_workflow_score FLOAT;
    v_format_score FLOAT;
    v_instruction_score FLOAT;
    v_context_score FLOAT;
    v_quality_score FLOAT;
    v_total_conversations INTEGER;
BEGIN
    -- Get conversation count for the date
    SELECT COUNT(DISTINCT c.id) INTO v_total_conversations
    FROM conversations c
    WHERE c.agent_type = p_agent_type
    AND c.created_at::date = p_date;

    -- Return NULL if no conversations
    IF v_total_conversations = 0 THEN
        RETURN NULL;
    END IF;

    -- Calculate positive feedback rate
    SELECT
        COALESCE(
            100.0 * COUNT(*) FILTER (WHERE cf.rating = 'positive') /
            NULLIF(COUNT(*), 0),
            0
        ) INTO v_positive_rate
    FROM conversations c
    JOIN conversation_feedback cf ON c.id = cf.conversation_id
    WHERE c.agent_type = p_agent_type
    AND c.created_at::date = p_date;

    -- Calculate accuracy score (% conversations without accuracy issues)
    SELECT
        100.0 - (
            100.0 * COUNT(DISTINCT c.id) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM feedback_tags ft
                    JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
                    WHERE cf2.conversation_id = c.id
                    AND ft.tag IN ('missed-information', 'hallucination', 'wrong-data', 'incomplete-extraction')
                )
            ) / v_total_conversations
        ) INTO v_accuracy_score
    FROM conversations c
    WHERE c.agent_type = p_agent_type
    AND c.created_at::date = p_date;

    -- Calculate workflow score
    SELECT
        100.0 - (
            100.0 * COUNT(DISTINCT c.id) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM feedback_tags ft
                    JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
                    WHERE cf2.conversation_id = c.id
                    AND ft.tag IN ('already-asked', 'repeated-step', 'wrong-sequence', 'skipped-step')
                )
            ) / v_total_conversations
        ) INTO v_workflow_score
    FROM conversations c
    WHERE c.agent_type = p_agent_type
    AND c.created_at::date = p_date;

    -- Calculate format score
    SELECT
        100.0 - (
            100.0 * COUNT(DISTINCT c.id) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM feedback_tags ft
                    JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
                    WHERE cf2.conversation_id = c.id
                    AND ft.tag IN ('wrong-format', 'missing-sections', 'too-long', 'wrong-structure')
                )
            ) / v_total_conversations
        ) INTO v_format_score
    FROM conversations c
    WHERE c.agent_type = p_agent_type
    AND c.created_at::date = p_date;

    -- Calculate instruction following score
    SELECT
        100.0 - (
            100.0 * COUNT(DISTINCT c.id) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM feedback_tags ft
                    JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
                    WHERE cf2.conversation_id = c.id
                    AND ft.tag IN ('not-what-i-asked', 'wrong-section', 'ignored-request', 'did-opposite')
                )
            ) / v_total_conversations
        ) INTO v_instruction_score
    FROM conversations c
    WHERE c.agent_type = p_agent_type
    AND c.created_at::date = p_date;

    -- Calculate context usage score
    SELECT
        100.0 - (
            100.0 * COUNT(DISTINCT c.id) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM feedback_tags ft
                    JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
                    WHERE cf2.conversation_id = c.id
                    AND ft.tag IN ('didnt-use-hubspot', 'asked-for-provided-info', 'ignored-uploaded-file')
                )
            ) / v_total_conversations
        ) INTO v_context_score
    FROM conversations c
    WHERE c.agent_type = p_agent_type
    AND c.created_at::date = p_date;

    -- Calculate weighted quality score
    -- Weights: Accuracy (30%), Instruction Following (25%), Positive Rate (20%),
    --          Format (10%), Workflow (10%), Context (5%)
    v_quality_score := (
        (COALESCE(v_accuracy_score, 0) * 0.30) +
        (COALESCE(v_instruction_score, 0) * 0.25) +
        (COALESCE(v_positive_rate, 0) * 0.20) +
        (COALESCE(v_format_score, 0) * 0.10) +
        (COALESCE(v_workflow_score, 0) * 0.10) +
        (COALESCE(v_context_score, 0) * 0.05)
    );

    RETURN v_quality_score;
END;
$$ LANGUAGE plpgsql;

-- Function to update agent_metrics_daily for a specific date and agent
CREATE OR REPLACE FUNCTION update_agent_metrics_daily(
    p_agent_type TEXT,
    p_date DATE
) RETURNS VOID AS $$
DECLARE
    v_quality_score FLOAT;
BEGIN
    -- Calculate quality score
    v_quality_score := calculate_agent_quality_score(p_agent_type, p_date);

    -- Insert or update metrics
    INSERT INTO agent_metrics_daily (
        agent_type,
        date,
        conversations_count,
        messages_count,
        unique_users,
        total_feedback,
        positive_feedback,
        negative_feedback,
        positive_feedback_rate,
        avg_revision_count,
        avg_completion_time_seconds,
        accuracy_issues,
        format_issues,
        workflow_issues,
        instruction_issues,
        context_issues,
        success_indicators,
        quality_score,
        updated_at
    )
    SELECT
        p_agent_type,
        p_date,
        COUNT(DISTINCT c.id),
        COUNT(DISTINCT m.id),
        COUNT(DISTINCT c.user_id),
        COUNT(DISTINCT cf.id),
        COUNT(DISTINCT cf.id) FILTER (WHERE cf.rating = 'positive'),
        COUNT(DISTINCT cf.id) FILTER (WHERE cf.rating = 'negative'),
        CASE
            WHEN COUNT(DISTINCT cf.id) > 0 THEN
                ROUND(100.0 * COUNT(DISTINCT cf.id) FILTER (WHERE cf.rating = 'positive') / COUNT(DISTINCT cf.id), 1)
            ELSE NULL
        END,
        AVG(cf.revision_count),
        AVG(cf.completion_time_seconds),
        COUNT(ft.id) FILTER (WHERE ft.tag IN ('missed-information', 'hallucination', 'wrong-data', 'incomplete-extraction')),
        COUNT(ft.id) FILTER (WHERE ft.tag IN ('wrong-format', 'missing-sections', 'too-long', 'wrong-structure')),
        COUNT(ft.id) FILTER (WHERE ft.tag IN ('already-asked', 'repeated-step', 'wrong-sequence', 'skipped-step')),
        COUNT(ft.id) FILTER (WHERE ft.tag IN ('not-what-i-asked', 'wrong-section', 'ignored-request', 'did-opposite')),
        COUNT(ft.id) FILTER (WHERE ft.tag IN ('didnt-use-hubspot', 'asked-for-provided-info', 'ignored-uploaded-file')),
        COUNT(ft.id) FILTER (WHERE ft.tag IN ('perfect', 'ready-to-submit', 'exactly-what-i-needed', 'great-work')),
        v_quality_score,
        NOW()
    FROM conversations c
    LEFT JOIN messages m ON c.id = m.conversation_id
    LEFT JOIN conversation_feedback cf ON c.id = cf.conversation_id
    LEFT JOIN feedback_tags ft ON (cf.id = ft.feedback_id OR EXISTS (
        SELECT 1 FROM feedback_notes fn
        WHERE fn.conversation_id = c.id AND ft.note_id = fn.id
    ))
    WHERE c.agent_type = p_agent_type
    AND c.created_at::date = p_date

    ON CONFLICT (agent_type, date)
    DO UPDATE SET
        conversations_count = EXCLUDED.conversations_count,
        messages_count = EXCLUDED.messages_count,
        unique_users = EXCLUDED.unique_users,
        total_feedback = EXCLUDED.total_feedback,
        positive_feedback = EXCLUDED.positive_feedback,
        negative_feedback = EXCLUDED.negative_feedback,
        positive_feedback_rate = EXCLUDED.positive_feedback_rate,
        avg_revision_count = EXCLUDED.avg_revision_count,
        avg_completion_time_seconds = EXCLUDED.avg_completion_time_seconds,
        accuracy_issues = EXCLUDED.accuracy_issues,
        format_issues = EXCLUDED.format_issues,
        workflow_issues = EXCLUDED.workflow_issues,
        instruction_issues = EXCLUDED.instruction_issues,
        context_issues = EXCLUDED.context_issues,
        success_indicators = EXCLUDED.success_indicators,
        quality_score = EXCLUDED.quality_score,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. TRIGGER TO AUTO-UPDATE METRICS
-- ============================================

-- Trigger function to update daily metrics when feedback is added
CREATE OR REPLACE FUNCTION trigger_update_agent_metrics()
RETURNS TRIGGER AS $$
BEGIN
    -- Update metrics for the conversation's agent and date
    PERFORM update_agent_metrics_daily(
        (SELECT agent_type FROM conversations WHERE id = NEW.conversation_id),
        (SELECT created_at::date FROM conversations WHERE id = NEW.conversation_id)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS feedback_metrics_update ON conversation_feedback;
CREATE TRIGGER feedback_metrics_update
    AFTER INSERT OR UPDATE ON conversation_feedback
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_agent_metrics();

DROP TRIGGER IF EXISTS feedback_tag_metrics_update ON feedback_tags;
CREATE TRIGGER feedback_tag_metrics_update
    AFTER INSERT OR UPDATE OR DELETE ON feedback_tags
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_agent_metrics();

-- ============================================
-- 8. SAMPLE QUERIES FOR DASHBOARD
-- ============================================

-- Example 1: Get agent quality matrix for last 7 days
/*
SELECT
    agent_type,
    ROUND(AVG(positive_feedback_rate), 1) as avg_positive_rate,
    ROUND(AVG(avg_revision_count), 1) as avg_revisions,
    SUM(accuracy_issues) as total_accuracy_issues,
    SUM(format_issues) as total_format_issues,
    SUM(workflow_issues) as total_workflow_issues,
    SUM(instruction_issues) as total_instruction_issues,
    SUM(context_issues) as total_context_issues,
    ROUND(AVG(quality_score), 1) as avg_quality_score
FROM agent_metrics_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY agent_type
ORDER BY avg_quality_score DESC;
*/

-- Example 2: Get detailed feedback for a specific agent
/*
SELECT
    conversation_id,
    user_name,
    rating,
    revision_count,
    tags,
    feedback_text,
    feedback_date
FROM feedback_with_tags
WHERE agent_type = 'etg-writer'
AND feedback_date >= NOW() - INTERVAL '7 days'
ORDER BY feedback_date DESC;
*/

-- Example 3: Track agent improvement over time
/*
SELECT
    date,
    agent_type,
    quality_score,
    positive_feedback_rate,
    accuracy_issues,
    instruction_issues
FROM agent_metrics_daily
WHERE agent_type = 'grant-card-generator'
AND date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC;
*/

-- ============================================
-- NOTES FOR IMPLEMENTATION
-- ============================================

-- To add feedback tags in the application:
-- 1. When user provides feedback text, parse for keywords
-- 2. Insert into feedback_tags table with appropriate tag
-- 3. Metrics will auto-update via trigger
--
-- Common keyword → tag mappings:
-- "missed" / "incomplete" → 'missed-information'
-- "wrong format" / "formatting" → 'wrong-format'
-- "already told you" / "repeated" → 'already-asked'
-- "not what I asked" / "wrong section" → 'not-what-i-asked'
-- "didn't use" / "ignored" → varies by context
-- "perfect" / "exactly" / "great" → 'perfect' or appropriate success tag

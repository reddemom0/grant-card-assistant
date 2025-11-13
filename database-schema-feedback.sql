-- Feedback System Database Schema
-- Railway PostgreSQL
-- Created: Jan 2025
-- Purpose: Track conversation feedback and learning data

-- =====================================================
-- CONVERSATION FEEDBACK (End-of-conversation ratings)
-- =====================================================

CREATE TABLE IF NOT EXISTS conversation_feedback (
    id SERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,

    -- Explicit feedback from user
    rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
    feedback_text TEXT,

    -- Implicit quality signals (auto-captured)
    revision_count INTEGER DEFAULT 0,
    completion_time_seconds INTEGER,
    message_count INTEGER,

    -- Computed quality score (0.0 - 1.0)
    -- Based on rating + implicit signals
    quality_score FLOAT,

    -- AI Sentiment Analysis
    sentiment VARCHAR(20) CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
    sentiment_score FLOAT,
    sentiment_themes JSONB,
    sentiment_analyzed_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW(),

    -- Ensure one feedback per message
    CONSTRAINT unique_message_rating UNIQUE(message_id)
);

-- =====================================================
-- FEEDBACK NOTES (During conversation)
-- =====================================================

CREATE TABLE IF NOT EXISTS feedback_notes (
    id SERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Note content
    note_text TEXT NOT NULL,

    -- Context: which message were they on when they wrote this?
    message_index INTEGER,

    -- AI Sentiment Analysis
    sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
    sentiment_score FLOAT,
    sentiment_themes JSONB,
    sentiment_analyzed_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- INDEXES for Performance
-- =====================================================

-- Conversation feedback indexes
CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON conversation_feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON conversation_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_message ON conversation_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON conversation_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_feedback_quality ON conversation_feedback(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON conversation_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_feedback_sentiment ON conversation_feedback(sentiment);
CREATE INDEX IF NOT EXISTS idx_conversation_feedback_sentiment_score ON conversation_feedback(sentiment_score);
CREATE INDEX IF NOT EXISTS idx_conversation_feedback_sentiment_analyzed ON conversation_feedback(sentiment_analyzed_at);

-- Feedback notes indexes
CREATE INDEX IF NOT EXISTS idx_notes_conversation ON feedback_notes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON feedback_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_sentiment ON feedback_notes(sentiment);
CREATE INDEX IF NOT EXISTS idx_notes_sentiment_score ON feedback_notes(sentiment_score);
CREATE INDEX IF NOT EXISTS idx_notes_sentiment_analyzed ON feedback_notes(sentiment_analyzed_at);
CREATE INDEX IF NOT EXISTS idx_notes_created ON feedback_notes(created_at DESC);

-- =====================================================
-- COMMENTS for Documentation
-- =====================================================

COMMENT ON TABLE conversation_feedback IS 'Overall conversation ratings (thumbs up/down) with quality metrics and AI sentiment';
COMMENT ON TABLE feedback_notes IS 'Ongoing feedback notes users add during conversations with AI sentiment';

COMMENT ON COLUMN conversation_feedback.quality_score IS 'Composite score (0-1) based on rating + revision count + completion time';
COMMENT ON COLUMN conversation_feedback.sentiment IS 'AI-analyzed sentiment category (positive/negative/neutral/mixed)';
COMMENT ON COLUMN conversation_feedback.sentiment_score IS 'AI-computed sentiment score from -1.0 (very negative) to 1.0 (very positive)';
COMMENT ON COLUMN conversation_feedback.sentiment_themes IS 'JSONB containing confidence, emotions, themes, key_phrases, and summary from AI analysis';
COMMENT ON COLUMN conversation_feedback.sentiment_analyzed_at IS 'Timestamp when AI sentiment analysis was performed';

COMMENT ON COLUMN feedback_notes.sentiment IS 'AI-analyzed sentiment category (positive/negative/neutral/mixed)';
COMMENT ON COLUMN feedback_notes.sentiment_score IS 'AI-computed sentiment score from -1.0 (very negative) to 1.0 (very positive)';
COMMENT ON COLUMN feedback_notes.sentiment_themes IS 'JSONB containing confidence, emotions, themes, key_phrases, and summary from AI analysis';
COMMENT ON COLUMN feedback_notes.sentiment_analyzed_at IS 'Timestamp when AI sentiment analysis was performed';
COMMENT ON COLUMN feedback_notes.message_index IS 'Which message # in conversation when note was written';

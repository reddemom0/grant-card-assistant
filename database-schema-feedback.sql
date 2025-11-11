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

    created_at TIMESTAMP DEFAULT NOW(),

    -- Ensure one feedback per conversation
    UNIQUE(conversation_id)
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

    -- Auto-detected sentiment (simple keyword analysis)
    sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),

    created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- INDEXES for Performance
-- =====================================================

-- Conversation feedback indexes
CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON conversation_feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON conversation_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON conversation_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_feedback_quality ON conversation_feedback(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON conversation_feedback(created_at DESC);

-- Feedback notes indexes
CREATE INDEX IF NOT EXISTS idx_notes_conversation ON feedback_notes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON feedback_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_sentiment ON feedback_notes(sentiment);
CREATE INDEX IF NOT EXISTS idx_notes_created ON feedback_notes(created_at DESC);

-- =====================================================
-- COMMENTS for Documentation
-- =====================================================

COMMENT ON TABLE conversation_feedback IS 'Overall conversation ratings (thumbs up/down) with quality metrics';
COMMENT ON TABLE feedback_notes IS 'Ongoing feedback notes users add during conversations';

COMMENT ON COLUMN conversation_feedback.quality_score IS 'Composite score (0-1) based on rating + revision count + completion time';
COMMENT ON COLUMN feedback_notes.sentiment IS 'Auto-detected from note text using keyword analysis';
COMMENT ON COLUMN feedback_notes.message_index IS 'Which message # in conversation when note was written';

-- Migration: Add AI Sentiment Analysis to conversation_feedback
-- Date: 2025-01-13
-- Purpose: Enable AI sentiment analysis for end-of-conversation ratings

-- Add sentiment analysis columns to conversation_feedback table
ALTER TABLE conversation_feedback
ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20) CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
ADD COLUMN IF NOT EXISTS sentiment_score FLOAT,
ADD COLUMN IF NOT EXISTS sentiment_themes JSONB,
ADD COLUMN IF NOT EXISTS sentiment_analyzed_at TIMESTAMP;

-- Create indexes for sentiment lookups
CREATE INDEX IF NOT EXISTS idx_conversation_feedback_sentiment ON conversation_feedback(sentiment);
CREATE INDEX IF NOT EXISTS idx_conversation_feedback_sentiment_score ON conversation_feedback(sentiment_score);
CREATE INDEX IF NOT EXISTS idx_conversation_feedback_sentiment_analyzed ON conversation_feedback(sentiment_analyzed_at);

-- Add comments for documentation
COMMENT ON COLUMN conversation_feedback.sentiment IS 'Overall sentiment category (positive/negative/neutral/mixed)';
COMMENT ON COLUMN conversation_feedback.sentiment_score IS 'AI-computed sentiment score from -1.0 (very negative) to 1.0 (very positive)';
COMMENT ON COLUMN conversation_feedback.sentiment_themes IS 'JSONB containing confidence, emotions, themes, key_phrases, and summary from AI analysis';
COMMENT ON COLUMN conversation_feedback.sentiment_analyzed_at IS 'Timestamp when AI sentiment analysis was performed';

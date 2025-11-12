-- Migration: Add AI Sentiment Analysis to feedback_notes
-- Date: 2025-01-12
-- Purpose: Enable AI sentiment analysis for during-conversation notes

-- Add sentiment analysis columns to feedback_notes table
ALTER TABLE feedback_notes
ADD COLUMN IF NOT EXISTS sentiment_score FLOAT,
ADD COLUMN IF NOT EXISTS sentiment_themes JSONB,
ADD COLUMN IF NOT EXISTS sentiment_analyzed_at TIMESTAMP;

-- Create index for sentiment score lookups
CREATE INDEX IF NOT EXISTS idx_notes_sentiment_score ON feedback_notes(sentiment_score);
CREATE INDEX IF NOT EXISTS idx_notes_sentiment_analyzed ON feedback_notes(sentiment_analyzed_at);

-- Add comments for documentation
COMMENT ON COLUMN feedback_notes.sentiment IS 'Overall sentiment category (positive/negative/neutral/mixed)';
COMMENT ON COLUMN feedback_notes.sentiment_score IS 'AI-computed sentiment score from -1.0 (very negative) to 1.0 (very positive)';
COMMENT ON COLUMN feedback_notes.sentiment_themes IS 'JSONB containing confidence, emotions, themes, key_phrases, and summary from AI analysis';
COMMENT ON COLUMN feedback_notes.sentiment_analyzed_at IS 'Timestamp when AI sentiment analysis was performed';

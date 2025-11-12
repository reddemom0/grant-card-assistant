/**
 * Sentiment Analysis API
 * POST /api/sentiment-analysis - Trigger sentiment analysis or generate insights
 * GET /api/sentiment-analysis - Get sentiment stats and trends
 */

import { analyzeFeedbackSentiment, analyzeBatchSentiment, calculateSentimentStats, generateFeedbackInsights } from '../src/feedback-learning/sentiment-analyzer.js';
import {
  saveFeedbackSentiment,
  getFeedbackPendingAnalysis,
  getSentimentStats,
  getSentimentTrends,
  getCommonThemes,
  getCommonEmotions,
  getFeedbackWithSentiment
} from '../src/database/sentiment.js';

export default async function handler(req, res) {
  // Handle OPTIONS for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Require authentication
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized - Please log in'
    });
  }

  try {
    // POST: Trigger sentiment analysis
    if (req.method === 'POST') {
      const { action, agentType } = req.body;

      if (action === 'analyze-pending') {
        // Analyze all pending feedback
        console.log('🔍 Finding feedback pending sentiment analysis...');
        const pendingFeedback = await getFeedbackPendingAnalysis(100);

        console.log(`📊 Found ${pendingFeedback.length} feedback items to analyze`);

        if (pendingFeedback.length === 0) {
          return res.status(200).json({
            success: true,
            message: 'No feedback pending analysis',
            analyzed: 0
          });
        }

        // Analyze in batches
        const analyses = await analyzeBatchSentiment(pendingFeedback);

        // Save results to database
        console.log('💾 Saving sentiment analysis results...');
        for (let i = 0; i < pendingFeedback.length; i++) {
          await saveFeedbackSentiment(pendingFeedback[i].id, analyses[i]);
        }

        console.log(`✅ Sentiment analysis complete for ${analyses.length} items`);

        // Calculate stats for response
        const stats = calculateSentimentStats(analyses);

        return res.status(200).json({
          success: true,
          analyzed: analyses.length,
          stats
        });
      }

      if (action === 'generate-insights') {
        // Generate AI-powered insights from all feedback for an agent
        if (!agentType) {
          return res.status(400).json({
            error: 'Missing agentType parameter'
          });
        }

        console.log(`🔍 Generating insights for ${agentType}...`);

        // STEP 1: First, check if any feedback needs sentiment analysis
        console.log(`🔍 Checking for feedback pending sentiment analysis...`);
        const pendingFeedback = await getFeedbackPendingAnalysis(100);

        if (pendingFeedback.length > 0) {
          console.log(`📊 Found ${pendingFeedback.length} feedback items needing sentiment analysis`);
          console.log(`🤖 Running automatic sentiment analysis before generating insights...`);

          // Analyze in batches
          const analyses = await analyzeBatchSentiment(pendingFeedback);

          // Save results to database
          console.log('💾 Saving sentiment analysis results...');
          for (let i = 0; i < pendingFeedback.length; i++) {
            await saveFeedbackSentiment(pendingFeedback[i].id, analyses[i]);
          }

          console.log(`✅ Sentiment analysis complete for ${analyses.length} items`);
        } else {
          console.log(`✅ All feedback already has sentiment analysis`);
        }

        // STEP 2: Fetch all feedback with sentiment data
        const feedbackItems = await getFeedbackWithSentiment(agentType, 90, 200);

        console.log(`📊 Found ${feedbackItems.length} feedback items with sentiment data`);

        if (feedbackItems.length === 0) {
          return res.status(200).json({
            success: true,
            insights: {
              summary: 'No feedback data available yet for this agent.',
              patterns: [],
              strengths: [],
              improvements: [],
              actionItems: [],
              feedbackCount: 0
            }
          });
        }

        // STEP 3: Generate insights using Claude
        const insights = await generateFeedbackInsights(feedbackItems, agentType);

        console.log(`✅ Insights generated successfully`);

        return res.status(200).json({
          success: true,
          insights,
          sentimentAnalyzed: pendingFeedback.length // Tell UI how many were analyzed
        });
      }

      return res.status(400).json({
        error: 'Invalid action. Use "analyze-pending" or "generate-insights"'
      });
    }

    // GET: Retrieve sentiment data
    if (req.method === 'GET') {
      const { action, agentType, days, limit } = req.query;

      switch (action) {
        case 'stats':
          if (!agentType) {
            return res.status(400).json({ error: 'Missing agentType parameter' });
          }

          const stats = await getSentimentStats(agentType, parseInt(days) || 30);

          // Handle NULL values from database
          const total = parseInt(stats?.total) || 0;
          const positive = parseInt(stats?.positive) || 0;
          const negative = parseInt(stats?.negative) || 0;
          const neutral = parseInt(stats?.neutral) || 0;
          const mixed = parseInt(stats?.mixed) || 0;

          return res.status(200).json({
            success: true,
            agentType,
            days: parseInt(days) || 30,
            stats: {
              total,
              positive,
              negative,
              neutral,
              mixed,
              averageScore: parseFloat(stats?.avg_score) || 0,
              averageQuality: parseFloat(stats?.avg_quality) || 0,
              positivePercent: total > 0 ? (positive / total) * 100 : 0,
              negativePercent: total > 0 ? (negative / total) * 100 : 0,
              neutralPercent: total > 0 ? (neutral / total) * 100 : 0,
              mixedPercent: total > 0 ? (mixed / total) * 100 : 0
            }
          });

        case 'trends':
          if (!agentType) {
            return res.status(400).json({ error: 'Missing agentType parameter' });
          }

          const trends = await getSentimentTrends(agentType, parseInt(days) || 30);

          return res.status(200).json({
            success: true,
            agentType,
            days: parseInt(days) || 30,
            trends: trends.map(t => ({
              date: t.date,
              total: parseInt(t.total),
              positive: parseInt(t.positive),
              negative: parseInt(t.negative),
              neutral: parseInt(t.neutral),
              averageScore: parseFloat(t.avg_score),
              averageQuality: parseFloat(t.avg_quality)
            }))
          });

        case 'themes':
          if (!agentType) {
            return res.status(400).json({ error: 'Missing agentType parameter' });
          }

          const themes = await getCommonThemes(agentType, parseInt(limit) || 10);

          return res.status(200).json({
            success: true,
            agentType,
            themes
          });

        case 'emotions':
          if (!agentType) {
            return res.status(400).json({ error: 'Missing agentType parameter' });
          }

          const emotions = await getCommonEmotions(agentType, parseInt(limit) || 10);

          return res.status(200).json({
            success: true,
            agentType,
            emotions
          });

        case 'pending-count':
          const pending = await getFeedbackPendingAnalysis(1000);

          return res.status(200).json({
            success: true,
            pendingCount: pending.length
          });

        default:
          return res.status(400).json({
            error: 'Invalid action parameter',
            availableActions: {
              GET: ['stats', 'trends', 'themes', 'emotions', 'pending-count'],
              POST: ['analyze-pending']
            }
          });
      }
    }

    return res.status(405).json({
      error: 'Method not allowed. Use GET or POST'
    });

  } catch (error) {
    console.error('Sentiment analysis API error:', error);
    return res.status(500).json({
      error: 'Failed to process sentiment analysis',
      message: error.message
    });
  }
}

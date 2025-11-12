/**
 * Test sentiment analysis backfill
 * Requires authentication cookie from browser
 */

async function testBackfill() {
  console.log('🧪 Testing sentiment analysis backfill...\n');

  const baseUrl = 'https://grant-card-assistant-staging.up.railway.app';

  // Note: You'll need to copy your authentication cookie from the browser
  console.log('⚠️  This requires authentication.');
  console.log('   Open browser devtools, go to Application > Cookies');
  console.log('   Copy the "granted_session" cookie value\n');

  // First check how many are pending
  const pendingResponse = await fetch(`${baseUrl}/api/sentiment-analysis?action=pending-count`, {
    headers: {
      'Cookie': `granted_session=${process.env.AUTH_COOKIE || 'YOUR_COOKIE_HERE'}`
    }
  });

  if (!pendingResponse.ok) {
    console.error('❌ Failed to check pending count:', await pendingResponse.text());
    console.error('\n💡 Make sure you set AUTH_COOKIE environment variable with your session cookie');
    return;
  }

  const pendingData = await pendingResponse.json();
  console.log(`📊 Pending analysis: ${pendingData.pendingCount} feedback items\n`);

  if (pendingData.pendingCount === 0) {
    console.log('✅ No feedback pending analysis!');
    return;
  }

  // Trigger analysis
  console.log('🚀 Triggering sentiment analysis...\n');

  const analyzeResponse = await fetch(`${baseUrl}/api/sentiment-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `granted_session=${process.env.AUTH_COOKIE || 'YOUR_COOKIE_HERE'}`
    },
    body: JSON.stringify({
      action: 'analyze-pending'
    })
  });

  if (!analyzeResponse.ok) {
    console.error('❌ Analysis failed:', await analyzeResponse.text());
    return;
  }

  const result = await analyzeResponse.json();
  console.log('✅ Analysis complete!');
  console.log(`   Analyzed: ${result.analyzed} items`);
  console.log(`\n📊 Results:`);
  console.log(`   Positive: ${result.stats.positive} (${result.stats.positivePercent.toFixed(1)}%)`);
  console.log(`   Negative: ${result.stats.negative} (${result.stats.negativePercent.toFixed(1)}%)`);
  console.log(`   Neutral: ${result.stats.neutral} (${result.stats.neutralPercent.toFixed(1)}%)`);
  console.log(`   Mixed: ${result.stats.mixed} (${result.stats.mixedPercent.toFixed(1)}%)`);
  console.log(`   Average Sentiment Score: ${result.stats.averageScore.toFixed(2)} (range: -1.0 to 1.0)`);
  console.log(`   Average Confidence: ${result.stats.averageConfidence.toFixed(2)}`);
}

testBackfill().catch(console.error);

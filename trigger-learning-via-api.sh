#!/bin/bash

# Trigger learning generation via Railway production API
# This uses Railway's DATABASE_URL environment variable automatically

echo "🎯 Triggering learning generation via Railway production API..."
echo ""

# Get your auth token (you'll need to be logged in to production)
# For now, using a simple curl without auth - but production requires auth

PRODUCTION_URL="https://grant-card-assistant-production.up.railway.app"

echo "📡 Calling: POST $PRODUCTION_URL/api/feedback-learning"
echo "📦 Payload: { \"all\": true }"
echo ""

# Trigger learning for all agents
curl -X POST "$PRODUCTION_URL/api/feedback-learning" \
  -H "Content-Type: application/json" \
  -d '{"all": true}' \
  -v

echo ""
echo ""
echo "✅ Request sent!"
echo ""
echo "Note: If you got a 401 Unauthorized error, you need to:"
echo "1. Log in to the production app in your browser"
echo "2. Get your JWT token from cookies"
echo "3. Add it to the curl command with: -H 'Cookie: token=YOUR_JWT_TOKEN'"

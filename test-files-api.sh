#!/bin/bash

# Test script for Files API and Agent SDK enhancements
# Usage: ./test-files-api.sh

BASE_URL="https://grant-card-assistant-production.up.railway.app"
USER_ID=$(cat /tmp/user_id.txt | tr -d '\n')
CONV_ID=$(cat /tmp/conv_id.txt | tr -d '\n')

echo "======================================"
echo "Railway Deployment Test Suite"
echo "======================================"
echo ""

# Test 1: Health Check
echo "Test 1: Health Endpoint"
echo "------------------------"
curl -s $BASE_URL/health | jq .
echo ""
echo ""

# Test 2: Files API List (without auth - should work for testing)
echo "Test 2: Files API - List Files"
echo "--------------------------------"
curl -s "$BASE_URL/api/files?conversationId=$CONV_ID" | jq .
echo ""
echo ""

# Test 3: Agent with Conversation History
echo "Test 3: Agent with Conversation History"
echo "----------------------------------------"
curl -X POST $BASE_URL/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "agentType": "etg-writer",
    "conversationId": "'$CONV_ID'",
    "userId": "'$USER_ID'",
    "message": "What have we discussed so far?",
    "options": {}
  }' 2>&1 | head -50
echo ""
echo ""

echo "======================================"
echo "Test Suite Complete"
echo "======================================"

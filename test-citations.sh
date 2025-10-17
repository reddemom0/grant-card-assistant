#!/bin/bash

# Test script for Citations functionality
# Usage: ./test-citations.sh

BASE_URL="https://grant-card-assistant-production.up.railway.app"

echo "======================================"
echo "Citations Feature Test Suite"
echo "======================================"
echo ""

# Test 1: Process PDF with Citations Enabled
echo "Test 1: PDF with Citations"
echo "--------------------------------"
curl -X POST $BASE_URL/api/pdf/process \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf",
    "prompt": "What are the key performance improvements in Claude 3.5 Sonnet? Please cite specific sections.",
    "enableCitations": true,
    "documentTitle": "Claude 3 Model Card - October Addendum",
    "documentContext": "Technical documentation about Claude 3 model improvements",
    "maxTokens": 2048
  }' | jq .
echo ""
echo ""

# Test 2: PDF with Citations and Caching
echo "Test 2: Citations + Caching"
echo "--------------------------------"
curl -X POST $BASE_URL/api/pdf/process \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf",
    "prompt": "What evaluation benchmarks are mentioned?",
    "enableCitations": true,
    "enableCaching": true,
    "documentTitle": "Claude 3 Model Card",
    "maxTokens": 1024
  }' | jq .
echo ""
echo ""

# Test 3: Citations Summary Analysis
echo "Test 3: Citation Summary Check"
echo "--------------------------------"
echo "This test extracts citation statistics from the response"
curl -X POST $BASE_URL/api/pdf/process \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf",
    "prompt": "Summarize the document structure and main sections.",
    "enableCitations": true,
    "documentTitle": "Claude 3 Model Card",
    "maxTokens": 1024
  }' | jq '.citations.summary'
echo ""
echo ""

# Test 4: Without Citations (Control Test)
echo "Test 4: Without Citations (Control)"
echo "------------------------------------"
curl -X POST $BASE_URL/api/pdf/process \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf",
    "prompt": "What are the key findings?",
    "enableCitations": false,
    "maxTokens": 512
  }' | jq '.citations'
echo "(Should return null - citations disabled)"
echo ""
echo ""

echo "======================================"
echo "Test Suite Complete"
echo "======================================"
echo ""
echo "Expected Results:"
echo "- Tests 1-3: Should include 'citations' object with raw data, summary, sources, and formatted output"
echo "- Test 4: citations should be null (feature disabled)"
echo ""
echo "Citation Structure:"
echo "  .citations.raw[]         - Individual citation objects"
echo "  .citations.summary       - Total counts and statistics"
echo "  .citations.sources[]     - Unique source documents"
echo "  .citations.formatted     - Human-readable markdown"

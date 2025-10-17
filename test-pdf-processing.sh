#!/bin/bash

# Test script for PDF processing functionality
# Usage: ./test-pdf-processing.sh

BASE_URL="https://grant-card-assistant-production.up.railway.app"

echo "======================================"
echo "PDF Processing Test Suite"
echo "======================================"
echo ""

# Test 1: Process PDF from URL
echo "Test 1: Process PDF from URL"
echo "--------------------------------"
curl -X POST $BASE_URL/api/pdf/process \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf",
    "prompt": "What are the key findings in this document? Provide 3 main points.",
    "maxTokens": 1024
  }' | jq .
echo ""
echo ""

# Test 2: Upload and Process PDF (if you have a local PDF)
# Uncomment and modify path to test
# echo "Test 2: Upload and Process PDF"
# echo "--------------------------------"
# curl -X POST $BASE_URL/api/pdf/upload-and-process \
#   -F "file=@/path/to/your/document.pdf" \
#   -F "prompt=Summarize this document" \
#   -F "enableCaching=true" | jq .
# echo ""
# echo ""

# Test 3: Process PDF with Caching Enabled
echo "Test 3: Process PDF with Caching"
echo "--------------------------------"
curl -X POST $BASE_URL/api/pdf/process \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf",
    "prompt": "What model versions are discussed?",
    "enableCaching": true,
    "maxTokens": 512
  }' | jq .
echo ""
echo ""

# Test 4: Batch Processing (example structure)
echo "Test 4: Create Batch Processing Job"
echo "------------------------------------"
echo "Example batch request structure:"
cat <<'EOF'
{
  "requests": [
    {
      "customId": "doc1-summary",
      "url": "https://example.com/doc1.pdf",
      "prompt": "Summarize this document",
      "maxTokens": 1024
    },
    {
      "customId": "doc2-analysis",
      "url": "https://example.com/doc2.pdf",
      "prompt": "Analyze key findings",
      "maxTokens": 1024
    }
  ]
}
EOF
echo ""
echo "(Skipping actual batch creation to avoid costs)"
echo ""

echo "======================================"
echo "Test Suite Complete"
echo "======================================"
echo ""
echo "Note: For full testing including file uploads and batch processing,"
echo "modify the script with your specific PDFs and requirements."

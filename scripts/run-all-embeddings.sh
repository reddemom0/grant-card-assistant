#!/bin/bash

SECRET=$(grep JWT_SECRET .env | cut -d= -f2)
URL="https://grant-card-assistant-production.up.railway.app/generate-embeddings?secret=$SECRET"

echo "🚀 Starting GetGranted Embedding Generation"
echo "Processing in batches of 100 grants..."
echo ""

for i in {1..6}; do
  echo "=== Batch $i/6 ==="
  response=$(curl -s "$URL")
  echo "$response" | jq '.stats'
  echo ""
  sleep 2
done

echo "✅ Complete! Check results above."

#!/bin/bash

echo "🧪 Testing Claude CLI on Railway-like environment..."
echo ""

echo "📂 Current directory: $(pwd)"
echo "🔑 ANTHROPIC_API_KEY set: ${ANTHROPIC_API_KEY:+YES}"
echo "📦 CLI exists: $(test -f ./node_modules/.bin/claude && echo YES || echo NO)"
echo ""

echo "🔍 Running CLI version check..."
./node_modules/.bin/claude --version
echo "Exit code: $?"
echo ""

echo "🔍 Testing CLI with simple prompt (--print mode)..."
echo "test" | ./node_modules/.bin/claude --print "Say hello" 2>&1
echo "Exit code: $?"

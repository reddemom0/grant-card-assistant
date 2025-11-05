#!/bin/bash
# Setup Staging Database on Railway
# This script runs the complete database setup on the staging environment

echo "🚀 Setting up staging database..."
echo ""

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Please install it first:"
    echo "   npm install -g @railway/cli"
    exit 1
fi

echo "📋 This will set up the database schema on your staging environment."
echo "   Make sure you've selected the staging environment in Railway."
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔧 Running database setup..."
echo ""

# Run the SQL file using Railway CLI
railway run psql $DATABASE_URL -f migrations/setup-railway-complete.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Database setup completed successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Try logging into staging: https://grant-card-assistant-staging.up.railway.app"
    echo "  2. Test creating a Google Doc to verify OAuth tokens work"
else
    echo ""
    echo "❌ Database setup failed. Check the errors above."
    exit 1
fi

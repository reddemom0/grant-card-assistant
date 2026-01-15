#!/bin/bash
# Setup Dropbox Environment Variables for Railway
# This script helps you configure Dropbox integration on Railway

echo "========================================"
echo "Dropbox Railway Setup"
echo "========================================"
echo ""
echo "Before running this script, you need to:"
echo "1. Create a Dropbox App at https://www.dropbox.com/developers/apps"
echo "2. Enable permissions: files.metadata.read, files.content.read, sharing.read"
echo "3. Generate OAuth tokens (see DROPBOX_SETUP.md for instructions)"
echo ""
echo "This script will add the following environment variables to Railway:"
echo "  - DROPBOX_APP_KEY"
echo "  - DROPBOX_APP_SECRET"
echo "  - DROPBOX_ACCESS_TOKEN"
echo "  - DROPBOX_REFRESH_TOKEN"
echo "  - DROPBOX_ORACLE_KB_PATH"
echo "  - DROPBOX_NAMESPACE_ID (optional)"
echo "  - DROPBOX_TEAM_MEMBER_ID (optional)"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it with: npm i -g @railway/cli"
    exit 1
fi

# Check if connected to Railway project
if ! railway status &> /dev/null; then
    echo "❌ Not connected to Railway project. Run: railway link"
    exit 1
fi

echo ""
echo "Enter your Dropbox credentials:"
echo ""

# Collect inputs
read -p "Dropbox App Key: " DROPBOX_APP_KEY
read -p "Dropbox App Secret: " DROPBOX_APP_SECRET
read -p "Dropbox Access Token: " DROPBOX_ACCESS_TOKEN
read -p "Dropbox Refresh Token: " DROPBOX_REFRESH_TOKEN
read -p "Oracle KB Path in Dropbox (e.g., /Oracle KB): " DROPBOX_ORACLE_KB_PATH

echo ""
read -p "Do you have a team namespace ID? (y/n): " HAS_NAMESPACE
if [[ $HAS_NAMESPACE == "y" ]]; then
    read -p "Namespace ID: " DROPBOX_NAMESPACE_ID
fi

read -p "Do you have a team member ID? (y/n): " HAS_MEMBER_ID
if [[ $HAS_MEMBER_ID == "y" ]]; then
    read -p "Team Member ID: " DROPBOX_TEAM_MEMBER_ID
fi

echo ""
echo "Setting Railway environment variables..."
echo ""

# Set required variables
railway variables set DROPBOX_APP_KEY="$DROPBOX_APP_KEY"
railway variables set DROPBOX_APP_SECRET="$DROPBOX_APP_SECRET"
railway variables set DROPBOX_ACCESS_TOKEN="$DROPBOX_ACCESS_TOKEN"
railway variables set DROPBOX_REFRESH_TOKEN="$DROPBOX_REFRESH_TOKEN"
railway variables set DROPBOX_ORACLE_KB_PATH="$DROPBOX_ORACLE_KB_PATH"

# Set optional variables if provided
if [[ ! -z "$DROPBOX_NAMESPACE_ID" ]]; then
    railway variables set DROPBOX_NAMESPACE_ID="$DROPBOX_NAMESPACE_ID"
fi

if [[ ! -z "$DROPBOX_TEAM_MEMBER_ID" ]]; then
    railway variables set DROPBOX_TEAM_MEMBER_ID="$DROPBOX_TEAM_MEMBER_ID"
fi

echo ""
echo "✅ Environment variables set successfully!"
echo ""
echo "Next steps:"
echo "1. Deploy your code: git push"
echo "2. Run the indexer on Railway: railway run node scripts/index-dropbox-kb.js"
echo "3. Test the Oracle at your production URL"
echo ""

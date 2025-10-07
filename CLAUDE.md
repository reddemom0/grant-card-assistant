# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Grant Card Assistant is an AI-powered platform for Granted Consulting that provides specialized AI agents for grant writing, claims processing, and business case development. The application is deployed on Vercel as a serverless Node.js application.

## Architecture

### Technology Stack
- **Frontend**: Vanilla HTML/CSS/JavaScript (no framework)
- **Backend**: Node.js serverless functions (Vercel)
- **AI**: Claude API (Anthropic) with streaming responses
- **Storage**:
  - Upstash Redis (conversation state, file context, knowledge base cache)
  - Google Drive (knowledge base documents via Service Account)
- **Authentication**: JWT tokens with Google OAuth 2.0
- **Deployment**: Vercel (serverless)

### Key Components

**api/server.js** (main serverless function, ~3200 lines):
- Unified serverless API handler for all agents
- Claude API integration with streaming support
- Document processing (PDF, DOCX via mammoth/pdf-parse)
- Context-aware conversation management with Redis persistence
- Agent-specific knowledge base selection from Google Drive
- Rate limiting and context size monitoring
- File upload handling with Multer

**Authentication Flow**:
- `api/auth-google.js` - Initiates Google OAuth
- `api/auth-callback.js` - Handles OAuth callback, creates JWT token
- JWT tokens stored in HTTP-only cookies
- Authentication middleware checks JWT for all API requests

**Agent HTML Pages**:
- `index.html` - Dashboard/landing page
- `grant-cards.html` - Grant Card creation agent
- `etg-agent.html` - BC Employee Training Grant specialist
- `bcafe-agent.html` - BC Agriculture and Food Export Program specialist
- `canexport-claims.html` - CanExport SME claims auditor
- `login.html` - Google OAuth login page

### Routing (vercel.json)
- `/api/auth-google` → OAuth initiation
- `/api/auth-callback` → OAuth callback handler
- `/api/*` → Main server.js handler
- Static HTML pages served with clean URLs (e.g., `/grant-cards` → `grant-cards.html`)

## Development Commands

```bash
# Install dependencies
npm install

# Run local development server (Vercel CLI required)
npm run dev

# Deploy to production
npm run deploy
```

## Agent System

Each agent has:
1. **Dedicated HTML page** with specialized UI
2. **System prompt** in `agentPrompts` object (server.js:848)
3. **Document selection function** (e.g., `selectGrantCardDocuments`, `selectETGDocuments`)
4. **Conversation limit** defined in `CONVERSATION_LIMITS` (server.js:72)
5. **Knowledge base** loaded from agent-specific Google Drive folder

### Agent Types
- `grant-cards` - Grant criteria extraction and card creation
- `etg-writer` - ETG business case writing
- `bcafe-writer` - BC Agriculture export applications
- `canexport-claims` - Claims auditing for CanExport SME
- `canexport-writer` - CanExport application writing (planned)
- `readiness-strategist` - Grant readiness assessment (planned)
- `internal-oracle` - Internal knowledge queries (planned)

## Context Management

The system actively monitors Claude API context limits (200K tokens):
- **Warning threshold**: 150K tokens (75%)
- **Hard limit**: 180K tokens (90%) - triggers aggressive pruning
- **Conversation pruning**: Automatically removes old messages based on agent-specific limits
- **Estimation**: `estimateContextSize()` calculates tokens from conversation + knowledge + files

## Knowledge Base System

Documents are loaded from Google Drive using Service Account credentials:
- Cached in Redis with indefinite TTL (`CACHE_PREFIX = 'knowledge-'`)
- Agent-specific folder structure mapped in `AGENT_FOLDER_MAP` (server.js:227)
- Dynamic document selection based on conversation context
- Supports PDF, DOCX, TXT formats
- Access via `getAgentKnowledgeBase(agentType)` and `loadAgentSpecificKnowledgeBase(agentType)`

## File Handling

Users can upload documents for analysis:
- Multer handles multipart/form-data uploads
- Supports PDF (text extraction), DOCX (mammoth), images (OCR placeholder)
- Files are stored in conversation context via `updateConversationFileContext()`
- Claude API supports direct file uploads for images via `uploadFileToAnthropic()`

## Environment Variables Required

```
# Claude AI
ANTHROPIC_API_KEY

# Google OAuth
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

# Google Drive (Service Account)
GOOGLE_DRIVE_FOLDER_ID
GOOGLE_SERVICE_ACCOUNT_KEY (JSON string)

# Redis (Upstash)
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN

# Security
JWT_SECRET
TEAM_PASSWORD (legacy, JWT auth primary)

# Database (Vercel Postgres)
POSTGRES_URL
```

## Important Implementation Notes

1. **Conversation State**: All conversations stored in Redis with 24-hour expiry. Each conversation has metadata including file context and timestamps.

2. **Streaming Responses**: API uses Server-Sent Events (SSE) for real-time streaming. Frontend uses EventSource to receive chunks.

3. **Rate Limiting**: Claude API calls are rate-limited with `RATE_LIMIT_DELAY` (3s between calls) and `MAX_CALLS_PER_MINUTE` (15).

4. **Agent Selection Logic**: Agent type determined by URL path using `getAgentType()` which checks both URL mapping and conversationId prefix.

5. **System Prompts**: Each agent has a unique system prompt with task-specific methodologies. Grant card agent has 6 different task types (grant-criteria, preview-description, etc.) with specialized prompts.

6. **Thinking Tags**: Responses support `<thinking>` tags which are stripped before display using `stripThinkingTags()`.

7. **Document Selection**: Smart document selection functions filter knowledge base to only relevant documents based on conversation context, reducing token usage.

## Common Development Patterns

**Adding a new agent**:
1. Create new HTML page (copy existing agent template)
2. Add route to `vercel.json`
3. Add agent configuration to `AGENT_URL_MAP`, `AGENT_FOLDER_MAP`, `CONVERSATION_LIMITS`
4. Create system prompt in `agentPrompts` object
5. Implement document selection function (e.g., `selectNewAgentDocuments`)
6. Update agent card in `index.html`

**Modifying system prompts**:
- Grant card prompts: `taskMethodologies` object (server.js:624)
- Other agents: `agentPrompts` object (server.js:848)

**Debugging conversations**:
- Check Redis for conversation state (key: conversationId)
- Review `logContextUsage()` output for token estimates
- Monitor `estimateContextSize()` for approaching limits
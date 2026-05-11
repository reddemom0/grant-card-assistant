# CLAUDE.md — Granted AI Hub

Orientation for Claude Code. Keep this file tight. Every line earns its place.

## What this repo is

Internal AI platform for Granted Consulting. Hosts multiple specialized Claude-API agents behind a single Express server with a shared HTML chat UI. Each agent is purpose-built for a specific consulting workflow.

Sister repo (separate): **getgranted-prototype** — the client-facing GG 2.0 prototype (Next.js, PostgreSQL, different architecture). Do not reference or modify it from here.

## Stack

- Node.js 22.x (ESM)
- Express 4
- Anthropic SDK (`@anthropic-ai/sdk`) + Claude Agent SDK
- PostgreSQL via `pg` (Railway)
- Upstash Redis + ioredis
- HubSpot SDK, Google APIs (Drive/Docs/Sheets/Gmail), Dropbox, Voyage AI
- Frontend: vanilla HTML/CSS/JS — no build step

## Deployment

**Railway.** Not Vercel. The Vercel migration happened in fall 2025. Production deploys from the `railway-migration` branch (NOT `main`). Any Vercel references in code, comments, or docs are stale — ignore them. The `.vercelignore` file contains `*` to disable Vercel explicitly.

- Production branch: `railway-migration`
- Deployment config: `railway.json`, `nixpacks.toml`, `Procfile` (all point to `node server.js`)
- Cron jobs: defined in `railway-cron.json`

### `RUN_MODE=sync`

`server.js` short-circuits at line 16 when `RUN_MODE=sync` is set: it executes `scripts/sync-getgranted-database.js` once and exits. This is NOT a persistent cron runner — it's a one-shot DB sync. Railway cron invokes the process with this env var.

## Agents

The hub hosts these agents. Each has a prompt file in `.claude/agents/` and a tool loadout in the `getToolsForAgent` switch in `src/tools/definitions.js` (line 2047).

| Agent | Frontend route | Backend agentType |
|-------|----------------|-------------------|
| Oracle (internal knowledge assistant) | `/oracle` | `internal-oracle` |
| Grant card generator | `/grant-cards` | `grant-card-generator` |
| ETG writer | `/etg-writer` | `etg-writer` |
| BCAFE writer | `/bcafe-writer` | `bcafe-writer` |
| BuyBC writer | `/buybc-writer` | `buybc-writer` |
| CanExport claims | `/canexport-claims` | `canexport-claims` |
| CanExport writer | `/canexport-writer` | `canexport-writer` |
| Readiness strategist | `/readiness-strategist` | `readiness-strategist` |
| Lead-gen (public chatbot) | `/lead-gen` | `lead-gen` |
| Orchestrator | (no UI route) | `orchestrator` |
| GetGranted AI | (no UI route) | `getgranted-ai` |

Two URL aliases exist (URL slug ≠ backend agentType): `oracle → internal-oracle` and `grant-cards → grant-card-generator`. All other mappings are identity.

### Lead-gen A/B variants

The lead-gen agent has two prompt variants selected by `LEAD_GEN_VARIANT` env var (A or B):
- **Variant A** (default): loads `.claude/agents/lead-gen.md` or `lead-gen-variant-a.md`
- **Variant B**: concatenates three files in `.claude/skills/lead-gen-variant-b/` at prompt-load time (NOT via `load_skill` — this is a prompt-load pattern, not a runtime-loadable skill)

For how agents are structured and added, see `.claude/agents/CLAUDE.md` (created as part of Session 2B).

## Request paths

Two distinct paths. They are NOT interchangeable.

### Authenticated agents (`POST /api/chat`)

All agents except lead-gen go through this path:

- **Frontend**: `unified-agents.html` → routes via `AGENT_TYPE_MAP` at line 843
- **Backend**: `server.js` → `src/api/chat.js#handleChatRequest` (line 22) → `src/claude/client.js#runAgent` (line 99) → `src/tools/executor.js`
- **Tool schemas**: `src/tools/definitions.js` (the `getToolsForAgent` switch at line 2047)
- **Storage**: `messages` table (standard schema — see `src/database/messages.js`)

### Public lead-gen (`POST /api/lead-gen/*`)

Separate world with its own:
- HTML: `lead-gen.html` (standalone, separate from unified-agents)
- Endpoints: `/api/lead-gen/chat`, `/api/lead-gen/init`, `/api/lead-gen/event`
- No authentication (public widget on granted.ca)
- Restricted tool set (no HubSpot writes, no `web_fetch`, no file memory)
- Storage: `lead_gen_conversations` table with JSONB messages column (migration `011_lead_gen_conversations.sql`)

## Skills

Skills are runtime-loadable content modules that agents invoke via the `load_skill` tool. Currently **10 registered skills**: `sales`, `research`, `grants`, `canexport-writer`, `bcafe-writer`, `hubspot`, `granted-marketing`, `staff-meeting-recap`, `grant-card-writing`, `grant-card-tagging`.

**Critical: skills have FIVE registration touchpoints.** Missing any one causes silent drift:
1. Folder + files on disk under `.claude/skills/{skill-name}/`
2. `SKILL_PATHS` mapping in `src/tools/load-skill.js`
3. `skill_name` + `sub_skill` enums in `src/tools/definitions.js` (the `LOAD_SKILL_TOOL` definition)
4. `LOAD_SKILL_TOOL.description` (advertises the skill to the model)
5. Tool subset (e.g., `coreHubSpotTools` at `definitions.js:2056`) if the skill teaches tools with restricted access

The enum is a model hint, not server-enforced. Server validation happens at `SKILL_PATHS` lookup. But drift between layers creates confusion.

For the full pattern and how to add new skills, see `.claude/skills/CLAUDE.md` (created as part of Session 2B).

The `hubspot/DEAL_CREATION` skill is the reference implementation — it has all 5 registration points correctly wired.

## Tool registration

Tools follow a split pattern: schemas and implementations live in different files.
- **Schemas**: defined inline or as constants in `src/tools/definitions.js`
- **Implementations**: `src/tools/{tool-area}.js` (e.g., `hubspot.js`, `google-drive.js`, `oracle-search.js`)
- **Executor dispatch**: `src/tools/executor.js`

**Gotcha: two HubSpot layers coexist.**
- `services/hubspot-service.js` (root, older) — used only by `server.js:454` for direct Express routes
- `src/tools/hubspot.js` (newer) — used by agent tool calls via `src/api/lead-gen-finalization.js`, `src/api/hubspot-webhook.js`, tests, scripts

Bug fixes in one do NOT propagate to the other. For more, see `src/tools/CLAUDE.md` (created as part of Session 2B).

## Environment variables

A subset of env vars is in `.env.example`. The full set is only in code. Critical ones:

- **AI**: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`
- **DB**: `DATABASE_URL`, `POSTGRES_URL`
- **Redis**: `REDIS_URL`, `REDIS_PUBLIC_URL`
- **HubSpot**: `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_WEBHOOK_SECRET`
- **Google OAuth + service account**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_DRIVE_FOLDER_ID`, `GMAIL_REFRESH_TOKEN`
- **Dropbox**: `DROPBOX_ACCESS_TOKEN`, `DROPBOX_REFRESH_TOKEN`, plus team/namespace IDs
- **Auth**: `JWT_SECRET`
- **Runtime**: `NODE_ENV`, `PORT`, `RUN_MODE` (when `sync`, server runs DB sync script and exits)
- **Lead-gen**: `LEAD_GEN_VARIANT` (A/B), `LEAD_GEN_TEST_MODE`

Never commit credentials. `.claude/settings.local.json` uses `${VAR}` placeholders, not literal secrets.

## Repo layout

```
.claude/
  agents/              agent prompt files (.md) — see .claude/agents/CLAUDE.md
  skills/              runtime-loadable skills — see .claude/skills/CLAUDE.md
  commands/            Claude Code slash commands (investigate, ship-check, log-decision)
  settings.local.json  local permission allow-rules (credential-safe, redacted)

api/                   route handlers (legacy Vercel-style, still wired — feedback, pdf, files, auth-callback)
docs/
  archive/2025-2026/   historical sprint/planning docs — reference only
  reference/           skill source material (strategic consulting skill v3, program intelligence)

knowledge-base/        reference content consumed by agents (canexport-claims, canexport-writer)
memories/              memory storage (purpose distinct from .memories/ — see below)
.memories/             filesystem storage for ANTHROPIC_MEMORY_TOOL
migrations/            SQL migrations (~35 files)
public/                static assets served by Express
scripts/               ops scripts (embeddings, migrations, diagnostics, sync)
src/
  agents/              prompt loader (load-agents.js) — NOT per-agent folders; agents are flat files
  api/                 route handlers (chat.js, auth.js, admin.js, lead-gen*.js)
  claude/              Claude API client, streaming, query classifier
  database/            DB connection + query modules (messages.js handles both conversation stores)
  email/               sendEmail.js (Gmail REST API, bypasses Railway SMTP block)
  feedback/, feedback-learning/  feedback capture + analysis
  middleware/          Express middleware (auth)
  services/            cross-cutting services (analytics, grant search, lead-notification)
  tools/               tool definitions + implementations — see src/tools/CLAUDE.md
  utils/               shared utilities

tests/                 test suite + fixtures
server.js              main Express app entry point
unified-agents.html    shared chat UI for all authenticated agents
lead-gen.html          standalone public lead-gen UI
```

## Storage: two conversation stores

Agents store messages in two different places depending on which request path they use:
- **Standard agents** (`/api/chat`): `messages` table — normalized schema, one row per message
- **Lead-gen agents** (`/api/lead-gen/*`): `lead_gen_conversations` table with JSONB `messages` column

Any cross-agent tooling (diagnostics, analytics, admin views) needs to handle both paths.

## Memory layers

Two distinct memory systems coexist:
- **`ANTHROPIC_MEMORY_TOOL`** → writes to `.memories/` on disk, cross-conversation (`definitions.js:29`)
- **`MEMORY_TOOLS`** (`memory_store`, `memory_recall`, `memory_list`) → writes to PostgreSQL, per-conversation (`definitions.js:42-76`)

Oracle explicitly opts OUT of `ANTHROPIC_MEMORY_TOOL` (see `definitions.js:2099-2103`: *"EXCLUDE filesystem-based ANTHROPIC_MEMORY_TOOL (.memories/) - wastes iteration checking empty directory"*). Other agents vary. If modifying memory behavior, check the tool loadout for each affected agent.

The `memories/` directory (no leading dot) is a separate storage location — its purpose is not documented in code. Not the same as `.memories/`.

## Working in this repo

- Use Plan mode (Shift+Tab) for any task touching more than one file.
- Delegate exploration to the `researcher` subagent — read-only, separate context window, preserves main session tokens. Or use `/investigate`.
- Use `/ship-check` before committing (will gracefully skip missing quality gates).
- Update `DECISIONS.md` for non-obvious architectural choices. Use `/log-decision`. Entries go at the top. File will be created on first use.
- Don't modify `CLAUDE.md` or sub-CLAUDE.md files casually — propose updates and let the user approve.
- No `git add -A`. Stage specific files intentionally.
- Commit locally, push explicitly. Auto-deploy is wired to `railway-migration`; pushing = deploying.

## Quality checks

This repo uses JavaScript (not TypeScript), so no typecheck script. Test suite: `npm test` (or `tests/run-tests.js` with mode args). ESLint not configured at repo level. `/ship-check` will skip what doesn't exist.

## Recent context

See `DECISIONS.md` (created on first use of `/log-decision`) for the last 5-10 architectural decisions. For older context or implementation history, see `docs/archive/2025-2026/`.

## Dormant / intentionally removed

- `config/` directory — removed in April 2026 Session 1 cleanup (previously held `agent-sdk-config.js`)
- `api/agent-sdk-handler.js`, `test-gdrive-mcp.js` — removed (same cleanup, dead Agent SDK path)
- `api/` folder as a whole is labeled "legacy" in `server.js` comments but is still in the hot path — individual files like `feedback.js`, `pdf-handler.js`, `auth-callback.js` are actively required.

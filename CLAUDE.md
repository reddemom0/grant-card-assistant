# CLAUDE.md — Granted AI Hub

Orientation for Claude Code. Keep this file tight. Every line earns its place.

**Never cite line numbers in this file or in any doc you write.** Name the file and the
symbol. Anchors rot within days; a stale anchor sends the next session into unrelated code.

## What this repo is

Internal AI platform for Granted Consulting. Multiple specialized Claude-API agents behind
one Express server with a shared HTML chat UI, plus one public agent.

## Where current state lives

This file describes structure. Current state lives in per-product blueprints — read the one
for what you are working on before you touch anything.

| Product | Blueprint |
|---|---|
| Oracle + Hub agents | `docs/oracle.md` |
| Lead-gen agent | `docs/lead-gen.md` |

The matching engine, tagger, and GetGranted chat agent live in the sibling repo
`gg3-ai-service`, with their own blueprints. `gg3-ai-api-backend` is Jason's — gateway and
grants data; PRs only, never push.

Anything in `docs/` not listed above is historical unless a blueprint vouches for it.
Several files there describe systems that no longer exist — the blueprints name which.

## Deployment

**Railway, not Vercel.** Production deploys from `railway-migration`, **not `main`**. Any
Vercel reference in code, comments, or docs is stale. `.vercelignore` contains `*`.

Pushing to `railway-migration` deploys to production. Commit locally, push explicitly.

`RUN_MODE=sync` short-circuits `server.js` into a one-shot DB sync and exits. Not a
persistent cron runner.

## Agents

Eleven agent types, dispatched by the `getToolsForAgent` switch in `src/tools/definitions.js`.
Prompts are flat files in `.claude/agents/` loaded by `loadAgentPrompt` in
`src/agents/load-agents.js`.

| Agent | Route | agentType |
|---|---|---|
| Oracle | `/oracle` | `internal-oracle` |
| Grant card generator | `/grant-cards` | `grant-card-generator` |
| ETG writer | `/etg-writer` | `etg-writer` |
| BCAFE writer | `/bcafe-writer` | `bcafe-writer` |
| BuyBC writer | `/buybc-writer` | `buybc-writer` |
| CanExport claims | `/canexport-claims` | `canexport-claims` |
| CanExport writer | `/canexport-writer` | `canexport-writer` |
| Readiness strategist | `/readiness-strategist` | `readiness-strategist` |
| Lead-gen (public) | `/lead-gen` | `lead-gen` |
| Orchestrator | — | `orchestrator` |
| GetGranted AI | — | `getgranted-ai` |

Two URL slugs differ from their agentType (`oracle`, `grant-cards`); the rest are identity.
See `.claude/agents/CLAUDE.md` for how agents are structured and added.

## Request paths

**Three paths run agents. They are not interchangeable.**

1. **`POST /api/chat`** — authenticated, SSE streaming. All agents except lead-gen.
   `handleChatRequest` in `src/api/chat.js` → `runAgent` in `src/claude/client.js` →
   `src/tools/executor.js`. Stores to the `messages` table.
2. **`POST /api/chat/google`** — the Google Chat adapter. Google OIDC verified, acks
   immediately, runs Oracle headlessly (`res: null`). `src/api/chat-google.js`. **Changes to
   `chat.js` or `client.js` affect this path.** See `docs/oracle.md`.
3. **`POST /api/lead-gen/*`** — public, unauthenticated, restricted tools, separate HTML and
   widget. Stores to `lead_gen_conversations`. See `docs/lead-gen.md`.

`POST /api/hubspot-webhook` also drives Oracle headlessly. `POST /api/addon/probe` does not
reach an agent — it is a disposable timeout probe.

## Skills

Twelve registered skills, loaded at runtime via the `load_skill` tool. Any agent can load
any skill — there is no gating by agent type or role.

**Skills have five registration touchpoints. Missing one causes silent drift:**
1. Folder + files on disk under `.claude/skills/{name}/`
2. `SKILL_PATHS` in `src/tools/load-skill.js`
3. `skill_name` + `sub_skill` enums in `src/tools/definitions.js`
4. `LOAD_SKILL_TOOL.description`
5. Tool subset (e.g. `coreHubSpotTools`) if the skill teaches restricted tools

`hubspot/DEAL_CREATION` is the reference implementation — correctly wired at all five.

Known drift: `research/company_intelligence` is registered at points 2–4 but
`.claude/skills/research-consultant/` does not exist on disk, so the call throws.

See `.claude/skills/CLAUDE.md` for the full pattern.

## Tools

Schemas and implementations are split: schemas in `src/tools/definitions.js`,
implementations in `src/tools/{area}.js`, dispatch through `src/tools/executor.js`.

**Two HubSpot layers coexist.** `services/hubspot-service.js` (root, older) backs the direct
Express routes in `server.js`. `src/tools/hubspot.js` (newer) backs agent tool calls. **Fixes
in one do not propagate to the other.**

**Duplicate module trap.** `src/agents/load-agents.js` is live. `src/load-agents.js` is dead —
imported only by a root test file. Same class of trap as the HubSpot split.

**`api/` is mostly dead.** Only about half its files are imported by `server.js`.
`api/auth-callback.js` and `api/auth-google.js` are superseded by `src/api/auth.js` — editing
them has no effect. Verify a file has an importer before changing it.

See `src/tools/CLAUDE.md`.

## Storage

- **Standard agents** → `messages` table, one row per message
- **Lead-gen** → `lead_gen_conversations`, JSONB `messages` column

`src/database/messages.js` handles both. Cross-agent tooling must handle both.

## Memory

Two systems:
- **`ANTHROPIC_MEMORY_TOOL`** → `.memories/` on disk, cross-conversation
- **`MEMORY_TOOLS`** (`memory_store`, `memory_recall`, `memory_list`) → Postgres,
  per-conversation

Oracle and lead-gen both opt **out** of `ANTHROPIC_MEMORY_TOOL`. Check the tool loadout per
agent before changing memory behaviour.

`memories/` (no leading dot) is a third, separate location. Not the same as `.memories/`.

## Environment variables

Full set exists only in code; `.env.example` is a subset. Some production values —
including `LEAD_GEN_VARIANT` — are set in the Railway dashboard and appear in no committed
file. Never commit credentials; `.claude/settings.local.json` uses `${VAR}` placeholders.

## Working in this repo

- **Use Plan mode (Shift+Tab) for any task touching more than one file.**
- **Never `git add -A`. Stage named files only.**
- Delegate exploration to the `researcher` subagent or `/investigate` — read-only, separate
  context, preserves session tokens.
- Slash commands: `/add-agent`, `/add-skill`, `/add-tool`, `/investigate`,
  `/inspect-conversation`, `/ship-check`, `/log-decision`.
- Run `/ship-check` before committing; it skips missing gates.
- Log non-obvious architectural choices in `DECISIONS.md` via `/log-decision`. Newest first.
- Propose changes to `CLAUDE.md` and sub-CLAUDE.md files; don't edit them unasked.

## Quality checks

JavaScript, not TypeScript — no typecheck. Tests: `npm test` (runs `tests/run-tests.cjs`).
ESLint not configured.

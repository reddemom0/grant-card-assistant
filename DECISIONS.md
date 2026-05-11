# Decisions Log

Append new entries at the **top**. Each entry is short — 3-5 lines max. Claude Code reads this for recent context.

Format:
```
## YYYY-MM-DD — short title
**What:** one line
**Why:** one line
**Impact:** files/systems touched
```

---

## 2026-05-11 — Grant card agent rewrite to skill-based architecture
**What:** Replaced 1,288-line `grant-card-generator` prompt with 172-line workflow orchestrator. Added `grant-card-writing` skill (parent `OVERVIEW` + 9 grant-type sub-skills: `RD`, `BUSINESS_ASSESSMENT`, `MARKET_EXPANSION`, `HIRING_TRAINING`, `SYSTEMS_PROCESSES`, `CAPITAL_COST`, `LOANS`, `INVESTMENT`, `PRIZES_CONTESTS`) and `grant-card-tagging` skill (`OVERVIEW`: 13 fields × 52 genres, 0-3 scoring, GG2 v2 mirror-taxonomy compatible). Deleted `genre-tagging` stub. Added `LOAD_SKILL_TOOL` to `grant-card-generator` loadout — meaningful capability change. New uppercase `OVERVIEW` sub-skill entry coexists with existing lowercase `overview` (both intentional).
**Why:** Old prompt cited 4 non-existent KB docs (`GRANT-CRITERIA-Formatter Instructions`, `PREVIEW-SECTION-Generator`, `GENERAL-REQUIREMENTS-Creator`, `MISSING-INFO-Generator`), advertised a fictional `searchGrants` tool (real tool is `search_getgranted`, already wired), and instructed `load_skill` calls the agent couldn't make. Skill-based architecture separates orchestration (agent prompt) from general format rules (`OVERVIEW`) from type-specific section rules (per-type sub-skill) from tagging taxonomy — each piece individually editable.
**Impact:** `.claude/agents/grant-card-generator.md` (rewritten), `.claude/skills/grant-card-writing/` (new, 10 files), `.claude/skills/grant-card-tagging/` (new, 1 file), `.claude/skills/genre-tagging/` (deleted), `src/tools/load-skill.js`, `src/tools/definitions.js` (`SKILL_PATHS`, `skill_name` + `sub_skill` enums, `LOAD_SKILL_TOOL.description`, `grant-card-generator` loadout), root `CLAUDE.md`, `.claude/skills/CLAUDE.md`, `.claude/recipes/add-skill.md`.

---

## 2026-04-30 — Granola MCP integration: 4-task architectural arc
**What:** First remote-MCP-as-tool-source integration in the hub, shipped across Tasks 1 (streamable-HTTP client foundation), 2 (per-user OAuth token storage), 3A-C (DCR client storage, OAuth flow, tool wiring), and 4 (connection UI). Seven decisions worth preserving:
1. **SDK-managed OAuth ceremony** — implement only `OAuthClientProvider` storage adapters; the SDK handles DCR, PKCE, and refresh. Avoided ~200 lines of hand-rolled crypto.
2. **Plaintext tokens** — re-affirmed for `user_oauth_tokens` (see separate entry below). Same deferral applies to all per-user OAuth tokens going forward.
3. **Deployment-scoped DCR** — `mcp_dcr_clients` is one row per provider per deployment, not per user. First user's DCR registration is reused for all subsequent users.
4. **Unconditional tool advertisement** — Oracle sees Granola tools regardless of user connection state; unconnected users get a "please connect" error from the first tool call. Avoids per-message DB lookup to filter tools.
5. **Redis for ephemeral OAuth state** — state + PKCE verifier in Redis with 10-min TTL (separate from long-lived tokens in Postgres). Mirrors existing per-module ioredis pattern.
6. **Generic remote-MCP wrapper** — `createRemoteMCPClient` accepts either `bearerToken` or `authProvider` (XOR). Future remote MCP servers inherit the wrapper without modification.
7. **Fail-quiet status UI** — Granola card on Oracle welcome screen renders nothing when `/api/auth/granola/status` errors, rather than showing a broken card.
**Why:** This arc established patterns the next remote MCP integration will inherit. Capturing rationale here lets future contributors and Claude sessions distinguish principled choices from expedient ones.
**Impact:** `src/mcp/remote-client.js`, `src/database/user-oauth-tokens.js`, `src/database/mcp-dcr-clients.js`, `src/api/granola-oauth-provider.js`, `src/api/granola-auth.js`, `src/utils/granola-oauth-state.js`, `src/tools/granola.js`, `src/tools/definitions.js`, `src/tools/executor.js`, `unified-agents.html`, migrations 019 + 020. Known follow-ups: (a) `src/database/redis.js` shared connection helper is a hygiene refactor target; (b) encryption-at-rest revisit triggered by compliance/audit/partner-contract pressure; (c) generic Connections UI when a second connector ships.

## 2026-04-30 — Plaintext OAuth tokens for `user_oauth_tokens` table
**What:** New generic per-user OAuth token table (migration 019) stores access/refresh tokens as plaintext `TEXT`, mirroring the existing Google convention on the `users` table (migration 004).
**Why:** No application-layer encryption infrastructure exists in the repo today. Introducing it (key management, rotation, BYTEA + IV/tag columns) is a larger lift than this scaffolding warrants and was not requested. Deferred until a concrete trigger appears (compliance, audit, partner contract).
**Impact:** `migrations/019_create_user_oauth_tokens.sql`, `src/database/user-oauth-tokens.js`. Generic table shape allows encryption columns to be added later without breaking changes — refresh_token / access_token columns can be replaced with encrypted variants behind the same CRUD API.

## 2026-04-21 — Oracle model upgraded to Sonnet 4.6 alias (dated-snapshot convention broken)
**What:** Repo-wide swap of `claude-sonnet-4-5-20250929` (dated snapshot) to `claude-sonnet-4-6` (alias) across 14 files; added `sonnet-4-6` branch to `calculateRequestCost` with identical $3/$15 pricing to 4.5.
**Why:** Anthropic hasn't published a dated snapshot for Sonnet 4.6 as of 2026-04-21. Alias is the only available form.
**Impact:** Breaks the repo's dated-snapshot pinning convention. When Anthropic publishes a dated snapshot (e.g., `claude-sonnet-4-6-20260217` or similar), do a follow-up repo-wide swap to restore the convention. Meanwhile the alias floats to whatever Anthropic's latest 4.6 snapshot is.

## 2026-04-21 — Authoring-copy drift — project knowledge can lag live repo
**What:** v1.4 authoring started from a stale `/mnt/project/hubspot-deal-creation-skill-v1_0.md` while the live file was already at v1.3; Claude Code caught the old_str mismatch at install time and aborted before applying bad edits.
**Why:** Authoring copies in the claude.ai project aren't auto-refreshed when the live file is edited elsewhere — five versions (v1.1, v1.2, v1.2.1, v1.3) shipped without the authoring copy being re-uploaded.
**Impact:** Convention — for any skill editable outside this project (GitHub web edits, other Claude Code sessions, other authors), Step 1 of an authoring session is to pull the current live file via Claude Code, or re-upload after significant revisions. No code changes.

## 2026-04-21 — Inspector timestamp fix — no storage skew, only client-side cast bug
**What:** scripts/inspect-conversation.js:95-96 was silently dropping rows from --after/--before windows; fixed by casting bounds as ::timestamptz (mirrors find-oracle-conv.js:25-26).
**Why:** Apparent +2h skew on `conversations.created_at` was a node-pg read-side display artifact on non-UTC hosts (Europe/Madrid). Storage is correct UTC — column populated by `DEFAULT CURRENT_TIMESTAMP` on a UTC server, cross-checked against HubSpot `createdate` in tool_result payloads; zero future-dated rows across 19 audited naked-TS columns.
**Impact:** scripts/inspect-conversation.js (2-line change, commit 1b6115a). No migration, no backfill — a bulk -2h correction would have corrupted clean data. Backlog: learning_applications.learning_updated_at (src/database/learning-tracking.js:51) is the one column that actually binds a JS Date to a naked-TS column; cosmetic only, zero read-side filters.

## 2026-04-20 — Session 2C: diagnostic CLI installed
**What:** Added scripts/inspect-conversation.js as the canonical conversation trace tool for any agent; wraps getConversationToolTrace() with CLI flags.
**Why:** Replaces ad-hoc dump-oracle-trace.js pattern; enables fast triage when team members report issues with a timestamp + agent.
**Impact:** scripts/inspect-conversation.js (new), .claude/commands/inspect-conversation.md (new). The 4 existing ad-hoc scripts remain in place for now; retire in a follow-up after the CLI sees real use.

## 2026-04-20 — Session 2B: root CLAUDE.md + 3 sub-CLAUDE.md orientation system
**What:** Overwrote root CLAUDE.md (Vercel-era → Railway-era) and added .claude/skills/CLAUDE.md, .claude/agents/CLAUDE.md, src/tools/CLAUDE.md. Each fact-checked against live code.
**Why:** Fresh Claude Code sessions were starting with false information (Vercel references, dead file paths). Architecture is now documented in files Chris controls.
**Impact:** CLAUDE.md, .claude/skills/CLAUDE.md, .claude/agents/CLAUDE.md, src/tools/CLAUDE.md.

## 2026-04-20 — Session 2A: skill registry drift resolved
**What:** Added granted-marketing and genre-tagging to skill_name enum + SKILL_PATHS; added OTHER_CONTENT, FOUNDATIONS, COMPANY_CONTEXT, GRANT_BLASTS, BLOGS, DATA_SOURCES to sub_skill enum; removed dead 'writing' entry from enum.
**Why:** Enum was drifting from on-disk reality — granted-marketing worked in production despite being unadvertised (enum is a hint, not server-enforced), genre-tagging existed with no registration at all. Registry now matches disk.
**Impact:** src/tools/definitions.js, src/tools/load-skill.js.

## 2026-04-20 — Session 1: AI hub cleanup
**What:** Removed 15 dead backup/unused files; deleted dead Agent SDK path (config/agent-sdk-config.js, api/agent-sdk-handler.js, POST /api/agent route); archived 137 historical docs to docs/archive/2025-2026/; moved 2 skill-source docs to docs/reference/; redacted 12 credential allow-rules in .claude/settings.local.json; installed researcher subagent + 3 slash commands (/investigate, /ship-check, /log-decision); fixed Vercel-stale dev/deploy scripts in package.json.
**Why:** Multi-session cleanup. Codebase had significant organizational debt making Claude Code slow to orient. ~32K lines of deletion in one commit.
**Impact:** ~161 files changed. Branch: railway-migration. Commit: 63f13e6.

## 2026-04-20 — Adopted Plan Mode for multi-file Claude Code tasks
**What:** Standing convention: any Claude Code task touching 2+ files or requiring judgment uses Plan mode (Shift+Tab) first. Single-file mechanical edits can use auto mode.
**Why:** Manual plan approval caught real issues (OTHER_CONTENT omission in 2A, missing files in 2B install prompt) before execution.
**Impact:** Workflow convention, no file changes.

## 2026-04-20 — Flagged but deferred: src/tools/index.js dead code
**What:** src/tools/index.js references 5 non-existent modules (broken imports). Flagged during Session 2B fact-check. Left in place.
**Why:** Not urgent; nothing imports it. Removal is a Session 3+ cleanup task.
**Impact:** None currently. Future cleanup target.

## 2026-04-20 — Flagged but deferred: dual HubSpot client layer
**What:** services/hubspot-service.js (used by server.js:454 only) and src/tools/hubspot.js (used by executor.js, lead-gen-finalization, hubspot-webhook, tests) are parallel implementations. Bug fixes must be applied to both.
**Why:** Real refactor, not a pre-launch blocker. Documented in src/tools/CLAUDE.md so future changes don't miss either side.
**Impact:** None currently. Phase 3 consolidation target.

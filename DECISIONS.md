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

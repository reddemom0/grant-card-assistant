# Oracle — current state

Blueprint for Oracle and the Hub agents. Current state lives here; CLAUDE.md carries
structure only. No line numbers anywhere in this file — name the file and the symbol.

## What Oracle is

The internal knowledge assistant (`agentType: 'internal-oracle'`). Internal only — not
client-facing, not the GetGranted chat agent. It is becoming the primary interface across
surfaces, with the other Hub agents consolidating underneath it as skills.

## Surfaces

Four routes reference Oracle. Three run it.

| Surface | Handler | Auth | Notes |
|---|---|---|---|
| `POST /api/chat` | `handleChatRequest` in `src/api/chat.js` | JWT in `granted_session` cookie via `authenticateUser` | Synchronous SSE streaming. Frontend is `unified-agents.html`, slug `oracle` → `internal-oracle` |
| `POST /api/chat/google` | `handleGoogleChatEvent` in `src/api/chat-google.js` | Google OIDC ID token, then `users` lookup by email | Acks immediately, runs headless (`res: null`) |
| `POST /api/hubspot-webhook` | `handleHubSpotWebhook` in `src/api/hubspot-webhook.js` | Shared `HUBSPOT_WORKFLOW_TOKEN` in the URL — see below | Headless, forced Haiku, hardcoded `userId = 1` |
| `POST /api/addon/probe` | `handleAddonProbe` in `src/api/addon-probe.js` | Google OIDC | Does not reach Oracle. Disposable timeout probe — sleeps, returns a static card |

**CLAUDE.md's "two distinct request paths" framing is wrong.** There are three that run
agents, plus lead-gen.

### HubSpot webhook auth

Authenticated by a shared `HUBSPOT_WORKFLOW_TOKEN` carried in the URL, set on the "Oracle
Insight - Auto Enrichment" workflow action. `server.js` logs a loud boot error if the env
var is unset, and the endpoint fails closed — it rejects all requests rather than running
open.

HubSpot v3 signature verification is separately deferred: the real sender is a workflow
webhook action that transmits no signature headers, only `x-hubspot-correlation-id`. So the
token is the whole authentication story here. It is a bearer secret in a URL, and this is
the one surface that runs Oracle headlessly as a hardcoded system user — worth knowing when
weighing changes, but it is not an open hole.

### Google Chat adapter

- **Verification.** `verifyChatRequest` checks Google's signature, `aud` exactly equal to
  `GOOGLE_CHAT_AUDIENCE` (the endpoint URL, character-for-character), and issuer email
  equal to `GOOGLE_CHAT_ISSUER_EMAIL` with `email_verified`. Fails closed when either env
  var is unset. Because this deploys as a Workspace add-on rather than a standalone Chat
  app, the issuer is deployment-specific — it is *not* the documented
  `chat@system.gserviceaccount.com`. Verification runs before any side effect.
- **Identity.** `resolveUser` matches `LOWER(email)` with `is_active = true`. Unknown and
  deactivated users get an identical reply so account existence isn't disclosed.
- **State.** Persists to the same `messages`/`conversations` store as the Hub. A
  deterministic UUID v5 derived from the Chat thread name means a Chat thread and a Hub
  conversation are the same row. History accumulates across turns.
- **Model.** Not forced — falls through to the same per-message classifier the Hub uses.
- **Payloads.** `normalizeChatEvent` handles both the classic shape and the Workspace
  add-on shape. The add-on shape has no top-level `type`; reading the classic shape against
  it yields `undefined` everywhere and fails silently. This has broken once already.
- **Response formatting.** Headings rewritten to bold (Chat renders most markdown but not
  headings, skipping fenced code blocks), chunked at 3500 chars on paragraph boundaries,
  posted via the service-account Chat client with markdown markup syntax.
- **No streaming or progressive edits** — deliberately out of scope for Phase 1.

## Confirmation gate

`CONFIRMATION_POLICY` in `src/tools/executor.js`, enforced pre-dispatch inside
`executeToolCall` — a refused call never constructs a client or reaches an external API.
Returns `requires_confirmation: true`, distinct from a generic failure.

**Covers three tools only:**
- `create_calendar_event` — gated only when `attendees` is non-empty
- `update_calendar_event` — gated only when `attendees` is non-empty
- `replace_google_doc_section` — gated unconditionally

**HubSpot is deliberately excluded.** No HubSpot write passes through this gate.
`create_hubspot_deal` is a prompt-only rail — the `hubspot/DEAL_CREATION` skill plus hard
language in Oracle's prompt. Nothing in the executor enforces it.

**Two known limits.** It is a forcing function, not a security boundary — the model can
send `confirmed: true` on the first call; what it guarantees is that the naive path fails
with instructions. And the predicate only sees the input, so `update_calendar_event`
repeats the check in `src/tools/google-calendar.js` after fetching the event.

**It cannot work headlessly.** The gate lives downstream of `runAgent`, so it applies on
every surface — but on Google Chat and the HubSpot webhook there is no human to confirm.
A gated tool there either gets `confirmed: true` from the model or fails.

## Tool loadout

From the `internal-oracle` case in `getToolsForAgent` (`src/tools/definitions.js`).
~63 tools. Oracle builds `oracleBaseTools` from scratch rather than reusing shared
`baseTools`.

Included: `SERVER_TOOLS`, `MEMORY_TOOLS`, `LOAD_SKILL_TOOL`, `ORACLE_TOOLS` (9),
Drive (2), Dropbox read (1), `coreHubSpotTools` (18 of 36), Granola (5), Sheets
read/write (4), Calendar (4), `create_google_doc` only, and `GOOGLE_DOCS_EDIT_TOOLS` (3).

Excluded, with reasons in code:
- `ANTHROPIC_MEMORY_TOOL` — wastes iterations on an empty directory. Postgres
  `MEMORY_TOOLS` are kept.
- The other 18 HubSpot tools (dedup/merge, files, email, notes, funding agreements).
- Three of four `GOOGLE_DOCS_TOOLS` — folder creation and template copying likely blocked
  by the narrow `drive.file` scope; `create_advanced_document` is a closed template enum.

**Structural containment — do not "tidy" this.** `GOOGLE_CALENDAR_TOOLS` and
`GOOGLE_DOCS_EDIT_TOOLS` are each referenced in exactly one place: the `internal-oracle`
case. That is deliberate. They are kept out of `ORACLE_TOOLS` and `GOOGLE_DOCS_TOOLS`
because those get spread into `ALL_TOOLS`, which would hand the orchestrator calendar-write
and document-rewrite repo-wide.

## Prompt

Single file, `.claude/agents/internal-oracle.md` (~331 lines, ~24.5 KB). No concatenation —
the multi-file assembly pattern exists only for lead-gen variant B. `loadAgentPrompt` in
`src/agents/load-agents.js` strips YAML frontmatter if present; Oracle's file has none.

At runtime `runAgent` appends a per-request user-identity block marked **not cacheable**.

## Skills

Oracle can load **all 12** registered skills. There is no gating by agent type or role —
`loadSkill` takes only `{ skill_name, sub_skill }` and validates against `SKILL_PATHS`.
This is deliberate, so Oracle picks up new skills without enum drift.

Two gaps:
- **Oracle's prompt advertises only 7.** Not mentioned: `staff-meeting-recap`,
  `strategy-consulting`, `grant-card-writing`, `canexport-writer`, `bcafe-writer`. The
  model can still load them from the tool description, but gets no routing guidance.
  `staff-meeting-recap` is written as mandatory yet is never mentioned in the prompt.
- **`research/company_intelligence` is broken.** It is in `SKILL_PATHS`, the enum, and the
  tool description, but `.claude/skills/research-consultant/` does not exist on disk. The
  call throws at read time.

## Identity and authorization

- **Store.** One `users` table in Postgres.
- **Sign-in.** Google OAuth in `src/api/auth.js`. Domain locked to `granted.ca`, enforced
  server-side — the `hd` consent parameter is a UX hint only. The check requires exactly
  one `@` and an exact match (`endsWith` would admit `evilgranted.ca`; taking the domain
  after the last `@` would admit `attacker@evil.com@granted.ca`).
- **Session.** JWT in a `granted_session` cookie. `authenticateUser` re-reads role and
  `is_active` from the DB on every request rather than trusting the token payload.
- **Roles.** `user` / `admin`. `is_active === false` fails auth in both middlewares, the
  OAuth callback, and the Chat adapter.
- **HubSpot owner.** `users.hubspot_owner_id`, mapped by exact case-insensitive email match
  against the owners API. Name matching was rejected because three owner records are named
  "Stephanie Sang" and two are "Chris Small". Three of eleven accounts have no usable
  owner: two match archived records, one has no owner record at all. `NULL` means "no valid
  owner" and callers must handle it — `DEAL_CREATION` falls back to asking.
- **Injection.** `runAgent` loads name, email, and owner ID into the non-cacheable identity
  block so the agent can attribute actions without asking. Wrapped in try/catch, never
  fails a turn, skipped when `userId` is null. The HubSpot webhook is *not* skipped — it
  passes `userId = 1` and inherits whatever that row holds.

This is the only read of `users.hubspot_owner_id` in the codebase. Every other
`hubspot_owner_id` hit in `src/tools/hubspot.js` is the HubSpot property of the same name
on contacts/companies/deals — a different thing.

## Behavior worth knowing

- **Model routing is per-message, not per-agent.** `getQueryConfig` in
  `src/claude/query-classifier.js` classifies each message by regex over the user's wording.
  Synthesis/reasoning language routes to Sonnet; research/enrichment language to Haiku. The
  same question phrased differently gets a different model, token budget, and iteration cap.
- **Compaction rewrites history.** `src/utils/conversation-compaction.js` summarizes once
  past ~50,000 tokens, keeping recent turns verbatim. With `maxTurns` at 40 for Oracle
  (30 for every other agent), this is the real shape of its memory.
- **The KB is two retrieval systems behind one tool.** `search_oracle_kb` dispatches to
  `searchOracleHybrid` in `oracle-search-rag.js`, which splits by source: Dropbox documents
  go through vector RAG (Voyage embeddings + reranking) because they're static; Drive
  documents go through the older Redis keyword index in `oracle-search.js` because they're
  live. `oracle-search.js` is still loaded — as a dependency, not the entry point.
- **Prompt caching is ordered.** Cacheable content first, the identity block explicitly
  after it, cache checkpoints every 5 messages. Anything added per-request must go on the
  non-cacheable side or it invalidates the cache every turn.

## Stale docs — do not trust

- `docs/ORACLE-METADATA-SCHEMA.md` — describes the Redis index before hybrid RAG existed.
- `docs/MEMORY_TOOL.md` — documents the file-based memory tool Oracle is excluded from.
  Nothing there describes the Postgres memory Oracle actually uses.
- `docs/BETA_FEATURES.md` — Agent SDK features; that path was removed in April 2026.
- `docs/MCP_GOOGLE_DRIVE_SETUP.md`, `MCP_GDRIVE_IMPLEMENTATION_SUCCESS.md`,
  `RAILWAY_GDRIVE_DEPLOYMENT.md` — describe an MCP-server integration. Drive access today
  is plain tool implementations in `src/tools/google-drive.js`.

`docs/dropbox-probe-findings.md` is current and relevant — Oracle's KB corpus is
Dropbox-sourced.

## Open items

- HubSpot v3 signature verification deferred (workflow token is the only check)
- `research/company_intelligence` skill missing on disk
- Oracle prompt advertises 7 of 12 loadable skills
- Three of eleven users lack a usable HubSpot owner ID
- Confirmation gate has no meaning on headless surfaces

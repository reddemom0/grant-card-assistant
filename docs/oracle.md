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
- **Attachments.** Files on the incoming message are read before the agent runs
  (`readAttachments` in `src/tools/chat-attachments.js`): uploads are downloaded with
  `media.download` as Oracle's own Chat identity (`chat.bot` scope, no admin change); files
  attached from Drive are read with the Drive reader as the sender. Both use
  `extractFileText` in `src/tools/google-drive.js` (PDF, .docx, .xlsx, text) and the 10 MB
  limit, enforced on the download stream since Chat attachment metadata has no size.
  Readable files reach the model as `[Chat attachment: name]` text blocks; unreadable ones
  get one plain line prepended to the reply (`withAttachmentNotes`). A files-only message
  runs on `FILE_ONLY_MESSAGE`. Earlier files in the same thread are read by the
  `read_chat_attachments` tool as the asker (`chat.messages.readonly`, the Chat-history
  grant), limited to the thread in the verified event. **File text is never stored:**
  `runAgent` saves `[Chat attachment: name — read, not stored]` in place of attachment
  blocks and of `read_chat_attachments` results.
- **/learn-this.** "@Oracle /learn-this" in a thread (text intent `learnIntent` in
  `src/tools/team-lessons.js`, checked in `runOracleAndReply`; not a console slash
  command). The slash form counts anywhere in the message as its own word — people
  often write the lesson first and end with "/learn-this"; plain "learn this" counts only
  at the start. It runs `runLearnThis`: the thread's transcript and files are read as the asker
  (`readThreadTranscript`), then Oracle runs once with `allowedTools = LEARN_MODE_TOOLS`
  (read tools plus `save_team_lesson`) and posts a one- or two-line summary. Lessons go to
  `team_lessons` (`migrations/035_team_lessons.sql`, `src/database/team-lessons-store.js`)
  with status verified / unverified / conflict, source, teacher, and thread link;
  `save_team_lesson` is offered only in a learn run (`toolsForRun` in `client.js` drops it
  unless `allowedTools` names it) and refused outside one, and where a lesson came from
  is taken from the verified event. Lessons reach answers as one labelled "Team notes"
  system block in `runAgent` — every active lesson, grouped by skill, capped at 40 — so
  a note doesn't depend on which skill file the model loads. Oracle-only, with uses
  logged to `learning_applications`. Official sources win over notes. Lessons are used in
  every space, DM and the Hub, so only general knowledge is saved, never client
  specifics. The transcript and file text are not stored.
  **In a DM** the source is the person's own message: its text with the command removed
  (`textWithoutCommand`), plus that message's files (read with Oracle's own identity),
  or, when the command is sent
  alone, their messages from the last 10 minutes, at most 5 (`readRecentDmMessages`, as
  the asker; `selectRecentOwnMessages` picks them). A DM lesson is still team-wide, but
  `lessonRow` stores it with `taught_in = 'dm'`, the DM person as teacher, and no thread
  name or link (nobody else can open a DM); it is labelled "taught by [name] in a DM".
  `migrations/036_team_lessons_dm.sql` makes the thread columns nullable and adds
  `taught_in`; it must be applied before the DM code deploys.
  **Confirmation card.** Nothing a learn run finds is used until the teacher confirms it
  (`src/cards/lesson-card.js`, card type `lesson`). `runLearnThis` first posts the card as
  "Checking…" (`startLessonCard`) as a reply in the /learn-this message's own thread, in a
  DM as in a space (`privateMessageViewer` to the teacher in a space, a normal card in a
  DM; only a message with no thread falls back to `<space>/threads/lessons`, unthreaded), then
  updates it in place (`finishLessonCard`): the lessons waiting, or — when none are —
  Oracle's short result, and closes it. `save_team_lesson` saves lessons as
  `state = 'pending'` with `card_id` and a 24-hour `expires_at`; `activeLessons` reads
  `state = 'active'` only. A lesson already in Granted's notes is sent with
  `already_known` and recorded on the card (`data.known`, greyed, never saved). At most 10
  pending per card (`MAX_PENDING_PER_CARD`); beyond that the tool refuses and the card
  counts the overflow. An attached document is scope-checked first (program, region,
  date against the notes); new in-scope facts are saved with `from_document` and labelled
  "from [document], not yet in Granted's notes" — a document never verifies itself.
  Buttons, teacher only (`owner_chat_id`; others get a private refusal): Save, Edit,
  Discard, plus Save all / Discard all with 2+ waiting. Edit opens a dialog — lesson cards
  opt in on their own (`dialogs: true`, `dialogsEnabled(type)` in `render.js`;
  `LESSON_DIALOGS_DISABLED=true` turns it off) while every other card keeps dialogs off —
  and always has the typed fallback "@Oracle edit lesson N: <text>". Either way
  `recheckEdit` runs one restricted learn run with `editLessonId`, and `save_team_lesson`
  confirms that one row with the re-checked text and status. A newer /learn-this in the
  same thread replaces the live card and deletes its waiting lessons — one live card per
  thread, in DMs too. A typed edit sent top-level in a DM (a new thread) falls back to the
  teacher's newest live lesson card in that DM (`liveLessonCard`, `anyInDm`). The hourly
  tracked-cards job calls `expireLessonCards`: pending rows past 24 hours are deleted and
  their cards patched silently — nothing is posted. Card types now receive the pressed
  button's `params` (`handleAction`, `dialogFor`, `submitDialog`).
  `migrations/037_team_lessons_pending.sql` adds `state`, `expires_at`, `card_id`,
  `confirmed_at` and `from_document`; apply it **before** deploying this code — until then
  team notes are unavailable and /learn-this cannot save.

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

Sourcing and honesty rules (cite with links, "couldn't find it" over guessing, estimates show
their math, `[TO CONFIRM]` in drafts, internal guidance attributed) live in one section of the
prompt, **Sources and honesty**. Drafting skills point to it rather than copying it. Re-check
behaviour after prompt changes with `scripts/oracle-checks/run-honesty-checks.mjs` (read-only).

## Skills

Oracle can load **all 13** registered skills. There is no gating by agent type or role —
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
- Drive file reading: clearer declines for .doc, .xls, .pptx, and native Sheets and Slides
  are still to do (Stage 3 of the 2026-09-16 plan). Stages 1 and 2 are done:
  `fetchDriveFileContent` in `src/tools/google-drive.js` reads .docx (`mammoth`) and .xlsx
  (SheetJS) by downloading the bytes and parsing in-process. Files over 10 MB (`size` from
  Drive metadata) are never downloaded; Oracle gets a "too large to read, ask for a smaller
  export" note instead of an error. Excel parsing is capped at 5,000 rows per sheet, since
  the size check is on the compressed file. `xlsx` is SheetJS 0.20.3 installed from the
  official SheetJS CDN tarball (SheetJS no longer publishes to npm; 0.18.5 on npm has
  unfixed high advisories). `npm outdated` and Dependabot do not track it — check
  https://cdn.sheetjs.com for new versions. The same package also parses Hub chat uploads
  in `src/api/chat.js`.
- Honesty checks (`scripts/oracle-checks/run-honesty-checks.mjs`, 2026-09-24): check c
  (Pazmac Tab 8 draft) still fails after four rounds of prompt changes. `[TO CONFIRM]` lands
  in a list below the draft instead of inline, disputed figures ($3.3M vs $3.5M) are
  written in unmarked, and the draft says evidence is "attached" when that is unconfirmed.
  The rule is in the core prompt and in the WRITEUP drafting procedure; the next step is
  likely a structural one, such as a post-draft check, not more prompt wording.
  Later runs vary: some put `[TO CONFIRM]` inline but add an unlabelled derived figure
  ("$2.8M (21%)" decline computed by Oracle).
- RTRI business plan (`BUSINESS_PLAN` in the rtri-tariff skill, 2026-09-24), honesty check f:
  - Budget read untested. Budgets in client folders are native Google Sheets, read with
    `read_sheet_metadata`/`read_sheet_range`, which run on the asker's own Google OAuth token
    (users table), not the service account. The local `.env` has no Google OAuth client, so
    locally every budget reads as unreadable. Test live after deploy: a Pazmac business plan
    should read "8. Budget Submission RTRI - Pazmac" and say Section 10 will be drafted.
  - Conflicting dates across the client's own files are still reconciled rather than marked.
    Pazmac's files give both "June 2025" and "April 6, 2026" for Section 232; Oracle turned
    them into a two-step timeline instead of `[TO CONFIRM: April 6, 2026 or June 2025]`.
  - Section 1 runs long (~4,500 characters against a ~2,500 target), and the character
    counts it reports contradict each other.
  - The status block said "not found (readable)" instead of the fixed wording "found but
    unreadable"; it did name both files and say Section 10 won't be drafted.
- Minor sourcing slips seen in the honesty checks, not yet fixed:
  - Internal field names in answers: `retainerDateSent`, `approvedDate`, `approvedFunding`,
    `dcterms.modified`.
  - HubSpot figures given without record links (approval-rate answer).
  - Narration openers ("Let me fetch…", "I'll put it directly…").
  - "PacifiCan hasn't published approval rates" stated without checking.

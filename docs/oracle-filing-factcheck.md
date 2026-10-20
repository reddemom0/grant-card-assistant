> **Superseded 20 Oct 2026.** The filing rules now live in `.claude/skills/filing/` (SKILL.md and reference.md), updated to Chris's decisions of 20 Oct 2026 (`DECISIONS.md`); the move tool, live folder lookup and written convention this file calls missing all exist. Current state: `dist/inventory/oracle-filing-conventions-current.md` and the "Filing taxonomy" section of `docs/oracle.md`. Kept for history.

# Oracle fact-check: filing skill + daily Drive sweep

Read-only investigation, 2026-10-13, branch `railway-migration`. No code changed, and no
Drive, Chat or external API calls were made. Every claim cites a file and a symbol. Per
CLAUDE.md, no line numbers are used, because they go stale quickly.

Labels: ✅ exists · ⚠️ partial · ❌ missing

---

## 1. Skills

- ✅ **Layout.** Each skill is a folder at `.claude/skills/{name}/` with one markdown file
  per sub-skill. Most files have no frontmatter. The loader ignores frontmatter where it
  exists (`sales-consultant`, `granted-marketing`, `staff-meeting-recap`).
- ✅ **Registration.** There are five touchpoints (see root CLAUDE.md):
  - `SKILL_PATHS` and `loadSkill` in `src/tools/load-skill.js`. `loadSkill` throws
    `Unknown skill` for anything unregistered.
  - The `skill_name` and `sub_skill` enums, plus the description, in `LOAD_SKILL_TOOL` in
    `src/tools/definitions.js`.
- ✅ **Oracle loads skills at runtime.** The `'internal-oracle'` case of `getToolsForAgent`
  includes `LOAD_SKILL_TOOL`. Oracle's prompt (`.claude/agents/internal-oracle.md`, "When to
  Load Skills") tells it when to load each skill. Skills are not pasted into the prompt:
  `loadAgentPrompt` in `src/agents/load-agents.js` does that only for lead-gen variant B.
- ⚠️ **Model routing is per query, not per skill.**
  - `runAgent` (`src/claude/client.js`) calls `getQueryConfig` and `getModelForQuery`
    (`src/claude/query-classifier.js`).
  - Simple and moderate queries go to Haiku 4.5. Complex queries go to Sonnet, and Oracle's
    complex tier is overridden to `claude-sonnet-5-5` with adaptive thinking (`ORACLE_SONNET`).
  - The HubSpot webhook forces Haiku (`src/api/hubspot-webhook.js`).
  - A skill cannot pick its model.

**Registered skills (13):**

| Skill | One line |
|---|---|
| `sales` | Lead farming, LinkedIn research, data quality, ICP |
| `grants` | Eligibility, matching, validation |
| `research` | `company_intelligence` (❌ broken, folder missing) |
| `canexport-writer` | CanExport application drafting |
| `bcafe-writer` | BCAFE final report |
| `hubspot` | `DEAL_CREATION` (reference implementation) |
| `granted-marketing` | Marketing content |
| `staff-meeting-recap` | Weekly staff-meeting recap to the sheet |
| `grant-card-writing` | Card rules for each grant type |
| `grant-card-tagging` | Genre scoring |
| `granted-insights` | Strategic read |
| `strategy-consulting` | Consulting method |
| `rtri-tariff` | PacifiCan tariff program |

**Drift between disk and registry:**
- ❌ `research/company_intelligence` is registered, but `.claude/skills/research-consultant/`
  does not exist.
- ⚠️ These files are on disk but not registered:
  - `canexport-writer/COMPETITIVE_APPLICATIONS.md`
  - `sales-consultant/SKILL.md`
  - `grant-card-writing/_souad-merge-2026-05-20.md`
  - `sales-consultant/scripts/README.md`

## 2. Drive tools

| Tool | Implementation | In Oracle loadout | Runs as |
|---|---|---|---|
| ✅ `search_google_drive` | `searchGoogleDrive`, `src/tools/google-drive.js` | yes | Service account, DWD as the asker, read-only scopes |
| ✅ `read_google_drive_file` | `readGoogleDriveFile`, same file | yes | same |
| ✅ `list_files_in_folder` | `listFilesInFolder`, same file | yes | same |
| ✅ `create_google_doc` | `createGoogleDoc`, `src/tools/google-docs.js` | yes | Asker's own OAuth |
| ✅ Doc edit tools (`read_google_doc_outline`, `insert_into_google_doc`, `replace_google_doc_section`) | `src/tools/google-docs-edit.js` | yes | Asker's OAuth, Docs API only |
| ⚠️ `create_google_drive_folder`, `copy_template_file` | `src/tools/google-drive.js` | **no** (other agents only) | Asker's OAuth |
| ❌ move, rename, share, list shared drives, recent files | none | — | — |

**How the asker's identity reaches Drive.**
1. `resolveUser` in `src/api/chat-google.js` maps the Chat sender to a `userId`.
2. `executeToolCall` in `src/tools/executor.js` looks up that user's email for
   `DELEGATED_DRIVE_TOOLS`.
3. `createDriveClient` in `src/tools/google-drive.js` sets `clientOptions.subject` to that
   email.

If the service-account key fails to parse, `createDriveClient` silently falls back to one
stored `GOOGLE_DRIVE_REFRESH_TOKEN`. On the webhook path, the subject is the webhook system
user.

**Scopes as written in code:**
- `createDriveClient` uses `drive.readonly` and `documents.readonly` when `readOnly`.
  Otherwise it uses `drive`, `documents` and `spreadsheets`.
- User OAuth (`src/api/auth.js`): `profile`, `email`, `drive.file`, `documents`,
  `spreadsheets`, `calendar.events`, `calendar.freebusy`, `chat.messages.readonly`,
  `chat.spaces.readonly`.
- `api/auth-google.js` asks for full `drive`, but that file is dead.
- Not checked: which scopes the Workspace admin console actually grants to the DWD client.

**Can Oracle move or rename a file today?** ❌ No, not as anyone.
- `removeParents` never appears under `src/`.
- No `files.update` call changes a name.
- The only runtime `addParents` calls place newly created docs and sheets into a folder
  (`google-docs-advanced.js`, `google-sheets.js`, `google-docs-construction.js`).
- `google-docs-edit.js` says outright that it makes no Drive calls, because user OAuth is
  `drive.file` only.
- ⚠️ The pieces exist. `createDriveClient(userEmail, false)` already builds a full-`drive`
  DWD client acting as a given user. Nothing calls it for a move.

**Does anything read the live Granted Files folder list?** ❌ Not at runtime.
- Search and list pass `supportsAllDrives` and `includeItemsFromAllDrives`, but nothing calls
  `drives.list`, uses `corpora: 'drive'`, or names a drive ID.
- No prompt, skill or `docs/oracle.md` holds a folder taxonomy.
- ⚠️ Scripts only:
  - The Granted Files drive ID `0AKxoOSs3WbQ0Uk9PVA` is hardcoded in 9 scripts, for example
    `scripts/drive-restructure.mjs` and `scripts/pilot-copy.mjs`.
  - `scripts/drive-restructure.mjs` moves folders with `addParents`/`removeParents`. It runs
    as the **bare service account** (hand-signed JWT, no `sub`, full `drive`) and hardcodes a
    `Clients/` and `Live Clients/` taxonomy.
  - `scripts/gdrive-org-inventory.mjs` uses DWD and calls `/drives` and `corpora: 'drive'`.
    It is the closest model for the sweep's "list new files" step.

## 3. Scheduled jobs

All recurring jobs run **in-process with `node-cron`** and are registered in `server.js` after
the server starts listening. There are no GitHub Actions, no Claude Code routines and no
external pinger. Every job assumes a single Railway instance (see the comments in
`src/cards/jobs.js` and `src/chat-listen/jobs.js`).

| Job | Schedule | Entry | What it does |
|---|---|---|---|
| ✅ Lead-gen finalization | every 10 min | inline `cron.schedule` in `server.js` | Finalizes idle lead-gen conversations (`LEAD_GEN_FINALIZATION_DISABLED` kill switch) |
| ✅ Chat-listen pass | `17 * * * *` UTC | `startChatListen`, `src/chat-listen/jobs.js` | Hourly Chat listen pass |
| ✅ Chat-listen retention | `30 9 * * *` | same | Daily retention cleanup |
| ✅ Tracked cards (hourly) | `5 * * * *` UTC | `startTrackedCards`, `src/cards/jobs.js` | Digests, reminders, `expireLessonCards`, `expireWatchChoices` |
| ✅ Tracked cards (daily) | `0 13 * * *` UTC | same | Refresh and lifecycle |
| ✅ GG3 grant copy | `41 * * * *`, plus once at boot | `startGg3Refresh`, `src/services/gg3-refresh.js` | Copies GG3 grants data; manual run via `GET /api/admin/gg3-refresh` |
| ✅ Pulse spike alert | every 5 min | `src/services/pulse-spike.js` | Env-gated alert |
| ✅ Pulse morning roundup | `0 8 * * *` America/Vancouver | `src/services/pulse-roundup.js` | Env-gated daily DM |
| ✅ Pulse weekly digest | `0 8 * * 1` | `src/services/pulse-digest.js` | Env-gated Monday digest |
| ⚠️ GetGranted DB sync | `0 10 * * *` in `railway-cron.json` | `RUN_MODE=sync` branch in `server.js` → `scripts/sync-getgranted-database.js` | `railway.json` has no cron. Whether this runs is decided only in the Railway dashboard. |

`pulse_stats` is an on-demand tool (`PULSE_STATS_TOOL`), not a job. `RAILWAY_CRON_SETUP.md`
is stale.

**For the sweep:** a new `node-cron` job registered next to the pulse jobs is the established
pattern.

## 4. Chat and the confirm gate

**Sending ✅.** Oracle posts as the Chat app (service account, `chat.bot`):
- `chatClient`, `postMessageWithThread` and `patchCard` in `src/cards/chat-api.js` (cardsV2,
  threads, private viewer)
- `createChatClient` and `postToChat` in `src/api/chat-google.js`

**DMs ⚠️.** `findDmSpace` in `src/cards/chat-api.js` calls `spaces.findDirectMessage`. Its
comment says the app *cannot create* a DM: "the person has to message Oracle first." Nothing
calls `spaces.setup`. A DM is found one of two ways:
- `users.chat_user_id` → `getPulseSubscribers` (`src/services/pulse-subscribers.js`)
- `chat_people.dm_space_name`, cached by `dmSpaceFor` (`src/cards/people.js`)

**Card buttons ✅.**
- Clicks route through `handleGoogleChatEvent` (`src/api/chat-google.js`) to `handleCardClick`
  and `pressAnswer` (`src/cards/actions.js`).
- They need `params.cardId` (a `tracked_cards` row) plus `action`, and dispatch through
  `cardTypeOf` (`src/cards/types.js`) to that type's `handleAction`.
- Every press is logged to `tracked_card_clicks`.

**Confirm gate ✅.**
- **Which tools are gated:** `GATED_TOOLS` in `src/tools/pending-actions.js`. The list covers
  HubSpot deal create/update, notes, `record_lead_outcome`, the two merges,
  `replace_google_doc_section`, and calendar create/update when there are attendees.
- **How it holds a call:** `executeToolCall` (`src/tools/executor.js`) saves the exact call to
  `pending_actions`. Each call expires after 24 h, and a conversation can have only one
  pending call at a time.
- **How it runs:** only through `runPendingAction`.
- **The one exemption:** `AUTO_APPROVED_TOOLS` (HubSpot deal create/update for the webhook
  system account).

**Who can confirm ⚠️.**
- **Typed "yes":** `tryHandleConfirmation` (`src/api/confirmation.js`) accepts it from
  *anyone* in the conversation and does not check them against the proposer.
- **Card buttons:** checks are per action against `owner_chat_id`:
  - `review.hubspot_decline` is owner-only.
  - `review.hubspot` confirm only needs a Hub sign-in (`confirmOutcomeNote` in
    `src/cards/review-card.js`).
  - Lesson buttons are teacher-only.
- There is no allowlist anywhere.

**Can a scheduled job DM Chris with confirm buttons? ⚠️ Mostly.**
- Already exists:
  - Scheduled DMs that carry button cards: `sendDueDigests` (`src/cards/notify.js`) and
    `pulse-digest.js`.
- Missing:
  - a sweep card type (`cardTypeOf` / `allCardTypes`) and its `tracked_cards` row
  - a gated move/rename tool
  - a way into `pending_actions` without a conversation, because `conversation_id` is
    `NOT NULL`
- Chris must have DM'd Oracle at least once.

## 5. State, memory and logging

- **DB:** Postgres via `getPool` / `query` in `src/database/connection.js`. Migrations are
  applied by hand; `autoMigrate` runs only 000, 004 and 005.
- ✅ **Last-run state:** `pulse_alert_state` (`alert_key` PK, `last_sent_at`, migration 040) is
  a generic once-per-key claim table. It is already reused for `weekly_digest:<monday>`. A
  `drive_sweep:<date>` key would fit. `tracked_card_digests` is a per-person-per-day
  precedent.
- ❌ **Rename/move log:** no table exists. The closest are:
  - `pending_actions` (status, result, `confirmed_by`)
  - `tracked_card_clicks`
  - `api_cost_events`

  None of them records a file's old and new name and parents.
- **Memory:**
  - `MEMORY_TOOLS` write to Postgres `conversation_memory`, which is per conversation and so
    no use for sweep state.
  - Oracle opts out of `ANTHROPIC_MEMORY_TOOL` (`.memories/`).

## 6. Docs: current vs stale

| Doc | Status |
|---|---|
| `docs/oracle.md` | ⚠️ Mostly current (last commit 2026-10-05), but has the wrong claims listed below |
| Root `CLAUDE.md`, `src/tools/CLAUDE.md`, `.claude/agents/CLAUDE.md`, `.claude/skills/CLAUDE.md` | ✅ Current on the points checked |
| `DECISIONS.md` | ✅ Current to 2026-10-06 |
| `docs/oracle-gg3/*` | ✅ Pre-build research, recent |
| `docs/reference/oracle-centralization.open-questions.md`, `docs/runbooks/gg3-readonly-access.md` | Not checked in depth |
| `docs/inventory/*` | Drive-migration working files, not Oracle design (not checked) |
| `RAILWAY_CRON_SETUP.md`, `railway-cron.json` | ❌ Stale or orphaned unless the dashboard uses them |

**Wrong claims in `docs/oracle.md`:**
1. **"Confirmation gate" section.** It describes a `CONFIRMATION_POLICY` covering 3 tools,
   says HubSpot is excluded, and says the model can pass `confirmed: true`. The live gate is
   `GATED_TOOLS` plus `pending_actions`. HubSpot is gated, and `executeToolCall` strips
   `confirmed`. The open item "gate has no meaning on headless surfaces" is stale for the same
   reason.
2. **Webhook "hardcoded `userId = 1`".** `resolveWebhookUser` uses
   `HUBSPOT_WEBHOOK_USER_EMAIL`.
3. **"Drive (2)" and "44 tools in `ORACLE_DEFERRED_TOOLS`".** There are 3 Drive tools and 45
   deferred tools (`pulse_stats` was added). The included list omits `CHAT_HISTORY_TOOLS`,
   `TRACKED_CARD_TOOLS` and `PULSE_STATS_TOOL`, so the "59 tools" total is probably stale.
4. **It says CLAUDE.md frames "two request paths".** Root CLAUDE.md now says three.

## 7. Gaps

### Filing skill ("where does this go / what should I call it" → "do it")

| Piece | Status |
|---|---|
| Skill mechanism (`load_skill`, five touchpoints) | ✅ |
| Read the file to classify it (`read_google_drive_file`, DWD as the asker) | ✅ |
| Asker identity → DWD subject | ✅ |
| Confirm gate (`GATED_TOOLS` + `pending_actions`) | ✅ |
| Live Granted Files folder list at runtime | ❌ The drive ID and the `drives.list` / `corpora: 'drive'` pattern exist only in scripts |
| Naming convention and folder taxonomy written down | ❌ Only hardcoded in `scripts/drive-restructure.mjs` |
| Move/rename tool | ❌ `createDriveClient(userEmail, false)` gives a full-`drive` DWD client to build on |
| Scope guard "only Granted Files or the asker's own My Drive" | ❌ |
| Rename/move audit log | ❌ |

**Riskiest part: the move tool's authority.**
- It acts with full `drive` scope as the asker. Any bug in the guard lets Oracle move files
  anywhere that person can edit.
- The guard has to check the target's `driveId` (Granted Files) or `owners` (the asker), and
  check every destination parent, server-side in the tool, not in the prompt.
- Moving a file *into* a shared drive also needs organizer or content-manager rights. The
  asker may lack these, and Drive does not move a file across owners and drives the way it
  moves one within a drive.
- The current "anyone in the conversation can type yes" confirm rule should be tightened to
  the proposer for this tool.

### Daily sweep

| Piece | Status |
|---|---|
| Scheduler (`node-cron` in `server.js`) | ✅ |
| Once-per-day claim (`pulse_alert_state`) | ✅ |
| DM a card with buttons on a schedule (`postMessageWithThread`, `findDmSpace`) | ✅ (Chris must have DM'd Oracle once) |
| Button routing (`tracked_cards` + `handleCardClick`) | ✅ framework; ❌ sweep card type |
| List files created in the last 24h across every user's My Drive | ❌ Needs DWD to iterate users. `scripts/gdrive-org-inventory.mjs` is the template, and `dwd_impersonate_domain_only` applies (@granted.ca subjects only). |
| List new files in Granted Files | ❌ `corpora: 'drive'` exists only in scripts |
| Meet recordings | ❌ Nothing. They land in the organizer's "Meet Recordings" folder, so per-user DWD would find them. |
| Read new files' contents | ⚠️ `readGoogleDriveFile` works per file. There is no batch or cost guard. |
| HR/finance skip and excluded accounts | ❌ The rules exist only as a decision (owner-based finance exclusion, name-based HR/legal; see the Drive migration notes). They are not in code. |
| Approve-all / approve-by-line → act | ❌ `pending_actions` holds one call per conversation and needs a `conversation_id`. A batch of N proposed moves needs its own table or a card-state design. |
| Action log | ❌ |
| Who can approve | ❌ Must be locked to Chris, because current card checks are per action |

**Riskiest part: unattended reading of everyone's new files.**
- This needs DWD across every account, with content read into a model.
- The HR/finance skip has to happen **before** reading content, using only metadata (owner,
  folder, name). Otherwise the skip check is itself the leak.
- Second-riskiest: the approval click runs many moves at once. Each line has to re-check its
  file before acting (still exists, same parents, same name) and log the outcome.

## Bugs noticed (not fixed)

- `tryHandleConfirmation` (`src/api/confirmation.js`): any member of a shared space can type
  "yes" and run what is pending for that thread.
- `review.hubspot` can be confirmed by any Hub user, while decline is owner-only
  (`src/cards/review-card.js`).
- `sendDueDigests` (`src/cards/notify.js`) records the digest as sent before posting, so a
  failed post loses that day's digest.
- `createDriveClient` silently falls back to one stored refresh token when the
  service-account key fails to parse, so Drive calls stop acting as the asker without any
  error.
- Skill registry drift (section 1) and the stale `docs/oracle.md` claims (section 6).

## Not checked

- The Railway dashboard (cron services, env flags)
- Which scopes the Workspace admin console actually grants to DWD
- Whether migrations 025 (`pending_actions`) and 040 (`pulse_alert_state`) are applied in
  production
- Classifier rules in detail
- The body of `runOracleAndReply`

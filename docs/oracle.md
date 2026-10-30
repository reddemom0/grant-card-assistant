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
| `POST /api/hubspot-webhook` | `handleHubSpotWebhook` in `src/api/hubspot-webhook.js` | Shared `HUBSPOT_WORKFLOW_TOKEN` in the URL — see below | Headless, forced Haiku, runs as the system account named by `HUBSPOT_WEBHOOK_USER_EMAIL` (`resolveWebhookUser`) |
| `POST /api/addon/probe` | `handleAddonProbe` in `src/api/addon-probe.js` | Google OIDC | Does not reach Oracle. Disposable timeout probe — sleeps, returns a static card |

### HubSpot webhook auth

Authenticated by a shared `HUBSPOT_WORKFLOW_TOKEN` carried in the URL, set on the "Oracle
Insight - Auto Enrichment" workflow action. `server.js` logs a loud boot error if the env
var is unset, and the endpoint fails closed — it rejects all requests rather than running
open.

HubSpot v3 signature verification is separately deferred: the real sender is a workflow
webhook action that transmits no signature headers, only `x-hubspot-correlation-id`. So the
token is the whole authentication story here. It is a bearer secret in a URL, and this is
the one surface that runs Oracle headlessly as a system user — worth knowing when
weighing changes, but it is not an open hole.

That user is the Workspace account named by `HUBSPOT_WEBHOOK_USER_EMAIL`, never a hardcoded
ID. `resolveWebhookUser` in `src/api/hubspot-webhook.js` refuses to run when the variable is
unset, has no `users` row, is deactivated, or has a `hubspot_owner_id` (Oracle would default
record owners to it).

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
- **/learn-this.** Two ways in, one run. A registered slash command, ID 6
  (`LEARN_COMMAND_ID` / `CHAT_LEARN_COMMAND_ID` in `src/cards/commands.js`, set up in the
  Cloud console like /help): `handleLearnCommand` checks sign-in (`commandActor`) and calls
  `runLearnThisFromCommand` in `chat-google.js`, passed in as `deps.runLearnThis`; the text
  after the command is `argumentText`. And the typed fallback, "@Oracle /learn-this" in a
  thread (text intent `learnIntent` in `src/tools/team-lessons.js`, checked in
  `runOracleAndReply`). In the typed form the slash form counts anywhere in the message as
  its own word — people often write the lesson first and end with "/learn-this"; plain
  "learn this" counts only at the start. Both run `runLearnThis`: the thread's transcript and files are read as the asker
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
  DM as in a space (a normal card visible to everyone in the space, and the same in a DM;
  refusals to non-teachers who press it stay private (`tellPresser`);
  only a message with no thread falls back to `<space>/threads/lessons`, unthreaded), then
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
  Discard, plus Save all / Discard all with 2+ waiting. A saved lesson keeps a Remove button:
  it retires the lesson (`retireLesson` sets `retired_at`, so answers stop using it on the
  next run) and the card says "Removed". Saved lessons don't count as waiting; the card
  stays open while anything is waiting or can still be removed, and closes after that.
  Expiry only ever touches pending lessons. A newer /learn-this in the same thread still
  closes the old card (one live card per thread), which ends its Remove buttons. Edit opens a dialog — lesson cards
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

## Tracked cards

Cards that live in a Chat thread and are updated in place. Rows are in `tracked_cards`
(`src/database/tracked-cards-store.js`). Each card type's `render` builds the card, and
`renderCard` / `rerenderCard` in `src/cards/update.js` call it with the stored row. Slash
commands are registered in `src/cards/commands.js` (`registerAppCommand`). Each needs a
matching Chat API command in the Cloud console.

| Command | Card | What it does |
|---|---|---|
| `/track`, "@Oracle track this" | `src/cards/track-card.js` (`createTrack`) | Who has the ball on an ask, or (everyone shape) a checklist of the space |
| `/meet`, "@Oracle find 30 min with @Name" | `src/cards/meet-card.js` (`createMeet`) | Three times everyone is free in their own hours, read with the asker's Calendar grant; books one |
| `/watch`, "@Oracle watch" | `src/cards/watch-card.js` (`startWatch` → `setUpWatch`) | Watches one funding program for date changes; one card per program per space |
| `/review` | `src/cards/review-card.js` (`trackReview`) | "Track this as a review?". Oracle fills the card through the `track_review` tool |
| `/help`, joining a space, a first DM | `src/cards/intro-card.js` (`postIntro`, `replyWithIntro`) | Fixed guide per space from `data/chat/space-guides.json`; no parsing |

**Interpreter.**
- `interpretAsk` in `src/cards/interpret.js` makes one Haiku call per new /track, /meet or
  /watch card: `claude-haiku-4-5-20251001`, forced `card_fields` tool output, 6 s cap, no
  retries.
- The rules (`track-parse.js`, `meet-slots.js`, `watch-match.js`) still run first.
- The model's validated fields replace the rule values one by one:
  - track: title, shape, feedback, holder (must be @mentioned), due date
  - meet: topic, plus length and window only when stated
  - watch: program name (must appear in the post)
- The ask is wrapped with `wrapToolOutput('chat_ask', …)` and `UNTRUSTED_DATA_INSTRUCTION`.
  Links go in as names, never URLs.
- It is off with `CARD_INTERPRETER=off`, without `ANTHROPIC_API_KEY`, and under a test runner
  unless `CARD_INTERPRETER=on`. Card tests swap in `fakes.interpret`.
- Review and intro are not interpreted.

**Buttons.**
- Each card type has a fixed pool (`BUTTON_POOLS`). The model's picks are filtered against
  it and saved on the row (`data.buttons`), so Refresh and re-renders keep them.
- /track's primaries are filtered for the shape they were picked for; after Switch the
  other shape shows its full set.
- Buttons that show the card's state (Confirm, Dismiss, Not right, Schedule call, a
  disabled Waiting on client / Call needed) always show.
- Refresh, Switch and Remove people… are always in the card's "More" overflow menu
  (`moreMenu` in `src/cards/render.js`, the `more` argument of `trackedCard`). Each menu item
  is a `button()` result, so a press reaches the same handler.
- An everyone-shape /track card shows "Submit response" (`data.feedback` true) or "I've done
  it" (false). Answers sent elsewhere ("DM me", "email me", "comment in the doc") make it a
  Done checklist, in both the interpreter rule and `isFeedbackAsk`. Its More menu adds
  "Switch to responses" / "Switch to Done checklist" (`track.switchFeedback`): everyone sees
  it, only the requester (`owner_chat_id`) can use it, and rows and stored responses are kept.
  Switch from one ball to everyone re-reads the ask to set `feedback`.
- /meet's only optional button is "Ignore working hours". It can be dropped only while times
  are shown, because the no-times text points to it.
- /watch's buttons are not chosen.

**Links.**
- `driveFilesOf` in `src/cards/doc-links.js` finds Docs, Sheets, Slides and Drive files in a
  message: URLs, rich-link chips, and files attached from Drive. Its URL pattern copies
  `DRIVE_URL` in `chat-google.js`; keep the two in step.
- `normalizeMessage` in `track-thread.js` attaches them as `driveFiles`.
- /track shows each one as "Open doc: <name>". The name comes from Chat (an attachment's
  `contentName`) or from `getDriveFileName` in `src/tools/google-drive.js`: the service
  account acting as the asker, @granted.ca only, 3 s cap. When the name can't be read it
  shows a plain "Open doc" link. A failure never blocks the card.
- /review takes its documents from the same reader (`docLinks` in `commands.js`).

**Fallback.**
- An error, timeout, missing tool call or invalid answer returns `{ ok: false, code }`. The
  card is then built from the rules exactly as before.
- The log line is `Track interpreter fallback — code: …` (and the same for Meet and Watch).
  /track's "Track card posted" line ends `interpreted: yes|no, docs: N`.
- /meet started from a /track card's Schedule call is not interpreted, since its text is
  already that card's title.

**Subject finder.**
- `findSubject` in `src/cards/subject.js` works out what /track, /watch, /review and lead
  triage act on, read as the asker (Chat user grant). Order:
  1. A quote-reply: the quoted message (`readMessage` in `track-thread.js`). It is taken
     as is, `from: 'quote'`, `sure: true`.
  2. The thread's first message.
  3. The last five messages of the space or DM.
- A quote is read only when its read works. Otherwise the finder logs `Subject quote read
  failed — code: …` and carries on with steps 2 and 3.
- It returns `matches` (every message that looked right, nearest first) alongside the
  `others` count.
- /track, /review and lead triage still answer an unsure result with the private
  `confirmSubject` text. /review also accepts a quoted subject.

**Quote-replies.**
- `normalizeChatEvent` carries `quotedMessageName`.
- googleapis 128 (`Schema$QuotedMessageMetadata`) has only the quoted message's name and
  time, never its text, so reading it is a separate `spaces.messages.get` as the asker.
- **A quote of an Oracle message goes into Oracle's context** (`findQuotedMessage` in
  `src/services/quoted-message.js`, called in `chat-google.js` beside the Pulse and briefing
  lookups). It reads the message as the asker (`readMessage` with `raw: true`), else as the
  app (chat.bot). A card message has no `text`, so its card text is flattened instead
  (`cardText`: titles and widgets, link targets kept, buttons dropped).
  - **Oracle's messages only.** The sender must be a BOT; in a space its display name must
    also say Oracle. A quoted person's message adds nothing.
  - `client.js` adds an uncached "The message the user is replying to" block
    (`quotedContextBlock`), with the text wrapped as `<tool_output tool="quoted_message">`.
  - **Filing-sweep cards:** the quoted message name is looked up in `filing_sweep_suggestions`
    (`space_name` + `message_name`). Every file on that card, with its Drive file ID, the
    folder it was in, the sweep's guess and its status, is listed in the block
    (`filing_sweep_log` envelope), with "never ask which file". This works even when the read
    fails, because a sweep row proves the message was Oracle's.
  - A failed read logs `Quoted message: read failed — code: …` and the turn runs without the
    text. Only the quoted message is added; thread replies already have the thread's history.
  - **Kept for the rest of the thread** (`src/services/quoted-context-store.js`, table
    `quoted_contexts`, migration 059: one row per conversation). A found quote is saved
    against the thread's conversation (`saveQuotedContext`). On a later turn with no new
    Oracle quote, `loadQuotedContext` returns it and the block is headed "The message this
    conversation started from". The Chat API isn't called again. A sweep card's files are
    re-read from `filing_sweep_suggestions` so their status is current (the saved list is
    used if that finds nothing).
  - **A newer Oracle quote in the same thread replaces the saved one.** A quote of a
    person's message leaves it in place.
  - **DM fallback:** in a DM, a message typed in the main box starts a new thread, so a new
    conversation. When that has nothing saved, the newest quote saved in the same DM in
    the last 30 minutes (`DM_FALLBACK_MINUTES`) is used. The block then says it may be
    about something else ("use it only if it fits"). The quote is copied to the new
    conversation (`fromDm: true`, so it stays labelled that way), which restarts the
    30 minutes.
  - Logs: `💬 Quoted message carried forward — from: thread|dm, sweep files: N`. Until
    migration 059 is applied, save and load skip silently and only the quoting turn has the
    block.

**/watch choice card.**
- When /watch can't tell the program, it posts a public card in the thread, not a private
  question. That happens when the subject is unsure, or when a quoted post names two or more
  programs.
- The card is a `watch` row with `data.choosing`, filed under the real thread.
- Choices come from `programChoices` in `watch-card.js`:
  - `programsFromPost` in `watch-match.js` collects every labelled, Title Case or acronym
    name;
  - each name is checked with `matchProgram` (score 50 or more);
  - programs we know come first under their own names, and raw post names are used only
    when none match;
  - at most 5.
- No names at all → the private NOT_FOUND note ("@Oracle watch <program name>").
- Buttons `watch.choose1–5` and "None of these" (`watch.choose_none`). Only the asker
  (`owner_chat_id`) can press; anyone else gets a private "Only <name> can pick — type
  /watch yourself to watch this too."
- A pick runs the normal setup (`placeWatch`): a live watch on that program is joined and
  the choice card says so; otherwise the choice card's message becomes the watch card in
  place, so that watch lives in the thread rather than as its own post.
- "None of these" closes the card with "No watch set. Try /watch followed by the program’s
  name."
- Unanswered for 24 hours, `expireWatchChoices` (the hourly job in `jobs.js`) closes it with
  the same line, silently.
- Watch reminders (`sendDueNotices`) and the stored-copy hook (`onStoredMessages`) skip
  choice cards.

**Slash-command threads (TEMP).**
- For a slash command, `normalizeChatEvent` falls back to `appCommandPayload.thread.name`
  when the command's message has no thread.
- The `appcommand` branch of `handleGoogleChatEvent` in `chat-google.js` logs `🧪 TEMP
  slash command fields — …`. It records whether each thread field and a quote are present,
  never values. Remove it once production shows which fields arrive.

**/meet times.**
- Working hours come from `data/cards/working-hours.json`; no Google API exposes them.
  Default 09:00–17:00 Mon–Fri; Chris (`writers@`) 10:00–22:00 with place "Barcelona".
- Each person's zone is their own calendar's (`timeZoneFor` in `people.js`); the file's
  `timeZone` is only for someone Oracle can't read (no Hub sign-in). A slot must fit
  every attendee's window in their own zone; Intl handles DST.
- A stated time ("today at 11am", `parseStatedTime` in `meet-slots.js`) is in the
  asker's zone, read from the ask's own words (the interpreter's window can't carry a
  time). `nearestSlots` offers it first when it works, else "11am is taken" and the
  nearest three, same day first. Any button looks afresh without it.
- Nothing in the window: the earliest times in the 14 days after it, headed "No time
  works for everyone {range} — here are the earliest options".
- Each time is shown in every attendee's zone, the asker's first
  (`slotWordsAcross`); one zone when all share it. Buttons stay in the asker's zone.
- An ask to move a meeting (`rescheduleIntent`) is answered "I can't reschedule
  existing meetings — here are new times you can book instead" plus a normal card; no
  existing event is read or edited. The booked card's own Reschedule button still moves
  the event Oracle created from that card. See DECISIONS.md, 2026-10-05.

## Confirmation gate

`GATED_TOOLS` in `src/tools/pending-actions.js`, enforced pre-dispatch inside
`executeToolCall` (`src/tools/executor.js`). A gated call is not run: it is saved to
`pending_actions` by `savePendingAction` (24 h expiry; a new proposal supersedes any pending
one in the same conversation), described in code-written language by `summarizeAction`, and
returned to the model as `awaiting_confirmation: true`. The only way it reaches its
implementation is `runPendingAction`, which passes a `pendingActionId` that
`executeToolCall` checks against a live row. There is no input flag to bypass it — a stray
`confirmed` key is stripped before dispatch. If the gate itself throws (e.g. migration 025
not applied), the tool is refused, not run.

**Gated:**
- `create_hubspot_deal`, `update_hubspot_deal`, `create_hubspot_note`,
  `record_lead_outcome`, `merge_duplicate_companies`, `merge_duplicate_contacts`,
  `replace_google_doc_section` — always
- `create_calendar_event` — when `attendees` is non-empty
- `update_calendar_event` — when `attendees` is non-empty or the event already has other
  attendees (fetched; a failed read gates, to be safe)
- `file_move_rename`, `file_move_rename_undo` — always; see "Drive move / rename" below

**Checked before saving.** `PREPARE_GATED` in `executor.js` runs a tool's own limit check
before `savePendingAction`: a refusal returns at once with nothing saved, and what is saved
is the checked plan, so the summary describes exactly what will run. Only the two Drive
tools use it.

**Who confirms.** A message that is only a confirmation word is handled by
`tryHandleConfirmation` in `src/api/confirmation.js`, before the model is called. Anyone in
the conversation may confirm — a deliberate choice — and is recorded as `confirmed_by`.
Card buttons (lead triage, review note) confirm the specific action their card shows; their
own owner checks live in each card type's `handleAction`.

**The asker-only exception.** `ASKER_ONLY_TOOLS` (`file_move_rename`,
`file_move_rename_undo`): `canConfirm` in `pending-actions.js` allows only the proposer of a
move, and for an undo the original mover or Chris (`DRIVE_ACTIONS_ADMIN_EMAIL`, default
writers@). `runPendingAction` and `declinePendingAction` enforce it before touching the row,
so typed "yes" and buttons are held to the same rule; anyone else gets "Only <name> can
confirm this." In Chat these proposals get a Confirm/Cancel card
(`src/cards/confirm-card.js`, posted by `runOracleAndReply`) instead of the "reply yes" text;
`pressAnswer` hands `pending.*` presses to it before the tracked-card lookup. Every other
gated tool is unchanged.

**The one exemption.** `AUTO_APPROVED_TOOLS` lets the HubSpot webhook's system account run
`create_hubspot_deal` / `update_hubspot_deal` unattended, logged as `auto_approved` by
`recordAutoApproval`. Merges are never auto-approved.

## Tool loadout

From the `internal-oracle` case in `getToolsForAgent` (`src/tools/definitions.js`).
64 tools; a normal turn is sent 63, because `toolsForRun` in `src/claude/client.js` drops
the run-only `save_team_lesson` unless `allowedTools` names it. Oracle builds
`oracleBaseTools` from scratch rather than reusing shared `baseTools`.

**Tools on demand (Sonnet 5.5 path only).** `withToolSearch` in `src/claude/client.js`
sends the 49 tools in `ORACLE_DEFERRED_TOOLS` with `defer_loading: true` and adds
Anthropic's tool search (`tool_search_tool_bm25`), so rarely used tools stay out of the
cached prefix until Claude searches for them. The list is the tools used in 2 or fewer
conversations over the 30 days to 2026-09-29. `track_review` and `read_chat_attachments`
qualified but stay loaded: the review card and Chat file uploads depend on them.
`gg3_conversations`, `pulse_stats`, `list_granted_files_folders`, `file_move_rename`,
`file_move_rename_undo` and `control_centre` were deferred from the start. Oracle's
Haiku tiers, the HubSpot webhook, and runs restricted by `allowedTools` (/learn-this,
lesson runs) send the full list unchanged. Search results are dropped from reloaded
history (`historyForRequest`), so a later turn searches again.

Included: `SERVER_TOOLS` (2), `MEMORY_TOOLS` (3), `LOAD_SKILL_TOOL`, `ORACLE_TOOLS` (9),
Drive (3), Dropbox read (1), `coreHubSpotTools` (17 of 36), Granola (5), Sheets
read/write (4), Calendar (4), `create_google_doc` only, `GOOGLE_DOCS_EDIT_TOOLS` (3),
`CHAT_HISTORY_TOOLS` (4, including the run-only `save_team_lesson`), `TRACKED_CARD_TOOLS`
(`track_review`), `gg3_conversations` (GetGranted client chats: read, search, troubleshoot,
and log_issue, which files a Control Centre chat card; `src/tools/gg3-conversations.js`),
`pulse_stats`, `control_centre` (`CONTROL_CENTRE_TOOL`, read-only, see below), and
`list_granted_files_folders` (`GRANTED_FILES_FOLDERS_TOOL`), and `FILE_MOVE_RENAME_TOOLS` (2) for
the filing skill.

`gg3_conversations` grant cards: gg3-ai-service removed the `surface_grant_tiles` tool on
2026-10-02 and now stores tiles itself. The conversation's cards are legacy `surface_grant_tiles`
calls followed by `conversations.grant_ids` (`grantsIn`). The cards on one reply come from
`chat_turns.surfaced_grant_ids` by `turn_index`; "not recorded" means that turn has no row
(`chat_turns` starts 2026-08-26 and has gaps until mid-October). Names come from `gg3_grants`
(`grantNames`). Search from/to are Vancouver days (`windowFor`). A conversation is in the
window when one of its `chat_turns` falls inside it; a conversation with no turn rows is in the
window when its created_at to updated_at span overlaps it.

`control_centre` (`src/tools/control-centre-tools.js`) is Oracle's read-only window on the
Control Centre (`docs/control-centre.md`), one tool with thirteen modes: `queue_summary` (open
cards by status, owner and kind; stuck = open with no change or comment for 3+ days, the board's rule; oldest open),
`list_cards` (filters: status, owner incl. `unassigned`, kind, company name/id, grant
name/id, `stuck_only`; at most 20), `card` (one card in full: diagnosis, evidence, flags,
history, linked cards), `overview` (`getOverview(range)` — tiles vs the window before with the
internal share, client-only top lists, chat), `chat_themes` (`latestDigest()`), `grants_list`
(the Grants tab's list, `grantList(range, view)`. `view` is `all`, `most_ignored` (displayed to 3+
clients, most "shown but never opened" first) or `not_matching` (no client matched in the range,
"Never" first). Counts are client-only with `internal_accounts_add`, at most 50) and `grant` (one
grant's page, `grantPage(id, range)`, by root id or part of the name: companies matched by goal
track with the AI review's marks, tags beside card text, engagement by day, recent edits shown as
"app user #N" because the app stores no editor names, and review cards), `coverage` (the Coverage &
changes tab, `coverage(range)`, default month: per main industry the live grants restricted to it,
grants open to every industry, clients, clients who ran matching, average grant matches, thin, and
wrong-industry AI-review cuts, plus province / goal-track / grant-type / grant-vs-loan breakdowns;
`view` `not_matching` gives the Not matching lists through `applyCoverageView`: ran matching but got
zero matches (a coverage gap), not run matching yet (not a gap), and no restricted grants; `industry`
gives one main or specific industry in full, with its grants, clients and cut grants; client-only
with `internal_accounts_add`, and the tagging caveat always included) and `changes`
(`changes(range)`: went live, closed, removed, edited with "app user #N", deadline passed and due
in 30 days; at most 20 per list), and four Chat themes modes over `chat-themes.js`:
`unanswered` and `unmet_needs` (the daily chat review's rows, migration 049, through
`chatOverview(range)`; unanswered groups sortable by "left after"), `chat_outcomes` (the 24-hour
outcome shares, chat health with the two daily-pass card types, the most discussed grants) and
`chat_search` (`chatSearch`: a word across client and assistant text, with company, dates, cards
and `include_internal`). `chat_themes` keeps the weekly digest's fields and, with `range`, adds
the daily themes. Chat counts are client-only unless `include_internal`. The grant, coverage and
chat modes share their tab's code and SQL. Every card in every answer carries its link, `${PUBLIC_URL}/control-centre#review/<id>`,
every grant carries `#grants/<id>`, every industry `#coverage/industry/<name>` and every chat `#chat/<id>`
(`src/control-centre/links.js`). SELECTs and the Control Centre's own read helpers only:
Oracle can't move, reassign or close a card. Results are wrapped as untrusted like every
tool result.

The three Drive tools are read-only and run as the asker: `createDriveClient` in
`src/tools/google-drive.js` uses the service account with domain-wide delegation, subject =
the asker's email (looked up in `executeToolCall`). With no usable service-account key they
fail closed with "Drive access unavailable" — there is no fallback to a stored OAuth token.

`list_granted_files_folders` (`listGrantedFilesFolders`, same file) is the filing skill's
live folder check: subfolders at a path in the Granted Files shared drive
(`GRANTED_FILES_DRIVE_ID`), folders only, paged, read-only scope, as the asker. Stricter
than the other three: with no @granted.ca asker email it refuses rather than running as the
bare service account, and a 403/404 is reported, never retried as another identity.

### Drive move / rename

`file_move_rename` and `file_move_rename_undo` (`src/tools/drive-actions.js`) move one file
and/or rename it, gated and asker-only (above). The limits are code, checked when proposed
(`planFileMove`) and again when confirmed (`executeFileMove`):
- **Identity:** the asker's own delegated client (`delegatedDriveClient` in `google-drive.js`);
  writes ask for exactly the `drive` scope (delegation refuses `spreadsheets`, and one refused
  scope fails the token). No asker, a bad key, or `tomliao@`/`payment@` → refused. No retry
  as anyone else.
- **Source:** a file in Granted Files or Granted Archive (`GRANTED_ARCHIVE_DRIVE_ID`), or one
  the asker owns in their My Drive. Owned outside granted.ca, someone else's My Drive, a
  folder or a shortcut → refused.
- **Destination:** Granted Files under `Clients/`, `Programs/` or `Departments/`, at least one
  level in; never the root, `Active Clients/`, `Old Files/`, `Departments/Mindfulness`,
  Archive or a My Drive. Missing folders are created only below an existing client, program
  or department folder, and only those the card listed as (new).
- **Sensitive guard (strict):** `SENSITIVE_TERMS` in `src/tools/drive-sensitive.js`, whole
  words, against the file name, the new name and every folder in its current path, plus the
  finance owners. Client files match too ("Financial Statement-…") and are moved by hand.
- **Never:** share, copy, delete or trash — the module has no such call.
- **Google Chat attachments:** a Drive file attached in Chat reaches the model with its file ID and link (`attachmentLabel` in `chat-attachments.js`, kept in the saved placeholder), so it can be filed directly. For a move into Granted Files from another drive, the card warns when the asker isn't a Granted Files Manager ("Undo may need a Granted Files Manager.") and when the file has "anyone with the link" access ("Link sharing may be lost after the move."); both are reads (`moveWarnings` in `drive-actions.js`).

Each executed attempt writes a `drive_actions` row (migration 042: asker, file, parents and
names before/after, paths, folders created, result, `undo_token`) and appends to the "Drive
migration log" sheet (`DRIVE_LOG_SHEET_ID`, Log tab, Run = "Oracle") as the service account
itself, which the sheet is shared with; a failed append is recorded in `sheet_error` and
never fails the action. The undo token goes into the conversation ("Done: … undo token …").
`file_move_rename_undo` restores the old parents and name **as the original mover**,
whoever confirms; it is refused if the file changed since, and leaves created folders in
place.

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

## Filing taxonomy

The rules live in the `filing` skill (`.claude/skills/filing/SKILL.md` for the steps,
`reference.md` for every type, pattern, folder rule and the program table), loaded on demand
with `load_skill`. They describe Granted Files as it is after the October 2026 cleanup
(Chris's decisions of 20 Oct 2026 in `DECISIONS.md`):
- **Client paths:** `Clients/{Client}/{Program}/{YYYY}/…`, the year a bare `YYYY` (season or
  intake subfolders allowed under it). No `{Client}-{Program}-{Year}` folders.
- **`General/`:** the official client-level folder for work tied to no program, with year
  folders (plus `Undated`). Grant Planners live in `Clients/{Client}/General/{YYYY}/`; new
  ones are named `Grant Planner-{Client}-{YYYY}`, existing ones keep their names.
- **Stage folders:** Application, Approval Docs, Claims (`{YYYYMM}` inside), Reimbursements,
  Paystubs, Reporting, Hiring. Oracle reuses an existing variant (`Reimb`, `Reimbursment`…)
  and creates new ones with the standard name only.
- **Programs:** folders use the standard folder name (the `Programs/` names); file names use
  the short code from the program table. Codes marked "(proposed)" await Chris's check.
- **Not filing targets:** `Active Clients/` (shortcuts to live clients only), `Old Files/`,
  `Departments/Mindfulness`, `Review/`, `Pre-Call Briefings/`. `Clients/_Unsorted` is the
  fallback after asking; `Programs/*/_Unfiled` holds unsorted program material.

**Client prefix match.** `listGrantedFilesFolders` calls `resolveGrantedFilesPath` with
`{ clientPrefix: true }`: when a client under `Clients/` has no exact `folderKey` match, a
single folder whose key starts with the typed key is used and reported in
`matched_by_prefix` ("Caliber" → "Caliber Projects"); several are returned as ambiguous; an
exact match always wins. `planFileMove` (`drive-actions.js`) and the Ruk briefing job
(`briefing-drive.js`) don't pass the option and keep exact matching, so a move or a created
folder never lands on a prefix guess.

## Filing sweep (pilot)

`src/services/filing-sweep.js` (rules in `src/services/filing-rules.js`, cards and presses in
`src/cards/sweep-card.js`, log in migrations 055 and 058). **Suggest-only:** nothing moves
without the recipient's Confirm.
- **When:** weekdays 08:30 America/Vancouver (`SWEEP_SCHEDULE`); a summary to the fallback
  (Chris) Mondays 08:45. Both off unless `FILING_SWEEP_ENABLED=true` (`startFilingSweep` in
  `server.js`). A per-day claim in `filing_sweep_runs` stops a second server copy.
- **What it looks at:** Granted Files only, via the Drive change feed since the last
  successful run (`changes.list`, `drive.readonly`, as `FILING_SWEEP_READER_EMAIL`, default
  the fallback). "New" means a file ID not in `filing_sweep_known_files`: the first run
  records every existing file and checks nothing, so there is no backfill. Files Oracle
  filed itself in the last two days are skipped.
- **Rule checks first** (`checkFile`, no model): Client/Program/Year or General/Year, a
  listed Type at the start of a client file's name, the internal patterns for department
  files, and loose files (client root, `_Unsorted`, top of a department or of `Programs/`).
  Excluded: Old Files, Active Clients, Review, Pre-Call Briefings, Departments/Mindfulness,
  HR and FINANCE, sensitive names, folders and shortcuts. A file that passes is logged `ok`.
- **Pilot rules** (reference.md "Claims, paystubs and wage subsidies"; DECISIONS 2026-10-30).
  The checks spot them, the prompt states them, and `evaluate` enforces them whatever the
  model says:
  - **Claim folder** (`claimFolder`): a named folder in `Claims` (not a `YYYYMM` month), or a
    folder below a student or intake folder whose name signals a claim or pay period
    (`CLAIM_OR_PERIOD`: "claim", "pay period", "Oct 8 to Oct 23", "2026-10-08"), or anything
    below either. Files in the second kind (`periodFolder`) are left as they are, name included (`ok`, no card); only the first kind gets the rename-only rule. Never moved: the destination is cleared, so it's a rename only. The
    rename must be `{Type}-Exp{N}-{YYYYMMDD}-{Vendor}` with the file's own expense number and
    full date (`claimRenameProblem`, `visibleDays`), else "not sure". Check: `claim_folder_name`.
  - **Delpreet's paystub name** (`PAYSTUB_CONVENTION`,
    `Paystubs-{Program}-{Employee}-{Employer}-{Pay period}`). Never renamed (`new_name`
    cleared). It must sit in a year's `Claims` folder (`paystub_not_in_claims`), and a
    suggested move must land in one.
  - **Wage-subsidy paystubs** are filed under the employer,
    `Clients/{Employer}/{Program}/{YYYY}/Claims`. An existing student or intake folder
    directly under the year is kept: `Claims` goes inside it (`paystubHome`). When the
    suggestion stays in the same client, program and year, the code sets this path itself, so
    the model can't flatten it. If the employer has no client folder
    (`resolveGrantedFilesPath` `missingAt === 1`), the item is `advised`, not "not sure":
    `planFileMove` only creates folders below a client, and it stays unchanged.
- **Suggestion:** one Haiku call per failing file (`claude-haiku-4-5-20251001`, forced tool),
  on metadata only: name, folder, the client's program and year folders, the type patterns
  and the program table. It is refused, so the file goes on a "not sure" card instead, when:
  - the model isn't confident
  - the suggestion has a month the file's name and folders don't show
  - the name still has a pattern placeholder
  - another new file would get the same home and name
  - `planFileMove`, run as the recipient, refuses it
  - a pilot rule above is broken
- **Who gets it:** the file's `lastModifyingUser`. The Drive Activity scope, which would name
  who added it, is refused by the delegation, so a file moved in without edits goes to its last
  editor. No @granted.ca person → the fallback (`FILING_SWEEP_FALLBACK_EMAIL`, default
  writers@). No DM with Oracle yet → the fallback's thread, re-planned as the fallback (only
  the asker can confirm a move). The card says "{First name}'s file — they're not on Chat yet,
  so it's come to you." (`forLine`; "files … they've" for several).
- **The DM:** one thread per person per run, because a card press re-renders its whole message.
  A header comes first, then **one card per destination folder** (`groupByRecipient`, keyed by
  kind + folder + the person a fallback item was meant for). At most 10 cards, moves first;
  the rest are listed in a final reply. The thread's conversation is seeded with a system note
  listing the suggestions, so a reply has context. Three kinds of card (`renderSweepCard`):
  - **move:** a summary line ("9 Eco Canada SWPP paystubs for AME Consulting Group → …", or
    "… — renames in …"), the file list in a collapsible section, and one **Confirm all** /
    **Skip**. Each file is still its own `file_move_rename` pending action on its own
    conversation (7-day expiry, undo). Confirm all (`confirmGroup`) answers "Moving N files…"
    at once, runs each one through the unchanged `canConfirm` / `runPendingAction`, records
    each as `handlePendingClick` does, then patches the card. It also saves the results to the
    thread's conversation.
  - **advise:** the suggested path and the client folder to create by hand, "then reply 'file
    them'". **Leave it here** only.
  - **unsure:** "Not sure where X goes" / "these N files", reply to tell me, and **Leave it
    here** (marks them `left`, nothing moves). Not-sure files with the same guessed (or current)
    folder share a card.
  - Presses carry the card's `group_id` and `kind`. Only the recipient may press. Cards posted
    before 058 carry a `suggestionId` and still work.
- **Pilot:** while `FILING_SWEEP_PILOT_EMAILS` is set, only those people get DMs; the rest
  are logged `would_suggest`.
- **Log:** `filing_sweep_suggestions`, one row per new file (file_id unique, so a file is
  never suggested twice), with the card's `group_id`. Statuses: `ok`, `excluded`, `unsure`,
  `advised`, `would_suggest`, `suggested`, `listed`, `confirmed`, `skipped`, `ignored`,
  `failed`, `left`.
  - Card presses update it in `handleSweepClick`, and a pre-058 card's Confirm in
    `handlePendingClick`.
  - **Migration 058 must be applied before the grouped-card code deploys:** it adds
    `group_id` and the `advised` / `left` statuses.
  - `message_name` is set on every row of a card group, so a **quote of a card** (the DM
    reply arrow) brings that card's files and their Drive IDs into Oracle's context (see
    Quote-replies). A reply *in* the thread still gets them from the thread's system note.
  - Each run reconciles against `pending_actions` and marks `suggested` rows older than 7 days `ignored`, expiring their cards.
- **Dry run:** `node --network-family-autoselection-attempt-timeout=5000 scripts/filing-sweep-dryrun.mjs --days 7`
  lists files *created* in the last N days (the change feed can't look back, so moved-in
  files aren't shown) and prints each person's cards. `--match <regex>` limits it to matching
  paths and names; `--render` prints each card's JSON. It sends nothing and writes nothing
  (non-SELECT queries are refused). It does spend a little on Haiku (about $0.008 a file),
  and it needs a working `ANTHROPIC_API_KEY`: a model 401 shows up as every file being "not
  sure".

## Prompt

Single file, `.claude/agents/internal-oracle.md` (~426 lines, ~40 KB). No concatenation —
the multi-file assembly pattern exists only for lead-gen variant B. `loadAgentPrompt` in
`src/agents/load-agents.js` strips YAML frontmatter if present; Oracle's file has none.

At runtime `runAgent` appends a per-request user-identity block marked **not cacheable**.

Sourcing and honesty rules (cite with links, "couldn't find it" over guessing, estimates show
their math, `[TO CONFIRM]` in drafts, internal guidance attributed) live in one section of the
prompt, **Sources and honesty**. Drafting skills point to it rather than copying it. Re-check
behaviour after prompt changes with `scripts/oracle-checks/run-honesty-checks.mjs` (read-only).

## Skills

Oracle can load **all 14** registered skills. There is no gating by agent type or role —
`loadSkill` takes only `{ skill_name, sub_skill }` and validates against `SKILL_PATHS`.
This is deliberate, so Oracle picks up new skills without enum drift.

**The skill list lives only in the `load_skill` description** (`LOAD_SKILL_TOOL` in
`src/tools/definitions.js`): all 14 skills, one line each, with the load-first and
mandatory rules. The sub-skills are in the `sub_skill` parameter's enum and description.
The prompt keeps only routing ("When to Load Skills") and skill-specific behaviour rules —
don't add a skill catalogue back to it.

**Filing (`filing/overview` + `filing/reference`, `.claude/skills/filing/`).** Answers "where
does this go / what should I call it" for Granted Files: `SKILL.md` is the process,
`reference.md` the only source for document types, folder rules and name formats (generated
from the naming-conventions workbook). It checks real folders with
`list_granted_files_folders` and marks any missing folder **(new)**. After the answer it
offers "Want me to move and rename it?" and calls `file_move_rename` only on a yes; the
asker confirms on the card. Routed by a line in "When to Load Skills"
that treats any "where does this belong / what do I call it" question as filing. The
`SKILL.md` frontmatter also makes it show up as a Claude Code skill; that is expected.

One gap:
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
  passes the system account from `resolveWebhookUser`, which must have no HubSpot owner ID.

This is the only read of `users.hubspot_owner_id` in the codebase. Every other
`hubspot_owner_id` hit in `src/tools/hubspot.js` is the HubSpot property of the same name
on contacts/companies/deals — a different thing.

## Grant data search

`grant_data` search mode reads Oracle's hourly copy of GetGranted (`searchGrantData` in
`src/tools/grant-data.js`). How a name search ranks:

1. **Main results show only the statuses asked for.** That is active unless the person
   asks about closed or past programs. A grant whose name is exactly what was searched
   comes first among them, then names containing the search as a phrase, then the rest by
   how well they match.
2. **Cards at other statuses never enter the main results,** even an exact-name match. They
   are listed separately as other-status matches, with their status. Exact-name matches
   always lead that list, so an old archived card can't push the live grant down or out.
3. **With no active exact-name match,** an archived or closed card with that exact name
   still leads the other-status list. Oracle can then say "it's there, but archived" rather
   than "not found".
4. **When a specific status is asked for** (for example archived), the exact-name match
   ranks first within that status.
5. **French cards come after English ones.** A card whose name is in French — translated,
   or marked "(French)" — is listed after every English match, in the main results and in
   the other-status list, unless the search itself is in French. French cards are never
   hidden: one that is the only match still shows. GetGranted has no language field, so
   the language is read from the name (`looksFrench` in `src/tools/grant-data.js`); a name
   mixing an English title with a French place ("Ville de Montréal") can be misread.

Hidden cards are never in either list; only their count is reported. Looking up a grant
by id or GetGranted link returns that grant at any status.

## Pre-call briefings (Ruk)

A scheduled job, not a chat surface: `src/services/ruk-briefings.js`, `briefing-gather.js`, `briefing-drive.js`; migration 049; registered in `server.js` beside the Pulse jobs. Design: the "Ruk pre-call briefings" Google doc (settled 1, 14 and 19 Oct 2026). **Off unless `RUK_BRIEFINGS_ENABLED=true`**; `0 8 * * 1-5` America/Vancouver, `noOverlap`.

- **Which meetings.** It reads Ruk's own calendar with her stored OAuth (`listCalendarEvents(105, …)`, `calendar.events` scope — no delegation), for the **next business day**: weekends are the only non-business days, and Friday covers Monday. It keeps events with an attendee outside granted.ca whom `leadCrmSnapshot` finds as a contact or company; otherwise the title's company hint is searched as a name. The type comes from the title (`discovery` / `quarterly|check-in`; `renewal` is skipped). When the title says neither, a closed-won deal on the contact **or on the matched company** makes it a check-in (`closedWonSource`; `typeFrom` = `hubspot_contact` | `hubspot_company` | `hubspot_no_won_deal`), and anything else is a discovery. HubSpot booking-link meetings ("30 min meeting with Rukshaar Ali") always land here, and a client's won deals usually sit on the company. Closed-won is read from the pipeline stage's own metadata (`getDealStageLabels`), not the stage-id regex in `mapLeadDeal`, which can't read numeric stage ids.
- **Once per meeting.** `pre_call_briefings.event_id` is the claim: `INSERT … ON CONFLICT DO UPDATE … WHERE` the row is failed and over 30 minutes old, or building and over 2 hours old, `RETURNING`. The only rows it can take are new ones and those two retries, so two server copies can't both build the same meeting. The table holds no attendee address and no briefing text.
- **Gather.** Read-only throughout.
  - *Discovery:* calculator answers (HubSpot contact fields + `latestLeadGenSession`), HubSpot contact, company and notes, and the website (`extractCompanyBackgroundFromWebsite`, now exported, behind a public-http(s)-only URL guard).
  - *Check-in:* the company's deals (`getDealsForCompany`), with stage and owner resolved to names, **grouped in code** (`groupDeals`, relative to the meeting date):
    - `deals_open_pending`: every open deal.
    - `deals_approved_last_12_months`: won, closed within 12 months.
    - Closed-lost and abandoned deals from that window are left out.
    - `deals_older_summary`: one line, e.g. "Older than 12 months: 2 approved, 1 lost."
    - The full list is kept as `_deals`, only for leaving existing programs out of new matches; `withoutInternal` keeps `_` keys from the writer.
    - Notes, logged emails and logged calls are read for the open, then recent approved, deals (up to 8), plus the company's own notes, calls and emails.
    - The strategy meeting is the newest logged call that mentions strategy, else the newest call.
  - *Calculator decoding* (`decodeCalculator`, both types). HubSpot stores several answers as codes or lower bounds:
    - revenue: enum 1–6 → "$5 million to $10 million" (engine band `$5M-$10M`);
    - `numemployees`: the band's lower bound → "20 – 49";
    - training/expansion budget: lower bound, with **0 written when unanswered** → band or unknown;
    - `industry_contact`: codes → widget labels;
    - for-profit/non-profit and existed-a-year are **derived by the form, never asked**. The property asks "non-profit?", so "no" = for-profit. The writer is told never to present them as answers.
    - Related, not changed: the lead triage card (`lead-lookup.js`) still reads the raw revenue code.
  - *Industry* (`industryFor`): the calculator labels and the HubSpot company industry first; **only if HubSpot has none**, the website pages (`sitePages`, the same single fetch the province lookup uses), scored onto gg3's 16 canonical industries (`INDUSTRY_SIGNALS`, ≥3 hits). `facts.industry.source` = `hubspot` | `website` | `none`. match-lead gets the whole canonical list (up to 2), so a food processor goes as Food & Beverage and Manufacturing; `facts.industry` shows the first.
  - Emails come **only** from what is logged to the deal or company: `getLoggedEmails` has no fallback to contacts, unlike `getProjectEmailHistory`.
- **Match.** `toPreviewProfile` → gg3-ai-service `POST /api/v1/ai/internal/match-preview` (`GG3_AI_SERVICE_URL` + `GG3_REVIEW_FEED_TOKEN`, the same pair match-explain uses; 180s), i.e. the real engine plus the AI review.
  - **Province** comes from `locateCompany`: first the HubSpot company address fields (state, postal code, street address, city), then the website's home, `/contact`, `/contact-us`, `/locations`, `/about` and `/about-us` pages. On the pages it counts province names, ", BC"-style abbreviations and postal codes, and keeps provinces mentioned at least half as often as the top one. Only after both fail does the calculator session's own location count. `facts.location` records the source.
  - Industries are humanized from the HubSpot enums. Goals come from the calculator's "what do you spend it on" and its budgets.
  - **No calculator session → its HubSpot contact fields are ignored entirely.** HubSpot fills an unanswered field with 0 or blank, and the prompt is told not to mention the calculator. A 0 on the company record counts as unknown too.
  - **Fallback** when the profile still has no province or industry, the call fails, or the service isn't configured: `searchGrantData` (keyword search), filtered by `reliableFallback`.
    - It drops any grant whose deadline has passed by the meeting date.
    - It drops any grant restricted to provinces the company isn't confirmed to be in; with no confirmed province, that means every province-restricted grant.
    - The writer is told to drop anything it would itself call a weak or conditional fit.
    - If fewer than 2 survive, in code or after the writer, the whole section is the one line "No reliable matches yet — confirm location and plans on the call."
    - Otherwise one italic line says the matches are keyword-only, and why.
  - Check-in matches drop programs the client already has a deal for.
  - **Grant list** (both types): `rankEngineGrants` passes up to 8 candidates in AI-review order, round-robin across goal tracks. The writer leaves out any grant a known fact rules out (location, service area, province, ownership, sector), shows the first 5 that remain, with at most **one** ASK each (the most decisive "couldn't check"). If none remain, the section is the one "No reliable matches" line.
  - **Known gap:** a check-in for a client with no calculator session has no business goals, so gg3 returns only its unreviewed "Matches for you" list (Peterson, 2026-10-19: 2 medium matches, no AI review). Goals could be read from the strategy-call notes; not done.
- **Write.** One Sonnet 5.5 call: no temperature, `tool_choice: auto`, and the prompt requires `write_briefing({summary_lines, markdown})`. The discovery and check-in outlines are copied from the design doc. Gaps are marked **ASK**, each grant gets one fit line written by Oracle (the AI review gives no reason for plain keeps), each "couldn't check" note becomes an **ASK**, and an unclear open deal reads "unclear — ask <deal owner>". Cost is logged as `ruk-briefing`.
- **Deliver.**
  - The Doc is created **as Ruk** through domain-wide delegation, `drive` scope only (`delegatedDriveClient(…, {write:true})`). It goes in Granted Files › Pre-Call Briefings › Ruk, created on first use; an ambiguous folder match is refused. The Doc is HTML uploaded and converted by Drive, so no Docs scope is needed. Name: `YYYY-MM-DD – Company – Discovery|Check-in`.
  - Then a **short DM posted as its own thread**, built in code (`dmText`) from the writer's `dm` block. It is posted through `postMessageWithThread({ …, markdown: false })` (`src/cards/chat-api.js`), i.e. in **Chat's own text formatting, not `MARKUP_SYNTAX_MARKDOWN`**: under Markdown a single `\n` is a soft break, and the first version rendered as one paragraph. Every other Oracle message keeps the Markdown default.
    - The layout is `*bold*` / `_italic_`, with blank lines between sections and one `• ` bullet per line:
      - `*Company — Discovery|Check-in, Tue 20 Oct, 13:15*` (event start, Vancouver time), then who · role · location;
      - `*What we know*` (≤3), `*Ask first*` (≤3 of the briefing's ASKs), `*Grants to raise*` (≤3, name — reason). A check-in shows `*Open deals needing action*` instead when there are any;
      - `<doc url|Open full briefing>`, then `_Reply here with any question about this client._`
    - At most 15 non-blank lines (`DM_MAX_LINES`; "What we know", then grants, are trimmed first). Each item is clipped to ~140 characters, with `* _ ~ \` < >` taken out of the model's text so it can't break the formatting.
  - Every DM sent is recorded in **`briefing_posts`** (049): space, thread and message names, the briefing markdown and the gathered facts (without `_` internals), with `is_test` for `--dm-to` sends. The daily run also writes `space_name` / `thread_name` / `message_name` on its `pre_call_briefings` row. A missing table warns once, and the DM still goes.
  - If the Doc fails, no DM is sent and the row is marked failed. If there is no DM space, the row is still done, with `error_code = no_dm_space`.
  - It never writes to HubSpot or to the calendar event.
- **Replies in a briefing thread** (the `pulse_posts` pattern).
  - `chat-google.js`, beside the Pulse lookup: `findBriefingPost({ spaceName, threadName, quotedMessageName })` matches a reply in the DM's thread, **or a quote of it**, to its `briefing_posts` row. It returns `matchedBy` (`thread` | `quote`), which is logged.
    - **The reply arrow in a DM sends a quote, not a thread reply.** The message starts a NEW thread and carries `quotedMessageMetadata.name` = the briefing DM's message name (`quoteType: REPLY`); live-checked 2026-10-19. So `message_name` is stored alongside `thread_name` (in `briefing_posts`, and on `pre_call_briefings`), and either one finds the briefing.
  - `client.js` then adds `briefingContextBlock` as a non-cached system block: the briefing and its facts (wrapped untrusted), plus rules: a few lines, cite sources the way the briefing does, "not on file" rather than guess, and "couldn't check" items are unconfirmed.
  - Each thread is already its own conversation (`conversationIdForEvent`). Messages outside briefing threads find no row, so nothing changes for them.
  - `runOracleAndReply` is exported only so a script can replay one message through the real handler.
  - **Live replies need migration 049 applied and this code deployed.**
- **Dry run.** `node scripts/ruk-briefing-dryrun.mjs "<title>" [--date YYYY-MM-DD] [--deliver --dm-to <user>]`.
  - It prints the gathered facts, the profile, the matches, the briefing and the cost, and never claims the meeting.
  - `--deliver` refuses without `--dm-to`, so a test can't DM Ruk by accident.
  - It prints the DM exactly as it will post (the link is filled in on `--deliver`). A `--deliver` send is recorded in `briefing_posts` as `is_test`, so its thread is replyable, but it never writes `pre_call_briefings`.
  - `--company "<name>"` picks the meeting by the matched HubSpot company (case-insensitive contains). Use it for booking-link meetings, whose titles are all alike; with a title too, both must match, and an ambiguous pick lists the candidates and stops.
  - `--dm-to` takes an exact email (always unambiguous) or a name or local part. A name that matches several accounts narrows to the one with a Chat DM, else it refuses.
  - The output names which HubSpot contact and company were matched, and how: contact by attendee email or phone; company by contact association, domain or title name. It also lists every province source checked.
  - Locally, run it as `railway run …` with the public `DATABASE_URL`. The local `.env` has no `GOOGLE_CLIENT_ID/SECRET`, so Ruk's calendar token can't refresh without Railway's env, and Railway's `DATABASE_URL` is an internal host.
  - It sends the Sonnet cost to no log; the website read's Haiku call still logs its own ~0.05¢ under `lead-gen-extraction`.
- **Cost.**
  - A discovery briefing with keyword-fallback matches: ~2–3¢ (Elmwood dry runs, 2026-10-19).
  - Elmwood is the thin-lead case: no HubSpot address, a 78-character JS-rendered site with no location, and no calculator session. So its section is the one-line fallback.
  - The engine path adds ~9–15¢: 8.8¢ for a one-goal profile, live.
  - Fresh Is Best, 5 goals: 25.9¢ matching + 5.0¢ writing = 30.9¢. Peterson check-in (no goals, unreviewed matches): 0.2¢ + 5.7¢ = 5.9¢ (2026-10-19).
- **To turn on:** apply migration 049, confirm `GG3_AI_SERVICE_URL` / `GG3_REVIEW_FEED_TOKEN` on the service, then set `RUK_BRIEFINGS_ENABLED=true`. Optionally set `RUK_BRIEFINGS_OWNER_EMAIL` (default `rukshaar@granted.ca`).

## Gmail (opt-in, per user)

Stage 1 groundwork for the Steph morning brief. Nothing calls the reader yet, and it is
not an agent tool: there is no schema in `definitions.js` and no executor dispatch.

- **Consent.** `src/api/gmail-auth.js`, mounted at `/api/auth/gmail`. It is a separate
  incremental-authorization link, **never part of sign-in**: `src/api/auth.js` and its scope
  list are unchanged. It is open only to emails in `GMAIL_CONSENT_ALLOWLIST`; unset means
  nobody.
  - **Scopes:** it requests exactly `gmail.readonly` + `gmail.compose`, with
    `include_granted_scopes=true`. Google therefore returns one token covering the user's
    earlier grants plus Gmail, and their later ordinary sign-ins keep Gmail.
  - **Callback checks:** `/api/auth/gmail/callback` checks the user-keyed state
    (`src/utils/gmail-consent-state.js`), the account (it must be the signed-in user's own
    mailbox), the allowlist and both scopes. Only then does it store the tokens on `users`
    and stamp `users.gmail_connected_at` (migration 050).
  - **Registration:** the callback URL must be registered on the OAuth client in Google
    Cloud Console.
- **Connected** = `gmail_connected_at` is set **and** both scopes are in
  `google_granted_scopes` (`hasGmailScopes` in `src/tools/gmail.js`, modelled on
  `hasChatScopes`). The scopes alone don't count, because `include_granted_scopes` carries
  them forward without a deliberate opt-in.
- **Reader** (`src/tools/gmail.js`), acting as the user via `getUserOAuth2Client`. Every
  entry point checks the connection first.
  - `listThreadsSince`: covers INBOX, "Former staff" and "Notifications". It runs one list
    per label, because `labelIds` is an AND, and merges the results. A missing label is
    reported, not fatal.
  - `getThread`: headers and plain-text bodies; attachments are listed by name only.
  - `replyState`: pure. It reports whether the user replied after the latest inbound
    message; drafts never count.
  - `createDraftReply`: a threaded draft to the latest inbound sender. Header values are
    stripped of CR/LF.
- **No-send rule.** The module can reach only five Gmail methods (`labels.list`,
  `threads.list`, `threads.get`, `drafts.create`, `getProfile`), through a frozen facade,
  and the raw client never leaves the file. `gmail.compose`, the narrowest scope that
  allows drafts, **also permits sending**, so Google does not enforce this.
  `tests/unit/gmail.test.js` does: a source scan fails on any send, modify, trash, delete,
  label-write, settings or watch call. Steph reviews and sends every draft herself.
- **Refresh tokens.** `saveUserOAuthTokens` (`google-docs.js`) now persists a refresh token
  Google rotates, using COALESCE so a refresh without one never erases the stored token.
  It applies to every user. Before this fix a rotated token was dropped, which would
  eventually strand background jobs.
- **Style.** Steph's voice guide is `.claude/skills/steph-writing-voice/voice-guide.md`. It
  is deliberately **not** registered with `load_skill` (any agent can load any registered
  skill) and not named `SKILL.md`, so Claude Code doesn't list it either. Its only way in
  is `loadStyleGuide(email)` (`src/services/style-guides.js`), which returns it for
  `ssang@granted.ca` only.
- **Meeting links.** `getMeetingLink(email, minutes)` (`src/services/meeting-links.js`)
  reads `meeting_links` on the consultant's entry in `consultant-routing.json`, by exact
  length. Steph has 15, 20, 30 and 40 minutes. `booking_link` is unchanged.
- **match-lead client.** `src/services/match-lead-client.js` calls gg3-ai-service
  `POST /api/v1/ai/internal/match-lead` with `GG3_AI_SERVICE_URL` + `GG3_REVIEW_FEED_TOKEN`.
  It never throws and has no callers yet.

## Morning brief (Steph)

`src/services/steph-brief.js`. On weekdays at 07:00 America/Vancouver (local time in PDT and PST),
one Chat card in Steph's DM lists the inbox threads she hasn't answered. Each item gets a
one- or two-line assessment, an in-thread Gmail **draft** saved in her mailbox, and a Done
button.

- **Gate:** `STEPH_BRIEF_ENABLED` must be exactly `true`. The run also needs her Gmail
  connected (see the Gmail section) and migrations 051–053. If `gmail_connected_at` is
  null, the run is skipped and **nothing is posted**.
- **Window:** the last 14 days (`READ_DAYS`). That covers every thread still unanswered by
  her whose latest inbound arrived in that time; new mail from the last 48 h is inside it
  by definition.
  - Each run also re-fetches the threads of items still open from earlier briefs.
  - Older unanswered mail is left to the Stage 3 catch-up. An item whose mail has aged
    out is neither shown nor auto-ticked.
  - Her SENT threads from the same 14 days are read too, for promises.
- **Triage** (`steph-brief-triage.js`, pure):
  - automated mail is skipped: List-Unsubscribe, Precedence, no-reply senders. A **bill**
    (an amount owed, a due date and payment instructions) is never skipped, even from
    billing@ or no-reply senders;
  - **covered by a colleague:** another `@granted.ca` address replied after the latest
    external inbound. The thread gets no item and no draft; the footer reads "Covered by
    colleagues: Ruk Ali (2)". Internal-only threads are never "covered";
  - one sender's threads form one item;
  - nudges (a second unanswered inbound, or follow-up phrasing) go to the top of their
    group, labelled "2nd nudge · 6 days";
  - Drive notifications are kept only for an @mention, a comment assigned to her, or a
    share that asks her something, grouped per document.
- **Groups** (`steph-brief-classify.js`): Your promises → Clients → Partners → Leads (most
  mature first) → Team (finance first, then urgency) → Government → Not sure if this needs
  you → Docs.
  - Fixed rules: government domains are Government, closed-won HubSpot contacts are
    Clients, and @granted.ca senders are Team.
  - One batched Haiku call sorts the rest.
  - An internal email about a closed-won company is a Client.
  - Cold pitches (`vendor`: the sender's product, not the sender's problem) and `handled`
    mail (receipts, newsletters, confirmations) are counted in the footer, never shown.
  - Borderline mail (`other`, or no verdict at all) is **surfaced** as "Wasn't sure if
    this needs you". It is never dropped.
- **Item types** (`decideItemType`; precedence top to bottom). Each item carries
  `item_type`, `badge`, an assessment, an owner hint, and draft or no draft, for the card.

  | Type | When | Badge | Draft |
  |---|---|---|---|
  | `safety` | A **person** asking to change bank or remit-to details, for an urgent payment or wire, or for a password, code or login; **or** a lookalike sender domain | "Verify by phone first", with a note on the lookalike | none |
  | `security` | An automated security **notice** ("Suspicious login", new sign-in, password changed). It needs an alert phrase **and** a system sender, and passes the automated filter | "Security alert", one line, suggest IT/admin. Start here: "have IT check it today" | none |
  | `cc` | Steph is only in Cc, and the email asks someone else to act or is addressed to someone else. If no one at Granted needs to act, it's counted as an FYI instead | "You're cc'd", one line, suggest that person | none |
  | `sensitive` | A legal threat, contract dispute, negotiation or refund demand | "Sensitive · write this yourself" | none |
  | `bill` | A bill | "Bill · $X due <date>" | none |
  | `unhappy` | An unhappy client or a complaint | "Unhappy client · call recommended" | acknowledgement only |
  | `unsure` | Borderline mail | "Wasn't sure if this needs you" | none |
  | `promise` | A promise she made that's due (below) | "You promised <what> · due <when>" | only if confirmable |
  | `mail` | Everything else | — | the normal path |

  - **Detection:** the Haiku classify call detects all of these. It also writes the
    "What's going on" assessment (25 words at most) and the one-line summary (15 words at
    most) to length. The drafting call adds `draft_summary`, what the draft does in 15
    words at most, which is shown as "Draft says"; the card never quotes the draft. If
    code replaced the draft (a holding reply or the plain acknowledgement), the summary
    describes the replacement. Hard cuts are only a safety net. Deterministic backups
    (`SAFETY_RE`, `isBill`) can only **add** a flag, never remove one.
  - **Lookalikes:** `lookalikeOf` compares the sender's domain with `granted.ca` (edit
    distance 1, so `grants.ca` isn't flagged) and with the HubSpot domain of the company
    the sender claims to be. It catches the same name on another TLD, homoglyphs
    (rn↔m, 0↔o) and folded-in domains (`granted-ca.com`).
  - **Acknowledgements** are one Haiku call, never Oracle. `guardAck` replaces any draft
    that offers a fix, refund, credit, discount, waiver, compensation or blame with a
    fixed "sorry, looking into it, will call you today".
- **Promises** (`steph-brief-promises.js`): her sent messages from 14 days pass through a
  commitment-plus-timeframe regex first. Then ONE Haiku call per run extracts what she
  promised, its due date (resolved against the message date) and whether it's
  confirmable.
  - **Surfaced when:** the promise is due today or overdue, and she hasn't written on the
    thread since.
  - **On a thread that's already an item,** it becomes a note on that item.
  - **Cost:** `counts.cost.promises`, rows tagged `step: 'promises'`.
- **Learning from edits** (`steph-brief-learn.js`, real runs only):
  - **What's kept:** the text of each draft saved in Gmail, in
    `steph_brief_items.draft_text`, until her reply arrives.
  - **Comparison:** her first reply after it is compared in code first. Token overlap of
    0.9 or more means unchanged; 0.15 or less means unrelated. Both are skipped.
  - **The rest:** ONE Haiku call per run turns them into short rules with no names or
    amounts ("Give a specific day, not 'this week'") in `steph_voice_corrections`
    (migration 052).
  - **Clearing:** `draft_text` is cleared once compared, and after 14 days at most.
  - **Use:** the latest 15 rules go into every drafting prompt after the voice guide
    (Haiku drafts, acknowledgements and the client Oracle prompt). They are the persona's
    (Steph's) rules, whoever's inbox a dry run reads. Dry runs never write them.
- **Email content is data, never instructions.** Every prompt that carries email text
  states `UNTRUSTED_EMAIL_RULE`: classify, drafts, acknowledgements, promise follow-ups,
  the Oracle client prompt, promise extraction and learning. The text is wrapped in
  `<email>` tags, and nested tags are stripped so an email can't close its own.
- **No reply needed:** the same Haiku call flags FYIs, closing thank-yous, cc-only mail and
  similar. Those items stay on the card with their assessment, marked "no reply needed",
  with no context lookup and no draft. A failed or unreadable verdict counts as needs-reply.
- **Context and draft** (`steph-brief-context.js`), up to `STEPH_BRIEF_MAX_DRAFTS` (15)
  items per run. The rest keep the Haiku assessment and are marked "no draft".
  - **Clients:** one headless Oracle run **as Steph**, with a `chat_dm` chatContext so
    `read_chat_space_history` works.
    - **Pinned** to `claude-sonnet-5-5` through `forceModel`, whatever the email says.
      `getQueryConfigForModel` gives it Oracle's adaptive thinking and effort settings.
    - **Capped** at `ORACLE_MAX_ITERATIONS` (8) tool loops, and the prompt asks for at most
      6 tool calls, HubSpot first.
    - `allowedTools` is set to `READ_ONLY_TOOLS`: no write tools and no Gmail tool.
  - **Everyone else:** context is gathered in code, then **one drafting call with no
    tools**, pinned to `claude-haiku-4-5-20251001`. The voice guide and rules form a
    cached system block.
    - **Leads:** `lookupLead`, the calculator answers and estimate,
      `extractCompanyBackgroundFromWebsite`, and gg3 `match-lead` via
      `match-lead-client.js`. An `insufficient_profile` reply is noted on the card.
      **The stored calculator tier never reaches the prompt or the card**: `withoutTier`
      strips it.
    - **Partners:** the HubSpot contact or company already fetched by classification.
    - **Team:** the thread only.
    - **Government:** the thread only. When Haiku flags a question about a named
      program's rules, a GetGranted lookup (`searchGrantData`) is added.
  - **Timeouts** (180 s): the client run is aborted through `runAgent`'s `abortSignal`,
    which stops it before the next model call or tool execution. The job then **awaits**
    the run, so the call already in flight still reports its cost, and saves a holding
    reply.
  - **Voice and links:** the voice comes from `loadStyleGuide`. Meeting links come from
    `meetingLinksFor` (`meeting_link_use` in `consultant-routing.json`): leads 15, clients
    and partners 30 or 40, and never the 20-minute quarterly link.
  - **Code guards** (`guardDraft`): a link the category may not offer is removed. An
    unconfirmed price, timeline or approval turns the draft into a holding reply, with a
    card note saying why.
- **Drafts:** the job calls `createDraftReply`, never Oracle, on the item's latest
  thread. If the thread already holds a draft, Steph's or ours, no new draft is made.
  **Nothing is ever sent.** `tests/unit/gmail.test.js` scans every brief file for send,
  modify, trash, delete, label, filter and settings calls.
- **State** (migration 051): `steph_brief_runs` holds the daily claim. The partial unique
  index `(owner_email, local_date) WHERE NOT is_test` gives the same re-claim rule as
  `pre_call_briefings`. `steph_brief_items` tracks each item as open, done or auto_done,
  carried across days.
  - Unticked, unreplied items carry over as "from yesterday" or "N days".
  - An item becomes auto_done once she has replied, and the footer says how many.
  - Done and auto_done items come back only when new mail arrives after they were closed.
  - Docs items have no reply signal, so they stay open until Done.
  - An item whose thread failed to load is never auto-ticked.
- **Card** (`src/cards/brief-card.js`), laid out to read in about 90 seconds (inbox-manager
  `digest_format.md`):
  - **Header:** "Good morning, Steph", then the date, "N emails need you" and "M replies
    drafted". The date comes from `local_date` via `ymd`, because pg returns `DATE` as a
    JS Date. That fixed the old "Invalid Date".
  - **Explainer:** a fixed sentence every day saying what an item is and what Done means.
  - **Start here:** the 1–2 most urgent items, each with what happens if it waits.
    `rankItems` in `steph-brief-rank.js` (pure, no model) decides the order:
    "Verify by phone first" always first; then deadlines (promises, bills, needs an answer
    today, soonest first); then money or an unhappy client; then follow-ups.
  - **Groups:** Your promises → Clients → Partners → Leads → Team → Government → Docs that
    need you → Not sure if this needs you, each headed "Label · n".
  - **Full detail** for promises, clients and leads:
    - badges;
    - "**Sender, Company** — subject";
    - "What's going on";
    - one of "Draft says" (its first sentence), "Before you send" (for a holding
      reply, from its Unclear note), or "No draft — why";
    - "Checked <sources>";
    - Open draft (`#drafts?compose=<messageId>`) or Open email (`#all/<threadId>`),
      plus Done.
  - **One line** for the other groups: badge, **sender**, summary, "No draft; suggest
    <owner>". Safety items keep the badge and the lookalike note. Docs get Open doc.
  - **Badges:** follow-up count, "From yesterday" or "Waiting N days", "Sent to <ex-staff>",
    "Holding reply · check first", and the Task A type badges.
  - **Length cap:** past the 10 most urgent, a "+N more" section has one row per item
    (sender, subject, open link, Done). It's capped at 30 rows to stay under Chat's
    100-widget limit.
  - **Footer, counts only:**
    - "Covered by colleagues: <name> (n)";
    - "Kept out of your way: X notifications, Y sales pitches, Z FYIs (no reply needed),
      W emails to former staff". FYIs are counted here, not listed;
    - dry runs add the cost line beneath. Real runs show no money.
  - **Data the card reads** (migration 053, data only): `urgency`, `finance`, `due_on`,
    `held`, `sources`, `draft_message_id`, `company`, `sent_to`.
  - **Done** works as before. It is not a tracked card: it runs through the `brief.*`
    branch at the top of `pressAnswer` (`actions.js`), next to `pending.*`, and only the
    run's recipient can press it. The press updates the row, answers
    `updateMessageResponse` with the rebuilt card, and patches the message. Buttons carry
    the run id, so Done on an old brief re-renders that brief.
- **Manual trigger:** `POST /api/admin/steph-brief-run?secret=…`. It needs an admin
  session plus `MIGRATION_SECRET` (or `JWT_SECRET`), the same gate as gg3-refresh.
  - **Dry run (the default):** reads her mail and makes the drafting calls and client
    Oracle runs, which cost money. It adds the comparison drafts. It creates **no drafts** and writes only `is_test` rows. Her real item state is
    untouched. The card goes to the **caller's** DM, with each draft shown for review.
  - **`inbox=<email>` (dry runs only):** reads another consented inbox instead of Steph's,
    for example Chris vetting the brief before Steph connects Gmail.
    - **Who's allowed:** the inbox must be in `GMAIL_CONSENT_ALLOWLIST` and have Gmail
      connected. Given with `dry_run=0`, or not on the allowlist, it answers 400.
      `preflight` refuses both again.
    - **Whose brief it stays:** Steph's voice guide and meeting links.
    - **Whose access:** client Oracle runs act as the inbox owner, so they read that
      person's Drive, Granola and Chat, never Steph's.
    - **What's written:** `is_test` rows keyed by that inbox's email, so they never mix
      with Steph's. No drafts, no claim, and the card goes to the caller.
  - **`dry_run=0`:** a real run, through the daily claim. Real runs only ever read
    `STEPH_BRIEF_OWNER_EMAIL` (default `ssang@granted.ca`).
  - It answers 202, or 409 with the reason when a check fails.
- **Cost** (every cent attributable):
  - **Per item:** `steph_brief_items` stores the model, `cost_usd`, the four token
    counts, tool calls, `tools_used`, web searches and the Oracle `conversation_id`.
    `cost_usd` includes the website lookup and the $0.01 web-search fee, which
    `calculateRequestCost` doesn't price.
  - **Per run:** `steph_brief_runs.cost_usd` holds the total, and `counts.cost` the
    breakdown: classify, drafting, Oracle, website, search fees and comparison.
  - **Tagging:** every brief row in `api_cost_events` carries `metadata.brief_run_id` and
    `metadata.is_dry_run` (Oracle through `runAgent`'s `costMetadata`), so
    `SUM(cost_usd) … WHERE metadata->>'brief_run_id' = '<id>'` is the run's model
    spend. The website lookup is tagged `session: steph-brief:<id>`.
  - **Dry-run card:** shows each draft's model and cost and, at the bottom, the run
    total. The real card shows no money.
- **Dry-run comparison:** for up to 3 Lead or Client items, a dry run also drafts with the
  other model and shows it under the main draft, each with its cost. Leads get a
  "Sonnet version": one Sonnet call on the same context. Clients get a "Haiku version":
  one Haiku call on the thread plus HubSpot. This never happens on a real run.
- **Logs:** counts and codes only.

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
- Three of eleven users lack a usable HubSpot owner ID
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

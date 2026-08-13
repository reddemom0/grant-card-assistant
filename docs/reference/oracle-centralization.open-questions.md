# Oracle Centralization — Open Questions and Deferred Work

Running record of what we deliberately did **not** build while centralizing Oracle, and why. Each entry is a decision that was made and set aside, not an oversight. Update as items are picked up or the reasoning changes.

Last updated: 2026-08-13.

---

## Identity and memory

**Function/role taxonomy on the identity table**
Classifying users by what they *do* (consulting, ops, research) rather than only who they are, so Oracle can adapt behaviour per function. Deferred because `users.hubspot_owner_id` (migration 023) solves attribution on its own, and a taxonomy is a modelling decision — get it wrong early and every downstream feature inherits the wrong shape.

**Per-person memory scoping**
Memory today is per-*conversation* (`conversation_memory`, keyed `conversation_id`) and never per-person, so nothing Oracle learns about someone carries into their next conversation. Deferred because it needs the identity layer to exist first — which it now does — plus a decision on retention and on what a person can see of their own history.

**Team memory via explicit promotion**
Letting a person promote something they've learned into shared team knowledge, with a retrieval layer over it later. Deferred because promotion without curation becomes a dumping ground; the retrieval design matters more than the storage and should not be rushed.

---

## Surfaces

**Google Chat adapter, then Workspace sidebar**
Driving Oracle from Chat, and later a Workspace sidebar. Deferred, but the groundwork holds: `runAgent` is already transport-agnostic (`res: null` is supported and every SSE emitter is null-guarded), and `src/api/hubspot-webhook.js` already drives `internal-oracle` headlessly. The real work is identity — a Chat sender is a Google email, while the Hub keys on an integer `users.id` with per-user OAuth minted by a browser flow.

**Converting writer agents into Oracle skills**
ETG, CanExport, BCAFE and grant card generation become skills Oracle loads rather than separate agents. Deferred and explicitly **sequenced, not batched** — each writer has its own prompt, tool loadout and quality bar, and converting them together would make regressions impossible to attribute.

**Docs write path**
Oracle has **no Google Docs tools in its loadout** (`definitions.js`, the `internal-oracle` case) even though the machinery exists and works — `createGoogleDoc`, `createAdvancedDocumentTool` and `createGoogleDocFromTemplate` are all implemented and used by other agents. Deferred as a registration decision, not a build.

**Domain-wide delegation**
Impersonating users for Google API calls. Currently coded but reachable only from `search_google*` tools and scoped read-only. Deferred because it is needed only for *proactive* features (Oracle acting on someone's behalf without them present); everything reactive works with the existing per-user OAuth.

---

## Security — known and accepted

**v3 signature verification on the app subscription**
The HubSpot app's webhook subscription sends real signatures (v1 + v3) and is currently rejected with 401 by `/api/hubspot-webhook`, which authenticates via a shared workflow token instead. Deferred because the sender that actually carries all traffic is an unsigned HubSpot *workflow*, so v3 would secure a path we don't use. Needs the app client secret in `HUBSPOT_WEBHOOK_SECRET` and raw-body capture.

**VisualPing webhook authentication**
`POST /api/visualping-webhook` has no verification of any kind. An unauthenticated POST bills the Anthropic API and writes attacker-supplied text into Redis keys Oracle later reads — a prompt-injection path into Oracle's context. Deferred by decision; the fix is a shared token, and VisualPing's webhook config exposes only a URL, so it must go in the query string.

**Reflected XSS at `src/api/auth.js:117-128`**
The OAuth error branch interpolates `req.query.error` and `error_description` into an HTML response unescaped. Deferred; note the file already has an `escapeHtml` helper, so the fix is small.

---

## Data and operations

**Admin dashboard schema drift**
9 of 14 `/api/admin/*` routes return 500 because `error_logs` and `conversation_stats` don't exist and `users.last_login` is missing. Deferred as a schema task. These handlers had never executed before the `users.role` fix made the admin router reachable, so the breakage is long-standing rather than new.

**Orphan conversation backfill (1,084 rows)**
Conversations with `user_id IS NULL` — 574 of them non-lead-gen and holding real messages. Ownership is **not recoverable** from the data (`messages` has no `user_id`, and `conversations` carries no other hint). Reads currently grandfather NULL owners so this history stays reachable. Deferred because any fix is a heuristic; the orphan set stopped growing once `/api/chat` began rejecting unauthenticated requests.

**Per-file ownership storage**
`/api/files/*` cannot enforce per-file ownership because the file→conversation link was never persisted — `db.updateConversationFileContext` is undefined and there is no `file_context` column. Authentication reduced exposure from "anyone on the internet" to "any authenticated staff member", but any staff member can still read or delete any file by ID. Deferred; the fix is storage, not a guard.

**Conversation compaction / message deletion**
Above ~50K estimated tokens, compaction keeps 10 recent turns, writes a ~2K summary, and issues a real `DELETE FROM messages`. Originals are unrecoverable. Deferred as a retention-policy question rather than a bug.

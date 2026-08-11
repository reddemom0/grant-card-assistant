# Dropbox Scope Probe — Findings

**Date:** 2026-07-30
**Probe script:** `scripts/dropbox-probe.js` (throwaway, read-only)
**Purpose:** Establish what the Dropbox app credentials can actually see, ahead of the Dropbox → Google Drive migration.
**Method:** OAuth refresh-token exchange, then `users/*`, `team/*`, `sharing/*`, and `files/list_folder` with `recursive: false`. Nothing downloaded, moved, or written. No credential values recorded here.

---

## 1. Authentication — WORKS

The refresh token still exchanges successfully.

| Check | Result |
|---|---|
| `DROPBOX_APP_KEY` / `APP_SECRET` / `REFRESH_TOKEN` | present in `.env` |
| `DROPBOX_NAMESPACE_ID` | present |
| `DROPBOX_TEAM_MEMBER_ID` | **ABSENT** (not in `.env`; resolved dynamically instead) |
| Refresh exchange | **SUCCESS** — short-lived access token issued |
| Token lifetime | ~4 hours |

The token endpoint did **not** return a `scope` field, so the granted scope list could not be read directly. Scopes were inferred empirically from which endpoints succeed (see §2).

## 2. Account type — USER token on a Business team (NOT a team token)

This is the single most important finding.

| Property | Value |
|---|---|
| Token kind | **User-scoped** (acts as one member) |
| `account_type` | `business` |
| Team | **Granted Consulting** |
| `team_member_id` | resolved from the account (`dbmid:AABEsUyb…`) |
| Member identity | `consultants@granted.ca` |
| `root_namespace_id` | `3248953587` (team space) |
| `home_namespace_id` | `4543298785` (this member's personal Dropbox) |

**The app is authenticated as one team member, not as the team.** Evidence:

- `team/get_info` → `400 USER_AUTH_NOT_ALLOWED — "This token is not associated with a team"`
- Sending `Dropbox-API-Select-User` → `400 "Unexpected select user header. Your app does not have permission to use this feature"`

**Consequence:** the app sees exactly what `consultants@granted.ca` sees — no more. There is no admin/team-wide view, and no ability to impersonate other members. Any folder that member lacks access to is invisible to the migration, and the app cannot grant itself access.

Working scopes (proven by successful calls): `account_info.read`, `files.metadata.read`, `sharing.read`.
Not available: `team_info.read` and the `members.*` / Select-User team features.

## 3. Reaching the team space — requires `Dropbox-API-Path-Root`

Header strategies tested against the namespace root:

| # | Headers | Result |
|---|---|---|
| A | none | OK — 4 entries, but this is the member's **personal** Dropbox |
| **B** | **`Path-Root` = `DROPBOX_NAMESPACE_ID`** | **OK — 3 entries, the team space ← correct** |
| C | `Path-Root` = `root_namespace_id` from account | OK — identical to B |
| D | `Path-Root` = `home_namespace_id` | OK — same as A (personal home) |
| E | `Path-Root` + `Select-User` | **FAILED** — 400, app lacks Select-User permission |

`DROPBOX_NAMESPACE_ID` in `.env` matches the account's `root_namespace_id`, so B and C are equivalent. **Strategy B is the one to use.**

⚠️ Without the Path-Root header the API silently returns the member's *personal* Dropbox instead of the team space — no error, just the wrong tree. That personal root contains a stale conflict copy named `Granted Team Folder (view-only conflicts 2024-07-23)`, which is easy to mistake for the real thing. Any migration tooling must set Path-Root explicitly.

### Namespace root (strategy B) — 3 entries
- `Strategy Consultants` (dir)
- `Granted Team Folder` (dir) ← the target
- `Team Paper Docs` (dir)

## 4. Top level of Granted Team Folder — 16 entries

Path: `/granted team folder` — 13 folders, 3 files.

| Entry | Type | Sharing flags | Readable? |
|---|---|---|---|
| Mindfulness | dir | — | yes |
| LEADERSHIP | dir | — | yes |
| FINANCE | dir | `no_access`, `read_only` | **NO** |
| GETGRANTED | dir | `no_access`, `read_only` | **NO** |
| GRANTED STARTER | dir | `no_access`, `read_only` | **NO** |
| ADMIN | dir | `no_access`, `read_only` | **NO** |
| OPERATIONS | dir | `traverse_only`, `read_only` | partial |
| AI | dir | — | yes |
| RESEARCH | dir | — | yes |
| HR | dir | `traverse_only`, `read_only` | partial |
| MARKETING | dir | — | yes |
| SALES | dir | — | yes |
| WRITERS | dir | — | yes |
| Granted - The Next Stage.pdf | file | — | yes |
| budget-2024.pdf | file | — | yes |
| budget-2025.pdf | file | — | yes |

## 5. "Grants" — NOT at the top level; it lives under SALES

`Grants` does **not** exist at the top of the Granted Team Folder (`path/not_found`).

A name search found two matches:
1. `/granted team folder/sales/grants` ← **the real one**
2. `/strategy consultants/granted team folder (view-only conflicts 2024-07-23)/sales/grants` (stale 2024 conflict copy — ignore)

### `/granted team folder/sales/grants` — ACCESSIBLE

**316 immediate children: 309 folders, 7 files.** One level only, no recursion.

Children are per-program folders (`Agri-Assurance SME`, `AgriInnovation`, `Alberta Innovates`, `BC Food Safety`, `Canada Summer Jobs`, `CPF`, `DS4Y`, …). This is the main grant-program corpus and it is fully readable.

## 6. Padlocked folders — 5 of 6 are readable

| Folder | Access | Detail |
|---|---|---|
| **GRANTED STARTER** | **DENIED** | `409 path/not_found` on list |
| HR | ACCESSIBLE | 5 children — ⚠️ parent is `traverse_only`, listing may be partial |
| MARKETING | ACCESSIBLE | 21 children (19 folders, 2 files) |
| SALES | ACCESSIBLE | 36 children (23 folders, 13 files) |
| WRITERS | ACCESSIBLE | 5 children (Training, BSP, Scale A.I, Resources, External Writers) |
| AI | ACCESSIBLE | 4 children (AI Biz Dev, + 3 docs) |

### Why GRANTED STARTER is denied

It is a **nested shared folder the app's member account is not a member of**:

```
sharing_info:  { no_access: true, read_only: true, parent_shared_folder_id: "995837967" }
get_metadata:  { shared_folder_id: "5006534705", no_access: true }
sharing/get_folder_metadata → 409 not_a_member/
```

The `path/not_found` is misleading — the folder exists, but `no_access: true` means this member cannot enter it, so the path does not resolve for them. The padlock in the UI is real and reflects genuine permissions, not a token/scope defect.

**FINANCE, GETGRANTED, and ADMIN carry the identical `no_access: true` flag** and will fail the same way, even though they were not on the original list.

### The `traverse_only` caveat

HR and OPERATIONS are `traverse_only`. In Dropbox this means the member can pass *through* the folder to reach specific sub-items they were granted, but cannot read the folder's full contents. **A listing of a `traverse_only` folder returns only the subset the member can reach — it looks like a complete listing but is not.** HR's 5 children may therefore be an undercount. This was not further verified (would require an admin view we do not have).

---

## Bottom line for the migration

1. **Auth works** and needs no re-consent — but the token is user-scoped, so the migration's reach is capped at whatever `consultants@granted.ca` can see.
2. **Always send `Dropbox-API-Path-Root` = `DROPBOX_NAMESPACE_ID`.** Never send `Dropbox-API-Select-User` — the app is not permitted to use it. Without Path-Root you silently get the wrong (personal) tree.
3. **The main prize is reachable.** `/granted team folder/sales/grants` (316 children) reads fine.
4. **Four top-level folders are hard-blocked** (`no_access`): FINANCE, GETGRANTED, GRANTED STARTER, ADMIN. Two more (`traverse_only`) may report partial contents: HR, OPERATIONS.
5. **`DROPBOX_TEAM_MEMBER_ID` is absent from `.env`** and is not needed — Select-User is rejected anyway. Existing code in `src/tools/dropbox.js` sets that header when the var is present; if it were ever populated, **every Dropbox call would start failing with a 400.** Worth knowing before anyone "fixes" the missing var.
6. **Open decision:** if the migration must include the `no_access` folders, someone with Dropbox admin rights has to either add `consultants@granted.ca` to those shared folders or issue a team-scoped token with `members.read` + Select-User permission. That is a permissions change, not a code change.

## Reproducing

```bash
node scripts/dropbox-probe.js
```

Read-only, safe to re-run. Delete `scripts/dropbox-probe.js` once the migration plan is settled — it is a throwaway diagnostic.

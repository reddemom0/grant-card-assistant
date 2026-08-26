# Google Drive — Organization-Wide Inventory

**Generated:** 2026-08-19 · **Domain:** granted.ca · **Script:** `scripts/gdrive-org-inventory.mjs`
**Access:** service account `granted-ai-drive-access@granted-ai-hub.iam.gserviceaccount.com` with
domain-wide delegation, impersonating `writers@granted.ca` (super admin).

**READ-ONLY.** Every Drive and Admin SDK call is a GET; the only POST is the OAuth token grant.
No file content was fetched — no `alt=media`, no `files.export`, no download. Nothing was moved,
copied, renamed, deleted, or re-shared, and no permission was modified. Permissions were **read**
to detect external sharing.

This pass **observes only**. It proposes no destinations and classifies nothing — organizing is a
later decision.

---

## ⚠️ Security finding first: 9,895 files are shared outside granted.ca

This is the finding that matters most in this report, so it leads.

| | Files |
|---|---|
| Raw external-sharing flags | 10,326 |
| …of which our own migration service account only | 431 (not a finding) |
| **Genuinely shared outside the domain** | **9,895** |
| **Shared to "anyone with the link"** | **5,599** |
| …of those, link-holders can **EDIT** | **2,022** |
| Shared to personal `@gmail.com` addresses | **3,941** |

**5,599 files are reachable by anyone holding the URL — no Google sign-in, no
domain check, no audit trail. 2,022 of them are editable by those link-holders.**
A link-shared file is public to anyone the URL ever reaches: forwarded email, a pasted chat message,
a browser history on a shared machine.

**3,941 files are shared to personal Gmail accounts.** Those recipients keep access when
someone leaves the company, and their copies sit outside any org control or retention policy.

### By owner

| Owner | External | anyone-with-link | to gmail.com |
|---|---|---|---|
| consultants@granted.ca | 2,777 | 1,583 | 1,131 |
| admin@granted.ca | 2,341 | 1,973 | 450 |
| ssang@granted.ca | 1,519 | 619 | 591 |
| marketing@granted.ca | 780 | 350 | 424 |
| rukshaar@granted.ca | 626 | 288 | 275 |
| delpreet@granted.ca | 587 | 114 | 423 |
| writers@granted.ca | 365 | 274 | 120 |
| payment@granted.ca | 353 | 139 | 199 |
| olivia@granted.ca | 225 | 144 | 188 |
| research@granted.ca | 153 | 48 | 84 |
| dev@granted.ca | 67 | 25 | 20 |
| help@granted.ca | 53 | 29 | 20 |
| natalie@granted.ca | 46 | 13 | 15 |
| tomliao@granted.ca | 3 | 0 | 1 |

Concentrated in four accounts — `consultants@`, `admin@`, `ssang@`, `marketing@` hold
7,417 of the 9,895.
Three of those are shared/role accounts rather than individuals, which usually means sharing was
done by many hands over years with no single owner tracking it.

### External domains (top 20)

| Domain | Files |
|---|---|
| (anyone-with-link) | 5,599 |
| gmail.com | 5,292 |
| launchcurve.com | 495 |
| gwenbridge.com | 443 |
| paintillio.com | 277 |
| havenshop.com | 246 |
| debrand.ca | 171 |
| standsuresolutions.ca | 144 |
| jukefriedchicken.com | 138 |
| earthlingfoods.ca | 136 |
| procogia.com | 122 |
| spreademkitchen.com | 119 |
| romexcanada.com | 119 |
| organicocean.com | 118 |
| pennyapp.com | 112 |
| modernpurair.com | 106 |
| srjca.com | 106 |
| 49thparallelroasters.com | 92 |
| thefortdistillery.com | 90 |
| courtabram.com | 89 |

Most named domains look like client companies, which is consistent with ordinary consulting
delivery. **This report does not judge whether any individual share is wrong** — that needs someone
who knows the engagements. What it establishes is the scale, and that the `anyone-with-link` and
personal-Gmail categories deserve review on their own terms.

---

## Scope of the inventory

| | |
|---|---|
| Rows captured | 133,283 |
| Files | 100,470 |
| Folders | 32,813 |
| Shared Drives | 1 |
| User accounts | 15 (all active — 0 suspended, 0 archived) |
| API calls | 18,119 |
| Throttle retries (403) | 2, both recovered |

### Shared Drives

The organization has **exactly one Shared Drive**. This was confirmed with
`useDomainAdminAccess=true` as a super admin, so it reflects the whole org, not just what one
account can see.

| Name | ID | Members | Files | Bytes |
|---|---|---|---|---|
| Granted Files | `0AKxoOSs3WbQ0Uk9PVA` | 5 | 76,286 | 63.86 GB |

Members: `writers@` (organizer); `delpreet@`, `natalie@`, `olivia@` and the migration service
account (fileOrganizer).

**This Shared Drive is the Dropbox migration** — its 76,241 files were placed there by the copy
stages, and the remaining items are the folder tree. It is not pre-existing material.

### The pre-existing corpus is in My Drives

**24,184 files, 70.16 GB** across 15 accounts. This is what phase 2
would need to fold into the new structure.

| Owner | Files | Bytes | Native | Binary | Shared | External | Orphaned |
|---|---|---|---|---|---|---|---|
| consultants@granted.ca | 6,099 | 16.90 GB | 3,205 | 2,894 | 4,479 | 2,784 | 153 |
| ssang@granted.ca | 5,894 | 8.68 GB | 3,048 | 2,846 | 4,702 | 1,527 | 50 |
| admin@granted.ca | 3,733 | 21.16 GB | 1,030 | 2,703 | 2,748 | 2,348 | 164 |
| marketing@granted.ca | 1,900 | 9.78 GB | 1,104 | 796 | 1,100 | 787 | 111 |
| payment@granted.ca | 1,500 | 1.09 GB | 222 | 1,278 | 775 | 353 | 27 |
| rukshaar@granted.ca | 1,445 | 7.65 GB | 744 | 701 | 1,164 | 628 | 3 |
| writers@granted.ca | 1,011 | 0.50 GB | 613 | 398 | 831 | 735 | 0 |
| delpreet@granted.ca | 657 | 0.58 GB | 57 | 600 | 633 | 587 | 0 |
| research@granted.ca | 552 | 2.86 GB | 470 | 82 | 405 | 178 | 45 |
| natalie@granted.ca | 402 | 0.48 GB | 285 | 117 | 300 | 50 | 0 |
| dev@granted.ca | 362 | 0.31 GB | 302 | 60 | 227 | 68 | 29 |
| olivia@granted.ca | 348 | 0.17 GB | 72 | 276 | 296 | 225 | 0 |
| help@granted.ca | 163 | 0.00 GB | 160 | 3 | 141 | 53 | 21 |
| fadi@granted.ca | 75 | 0.00 GB | 72 | 3 | 13 | 0 | 0 |
| tomliao@granted.ca | 43 | 0.00 GB | 21 | 22 | 3 | 3 | 0 |

---

## Google-native versus binary

| | Files | Bytes |
|---|---|---|
| Google-native (Docs, Sheets, Slides, Forms…) | 11,448 | 1,440,940,519 bytes reported |
| Binary (PDF, Office, images, video…) | 89,022 | — |

**Native files report a size that is not a real byte count.** They live in Google's own storage
format and have no downloadable original. This matters for any later move:

- They cannot be copied byte-for-byte the way the Dropbox migration copied files. Moving them
  between drives is a metadata re-parent; exporting them means format conversion and fidelity loss.
- A byte-based size or progress estimate that includes them will be wrong.
- The Dropbox copy explicitly refused to create native types precisely to avoid this.

| Type | Files |
|---|---|
| binary | 89,022 |
| Google Doc | 5,635 |
| Google Sheet | 2,843 |
| Shortcut | 2,692 |
| Google Slides | 195 |
| Google Form | 55 |
| Google Drawing | 23 |
| Google Site | 4 |
| Google My Map | 1 |

---

## Orphaned files

**603 files in My Drives have no parent folder.** They are reachable by search and by
direct link but appear in no folder, so a folder-tree-based migration would silently skip them.

| Owner | Orphans |
|---|---|
| admin@granted.ca | 164 |
| consultants@granted.ca | 153 |
| marketing@granted.ca | 111 |
| ssang@granted.ca | 50 |
| research@granted.ca | 45 |
| dev@granted.ca | 29 |
| payment@granted.ca | 27 |
| help@granted.ca | 21 |
| rukshaar@granted.ca | 3 |

---

## Age distribution (My Drives, by modifiedTime)

| Age | Files | Share |
|---|---|---|
| <90d | 650 | 2.7% |
| 90d–1y | 2,767 | 11.4% |
| 1–2y | 4,372 | 18.1% |
| 2–5y | 12,930 | 53.5% |
| 5y+ | 3,465 | 14.3% |

**68% has not been touched in over two years.** Useful
context for phase 2: most of this corpus is archival, not live working material.

---

## Client-name signal (rough)

**4,328 files** have a path or filename loosely matching one of
**574 names** from `dist/inventory/clients-final.csv`.

**This is a signal, not a match.** It is a normalized substring test against canonical client names
of six characters or more, first hit wins. It will catch coincidental substrings and miss
abbreviations, misspellings and initials entirely. Treat the number as evidence that client work
exists in My Drives at scale — not as a file list to act on.

| Client name matched | Files |
|---|---|
| Paintillio | 161 |
| Fine Choice Foods | 96 |
| Spring | 89 |
| Caliber | 82 |
| GlassCanvas | 74 |
| Wakefield | 72 |
| Forecast | 67 |
| Body Energy Club | 60 |
| Modern Purair | 58 |
| Consumer Genius | 57 |
| Lass Chance | 56 |
| Fort Distillery | 51 |
| Levelground | 49 |
| Spreadem | 48 |
| SAAM Towage | 45 |
| HPP Canada | 42 |
| Sparelabs | 41 |
| BINQUIP | 41 |
| Santevia | 41 |
| Hatchways | 40 |

---

## Duplicate names across users (rough collaboration signal)

**731 distinct filenames** appear in more than one user's My Drive.

Filename collision is weak evidence — `Untitled document` and `image.png` collide meaninglessly.
It is offered only as a hint about where the same material may exist in several places.

| Name | Owners |
|---|---|
| untitled document | 12 |
| untitled spreadsheet | 10 |
| getting started | 6 |
| funding_agreement.pdf | 5 |
| .ds_store | 4 |
| canexport templates | 4 |
| granted consulting hr policy | 4 |
| elivated document directory | 4 |
| granted check in and goal tracking- delpreet kaur | 3 |
| expense 14-uber-pop.pdf | 3 |
| green jobs - clean foundation - complete process | 3 |
| claims | 3 |
| final claim | 3 |
| buybc_logos.zip | 3 |
| buy bc logo user guide.pdf | 3 |

---

## What this inventory CANNOT see

Stated plainly, because the gaps matter as much as the contents:

- **Files in personal Gmail accounts.** Outside the domain entirely — invisible to Admin SDK and
  domain-wide delegation. If a staff member saved work to a personal account, it is not here. Note
  the connection to the finding above: 3,941 files are *shared to* personal Gmail, and
  anything *copied into* those accounts is beyond reach.
- **Files shared into the org from outside.** They appear in a user's "Shared with me" but are owned
  externally, so they live in the owner's Drive, not ours. They cannot be inventoried, migrated or
  preserved, and if the external owner deletes one it is gone.
- **Suspended and archived users' Drives.** Not an issue today — all 15 accounts are active — but
  `users.list` omits suspended accounts by default and Drive impersonation of a suspended user
  typically fails. If someone is suspended before phase 2, their Drive needs deliberate handling.
- **Deleted users' Drives.** Gone unless the account was transferred or is inside the recovery window.
- **Trashed files.** Excluded by `trashed = false`. Recoverable for 30 days, invisible here.
- **Per-file sharing inside the Shared Drive.** Access there is governed at drive level, and probing
  76k files would have cost hours to mostly restate the member list. Shared Drive rows therefore
  record `shared_externally` as **empty, not false** — the check was not run, and the CSV does not
  pretend otherwise.
- **Content of any kind.** No file was opened. Anything requiring the inside of a document —
  what a file is actually about, whether it holds personal data — is out of reach of this pass.

---

## Output

`dist/inventory/gdrive-org-inventory.csv` — 133,283 rows, one per file and folder:

```
corpus, corpus_kind, owner, path, name, mime_type, type_label, is_google_native,
is_folder, size, quota_bytes_used, created_time, modified_time, last_modifying_user,
shared, shared_externally, external_detail, orphaned, drive_id, file_id, web_view_link
```

Gitignored and regenerable. The run checkpoints per account, so an interruption resumes rather
than re-walking.

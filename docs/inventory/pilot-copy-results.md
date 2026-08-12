# CanExport Pilot Copy — Results

**Generated:** 2026-08-11T23:55:49.218Z
**Destination:** Shared Drive `0AKxoOSs3WbQ0Uk9PVA`
**Credential:** service account `granted-ai-drive-access@granted-ai-hub.iam.gserviceaccount.com`
**Source:** Dropbox, read-only. Nothing was written to Dropbox and nothing was deleted anywhere.

## Outcome

| | |
|---|---|
| Files in the Shared Drive | **1,469** |
| Folders created | 724 |
| Mapping expects | 1,474 |
| Verified in ledger | 1,468 |
| Failed in ledger | 6 |
| Ledger lines / distinct rows | 1,494 / 1,474 (the difference is retried rows) |
| Bytes uploaded (ledger) | 21,868,640,801 (20.37 GB) |
| `review` rows deliberately not copied | 45 |

---

## Reconciliation — Drive vs the mapping

**This section does not read the copy ledger.** The Shared Drive was listed recursively via the Drive API and compared against the mapping sheet directly. Reconciling against the ledger would only prove the copier agrees with itself.

| Check | Count | Verdict |
|---|---|---|
| In the mapping, missing from Drive | 6 | **needs attention** |
| In Drive, not in the mapping | 1 | see below |
| Size mismatch against Dropbox source | 0 | clean |
| Converted to a `vnd.google-apps.*` type | 0 | clean |

**They agree on every real file.** Sizes match exactly and nothing was converted. The only gap is 6 shortcut stubs (`.web` / `.gdoc`) which Dropbox refuses to serve — see below.

### Missing from Drive (6)

All of these are **shortcut stubs, not real files.** A `.web` or `.gdoc` in Dropbox is a pointer to something hosted elsewhere; `files/download` rejects them with `unsupported_file`, so there are no bytes to copy. They were counted in the mapping because the inventory lists them as files. Recreating them would mean resolving each pointer and making a Drive shortcut — a separate task, and arguably not worth it for six.

| Destination | Route | Source |
|---|---|---|
| `Capstone Canada/CanExport/2023/Capstone CanExport - Final Report Instructions & Script.web` | sort | `/Granted Team Folder/SALES/Grants/CanExport/Clients/Capstone Canada/2023/Capstone CanExport - Final Report Instructions & Script.web` |
| `Programs/CanExport/Other resources/CanExport Budget Template.web` | program | `/Granted Team Folder/SALES/Grants/CanExport/Other resources/CanExport Budget Template.web` |
| `Programs/CanExport/Other resources/CanExport Interview Questions.web` | program | `/Granted Team Folder/SALES/Grants/CanExport/Other resources/CanExport Interview Questions.web` |
| `Programs/CanExport/Other resources/CanExport Readiness Assessment 2023.web` | program | `/Granted Team Folder/SALES/Grants/CanExport/Other resources/CanExport Readiness Assessment 2023.web` |
| `Programs/CanExport/Other resources/CanEx Readiness Assessment 2022 - 2nd time Applicant.web` | program | `/Granted Team Folder/SALES/Grants/CanExport/Other resources/CanEx Readiness Assessment 2022 - 2nd time Applicant.web` |
| `Programs/CanExport/CanExport Process Docs/Archive/CanEx 2021 Process/Claims Process/Canex Claims Process.gdoc` | program | `/Granted Team Folder/SALES/Grants/CanExport/CanExport Process Docs/Archive/CanEx 2021 Process/Claims Process/Canex Claims Process.gdoc` |

### In Drive but not in the mapping (1)

Expected to contain only the permission-check artefact. Anything else here was not called for by the contract.

| Path | Size | Mime type |
|---|---|---|
| `_permission-check/permcheck-1786488086086.txt` | 108 | text/plain |

---

## Failures during the run (6)

| Source | Error |
|---|---|
| `/Granted Team Folder/SALES/Grants/CanExport/Clients/Capstone Canada/2023/Capstone CanExport - Final Report Instructions & Script.web` | HTTP 409: {"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"} |
| `/Granted Team Folder/SALES/Grants/CanExport/Other resources/CanExport Budget Template.web` | HTTP 409: {"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"} |
| `/Granted Team Folder/SALES/Grants/CanExport/Other resources/CanExport Interview Questions.web` | HTTP 409: {"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"} |
| `/Granted Team Folder/SALES/Grants/CanExport/Other resources/CanExport Readiness Assessment 2023.web` | HTTP 409: {"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"} |
| `/Granted Team Folder/SALES/Grants/CanExport/Other resources/CanEx Readiness Assessment 2022 - 2nd time Applicant.web` | HTTP 409: {"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"} |
| `/Granted Team Folder/SALES/Grants/CanExport/CanExport Process Docs/Archive/CanEx 2021 Process/Claims Process/Canex Claims Process.gdoc` | HTTP 409: {"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"} |

---

## Not copied, by design

| | Count | Why |
|---|---|---|
| `review` rows | 45 | Undecided — 21 dual-filed joint-client rows, 3 with no attributed client |

## Reproducing

```bash
node scripts/pilot-copy.mjs --dry-run     # plan only
node scripts/pilot-copy.mjs               # resumable full run
node scripts/pilot-reconcile.mjs          # this document
```

The copy is idempotent: verified ledger entries are skipped, so re-running never duplicates a file.

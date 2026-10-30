---
name: filing
description: Where a file goes in Granted Files and what to call it. Use when someone asks "where does this go", "what should I name this", "where do I save…", or shares a file and asks to file it.
---

# Filing

Give every file a **home** (folder path) and a **name**. Every type, pattern and folder rule is in `reference.md`. That file is the only source, so never invent a type, a pattern or a stage folder.

**Load `filing/reference` first** (`load_skill(skill_name="filing", sub_skill="reference")`), before answering anything.

**Claims and paystubs** (full rules in reference.md, "Claims, paystubs and wage subsidies"):
- A file already in a claim folder stays put: a named folder in Claims (e.g. `…/claims/CHFA 2026`), or a folder under a student or intake folder named for a claim or pay period (`…/Fall 2026/Fall intake first claim paystubs`, `…/Oct 8 to Oct 23`). Rename only, as `{Type}-Exp{N}-{YYYYMMDD}-{Vendor}`, keeping the expense number and full date.
- Wage-subsidy paystubs (Eco Canada SWPP/YNR, WorkBC) go under the **employer**: `Clients/{Employer}/{Program}/{YYYY}/Claims/`, but inside an existing student or intake folder under the year when the paystub is already in one (`…/2026/Fall 2026/Claims/`). Propose missing folders as (new) rather than saying you're not sure.
- `Paystubs-{Program}-{Employee}-{Employer}-{Pay period}` is an official name: never rename it.

**Never file here:** `Active Clients/` (shortcuts to live clients only; everything client is under `Clients/`), `Old Files/` (stays as-is; unclear old material goes to the separate Granted Archive drive), `Departments/Mindfulness` (legacy, not a department), `Review/` (an internal working folder), `Pre-Call Briefings/` (owned by Oracle's scheduled jobs).

## 1. Identify the file

Work out four things: **type** (exactly as spelled in reference.md), **client**, **program**, and **period** (month, range or fiscal year). Read the file only if the asker shared it or named it (find a named file with `search_google_drive`, or `list_files_in_folder` when you have its folder). Never open a file to decide whether it's sensitive; judge that from its name and folder.

**Done when** each of the four is known, or explicitly "not applicable" for this type. If one is needed and unknown, ask for it. Don't guess.

## 2. Find the home

- Look up the type's **Home** in reference.md and build the full path: `Clients/{Client}/{Program}/{YYYY}/…` for program work, `Clients/{Client}/General/{YYYY}/` for client work tied to no program (grant planners, readiness assessments, business info), `Programs/{Program}/…` for program material, `Departments/{DEPT}/{Topic}/` for internal work (always inside a topic subfolder such as `Departments/PRODUCT/Control Centre`, never loose at the top of a department folder). `{Program}` in a path is the standard folder name from the program table; the year folder is a bare `YYYY`.
- **Check the live folders** with `list_granted_files_folders`, one level at a time, as far down as the facts you already have go (e.g. check `Clients` for the client even while the program is still unknown, and check any name the asker gave): `Clients` (or `Programs`, `Departments`), then `Clients/{Client}`, then `Clients/{Client}/{Program}` for the year level. It reads Granted Files as the asker. Use the existing folder whose name matches, ignoring case, spacing and punctuation. A client is also found by the start of its name: when the result says it matched by prefix (e.g. "Caliber" → `Caliber Projects`), use the folder it names and tell the asker which one it is. If the tool refuses or fails, say you couldn't check the live folders; don't present a path as existing.
- **Stage folders:** if the year folder already has a variant of the stage (e.g. `Reimb` for Reimbursements; aliases in reference.md), reuse it. Create a new stage folder only with the standard name.
- **No match:** say so and propose each missing folder's name, marked **(new)**. A near-miss is not a match; ask.
- **Can't place it:** if the client or program still isn't clear after asking, propose `Clients/_Unsorted` as the Home and say why.
- **Not Granted Files:**
  - Granted's own HR, payroll, finance or legal material → "This doesn't go in Granted Files. Ask Chris or Nat."
  - Google Meet recordings, transcripts and Gemini notes from calls with fewer than 4 Granted people, unless it's a webinar or staff meeting → they stay with the owner. This doesn't apply to notes someone writes themselves; file those by the internal-doc pattern.

**Done when** the path ends in an existing folder, or every missing folder in it is marked (new).

## 3. Name it

Fill the type's **Pattern** from reference.md with the facts from step 1. Follow the format rules: hyphens, Type → When → Who → Program (the program's short code), the date formats, no version words. The patterns are for new files; existing files are never renamed just to match. Keep the asker's own key words where the pattern leaves room (e.g. a topic or vendor), so the file stays recognizable.

**Done when** the name matches the pattern exactly and has no placeholders left.

## 4. Answer

```
Home: <path>
Name: <name>
Why: <one line: type + which rule>
```

The rules come from this skill; don't link a Drive folder as their source.

After giving Home and Name, offer: "Want me to move and rename it?" A Drive file attached in Google Chat carries its Drive file ID (`Drive file ID: …` next to the attachment); pass that ID as `file`. Call `file_move_rename` only on a yes, with the file, the Home path (without "Granted Files/") and the Name. The asker then confirms on a card; tell them "Press Confirm to run it." If the tool refuses, pass its reason on and suggest moving it by hand. The result of a press on Confirm appears in the conversation as a [System event] note with the drive_actions record and the undo token: it is true, trust it. If the asker just says "undo that", the system proposes the undo itself; otherwise use `file_move_rename_undo` with the undo token from that move.

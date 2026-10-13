---
name: filing
description: Where a file goes in Granted Files and what to call it. Use when someone asks "where does this go", "what should I name this", "where do I save…", or shares a file and asks to file it.
---

# Filing

Give every file a **home** (folder path) and a **name**. Every type, pattern and folder rule is in `reference.md`. That file is the only source, so never invent a type, a pattern or a stage folder.

**Load `filing/reference` first** (`load_skill(skill_name="filing", sub_skill="reference")`), before answering anything.

**Never file here:** `Active Clients/` (a leftover; everything client is under `Clients/`), `Live Clients/` (shortcuts only), `Departments/Mindfulness` (legacy, not a department), `Old Files/` (stays as-is; unclear old material goes to the separate Granted Archive drive).

## 1. Identify the file

Work out four things: **type** (exactly as spelled in reference.md), **client**, **program**, and **period** (month, range or fiscal year). Read the file only if the asker shared it or named it (find a named file with `search_google_drive`, or `list_files_in_folder` when you have its folder). Never open a file to decide whether it's sensitive; judge that from its name and folder.

**Done when** each of the four is known, or explicitly "not applicable" for this type. If one is needed and unknown, ask for it. Don't guess.

## 2. Find the home

- Look up the type's **Home** in reference.md and build the full path: `Clients/{Client}/{Program}/{Engagement}/…` for client work, `Programs/{Program}/…` for program material, `Departments/{DEPT}` for internal work.
- **Check the live folders** with `list_granted_files_folders`, one level at a time, as far down as the facts you already have go (e.g. check `Clients` for the client even while the program is still unknown, and check any name the asker gave): `Clients` (or `Programs`, `Departments`), then `Clients/{Client}`, then `Clients/{Client}/{Program}` for the engagement level. It reads Granted Files as the asker. Use the existing folder whose name matches, ignoring case, spacing and punctuation. If an engagement folder already exists as a bare year (e.g. `2026`), use it. If the tool refuses or fails, say you couldn't check the live folders; don't present a path as existing.
- **No match:** say so and propose each missing folder's name, marked **(new)**. A near-miss is not a match; ask.
- **Not Granted Files:**
  - Granted's own HR, payroll, finance or legal material → "This doesn't go in Granted Files. Ask Chris or Nat."
  - Google Meet recordings, transcripts and Gemini notes from calls with fewer than 4 Granted people, unless it's a webinar or staff meeting → they stay with the owner. This doesn't apply to notes someone writes themselves; file those by the internal-doc pattern.

**Done when** the path ends in an existing folder, or every missing folder in it is marked (new).

## 3. Name it

Fill the type's **Pattern** from reference.md with the facts from step 1. Follow the format rules: hyphens, Type → When → Who → Program, the date formats, no version words. Keep the asker's own key words where the pattern leaves room (e.g. a topic or vendor), so the file stays recognizable.

**Done when** the name matches the pattern exactly and has no placeholders left.

## 4. Answer

```
Home: <path>
Name: <name>
Why: <one line: type + which rule>
```

The rules come from this skill; don't link a Drive folder as their source.

Move or rename only when asked, using the move/rename tool. Until that tool exists, say "I can't move files yet. Drag it there and rename it."

---
description: Append a new entry to DECISIONS.md at the top
---

Append a new entry to the TOP of `DECISIONS.md` (after the format block and separator, before the most recent existing entry).

Use today's date in YYYY-MM-DD format. The user will provide the content via $ARGUMENTS.

Parse $ARGUMENTS as:
- First line or up to first colon = title
- "What:" content = what was decided
- "Why:" content = rationale
- "Impact:" content = files or systems affected

If $ARGUMENTS is informal prose, infer these fields. If anything is genuinely ambiguous, ask one clarifying question before writing. Otherwise just write it.

Format must match existing entries exactly:

```
## YYYY-MM-DD — short title
**What:** one line
**Why:** one line
**Impact:** files/systems touched
```

If `DECISIONS.md` doesn't exist yet, create it with this header first:

```
# Decisions Log

Append new entries at the **top**. Each entry is short — 3-5 lines max. Claude Code reads this for recent context.

Format:
\`\`\`
## YYYY-MM-DD — short title
**What:** one line
**Why:** one line
**Impact:** files/systems touched
\`\`\`

---
```

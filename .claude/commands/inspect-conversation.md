---
description: Pull a conversation trace by UUID, agent type, timestamp window, or user
---

Invoke the conversation inspector CLI to pull diagnostic data: $ARGUMENTS

Use `node scripts/inspect-conversation.js` with the appropriate flags based on what the user described.

Common patterns:
- User gives a timestamp like "around 2:30pm today" → `--agent <type> --after <iso>` with a 30-60 min window
- User gives a conversation UUID → `--conversation <uuid>`
- User mentions a team member by name/email → `--user <email> --after <today>`
- User reports "recent Oracle issue" → `--agent internal-oracle --limit 5`

Default to `--format summary` for triage. Only use `--format trace` if the user needs full tool inputs/outputs or specifically asks for detail. Use `--format json` only when piping to another tool.

After running, summarize findings in plain language: what happened, what tool calls ran, any errors, and what the likely issue is. Do NOT paste raw JSON at the user unless they ask.

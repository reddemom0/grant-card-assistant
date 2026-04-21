---
description: Add a new agent to the AI hub following the 4-touchpoint registration pattern
---

Follow the recipe at `.claude/recipes/add-agent.md` to add a new agent: $ARGUMENTS

Start by reading the full recipe. Then collect the required inputs listed in the "Inputs you need before starting" section. If any are missing from what the user provided, ask before proceeding.

Run pre-flight checks. If any fail, stop and report.

Execute the 4 registration touchpoints in order (prompt file, tool loadout, frontend route, UI registration). For backend-only agents, skip Steps 3 and 4. Use Plan mode for the edits — propose your plan before touching files.

After execution, run the verification steps. Log the decision via `/log-decision`.

---
description: Add a new runtime tool to the AI hub following the schema/implementation/dispatch pattern
---

Follow the recipe at `.claude/recipes/add-tool.md` to add a new tool: $ARGUMENTS

Start by reading the full recipe. Then collect the required inputs listed in the "Inputs you need before starting" section. If any are missing from what the user provided, ask before proceeding.

Run pre-flight checks. If any fail, stop and report.

Execute the 3 registration touchpoints in order (schema, implementation, executor dispatch), plus Step 4 (agent loadouts) if the tool needs to be added to specific agents. Use Plan mode for the edits — propose your plan before touching files.

After execution, run the verification steps. Log the decision via `/log-decision`.

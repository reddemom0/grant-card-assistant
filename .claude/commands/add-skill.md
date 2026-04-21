---
description: Add a new skill to the AI hub following the 5-touchpoint registration pattern
---

Follow the recipe at `.claude/recipes/add-skill.md` to add a new skill: $ARGUMENTS

Start by reading the full recipe. Then collect the required inputs listed in the "Inputs you need before starting" section. If any are missing from what the user provided, ask before proceeding.

Run pre-flight checks. If any fail, stop and report.

Execute the 6 steps in order (5 touchpoints + conditional tool subset). Use Plan mode for the edits — propose your plan before touching files.

After execution, run the verification steps. Log the decision via `/log-decision`.

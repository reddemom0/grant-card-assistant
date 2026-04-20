---
description: Pre-commit quality gate — runs available quality checks and reports what needs fixing
---

Run available quality checks and report results:

1. If `npm run typecheck` exists, run it and report errors
2. If `npm run lint` exists, run it and report errors
3. If `npm test` exists, run it and report results

For any checks that don't exist or aren't configured yet, say so clearly.

If all configured checks pass, say "Ready to commit."

If there are errors, list them clearly. Do NOT automatically fix them — wait for instruction.

---
name: repo-health-check
description: Inspect a GitHub repository and produce a concise repository health report covering structure, recent changes, open pull requests and issues, and CI status. Use when the user asks for a repo status check, maintenance snapshot, or quick engineering-health review. Do not modify the repository unless the user explicitly asks for changes.
---

# Repository Health Check

Use the connected GitHub app to inspect the repository named or linked by the user.

## Workflow

1. Resolve the repository and its default branch.
2. Inspect the repository metadata and top-level structure.
3. Review the most relevant recent commits.
4. Review open pull requests and open issues, prioritizing recently updated items.
5. Check recent CI/workflow status when available.
6. Summarize notable risks, blockers, stale work, and concrete next actions.

## Output

Return a compact report with:

- **Status:** one-sentence overall assessment.
- **Recent activity:** the most relevant recent changes.
- **PRs / issues:** items that need attention, with identifiers.
- **CI:** failing, pending, or noteworthy checks.
- **Next actions:** up to five prioritized recommendations.

Use repository evidence rather than guessing. If a requested signal is unavailable, say so explicitly. Keep this skill read-only by default; only perform GitHub writes after an explicit user request.

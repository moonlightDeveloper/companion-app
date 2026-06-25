---
name: commit-format
description: >
  How to write git commit messages in this repo. Use whenever committing.
  Every commit must follow: type(JIRA-KEY): subject, then a blank line,
  then a short description.
---

# Commit message format

Every commit in this repo MUST follow:

```
type(TICKET): subject

Short description of what changed and why.
```

- **type** is one of: feat, fix, chore, docs, refactor, test, style, perf, build, ci
- **TICKET** is the Jira key, uppercase, e.g. `CMP-12`
- Title: imperative mood, no trailing period, ~50 chars or less
- Blank line, then a short description

Example:

```
feat(CMP-12): add live behaviour read

Wire the story flow to POST /api/analyze and render the returned
bars, cards, suggested move, and grounding note.
```

## Finding the ticket
- Look for the Jira key in the branch name (e.g. `feat/CMP-12-live-read` → CMP-12).
- If no key is found, ask the user which Jira ticket this commit belongs to. Do not invent one.

## Guardrail
- A `commit-msg` git hook enforces this. If a commit is rejected, fix the message to match the pattern rather than bypassing the hook.

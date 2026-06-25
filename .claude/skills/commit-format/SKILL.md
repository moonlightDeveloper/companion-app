---
name: commit-format
description: >
  How to write git commit messages in this repo. Use whenever committing.
  Commits follow: type(JIRA-KEY): subject, then a blank line, then a short
  description. The (JIRA-KEY) is optional for quick fixes.
---

# Commit message format

Every commit in this repo MUST follow one of:

```
type(TICKET): subject        # normal — tied to a Jira ticket

type: subject                # quick fix — no ticket
```

followed by a blank line, then a short description.

- **type** is one of: feat, fix, chore, docs, refactor, test, style, perf, build, ci
- **TICKET** is the Jira key, uppercase, e.g. `CMP-12`. Include it whenever the
  commit relates to a ticket.
- Title: imperative mood, no trailing period, ~50 chars or less
- Blank line, then a short description

Example (with ticket):

```
feat(CMP-12): add live behaviour read

Wire the story flow to POST /api/analyze and render the returned
bars, cards, suggested move, and grounding note.
```

Example (quick fix, no ticket):

```
fix: correct typo in landing heading
```

## Finding the ticket
- Look for the Jira key in the branch name (e.g. `feat/CMP-12-live-read` → CMP-12).
- If no key is found, ask the user whether this is a quick fix (omit the ticket)
  or which Jira ticket it belongs to. Do not invent a ticket.
- Prefer including a ticket; omit it only for genuinely small, standalone fixes.

## Guardrail
- A `commit-msg` git hook enforces this. If a commit is rejected, fix the message to match the pattern rather than bypassing the hook.

---
name: open-pr
description: >
  How to open a pull request in this repo so it links to its Jira ticket.
  Use whenever opening or creating a PR / MR.
---

# Opening a pull request

Open PRs with the repo helper:

```
scripts/open-pr.sh           # base defaults to main
scripts/open-pr.sh develop   # or pass a base branch
```

It checks the branch carries the Jira key (e.g. `fix/FLAG-2-wrong-images`),
pushes, and opens the PR with title/body taken from the commits via
`gh --fill`.

## How the Jira link works
A repository **autolink** (`FLAG-` → `https://companion-app.atlassian.net/browse/FLAG-<n>`)
turns every `FLAG-<n>` into a clickable Jira link automatically — in commit
messages, PR descriptions, and comments. Because the title format
`type(KEY): subject` puts the key in the commit (and thus the PR body), the
link appears with **no footer and no added text**.

Note: GitHub renders PR **titles** as plain text, so the key in the title
itself is not clickable — only where GitHub renders body/commit text.

## Rules
- The branch name MUST contain the Jira key (uppercase), e.g. `feat/CMP-12-...`.
  The script refuses otherwise — rename the branch, don't bypass it.
- **Do not add generated boilerplate to PR descriptions** (no "Generated with
  Claude Code" line, no manual Jira-link footer). Let the body be the real
  commit content; the autolink handles the link.

## The other half (one-time, in the UI)
Live two-way status (PRs in the Jira ticket's Development panel) comes from the
**GitHub for Jira** app, connected once at the org level. It keys off the
Jira key already in the branch/commit/PR.

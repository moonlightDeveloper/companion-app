---
name: open-pr
description: >
  How to open a pull request in this repo so it links back to its Jira ticket.
  Use whenever opening or creating a PR / MR.
---

# Opening a pull request

Always open PRs with the repo helper so the PR body links to the Jira ticket
and both platforms cross-reference:

```
scripts/open-pr.sh           # base defaults to main
scripts/open-pr.sh develop   # or pass a base branch
```

It derives the Jira key from the current branch (e.g. `fix/FLAG-2-wrong-images`
→ `FLAG-2`), pushes the branch, opens the PR with `gh --fill`, and appends a
`🔗 Jira ticket: [KEY](https://companion-app.atlassian.net/browse/KEY)` footer.

## Rules
- The branch name MUST contain the Jira key (uppercase), e.g. `feat/CMP-12-...`.
  The script refuses to open a PR otherwise — rename the branch, don't bypass it.
- PR titles still follow `type(KEY): subject` (see the `commit-format` skill);
  with `--fill` the title comes from the latest commit, which already matches.
- If you open a PR by hand instead, include the same Jira link in the body.

## The other half (one-time, in the UI)
Live two-way status (PRs showing in the Jira ticket's Development panel,
optional auto-transitions) comes from the **GitHub for Jira** app, connected
once at the org level. The key in the branch/commit/PR is what it keys off —
which this repo's conventions already guarantee.

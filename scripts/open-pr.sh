#!/bin/sh
# Open a PR whose body links back to the Jira ticket named in the branch.
#
# Usage: scripts/open-pr.sh [base-branch]   (base defaults to "main")
#
# Derives the Jira key from the current branch (e.g. fix/FLAG-2-wrong-images
# -> FLAG-2), pushes the branch, opens the PR with `gh --fill`, then appends a
# clickable Jira link to the PR body so both platforms cross-reference.
set -e

JIRA_BASE="${JIRA_BASE:-https://companion-app.atlassian.net}"
base="${1:-main}"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" = "$base" ]; then
  echo "✗ You're on '$base'. Switch to a feature branch first." >&2
  exit 1
fi

key="$(printf '%s' "$branch" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1)"
if [ -z "$key" ]; then
  echo "✗ No Jira key found in branch name '$branch'." >&2
  echo "  Rename the branch to include one, e.g. feat/CMP-12-thing." >&2
  exit 1
fi
url="$JIRA_BASE/browse/$key"

# Make sure the branch is on the remote so gh can open the PR.
git push -u origin "$branch"

# Create the PR with title/body filled from the commits.
gh pr create --base "$base" --fill

# Append the Jira link footer to the PR body (idempotent).
num="$(gh pr view --json number --jq .number)"
body="$(gh pr view --json body --jq .body)"
case "$body" in
  *"$url"*) ;;  # already linked
  *) gh pr edit "$num" --body "$body

---
🔗 Jira ticket: [$key]($url)" ;;
esac

echo "✓ PR #$num opened and linked to $url"

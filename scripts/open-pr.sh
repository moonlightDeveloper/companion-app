#!/bin/sh
# Open a PR for the current branch.
#
# Usage: scripts/open-pr.sh [base-branch]   (base defaults to "main")
#
# The branch must carry the Jira key (e.g. fix/FLAG-2-wrong-images). The key
# also ends up in the PR title/body via the commit message, and a repository
# autolink turns every FLAG-<n> into a clickable Jira link automatically — so
# the PR needs no extra footer or boilerplate.
set -e

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

# Push the branch, then open the PR with title/body taken straight from the
# commits — no generated footer.
git push -u origin "$branch"
gh pr create --base "$base" --fill

num="$(gh pr view --json number --jq .number)"
echo "✓ PR #$num opened (key $key autolinks to Jira)"

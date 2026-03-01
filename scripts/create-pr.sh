#!/usr/bin/env bash
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$branch" == "HEAD" ]]; then
  echo "Detached HEAD detected. Switch to a feature branch first."
  exit 1
fi

if [[ "$branch" == "main" || "$branch" == "master" ]]; then
  echo "Refusing to create a PR from $branch. Switch to a feature branch first."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is not installed."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login --git-protocol ssh --web"
  exit 1
fi

# Push the current branch once if it has no upstream yet.
if ! git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
  git push -u origin "$branch"
fi

# If a PR already exists for this branch, print it and exit.
if gh pr view --head "$branch" --json url >/dev/null 2>&1; then
  gh pr view --head "$branch" --json url --jq '.url'
  exit 0
fi

use_fill=1
for arg in "$@"; do
  if [[ "$arg" == "--title" || "$arg" == "--body" || "$arg" == "--body-file" ]]; then
    use_fill=0
  fi
done

cmd=(gh pr create --base main --head "$branch")
if [[ "$use_fill" -eq 1 ]]; then
  cmd+=(--fill)
fi
cmd+=("$@")

"${cmd[@]}"

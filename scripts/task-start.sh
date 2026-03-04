#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/task-start.sh <task-name>

Creates a new worktree and branch using this convention:
  branch: codex/<task-name>
  path:   <worktrees-root>/<task-name>

Environment variables:
  WORKTREES_ROOT  Override default worktrees root directory.
  BASE_REF        Override base ref (default: origin/main).
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 2
fi

RAW_TASK_NAME="$1"
TASK_NAME="$(printf '%s' "$RAW_TASK_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's#[^a-z0-9._-]+#-#g; s#^-+##; s#-+$##')"

if [ -z "$TASK_NAME" ]; then
  echo "task-start: invalid task name: $RAW_TASK_NAME" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
DEFAULT_WORKTREES_ROOT="$(dirname "$REPO_ROOT")/${REPO_NAME}-worktrees"
WORKTREES_ROOT="${WORKTREES_ROOT:-$DEFAULT_WORKTREES_ROOT}"
BASE_REF="${BASE_REF:-origin/main}"

BRANCH_NAME="codex/$TASK_NAME"
WORKTREE_PATH="$WORKTREES_ROOT/$TASK_NAME"

git fetch origin --prune

if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "task-start: base ref not found: $BASE_REF" >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "task-start: local branch already exists: $BRANCH_NAME" >&2
  exit 1
fi

if [ -e "$WORKTREE_PATH" ]; then
  echo "task-start: worktree path already exists: $WORKTREE_PATH" >&2
  exit 1
fi

mkdir -p "$WORKTREES_ROOT"
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_REF"

echo "Created task worktree."
echo "branch=$BRANCH_NAME"
echo "path=$WORKTREE_PATH"
echo "next: cd $WORKTREE_PATH"

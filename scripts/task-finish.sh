#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/task-finish.sh <pr-number-or-url> [task-name-or-branch]

Merges the PR into main, then cleans up branch + worktree.

If task-name-or-branch is omitted, the current branch is used (must match codex/<task-name>).

Environment variables:
  WORKTREES_ROOT  Override default worktrees root directory.
  MERGE_METHOD    gh merge method: merge|squash|rebase (default: merge).
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage >&2
  exit 2
fi

PR_REF="$1"
BRANCH_INPUT="${2:-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "task-finish: gh CLI is required" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
DEFAULT_WORKTREES_ROOT="$(dirname "$REPO_ROOT")/${REPO_NAME}-worktrees"
WORKTREES_ROOT="${WORKTREES_ROOT:-$DEFAULT_WORKTREES_ROOT}"
MERGE_METHOD="${MERGE_METHOD:-merge}"

CURRENT_BRANCH="$(git branch --show-current || true)"

if [ -z "$BRANCH_INPUT" ]; then
  if [[ "$CURRENT_BRANCH" != codex/* ]]; then
    echo "task-finish: provide task-name-or-branch when not on a codex/* branch" >&2
    exit 2
  fi
  BRANCH_NAME="$CURRENT_BRANCH"
elif [[ "$BRANCH_INPUT" == codex/* ]]; then
  BRANCH_NAME="$BRANCH_INPUT"
else
  BRANCH_NAME="codex/$BRANCH_INPUT"
fi

TASK_NAME="${BRANCH_NAME#codex/}"
WORKTREE_PATH="$WORKTREES_ROOT/$TASK_NAME"

if [[ "$MERGE_METHOD" != "merge" && "$MERGE_METHOD" != "squash" && "$MERGE_METHOD" != "rebase" ]]; then
  echo "task-finish: invalid MERGE_METHOD '$MERGE_METHOD'" >&2
  exit 2
fi

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "task-finish: expected worktree path not found: $WORKTREE_PATH" >&2
  exit 1
fi

if [ -n "$(git -C "$WORKTREE_PATH" status --porcelain)" ]; then
  echo "task-finish: worktree has uncommitted changes: $WORKTREE_PATH" >&2
  exit 1
fi

PR_STATE="$(gh pr view "$PR_REF" --json state --jq '.state')"
PR_HEAD="$(gh pr view "$PR_REF" --json headRefName --jq '.headRefName')"

if [ "$PR_HEAD" != "$BRANCH_NAME" ]; then
  echo "task-finish: warning: PR head '$PR_HEAD' differs from expected '$BRANCH_NAME'" >&2
fi

if [ "$PR_STATE" = "OPEN" ]; then
  gh pr merge "$PR_REF" "--$MERGE_METHOD"
elif [ "$PR_STATE" = "MERGED" ]; then
  echo "PR already merged: $PR_REF"
else
  echo "task-finish: PR is not open/merged (state=$PR_STATE)" >&2
  exit 1
fi

# Use common repo root for cleanup so the target worktree can be removed safely.
COMMON_GIT_DIR="$(git rev-parse --git-common-dir)"
COMMON_REPO_ROOT="$(cd "$COMMON_GIT_DIR/.." && pwd)"

if [ "$COMMON_REPO_ROOT" = "$WORKTREE_PATH" ]; then
  echo "task-finish: refusing to remove common repo root as worktree" >&2
  exit 1
fi

# Keep local refs clean.
git -C "$COMMON_REPO_ROOT" fetch --prune

if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
  git -C "$COMMON_REPO_ROOT" push origin --delete "$BRANCH_NAME"
fi

git -C "$COMMON_REPO_ROOT" worktree remove "$WORKTREE_PATH"

if git -C "$COMMON_REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git -C "$COMMON_REPO_ROOT" branch -d "$BRANCH_NAME"
fi

git -C "$COMMON_REPO_ROOT" worktree prune
git -C "$COMMON_REPO_ROOT" fetch --prune

echo "Cleanup complete."
echo "pr=$PR_REF"
echo "branch=$BRANCH_NAME"
echo "worktree=$WORKTREE_PATH"

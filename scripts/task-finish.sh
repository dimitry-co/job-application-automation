#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/task-finish.sh <pr-number-or-url> [task-name-or-branch] [options]

Merges the PR into main, deletes remote/local branch, removes worktree,
and updates .codexbot/active-tasks.json.

Options:
  --method <merge|squash|rebase>   Merge method (default: merge).
  -h, --help                       Show help.

Environment variables:
  WORKTREES_ROOT                   Override default worktrees root directory.
USAGE
}

if [ "$#" -eq 0 ]; then
  usage >&2
  exit 2
fi

PR_REF=""
BRANCH_INPUT=""
MERGE_METHOD="${MERGE_METHOD:-merge}"

POSITIONAL_COUNT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --method)
      MERGE_METHOD="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "task-finish: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      POSITIONAL_COUNT=$((POSITIONAL_COUNT + 1))
      if [ "$POSITIONAL_COUNT" -eq 1 ]; then
        PR_REF="$1"
      elif [ "$POSITIONAL_COUNT" -eq 2 ]; then
        BRANCH_INPUT="$1"
      else
        echo "task-finish: too many positional arguments" >&2
        usage >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [ -z "$PR_REF" ]; then
  echo "task-finish: pr-number-or-url is required" >&2
  usage >&2
  exit 2
fi

if [[ "$MERGE_METHOD" != "merge" && "$MERGE_METHOD" != "squash" && "$MERGE_METHOD" != "rebase" ]]; then
  echo "task-finish: invalid merge method: $MERGE_METHOD" >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "task-finish: gh CLI is required" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
DEFAULT_WORKTREES_ROOT="$(dirname "$REPO_ROOT")/${REPO_NAME}-worktrees"
WORKTREES_ROOT="${WORKTREES_ROOT:-$DEFAULT_WORKTREES_ROOT}"
TASK_REGISTRY_PATH="$REPO_ROOT/.codexbot/active-tasks.json"

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

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "task-finish: expected worktree path not found: $WORKTREE_PATH" >&2
  exit 1
fi

if [ -n "$(git -C "$WORKTREE_PATH" status --porcelain)" ]; then
  echo "task-finish: worktree has uncommitted changes: $WORKTREE_PATH" >&2
  exit 1
fi

PR_INFO="$(gh pr view "$PR_REF" --json number,state,headRefName,url,mergedAt)"
PR_NUMBER="$(printf '%s' "$PR_INFO" | node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(String(o.number));')"
PR_STATE="$(printf '%s' "$PR_INFO" | node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(String(o.state));')"
PR_HEAD="$(printf '%s' "$PR_INFO" | node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(String(o.headRefName));')"

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

UPDATED_PR_INFO="$(gh pr view "$PR_REF" --json number,state,mergedAt,url)"
UPDATED_PR_STATE="$(printf '%s' "$UPDATED_PR_INFO" | node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(String(o.state));')"
if [ "$UPDATED_PR_STATE" != "MERGED" ]; then
  echo "task-finish: merge did not complete (state=$UPDATED_PR_STATE)" >&2
  exit 1
fi

COMPLETED_AT_MS="$(node -e 'console.log(Date.now())')"

COMMON_GIT_DIR="$(git rev-parse --git-common-dir)"
COMMON_REPO_ROOT="$(cd "$COMMON_GIT_DIR/.." && pwd)"

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

if [ -f "$TASK_REGISTRY_PATH" ]; then
  node - <<'NODE' "$TASK_REGISTRY_PATH" "$TASK_NAME" "$PR_NUMBER" "$COMPLETED_AT_MS"
const fs = require("node:fs");
const [filePath, taskName, prNumber, completedAt] = process.argv.slice(2);

let data;
try {
  data = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch {
  process.exit(0);
}

if (!data || typeof data !== "object" || !data.tasks || typeof data.tasks !== "object") {
  process.exit(0);
}

const current = data.tasks[taskName];
if (!current || typeof current !== "object") {
  process.exit(0);
}

current.status = "done";
current.pr = Number(prNumber);
current.completedAt = Number(completedAt);
current.checks = {
  prMerged: true,
  branchDeleted: true,
  worktreeDeleted: true
};

fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
NODE
fi

echo "Task cleanup complete."
echo "pr=$PR_REF"
echo "branch=$BRANCH_NAME"
echo "worktree=$WORKTREE_PATH"

#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/task-start.sh <task-name> [options]

Creates an isolated worktree and matching branch.

Options:
  --description <text>   Human-readable task description (defaults to task-name).
  --base <ref>           Base ref (default: origin/main).
  -h, --help             Show help.

Environment variables:
  WORKTREES_ROOT         Override default worktrees root directory.
USAGE
}

if [ "$#" -eq 0 ]; then
  usage >&2
  exit 2
fi

RAW_TASK_NAME=""
TASK_DESCRIPTION=""
BASE_REF="${BASE_REF:-origin/main}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --description)
      TASK_DESCRIPTION="${2:-}"
      shift 2
      ;;
    --base)
      BASE_REF="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "task-start: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -z "$RAW_TASK_NAME" ]; then
        RAW_TASK_NAME="$1"
        shift
      else
        echo "task-start: unexpected positional argument: $1" >&2
        usage >&2
        exit 2
      fi
      ;;
  esac
done

if [ -z "$RAW_TASK_NAME" ]; then
  echo "task-start: task-name is required" >&2
  usage >&2
  exit 2
fi

TASK_NAME="$(printf '%s' "$RAW_TASK_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's#[^a-z0-9._-]+#-#g; s#^-+##; s#-+$##')"
if [ -z "$TASK_NAME" ]; then
  echo "task-start: invalid task name: $RAW_TASK_NAME" >&2
  exit 2
fi

if [ -z "$TASK_DESCRIPTION" ]; then
  TASK_DESCRIPTION="$RAW_TASK_NAME"
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
DEFAULT_WORKTREES_ROOT="$(dirname "$REPO_ROOT")/${REPO_NAME}-worktrees"
WORKTREES_ROOT="${WORKTREES_ROOT:-$DEFAULT_WORKTREES_ROOT}"

BRANCH_NAME="codex/$TASK_NAME"
WORKTREE_PATH="$WORKTREES_ROOT/$TASK_NAME"

TASK_REGISTRY_DIR="$REPO_ROOT/.codexbot"
TASK_REGISTRY_PATH="$TASK_REGISTRY_DIR/active-tasks.json"

if ! command -v node >/dev/null 2>&1; then
  echo "task-start: node is required" >&2
  exit 1
fi

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

TIMESTAMP_MS="$(node -e 'console.log(Date.now())')"

mkdir -p "$TASK_REGISTRY_DIR"
TASK_RECORD_JSON="$(node - <<'NODE' "$TASK_NAME" "$TASK_DESCRIPTION" "$REPO_NAME" "$WORKTREE_PATH" "$BRANCH_NAME" "$TIMESTAMP_MS"
const [taskName, description, repo, worktreePath, branchName, startedAt] = process.argv.slice(2);
const record = {
  id: taskName,
  agent: "codex",
  description,
  repo,
  worktree: worktreePath,
  branch: branchName,
  startedAt: Number(startedAt),
  status: "running",
  notifyOnComplete: true
};
process.stdout.write(JSON.stringify(record));
NODE
)"

node - <<'NODE' "$TASK_REGISTRY_PATH" "$TASK_RECORD_JSON"
const fs = require("node:fs");
const path = require("node:path");
const [filePath, recordJson] = process.argv.slice(2);
const record = JSON.parse(recordJson);

let data = { tasks: {} };
if (fs.existsSync(filePath)) {
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    data = { tasks: {} };
  }
}
if (!data || typeof data !== "object") {
  data = { tasks: {} };
}
if (!data.tasks || typeof data.tasks !== "object") {
  data.tasks = {};
}
data.tasks[record.id] = record;
fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
NODE

echo "Created isolated task workspace."
echo "branch=$BRANCH_NAME"
echo "path=$WORKTREE_PATH"
echo "task_registry=$TASK_REGISTRY_PATH"
echo "next: cd $WORKTREE_PATH"

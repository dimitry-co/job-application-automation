#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "Usage: $0 <prompt_file> <output_file> <done_ok> <done_error> <cdp_endpoint> <workdir>" >&2
  exit 2
fi

PROMPT_FILE="$1"
OUTPUT_FILE="$2"
DONE_OK="$3"
DONE_ERROR="$4"
CDP_ENDPOINT_VALUE="$5"
WORKDIR="$6"

cleanup() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    printf 'form_fill_agent_failed_exit_code=%s\n' "$exit_code" >"$DONE_ERROR"
  fi
  exit "$exit_code"
}

trap cleanup EXIT

if [ "${FORM_FILL_RUNNER_ACTIVE:-}" = "1" ]; then
  printf 'recursive_runner_invocation_blocked\n' >"$DONE_ERROR"
  exit 18
fi

cat "$PROMPT_FILE" | FORM_FILL_RUNNER_ACTIVE=1 CDP_ENDPOINT="$CDP_ENDPOINT_VALUE" codex exec \
  --model "${FORM_FILL_CODEX_MODEL:-gpt-5.3-codex}" \
  -c "model_reasoning_effort=${FORM_FILL_REASONING_EFFORT:-high}" \
  --dangerously-bypass-approvals-and-sandbox \
  --cd "$WORKDIR" \
  --output-last-message "$OUTPUT_FILE" \
  -

rm -f "$DONE_ERROR"
touch "$DONE_OK"

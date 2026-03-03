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

APPLICATION_URL="$(awk '
  /Run the full job application form-fill workflow for this application URL:/ { getline; print; exit }
' "$PROMPT_FILE" | tr -d '\r' | xargs)"

if [ -z "$APPLICATION_URL" ]; then
  printf 'failed_to_extract_application_url_from_prompt\n' >"$DONE_ERROR"
  exit 19
fi

cd "$WORKDIR"

CDP_ENDPOINT="$CDP_ENDPOINT_VALUE" npx tsx scripts/form-fill-direct.ts \
  "$APPLICATION_URL" \
  "$OUTPUT_FILE" \
  "$CDP_ENDPOINT_VALUE"

rm -f "$DONE_ERROR"
touch "$DONE_OK"

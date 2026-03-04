#!/usr/bin/env bash
set -euo pipefail

CDP_ENDPOINT="${CDP_ENDPOINT:-http://localhost:9222}"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_DIR="${CHROME_REMOTE_PROFILE_DIR:-$HOME/.codex/chrome-remote-profile}"

if curl -fsS "${CDP_ENDPOINT}/json/version" >/dev/null 2>&1; then
  echo "Chrome CDP already running at ${CDP_ENDPOINT}"
  exit 0
fi

if [ ! -x "${CHROME_BIN}" ]; then
  echo "Chrome binary not found: ${CHROME_BIN}"
  exit 1
fi

mkdir -p "${PROFILE_DIR}"

nohup "${CHROME_BIN}" \
  --remote-debugging-port=9222 \
  --user-data-dir="${PROFILE_DIR}" \
  >/tmp/chrome-remote.log 2>&1 &

for _ in $(seq 1 20); do
  if curl -fsS "${CDP_ENDPOINT}/json/version" >/dev/null 2>&1; then
    echo "Chrome CDP started at ${CDP_ENDPOINT} with profile ${PROFILE_DIR}"
    exit 0
  fi
  sleep 0.5
done

echo "Chrome started but CDP endpoint did not become ready at ${CDP_ENDPOINT}"
exit 1

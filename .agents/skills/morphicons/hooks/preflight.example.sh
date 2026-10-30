#!/usr/bin/env sh
# Generic preflight example. Adapt environment variables to the agent platform.
# It prints only the references relevant to the current task.

set -eu
SKILL_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TASK_CONTEXT="${AGENT_TASK:-${1:-}}"
FILES_CONTEXT="${AGENT_FILES:-${2:-}}"
IMPORTS_CONTEXT="${AGENT_IMPORTS:-${3:-}}"

node "$SKILL_DIR/scripts/select-references.mjs" \
  --query "$TASK_CONTEXT" \
  --files "$FILES_CONTEXT" \
  --imports "$IMPORTS_CONTEXT"

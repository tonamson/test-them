#!/bin/sh
ROOT="${CLAUDE_PLUGIN_ROOT:-${GROK_PLUGIN_ROOT:-${PLUGIN_ROOT:-}}}"
if [ -z "$ROOT" ]; then
  ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
fi
exec node "$ROOT/src/server.mjs"

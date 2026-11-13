#!/usr/bin/env bash
# Install both halves of pi-vscode-focus: the VS Code collector and the pi reader.
# Works on Windows (git-bash), macOS and Linux. Idempotent: targets are replaced.
# DRY_RUN=1 prints the two target directories and exits without touching disk.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if [ -n "${USERPROFILE:-}" ] && command -v cygpath >/dev/null 2>&1; then
  profile="$(cygpath -u "$USERPROFILE")"
else
  profile="${HOME:-}"
fi

vsx="${VSCODE_EXT_DIR:-$profile/.vscode/extensions}/pi-vscode-focus-0.1.0"
agent="${PI_CODING_AGENT_DIR:-$profile/.pi/agent}/extensions"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "VSX=$vsx"
  echo "AGENT=$agent"
  exit 0
fi

node --check "$here/vscode-ext/extension.js"

rm -rf "$vsx"
mkdir -p "$vsx"
cp -r "$here/vscode-ext/." "$vsx/"

rm -rf "$agent/vscode-focus"
mkdir -p "$agent/vscode-focus"
cp "$here/pi-ext/vscode-focus.ts" "$agent/vscode-focus/index.ts"
cp "$here/pi-ext/render.mjs" "$agent/vscode-focus/render.mjs"

echo "VS Code extension -> $vsx"
echo "pi extension      -> $agent/vscode-focus/index.ts (+ render.mjs)"
echo
echo "Next: reload the VS Code window (Ctrl+Shift+P -> Developer: Reload Window),"
echo "then /reload inside pi, then ask it: what am I looking at?"

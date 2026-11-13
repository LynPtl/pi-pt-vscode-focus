#!/usr/bin/env bash
# Install both halves of pi-vscode-focus. Idempotent: targets are replaced.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
profile="$(cygpath -u "$USERPROFILE" 2>/dev/null || echo "$HOME")"
vsx="$profile/.vscode/extensions/pi-vscode-focus-0.1.0"
agent="$profile/.pi/agent/extensions"

node --check "$here/vscode-ext/extension.js"

rm -rf "$vsx"
mkdir -p "$vsx"
cp -r "$here/vscode-ext/." "$vsx/"

rm -rf "$agent/vscode-focus" "$agent/vscode-focus.ts" "$agent/render.mjs"
mkdir -p "$agent/vscode-focus"
cp "$here/pi-ext/vscode-focus.ts" "$agent/vscode-focus/index.ts"
cp "$here/pi-ext/render.mjs" "$agent/vscode-focus/render.mjs"

echo "VS Code extension -> $vsx"
echo "pi extension      -> $agent/vscode-focus/index.ts (+ render.mjs)"
echo
echo "Next: reload the VS Code window (Ctrl+Shift+P -> Developer: Reload Window),"
echo "then /reload inside pi, then ask it: 我在看什么？"

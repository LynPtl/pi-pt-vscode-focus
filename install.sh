#!/usr/bin/env bash
# Install both halves of pi-vscode-focus: the VS Code collector and the pi reader.
# Works on Windows (git-bash), macOS and Linux. Idempotent: targets are replaced.
# DRY_RUN=1 prints the target directories and exits without touching disk.
#
# Environment overrides:
#   VSCODE_EXT_DIR        install only into this extensions dir (skips discovery)
#   PI_CODING_AGENT_DIR   pi agent directory (default: <home>/.pi/agent)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if [ -n "${USERPROFILE:-}" ] && command -v cygpath >/dev/null 2>&1; then
  profile="$(cygpath -u "$USERPROFILE")"
else
  profile="${HOME:-}"
fi

EXT_NAME="pi-vscode-focus-0.1.0"
vsx_targets=()
if [ -n "${VSCODE_EXT_DIR:-}" ]; then
  vsx_targets+=("$VSCODE_EXT_DIR")
else
  vsx_targets+=("$profile/.vscode/extensions")
  for alt in ".vscode-insiders/extensions" ".cursor/extensions"; do
    if [ -d "$profile/$alt" ]; then
      vsx_targets+=("$profile/$alt")
    fi
  done
fi

agent="${PI_CODING_AGENT_DIR:-$profile/.pi/agent}/extensions"

if [ "${DRY_RUN:-}" = "1" ]; then
  for target in "${vsx_targets[@]}"; do
    echo "VSX=$target/$EXT_NAME"
  done
  echo "AGENT=$agent"
  exit 0
fi

node --check "$here/vscode-ext/extension.js"

for target in "${vsx_targets[@]}"; do
  rm -rf "${target:?}/$EXT_NAME"
  mkdir -p "$target/$EXT_NAME"
  cp -r "$here/vscode-ext/." "$target/$EXT_NAME/"
  echo "VS Code extension -> $target/$EXT_NAME"
done

rm -rf "$agent/vscode-focus"
mkdir -p "$agent/vscode-focus"
cp "$here/pi-ext/vscode-focus.ts" "$agent/vscode-focus/index.ts"
cp "$here/pi-ext/render.mjs" "$agent/vscode-focus/render.mjs"
echo "pi extension      -> $agent/vscode-focus/index.ts (+ render.mjs)"

echo
echo "Next: reload the VS Code window (Ctrl+Shift+P -> Developer: Reload Window),"
echo "then /reload inside pi, then ask it: what am I looking at?"

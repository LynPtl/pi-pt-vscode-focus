// install.sh must work on Windows (git-bash), macOS and Linux. DRY_RUN=1
// resolves and prints the two target directories without touching disk, so the
// path logic is testable without a VS Code or pi install.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "install.sh");

function dryRun(env) {
  return execFileSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "1", ...env },
  });
}

test("POSIX 环境（USERPROFILE 未定义）不中止，走 HOME", () => {
  const out = dryRun({
    USERPROFILE: "",
    HOME: "/tmp/h",
    PI_CODING_AGENT_DIR: "",
    VSCODE_EXT_DIR: "",
  });
  assert.match(out, /^VSX=\/tmp\/h\/\.vscode\/extensions\/pi-vscode-focus-0\.1\.0$/m);
  assert.match(out, /^AGENT=\/tmp\/h\/\.pi\/agent\/extensions$/m);
});

test("环境变量可覆盖两个目标目录", () => {
  const out = dryRun({
    USERPROFILE: "",
    HOME: "/tmp/h",
    PI_CODING_AGENT_DIR: "/tmp/agent",
    VSCODE_EXT_DIR: "/tmp/vsx",
  });
  assert.match(out, /^VSX=\/tmp\/vsx\/pi-vscode-focus-0\.1\.0$/m);
  assert.match(out, /^AGENT=\/tmp\/agent\/extensions$/m);
});

// install.sh must work on Windows (git-bash), macOS and Linux. DRY_RUN=1
// resolves and prints the target directories without touching disk, so the path
// logic is testable without a VS Code or pi install.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "install.sh");
const NEWLINE = String.fromCharCode(10);

function dryRun(env) {
  return execFileSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "1", ...env },
  });
}

function vsxTargets(out) {
  return out.split(NEWLINE).filter((line) => line.startsWith("VSX="));
}

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
}

test("POSIX 环境（USERPROFILE 未定义）不中止，走 HOME", () => {
  const out = dryRun({ USERPROFILE: "", HOME: "/tmp/h", PI_CODING_AGENT_DIR: "", VSCODE_EXT_DIR: "" });
  assert.match(out, /^VSX=\/tmp\/h\/\.vscode\/extensions\/pi-vscode-focus-0\.1\.0$/m);
  assert.match(out, /^AGENT=\/tmp\/h\/\.pi\/agent\/extensions$/m);
});

test("环境变量可覆盖两个目标目录", () => {
  const out = dryRun({ USERPROFILE: "", HOME: "/tmp/h", PI_CODING_AGENT_DIR: "/tmp/agent", VSCODE_EXT_DIR: "/tmp/vsx" });
  assert.match(out, /^VSX=\/tmp\/vsx\/pi-vscode-focus-0\.1\.0$/m);
  assert.match(out, /^AGENT=\/tmp\/agent\/extensions$/m);
});

test("Cursor 也存在时一并安装", () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, ".cursor", "extensions"), { recursive: true });
  const targets = vsxTargets(dryRun({ USERPROFILE: "", HOME: home, PI_CODING_AGENT_DIR: "", VSCODE_EXT_DIR: "" }));
  assert.equal(targets.length, 2);
  assert.ok(targets.some((line) => line.includes(".vscode/extensions")));
  assert.ok(targets.some((line) => line.includes(".cursor/extensions")));
});

test("VSCODE_EXT_DIR 覆盖时不扫描其它编辑器", () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, ".cursor", "extensions"), { recursive: true });
  const targets = vsxTargets(dryRun({ USERPROFILE: "", HOME: home, PI_CODING_AGENT_DIR: "", VSCODE_EXT_DIR: "/tmp/vsx" }));
  assert.equal(targets.length, 1);
});

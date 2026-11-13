// The focus directory rule exists twice: once in the VS Code extension's
// CommonJS lib (what actually writes the file) and once in the pi extension's
// TypeScript (which reads it). pi loads the .ts from its own directory and
// cannot import the extension's lib, so this test is the only thing keeping the
// two copies equal.
import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../vscode-ext/lib/focus-core.js");
const canStripTs = !!(process.features && process.features.typescript);
const skip = canStripTs ? false : "needs Node >= 22.18 (TypeScript type stripping) to import pi-ext/vscode-focus.ts";

const cases = [
  { platform: "win32", env: { LOCALAPPDATA: "C:\L" }, homedir: "H" },
  { platform: "win32", env: {}, homedir: "H" },
  { platform: "darwin", env: {}, homedir: "H" },
  { platform: "linux", env: { XDG_STATE_HOME: "/xdg" }, homedir: "H" },
  { platform: "linux", env: {}, homedir: "H" },
  { platform: "linux", env: { PI_FOCUS_DIR: "/p" }, homedir: "H", expect: "/p" },
  { platform: "darwin", env: { PI_FOCUS_DIR: "/p" }, homedir: "H", expect: "/p" },
  { platform: "win32", env: { PI_FOCUS_DIR: "P:\p", LOCALAPPDATA: "C:\L" }, homedir: "H", expect: "P:\p" },
];

test("两侧的焦点目录规则一致", { skip }, async () => {
  const { resolveFocusDir } = await import("../pi-ext/vscode-focus.ts");
  for (const options of cases) {
    assert.equal(
      resolveFocusDir(options),
      core.resolveFocusDir(options),
      `rule drifted for ${JSON.stringify(options)}`,
    );
    if (options.expect !== undefined) {
      assert.equal(resolveFocusDir(options), options.expect, `PI_FOCUS_DIR override ignored for ${options.platform}`);
    }
  }
});

test("两侧的 slug 规则一致", { skip }, async () => {
  const { focusPath } = await import("../pi-ext/vscode-focus.ts");
  for (const folder of ["D:\happy-llm", "/home/u/proj", "C:\a b\c"]) {
    const name = path.basename(focusPath(folder));
    assert.equal(name, `${core.slugForFolder(folder)}.json`);
  }
});

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const core = require("../vscode-ext/lib/focus-core.js");

test("slugForFolder 逐字符替换非字母数字", () => {
  assert.equal(core.slugForFolder("D:\\happy-llm"), "d--happy-llm");
  assert.equal(core.slugForFolder("c:\\a b\\c-d"), "c--a-b-c-d");
});

test("focusFile 落在 LOCALAPPDATA\\pi-focus", () => {
  const f = core.focusFile("D:\\happy-llm");
  assert.equal(path.basename(f), "d--happy-llm.json");
  assert.equal(path.basename(path.dirname(f)), "pi-focus");
});

test("SCHEMA 为 1", () => {
  assert.equal(core.SCHEMA, 1);
});

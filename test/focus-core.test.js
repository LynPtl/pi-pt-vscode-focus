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

test("findHeading 向上找最近的 markdown 标题", () => {
  const lines = ["# 章", "", "## 2.1 注意力机制", "正文", "### 2.1.2 深入理解注意力机制", "正文", "正文"];
  assert.equal(core.findHeading(lines, 7), "2.1.2 深入理解注意力机制");
  assert.equal(core.findHeading(lines, 4), "2.1 注意力机制");
});

test("findHeading 无标题时返回 undefined", () => {
  assert.equal(core.findHeading(["正文", "正文"], 2), undefined);
});

test("mergeRanges 合并相邻和重叠区间", () => {
  assert.deepEqual(core.mergeRanges([[10, 12], [13, 15], [20, 21]]), [[10, 15], [20, 21]]);
  assert.deepEqual(core.mergeRanges([[5, 9], [1, 3]]), [[1, 3], [5, 9]]);
});

test("buildPayload 截断选区文本但保留全长", () => {
  const now = new Date("2026-11-13T08:31:04.000Z");
  const long = "字".repeat(2000);
  const p = core.buildPayload({
    folder: "D:\\happy-llm",
    windowPid: 23488,
    editor: {
      path: "docs\\chapter2\\第二章 Transformer架构.md",
      editorKind: "text",
      languageId: "markdown",
      dirty: true,
      line: 900,
      column: 12,
      selection: { startLine: 895, endLine: 905, text: long },
      visible: { firstLine: 845, lastLine: 960 },
      heading: "2.1.2 深入理解注意力机制",
    },
    openTabs: [{ path: "README.md" }, { path: "docs\\chapter2\\第二章 Transformer架构.md", active: true }],
  }, now);
  assert.equal(p.schema, 1);
  assert.equal(p.updatedAt, "2026-11-13T08:31:04.000Z");
  assert.equal(p.editor.selection.chars, 2000);
  assert.equal(p.editor.selection.text.length, 1500);
  assert.deepEqual(p.openTabs.map((t) => t.active === true), [false, true]);
});

test("buildPayload 丢弃过期改动并只留 5 个文件", () => {
  const now = new Date("2026-11-13T08:31:04.000Z");
  const recentEdits = [];
  for (let i = 0; i < 7; i++) {
    recentEdits.push({ path: `f${i}.md`, ranges: [[1, 2]], at: now.getTime() - i * 1000, plus: i, minus: 0 });
  }
  recentEdits.push({ path: "old.md", ranges: [[9, 9]], at: now.getTime() - 120000, plus: 1, minus: 1 });
  const p = core.buildPayload({ folder: "D:\\happy-llm", windowPid: 1, recentEdits }, now);
  assert.equal(p.recentEdits.length, 5);
  assert.deepEqual(p.recentEdits.map((e) => e.path), ["f0.md", "f1.md", "f2.md", "f3.md", "f4.md"]);
});

test("buildPayload 无 editor 时 editor 为 null", () => {
  const p = core.buildPayload({ folder: "D:\\happy-llm", windowPid: 1 }, new Date());
  assert.equal(p.editor, null);
  assert.deepEqual(p.recentEdits, []);
  assert.deepEqual(p.openTabs, []);
});

test("writeJsonAtomic 写入并可原子覆盖", async () => {
  const os = require("node:os");
  const fs = require("node:fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  const file = path.join(dir, "d--x.json");
  await core.writeJsonAtomic(file, { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { a: 1 });
  await core.writeJsonAtomic(file, { a: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { a: 2 });
  assert.equal(fs.existsSync(file + ".tmp"), false);
});

test("makeThrottledWriter 合并连续 schedule 并等 flush", async () => {
  let calls = 0;
  const w = core.makeThrottledWriter(async () => { calls++; }, 10, 0);
  w.schedule(); w.schedule(); w.schedule();
  await w.flush();
  assert.equal(calls, 1);
});

test("relativize 返回本机分隔符的相对路径，越界返回 undefined", () => {
  const os = require("node:os");
  const ws = path.join(os.tmpdir(), "ws");
  assert.equal(core.relativize(path.join(ws, "docs", "a.md"), ws), path.join("docs", "a.md"));
  assert.equal(core.relativize(path.join(os.tmpdir(), "other", "a.md"), ws), undefined);
});

test("accumulateEdit 累加区间与行数", () => {
  const first = core.accumulateEdit(undefined, { path: "a.md", ranges: [[10, 12]], at: 1000, plus: 3, minus: 1 });
  assert.deepEqual(first, { path: "a.md", ranges: [[10, 12]], at: 1000, plus: 3, minus: 1 });
  const second = core.accumulateEdit(first, { path: "a.md", ranges: [[13, 14]], at: 2000, plus: 2, minus: 0 });
  assert.deepEqual(second, { path: "a.md", ranges: [[10, 14]], at: 2000, plus: 5, minus: 1 });
});

test("resolveFocusDir 三平台规则", () => {
  const path = require("node:path");
  assert.equal(
    core.resolveFocusDir({ platform: "win32", env: { LOCALAPPDATA: "C:\L" }, homedir: "H" }),
    path.join("C:\L", "pi-focus"),
  );
  assert.equal(
    core.resolveFocusDir({ platform: "darwin", env: {}, homedir: "H" }),
    path.join("H", "Library", "Application Support", "pi-focus"),
  );
  assert.equal(
    core.resolveFocusDir({ platform: "linux", env: { XDG_STATE_HOME: "/xdg" }, homedir: "H" }),
    path.join("/xdg", "pi-focus"),
  );
  assert.equal(
    core.resolveFocusDir({ platform: "linux", env: {}, homedir: "H" }),
    path.join("H", ".local", "state", "pi-focus"),
  );
});

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import vscodeFocus, { focusPath, focusText } from "../pi-ext/vscode-focus.ts";

const FOLDER = path.join(os.tmpdir(), "pi-focus-ws");
const core_slug = (folder) => folder.toLowerCase().replace(/[^a-z0-9]/g, "-");

// One sandbox per file, set before any test body runs and never unset. Restoring
// the environment from a `finally` while an async body is still awaiting let a
// test overwrite the real focus file of the editor that was running.
const FOCUS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-focus-"));
process.env.PI_FOCUS_DIR = FOCUS_DIR;

function assertSandboxed() {
  const file = focusPath(FOLDER);
  assert.ok(file.startsWith(FOCUS_DIR), `test wrote outside the sandbox: ${file}`);
}

function writeFocus(payload) {
  assertSandboxed();
  const file = focusPath(FOLDER);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ folder: FOLDER, ...payload }), "utf8");
  return file;
}

function clearFocus() {
  try {
    fs.unlinkSync(focusPath(FOLDER));
  } catch {}
}

function fakePi() {
  const handlers = new Map();
  const tools = new Map();
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    registerTool: (tool) => tools.set(tool.name, tool),
  };
  return { pi, handlers, tools };
}

function sampleEditor() {
  return {
    updatedAt: new Date().toISOString(),
    editor: {
      path: "docs\\a.md",
      editorKind: "text",
      languageId: "markdown",
      dirty: false,
      line: 12,
      column: 3,
      heading: "2.1 注意力机制",
    },
    recentEdits: [],
    openTabs: [{ path: "docs\\a.md", active: true }],
  };
}

test("测试期间焦点文件被重定向到临时目录", () => {
  assertSandboxed();
});

test("file 不存在时 focusText 返回 null", () => {
  clearFocus();
  assert.equal(focusText(FOLDER, new Date()), null);
});

test("focusPath 使用 slug 命名", () => {
  assert.equal(focusPath(FOLDER), path.join(FOCUS_DIR, `${core_slug(FOLDER)}.json`));
});

test("before_agent_start 注入一次，重复内容不再注入", () => {
  writeFocus(sampleEditor());
  const { pi, handlers } = fakePi();
  vscodeFocus(pi);
  handlers.get("session_start")({}, { cwd: FOLDER });
  const start = handlers.get("before_agent_start");

  const first = start({ messageType: "user" }, { cwd: FOLDER });
  assert.equal(first.message.customType, "vscode-focus");
  assert.equal(first.message.display, false);
  assert.match(first.message.content, /docs\\a\.md/);
  assert.match(first.message.content, /光标 L12 C3 · 小节「2\.1 注意力机制」/);

  assert.equal(start({ messageType: "user" }, { cwd: FOLDER }), undefined);
});

test("压缩之后重新注入一次", () => {
  writeFocus(sampleEditor());
  const { pi, handlers } = fakePi();
  vscodeFocus(pi);
  const start = handlers.get("before_agent_start");
  assert.ok(start({ messageType: "user" }, { cwd: FOLDER }).message);
  assert.equal(start({ messageType: "user" }, { cwd: FOLDER }), undefined);
  handlers.get("session_compact")({}, { cwd: FOLDER });
  assert.ok(start({ messageType: "user" }, { cwd: FOLDER }).message);
});

test("custom 触发的 run 不注入", () => {
  writeFocus(sampleEditor());
  const { pi, handlers } = fakePi();
  vscodeFocus(pi);
  assert.equal(handlers.get("before_agent_start")({ messageType: "custom" }, { cwd: FOLDER }), undefined);
});

test("目录不匹配时不注入", () => {
  writeFocus(sampleEditor());
  const { pi, handlers } = fakePi();
  vscodeFocus(pi);
  assert.equal(handlers.get("before_agent_start")({ messageType: "user" }, { cwd: path.join(os.tmpdir(), "elsewhere") }), undefined);
});

test("vscode_focus 工具返回现场文本，缺失时给出提示", async () => {
  const { pi, tools } = fakePi();
  vscodeFocus(pi);
  const tool = tools.get("vscode_focus");
  assert.equal(tool.readOnlyHint, true);

  clearFocus();
  const empty = await tool.execute("t1", {}, undefined, undefined, { cwd: FOLDER });
  assert.match(empty.content[0].text, /未获取到 VS Code 现场/);

  writeFocus(sampleEditor());
  const filled = await tool.execute("t2", {}, undefined, undefined, { cwd: FOLDER });
  assert.match(filled.content[0].text, /docs\\a\.md/);
});

// Characterization tests for the VS Code glue. `activate()` runs against a
// hand-built fake `vscode` module so the write path is exercised without a
// VS Code host. Flush is forced through the registered dispose hook.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const FOLDER = path.join(os.tmpdir(), "pf-ws");
const LISTENERS = {
  activeTextEditor: [],
  selection: [],
  visible: [],
  tabs: [],
  tabGroups: [],
  document: [],
  save: [],
};

function makeFake({ activeTextEditor, activeTab, tabs }) {
  return {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: FOLDER } }],
      textDocuments: activeTextEditor ? [activeTextEditor.document] : [],
      onDidChangeTextDocument: (fn) => (LISTENERS.document.push(fn), { dispose() {} }),
      onDidSaveTextDocument: (fn) => (LISTENERS.save.push(fn), { dispose() {} }),
    },
    window: {
      activeTextEditor,
      onDidChangeActiveTextEditor: (fn) => (LISTENERS.activeTextEditor.push(fn), { dispose() {} }),
      onDidChangeTextEditorSelection: (fn) => (LISTENERS.selection.push(fn), { dispose() {} }),
      onDidChangeTextEditorVisibleRanges: (fn) => (LISTENERS.visible.push(fn), { dispose() {} }),
      tabGroups: {
        activeTabGroup: { activeTab, tabs },
        onDidChangeTabs: (fn) => (LISTENERS.tabs.push(fn), { dispose() {} }),
        onDidChangeTabGroups: (fn) => (LISTENERS.tabGroups.push(fn), { dispose() {} }),
      },
    },
  };
}

function doc(fsPath, text, { languageId = "markdown", dirty = false } = {}) {
  return { uri: { fsPath }, languageId, isDirty: dirty, getText: (range) => (range ? text : text) };
}

function editor(document, line, character, end) {
  return {
    document,
    selection: {
      active: { line, character },
      start: { line, character },
      end: end || { line, character },
      isEmpty: !end,
    },
    visibleRanges: [{ start: { line: Math.max(0, line - 20) }, end: { line: line + 20 } }],
  };
}

function load(vscodeFake) {
  const original = Module._load;
  Module._load = function (request) {
    if (request === "vscode") return vscodeFake;
    return original.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve("../vscode-ext/extension.js")];
    return require("../vscode-ext/extension.js");
  } finally {
    Module._load = original;
  }
}

async function flush(ext) {
  await ext.deactivate();
}

function focusJson(dir) {
  const slug = FOLDER.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return JSON.parse(fs.readFileSync(path.join(dir, slug + ".json"), "utf8"));
}

test("文本编辑器场景写入文件、光标、选区、小节、tabs", async () => {
  for (const key of Object.keys(LISTENERS)) LISTENERS[key].length = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  process.env.PI_FOCUS_DIR = dir;

  const text = "# 章\n\n## 2.1 注意力机制\n正文\n### 2.1.2 深入理解注意力机制\n正文";
  const document = doc(path.join(FOLDER, "docs", "a.md"), text, { dirty: true });
  const activeTextEditor = editor(document, 5, 2, { line: 5, character: 8 });
  const activeTab = { isActive: true, input: { uri: { fsPath: document.uri.fsPath } } };
  const tabs = [activeTab, { isActive: false, input: { uri: { fsPath: path.join(FOLDER, "README.md") } } }];

  const ext = load(makeFake({ activeTextEditor, activeTab, tabs }));
  const context = { subscriptions: [] };
  ext.activate(context);
  await flush(ext);

  const json = focusJson(dir);
  assert.equal(json.schema, 1);
  assert.equal(json.folder, FOLDER);
  assert.equal(json.editor.path, "docs\\a.md");
  assert.equal(json.editor.editorKind, "text");
  assert.equal(json.editor.dirty, true);
  assert.equal(json.editor.line, 6);
  assert.equal(json.editor.column, 3);
  assert.deepEqual(json.editor.selection, { startLine: 6, endLine: 6, chars: text.length, text });
  assert.deepEqual(json.editor.heading, "2.1.2 深入理解注意力机制");
  assert.deepEqual(json.openTabs, [
    { path: "docs\\a.md", active: true },
    { path: "README.md", active: false },
  ]);
});

test("webview 场景仍报出文件，并沿用上次光标", async () => {
  for (const key of Object.keys(LISTENERS)) LISTENERS[key].length = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  process.env.PI_FOCUS_DIR = dir;

  const document = doc(path.join(FOLDER, "docs", "a.md"), "# t\n正文\n## 小节\n正文");
  const activeTextEditor = editor(document, 2, 1);
  const activeTab = { isActive: true, input: { uri: { fsPath: document.uri.fsPath } } };

  const fake = makeFake({ activeTextEditor, activeTab, tabs: [activeTab] });
  const ext = load(fake);
  const first = { subscriptions: [] };
  ext.activate(first);
  await flush(ext);

  // Same window, same file, but the editor is now a custom webview.
  fake.window.activeTextEditor = undefined;
  const webInput = { viewType: "cweijan.markdownViewer", uri: { fsPath: document.uri.fsPath } };
  activeTab.input = webInput;
  LISTENERS.tabs.forEach((fn) => fn());
  await flush(ext);

  const json = focusJson(dir);
  assert.equal(json.editor.path, "docs\\a.md");
  assert.equal(json.editor.line, 3);
});

test("无 uri 的 webview 不猜上一个文件", async () => {
  for (const key of Object.keys(LISTENERS)) LISTENERS[key].length = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  process.env.PI_FOCUS_DIR = dir;

  const document = doc(path.join(FOLDER, "docs", "a.md"), "# t\\n正文");
  const activeTab = { isActive: true, input: { uri: { fsPath: document.uri.fsPath } } };
  const fake = makeFake({ activeTextEditor: editor(document, 1, 0), activeTab, tabs: [activeTab] });
  const ext = load(fake);
  const context = { subscriptions: [] };
  ext.activate(context);
  await flush(ext);
  assert.equal(focusJson(dir).editor.path, "docs\\a.md");

  fake.window.activeTextEditor = undefined;
  activeTab.input = { viewType: "workbench.view.settings" };
  LISTENERS.tabs.forEach((fn) => fn());
  await flush(ext);
  assert.equal(focusJson(dir).editor, null);
});

test("工作区外的文件用绝对路径报出", async () => {
  for (const key of Object.keys(LISTENERS)) LISTENERS[key].length = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  process.env.PI_FOCUS_DIR = dir;

  const outside = path.join(os.tmpdir(), "elsewhere", "notes.md");
  const document = doc(outside, "# t\\n正文");
  const activeTab = { isActive: true, input: { uri: { fsPath: outside } } };
  const ext = load(makeFake({ activeTextEditor: editor(document, 0, 0), activeTab, tabs: [activeTab] }));
  const context = { subscriptions: [] };
  ext.activate(context);
  await flush(ext);
  assert.equal(focusJson(dir).editor.path, outside);
});

test("最近改动被记录并合并区间", async () => {
  for (const key of Object.keys(LISTENERS)) LISTENERS[key].length = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  process.env.PI_FOCUS_DIR = dir;

  const document = doc(path.join(FOLDER, "docs", "a.md"), "x");
  const activeTab = { isActive: true, input: { uri: { fsPath: document.uri.fsPath } } };
  const ext = load(makeFake({ activeTextEditor: editor(document, 0, 0), activeTab, tabs: [activeTab] }));
  const context = { subscriptions: [] };
  ext.activate(context);

  const change = (startLine, endLine, text) => ({
    document,
    contentChanges: [{ range: { start: { line: startLine }, end: { line: endLine } }, text }],
  });
  LISTENERS.document.forEach((fn) => fn(change(10, 12, "a\nb\nc")));
  LISTENERS.document.forEach((fn) => fn(change(13, 13, "d\ne")));
  await flush(ext);

  const json = focusJson(dir);
  assert.equal(json.recentEdits.length, 1);
  assert.deepEqual(json.recentEdits[0].path, "docs\\a.md");
  assert.deepEqual(json.recentEdits[0].ranges, [[11, 15]]);
  assert.equal(json.recentEdits[0].plus, 3);
  assert.equal(json.recentEdits[0].minus, 2);
});

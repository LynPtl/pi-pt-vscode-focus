# pi ↔ VS Code 焦点同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 pi 每轮对话自动知道用户在 VS Code 里的活动文件、光标、选区、所在小节和最近改动，成本 < 300 token，不用 UI 自动化。

**Architecture:** 一个无构建的 VS Code 扩展用编辑器事件把"现场"降频写到 `%LOCALAPPDATA%\pi-focus\<slug>.json`；一个 pi 扩展在 `before_agent_start` 读取并作为一条追加 message 注入，另注册只读工具 `vscode_focus` 供中途复查。两侧只通过该 JSON 单向通信。

**Tech Stack:** VS Code Extension API（`extension.js`，CommonJS，无构建）、Node 内置 `node:test`、pi 扩展 API（TypeScript + 一个纯 JS 渲染模块）。

**Spec:** `C:\Users\ptlan\pi-vscode-focus\DESIGN.md`

## Global Constraints

- 落盘目录：`%LOCALAPPDATA%\pi-focus\`（`process.env.LOCALAPPDATA`，缺失时用 `path.join(os.homedir(), "AppData", "Local")`）。
- slug 算法（逐字符替换，**不合并**）：`folder.toLowerCase().replace(/[^a-z0-9]/g, "-")`。`D:\happy-llm` → `d--happy-llm`。
- 常量：`SCHEMA = 1`、`DEBOUNCE_MS = 400`、`MIN_WRITE_INTERVAL_MS = 1000`、`SELECTION_TEXT_MAX = 1500`、`HEADING_SCAN_LINES = 200`、`RECENT_EDIT_WINDOW_MS = 90000`、`RECENT_EDIT_MAX_FILES = 5`、`STALE_MS = 900000`。
- JSON 顶层键固定：`schema, folder, windowPid, updatedAt, editor, recentEdits, openTabs`；`editor` 键固定：`path, editorKind, languageId, dirty, line, column, selection, visible, heading`。
- 所有路径（`editor.path`、`recentEdits[].path`、`openTabs[].path`）一律 **相对工作区文件夹**，用 Windows 反斜杠，不带开头分隔符。
- VS Code 侧不打包 vsix、不跑 tsc；pi 侧不引入 npm 依赖。
- 不截屏、不读取无障碍树、不上网。

## Review Focus

1. markdown 被 `cweijan.vscode-office` 以 webview 打开 → `window.activeTextEditor` 为 `undefined`：仍须报出正确文件，且不出现空行号行。
2. 同一文件夹开两个 VS Code 窗口 → 后写覆盖，但不得写出半截 JSON，pi 侧不报错。
3. 整个章节被选中（数万字符）→ 文本截断到 1500 且 `chars` 为真实全长。
4. 光标在文件开头、上方无标题 → `heading` 字段省略，渲染不出现空括号。
5. 活动标签是图片/PDF/二进制或文件已被删除重命名 → 不抛异常，`languageId` 缺省 `undefined` 时渲染省略。

---

### Task 1: 骨架与 slug

**Files:**
- Create: `C:\Users\ptlan\pi-vscode-focus\.gitignore`
- Create: `C:\Users\ptlan\pi-vscode-focus\vscode-ext\lib\focus-core.js`
- Test: `C:\Users\ptlan\pi-vscode-focus\test\focus-core.test.js`

**Interfaces:**
- Produces: `slugForFolder(folder: string): string`，`focusDir(): string`，`focusFile(folder: string): string`，常量 `SCHEMA`。CommonJS：`module.exports = { ... }`。

- [ ] **Step 1: 初始化仓库**

```bash
cd /c/Users/ptlan/pi-vscode-focus
git init
printf 'node_modules/\n*.tmp\n' > .gitignore
```

Expected: `git init` 输出 `Initialized empty Git repository`。

- [ ] **Step 2: 写失败测试**

`test/focus-core.test.js`：

```js
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
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test test/focus-core.test.js`
Expected: FAIL，`Cannot find module '../vscode-ext/lib/focus-core.js'`。

- [ ] **Step 4: 实现 `vscode-ext/lib/focus-core.js`**

```js
const path = require("node:path");
const os = require("node:os");

const SCHEMA = 1;

function focusDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "pi-focus");
}

function slugForFolder(folder) {
  return folder.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

function focusFile(folder) {
  return path.join(focusDir(), slugForFolder(folder) + ".json");
}

module.exports = { SCHEMA, focusDir, slugForFolder, focusFile };
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test test/focus-core.test.js`
Expected: `# pass 3` / `# fail 0`。

- [ ] **Step 6: 提交**

```bash
git add .gitignore test/focus-core.test.js vscode-ext/lib/focus-core.js
git commit -m "feat: focus file location and slug"
```

---

### Task 2: 小节查找、区间合并、payload 组装

**Files:**
- Modify: `C:\Users\ptlan\pi-vscode-focus\vscode-ext\lib\focus-core.js`
- Test: `C:\Users\ptlan\pi-vscode-focus\test\focus-core.test.js`

**Interfaces:**
- Consumes: Task 1 的 `slugForFolder`、`SCHEMA`。
- Produces:
  - `findHeading(lines: string[], lineNumber: number): string | undefined` — `lineNumber` 是 1 起始；从该行向上最多 200 行找第一个匹配 `/^#{1,6}\s+(.+?)\s*$/` 的行，返回捕获组；找不到返回 `undefined`。
  - `mergeRanges(ranges: Array<[number, number]>): Array<[number, number]>` — 按起点排序，相邻或重叠（`next.start <= cur.end + 1`）合并。
  - `buildPayload(raw: RawFocus, now: Date): object`，`RawFocus = { folder: string, windowPid: number, editor?: EditorInput, recentEdits?: Array<{path: string, ranges: Array<[number,number]>, at: number, plus: number, minus: number}>, openTabs?: Array<{path: string, active?: boolean}> }`，`EditorInput = { path: string, editorKind: "text"|"webview", languageId?: string, dirty: boolean, line?: number, column?: number, selection?: {startLine:number, endLine:number, text:string}, visible?: {firstLine:number, lastLine:number}, heading?: string }`。`buildPayload` 不改入参，`updatedAt` 用 `now.toISOString()`，`selection` 输出 `{startLine, endLine, chars, text}`（`chars` = 原文长度，`text` 截到 1500），`recentEdits` 只保留 `now - at <= 90000`、按 `at` 倒序取 5 个、`ranges` 经 `mergeRanges`。

- [ ] **Step 1: 写失败测试**

追加到 `test/focus-core.test.js`：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/focus-core.test.js`
Expected: FAIL，`core.findHeading is not a function`。

- [ ] **Step 3: 实现三个函数并加进 `module.exports`**

`findHeading` 只扫 `[max(0, lineNumber-1-200), lineNumber-1]`；`buildPayload` 内部对 `recentEdits` 先过滤再排序再切片再映射 `ranges: mergeRanges(ranges)`，`editor` 缺省时输出 `null`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/focus-core.test.js`
Expected: `# pass 8` / `# fail 0`。

- [ ] **Step 5: 提交**

```bash
git add test/focus-core.test.js vscode-ext/lib/focus-core.js
git commit -m "feat: heading lookup, range merge, payload assembly"
```

---

### Task 3: 原子写入与节流

**Files:**
- Modify: `C:\Users\ptlan\pi-vscode-focus\vscode-ext\lib\focus-core.js`
- Test: `C:\Users\ptlan\pi-vscode-focus\test\focus-core.test.js`

**Interfaces:**
- Produces: `writeJsonAtomic(file: string, data: object): Promise<void>`（先写 `<file>.tmp` 再 `fs.promises.rename`；目录不存在时 `{recursive:true}` 创建）；`makeThrottledWriter(write: () => Promise<void>, debounceMs?: number, minIntervalMs?: number): { schedule(): void, flush(): Promise<void> }` — 默认 400/1000；期间多次调用只保留最后一次；`flush()` 立即执行待定写入并等待完成。

- [ ] **Step 1: 写失败测试**

追加：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/focus-core.test.js`
Expected: FAIL，`core.writeJsonAtomic is not a function`。

- [ ] **Step 3: 实现**

`writeJsonAtomic` 用 `fs.promises.mkdir(path.dirname(file), { recursive: true })`、`writeFile(file + ".tmp", JSON.stringify(data), "utf8")`、`rename`。`makeThrottledWriter` 用 `setTimeout` 计时，记录 `lastWriteAt`，`schedule` 时若距上次写入不足 `minIntervalMs` 则延后 `minIntervalMs - elapsed`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/focus-core.test.js`
Expected: `# pass 10` / `# fail 0`。

- [ ] **Step 5: 提交**

```bash
git add test/focus-core.test.js vscode-ext/lib/focus-core.js
git commit -m "feat: atomic json write and throttled writer"
```

---

### Task 4: VS Code 扩展胶水层

**Files:**
- Create: `C:\Users\ptlan\pi-vscode-focus\vscode-ext\package.json`
- Create: `C:\Users\ptlan\pi-vscode-focus\vscode-ext\extension.js`

**Interfaces:**
- Consumes: Task 1–3 的 `buildPayload`、`focusFile`、`writeJsonAtomic`、`makeThrottledWriter`、`findHeading`。
- Produces: 无导出；运行期副作用 = 产出 `focusFile(folder)` 的 JSON。

`package.json`：`name: "pi-vscode-focus"`、`version: "0.1.0"`、`publisher: "ptlan"`、`engines.vscode: ">=1.80.0"`、`main: "./extension.js"`、`activationEvents: ["onStartupFinished"]`，无 `dependencies`、无 `type` 字段（默认 CommonJS）。

- [ ] **Step 1: 写 `extension.js` 主体**

要点（按序）：
1. `activate(context)`：取 `vscode.workspace.workspaceFolders?.[0]`，没有就 `return`。
2. 维护 `state = { recentEdits: new Map<string, {ranges, at, plus, minus}> }`。
3. `collect()`：文件身份取自 `vscode.window.tabGroups.activeTabGroup.activeTab?.input`，判定顺序 `TabInputText`（`input.uri.fsPath`）→ `TabInputCustom`（`input.uri.fsPath`）→ `TabInputTextDiff`/`TabInputNotebook`（跳过，无 fsPath 时用 `undefined`）→ `TabInputWebview`（用 `state.lastUri` 兜底）；`editorKind` = 有 `vscode.window.activeTextEditor` 且其 `document.uri` 与活动 tab 的 uri 相等时为 `"text"`，否则 `"webview"`。
4. `text` 分支：`line = position.line + 1`、`column = position.character + 1`；`selection` 仅在 `!selection.isEmpty` 时给出 `{startLine, endLine, text: doc.getText(selection)}`；`visible` 由 `visibleRanges[0]` 得出；markdown 时 `heading = findHeading(doc.getText().split(/\r?\n/), line)`。
5. `dirty = workspace.textDocuments.find(d => d.uri.fsPath === activeFsPath)?.isDirty ?? false`（webview 场景 `activeTextEditor` 为空，靠 `workspace.textDocuments` 反查）。
6. `openTabs` = `tabGroups.activeTabGroup.tabs.map(...)`，`active` 标记 `tab.isActive`，无 `fsPath` 的 tab 跳过。
7. `onDidChangeTextDocument(e)`：按 `e.contentChanges` 的 `range` 往 `state.recentEdits` 累加行区间与 `plus`/`minus`（`e.document.uri.fsPath` 相对化后作 key，`at = Date.now()`）。
8. 所有监听器都调用 `writer.schedule()`；`writer = makeThrottledWriter(() => writeJsonAtomic(focusFile(folder), buildPayload(raw, new Date())))`。
9. `context.subscriptions.push(...disposers)`；`deactivate()` 调 `writer.flush()`。

- [ ] **Step 2: 复制安装并重载**

```bash
mkdir -p "$USERPROFILE/.vscode/extensions/pi-vscode-focus-0.1.0"
cp -r /c/Users/ptlan/pi-vscode-focus/vscode-ext/. "$USERPROFILE/.vscode/extensions/pi-vscode-focus-0.1.0/"
```

然后在 VS Code 里 `Ctrl+Shift+P` → `Developer: Reload Window`。

- [ ] **Step 3: 手动验证文本编辑器场景**

在 `docs/chapter2/第二章 Transformer架构.md` 里点几下、选中 3 行，然后：

```bash
cat "$LOCALAPPDATA/pi-focus/d--happy-llm.json" | python -m json.tool
```

Expected: `editor.path` 为 `docs\\chapter2\\第二章 Transformer架构.md`、`line` 与光标一致、`selection.chars` 与手选字数一致、`openTabs` 三项且活动项 `active: true`、`updatedAt` 在 2 秒内。

- [ ] **Step 4: 手动验证 webview 场景（Review Focus 1）**

让该 markdown 走 office 预览（点编辑器右上角的预览切换）→ 再 `cat` 上面的文件。

Expected: `editor.path` 仍是该文件、`editorKind` 为 `"webview"`、无 `line`/`selection`（或沿用上次文本模式的值），扩展无报错气泡。

- [ ] **Step 5: 提交**

```bash
git add vscode-ext/package.json vscode-ext/extension.js
git commit -m "feat: vscode focus collector extension"
```

---

### Task 5: pi 侧渲染（纯函数）

**Files:**
- Create: `C:\Users\ptlan\pi-vscode-focus\pi-ext\render.mjs`
- Test: `C:\Users\ptlan\pi-vscode-focus\test\render.test.mjs`

**Interfaces:**
- Produces: `renderFocus(focus: object|null, cwd: string, now: Date): string | null`。规则：`focus` 为 `null` → `null`；`focus.folder` 与 `cwd` 不相等（忽略大小写与结尾分隔符）→ `null`；否则输出多行文本，首行 `[VS Code 现场 HH:MM]`（`HH:MM` 取 `focus.updatedAt` 的**本地**时间），`now - updatedAt > 900000` 时改为 `[VS Code 现场 HH:MM（可能已过期）]`。第 2 行 `editor.path（languageId，未保存|已保存）`；第 3 行 `光标 L{line} C{column}`，其后依次追加 ` · 选区 L{startLine}-{endLine}（{chars} 字）`、` · 视口 L{firstLine}-{lastLine}`、` · 小节「{heading}」`，缺哪个字段就整段省略；`editor` 为 `null` 时第 2、3 行换成 `（未获取到活动编辑器）`。第 4 行仅在 `recentEdits` 非空时输出 `最近改（90s）：` + 每项 `{path} L{a}-{b}(+{plus}/-{minus})`，多项用 ` · ` 连接、最多 3 项。第 5 行仅在 `openTabs` 非空时输出 `打开：📄 {active.path basename} · {其余 basename} · …`。

- [ ] **Step 1: 写失败测试**

`test/render.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert";
import { renderFocus } from "../pi-ext/render.mjs";

const now = new Date("2026-11-13T08:31:04.000Z");
const focus = {
  schema: 1,
  folder: "d:\\happy-llm",
  windowPid: 23488,
  updatedAt: "2026-11-13T08:31:04.000Z",
  editor: {
    path: "docs\\chapter2\\第二章 Transformer架构.md",
    editorKind: "text",
    languageId: "markdown",
    dirty: false,
    line: 900,
    column: 12,
    selection: { startLine: 895, endLine: 905, chars: 312, text: "…" },
    visible: { firstLine: 845, lastLine: 960 },
    heading: "2.1.2 深入理解注意力机制",
  },
  recentEdits: [{ path: "docs\\chapter2\\第二章 Transformer架构.md", ranges: [[880, 905]], at: "x", plus: 18, minus: 4 }],
  openTabs: [
    { path: "docs\\chapter2\\第二章 Transformer架构.md", active: true },
    { path: "README.md", active: false },
  ],
};

test("完整现场渲染五行", () => {
  const out = renderFocus(focus, "D:\\happy-llm", now);
  assert.equal(out.split("\n")[0], "[VS Code 现场 08:31]");
  assert.match(out, /第二章 Transformer架构\.md（markdown，已保存）/);
  assert.match(out, /光标 L900 C12 · 选区 L895-905（312 字） · 视口 L845-960 · 小节「2\.1\.2 深入理解注意力机制」/);
  assert.match(out, /最近改（90s）：docs\\chapter2\\第二章 Transformer架构\.md L880-905\(\+18\/-4\)/);
  assert.match(out, /打开：📄 第二章 Transformer架构\.md · README\.md/);
});

test("webview 场景不输出光标行残片", () => {
  const web = { ...focus, editor: { path: "a.md", editorKind: "webview", languageId: "markdown", dirty: true } };
  const out = renderFocus(web, "d:\\happy-llm", now);
  assert.match(out, /a\.md（markdown，未保存）/);
  assert.doesNotMatch(out, /光标/);
});

test("空 heading/缺字段不出现空括号", () => {
  const bare = { ...focus, editor: { path: "a.md", editorKind: "text", dirty: false, line: 3, column: 1 }, recentEdits: [], openTabs: [] };
  const out = renderFocus(bare, "d:\\happy-llm", now);
  assert.equal(out.split("\n").length, 3);
  assert.doesNotMatch(out, /\(\)|「」|（）/);
});

test("目录不匹配与 null 返回 null", () => {
  assert.equal(renderFocus(null, "d:\\happy-llm", now), null);
  assert.equal(renderFocus(focus, "D:\\other", now), null);
  assert.equal(renderFocus({ ...focus, folder: "D:\\happy-llm" }, "d:\\happy-llm\\", now) !== null, true);
});

test("超过 15 分钟标注过期", () => {
  const late = new Date(now.getTime() + 900001);
  assert.match(renderFocus(focus, "d:\\happy-llm", late).split("\n")[0], /可能已过期/);
});

test("editor 为 null 时给出说明行", () => {
  const out = renderFocus({ ...focus, editor: null }, "d:\\happy-llm", now);
  assert.match(out, /未获取到活动编辑器/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/render.test.mjs`
Expected: FAIL，`Cannot find module '../pi-ext/render.mjs'`。

- [ ] **Step 3: 实现 `pi-ext/render.mjs`**

纯函数，无 import（时间格式化用 `new Date(iso)` 的 `getHours()`/`getMinutes()` 补零）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/render.test.mjs`
Expected: `# pass 6` / `# fail 0`。

- [ ] **Step 5: 提交**

```bash
git add pi-ext/render.mjs test/render.test.mjs
git commit -m "feat: focus rendering for pi"
```

---

### Task 6: pi 扩展接线

**Files:**
- Create: `C:\Users\ptlan\pi-vscode-focus\pi-ext\vscode-focus.ts`

**Interfaces:**
- Consumes: Task 5 的 `renderFocus(focus, cwd, now)`；Task 1 的 slug 算法（此处**重写一份 3 行实现**，不从 VS Code 侧 require）。
- Produces: pi 扩展默认导出；运行期产出 `vscode_focus` 工具与 `before_agent_start` 注入。

- [ ] **Step 1: 写 `pi-ext/vscode-focus.ts`**

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderFocus } from "./render.mjs";

const STALE_MS = 900000;

function focusPath(cwd: string): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const slug = cwd.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return path.join(base, "pi-focus", slug + ".json");
}

function readFocus(cwd: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(focusPath(cwd), "utf8"));
  } catch {
    return null;
  }
}
```

接线要点：
1. `pi.on("before_agent_start", async (event, ctx) => { if (event.messageType === "custom") return; const text = renderFocus(readFocus(ctx.cwd), ctx.cwd, new Date()); if (!text || text === lastText) return; lastText = text; return { message: { customType: "vscode-focus", content: text, display: false } }; })`。
2. `pi.registerTool({ name: "vscode_focus", description: "读取用户 VS Code 当前活动文件、光标、选区、小节与最近改动", ... })`，`readOnlyHint: true`，无参数，`execute` 返回 `renderFocus(...) ?? "未获取到 VS Code 现场（扩展未安装或窗口未打开）"`。
3. `lastText` 为模块级变量；`pi.on("session_start")` 时清空。

- [ ] **Step 2: 安装并确认加载无错**

```bash
cp /c/Users/ptlan/pi-vscode-focus/pi-ext/vscode-focus.ts /c/Users/ptlan/.pi/agent/extensions/vscode-focus.ts
cp /c/Users/ptlan/pi-vscode-focus/pi-ext/render.mjs /c/Users/ptlan/.pi/agent/extensions/render.mjs
```

在 pi 里 `/reload`。Expected: 无 extension error（若报 `./render.mjs` 无法解析，按 Step 3 兜底）。

- [ ] **Step 3: 兜底（仅当 Step 2 报 `render.mjs` 解析失败）**

把 `render.mjs` 内容原样内联到 `vscode-focus.ts` 顶部，删掉该 `import`，并把 `test/render.test.mjs` 改为 `import { renderFocus } from "../pi-ext/vscode-focus.ts"` + 运行 `node --test --experimental-strip-types test/render.test.mjs`。完成后重跑 Step 2。

- [ ] **Step 4: 手动验证注入与工具**

在 `D:\happy-llm` 里让光标停在第 900 行附近，然后对 pi 说：

```
我在看什么？
```

Expected: 回答含 `第二章 Transformer架构.md`、`L900`、`2.1.2`；`/usage` 里本轮系统/上下文增量为几百 token 级。

- [ ] **Step 5: 提交**

```bash
git add pi-ext/vscode-focus.ts
git commit -m "feat: pi extension injects vscode focus"
```

---

### Task 7: 一键安装与端到端验收

**Files:**
- Create: `C:\Users\ptlan\pi-vscode-focus\install.sh`
- Create: `C:\Users\ptlan\pi-vscode-focus\README.md`

**Interfaces:**
- Consumes: Task 4 的 `vscode-ext/`、Task 6 的 `pi-ext/`。
- Produces: `install.sh`（幂等：先删目标目录再复制）。

- [ ] **Step 1: 写 `install.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
vsx="${USERPROFILE//\\/\/}/.vscode/extensions/pi-vscode-focus-0.1.0"
agent="$(cygpath "$USERPROFILE" 2>/dev/null || echo "$HOME")/.pi/agent/extensions"
rm -rf "$vsx" && mkdir -p "$vsx" && cp -r "$here/vscode-ext/." "$vsx/"
mkdir -p "$agent"
cp "$here/pi-ext/vscode-focus.ts" "$here/pi-ext/render.mjs" "$agent/"
echo "installed. Reload VS Code window, then /reload in pi."
```

- [ ] **Step 2: 跑安装脚本**

Run: `bash /c/Users/ptlan/pi-vscode-focus/install.sh && ls "$USERPROFILE/.vscode/extensions/pi-vscode-focus-0.1.0" "$HOME/.pi/agent/extensions"`
Expected: 目标目录里有 `package.json`、`extension.js`、`lib/`；agent 目录里有 `vscode-focus.ts`、`render.mjs`。

- [ ] **Step 3: 端到端验收（对照 DESIGN 的 6 条）**

1. 切 tab / 移光标 / 改 3 行 → `python -m json.tool` 观察 1 秒内更新（Review Focus 2：同时开第二个同目录窗口，JSON 仍可解析）。
2. 整章全选（Ctrl+A）→ `chars` 为真实全文长度，`text` 长度 1500（Review Focus 3）。
3. 光标移到文件第一行 → `heading` 缺失、渲染无空括号（Review Focus 4）。
4. 打开 `images/` 下任一张图 → 不抛错、`openTabs` 不含它、`editor` 可为 `null`（Review Focus 5）。
5. 关闭该 VS Code 窗口 → pi 侧不注入或标"可能已过期"。
6. `pi --no-extensions -p "hi"` → 正常返回，证明扩展失败不阻塞。

- [ ] **Step 4: 写 `README.md`**

内容：一句话用途、安装（`bash install.sh` + Reload Window + `/reload`）、文件位置（`%LOCALAPPDATA%\pi-focus\`）、卸载（删两个目录）、已知限制（远程 SSH/WSL 不支持、webview 无行号、多窗口后写胜）。

- [ ] **Step 5: 提交**

```bash
git add install.sh README.md
git commit -m "chore: installer and usage notes"
```

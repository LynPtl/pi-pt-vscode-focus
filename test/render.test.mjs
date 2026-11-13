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

function localClock(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

test("完整现场渲染五行", () => {
  const out = renderFocus(focus, "D:\\happy-llm", now);
  const lines = out.split("\n");
  assert.equal(lines[0], `[VS Code 现场 ${localClock(focus.updatedAt)}]`);
  assert.match(lines[0], /^\[VS Code 现场 \d{2}:\d{2}\]$/);
  assert.match(out, /第二章 Transformer架构\.md（markdown，已保存）/);
  assert.match(out, /光标 L900 C12 · 选区 L895-905（312 字） · 视口 L845-960 · 小节「2\.1\.2 深入理解注意力机制」/);
  assert.match(out, /最近改（90s）：docs\\chapter2\\第二章 Transformer架构\.md L880-905\(\+18\/-4\)/);
  assert.match(out, /打开：📄 第二章 Transformer架构\.md · README\.md/);
  assert.equal(lines.length, 5);
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

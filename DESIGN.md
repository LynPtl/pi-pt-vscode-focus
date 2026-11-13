# pi ↔ VS Code 焦点同步（方案 B）— 设计

日期：2026-11-13 · 状态：待批准

## 意图

pi 在 VS Code 集成终端里跑，但看不到用户正在看/改什么。目标：pi 每轮对话都知道
**当前活动文件、光标位置、选区、所在小节、最近改了哪些行**，成本控制在几百 token，
不使用 UI 自动化 / 截图 / 无障碍树。

## 非目标

- 不做意图同步（"我在想什么"）——由用户用一两句话讲。
- 不做远程 SSH / WSL / Codespaces（扩展跑在远端，写远端文件；本期不支持）。
- 不读 VS Code 的 `state.vscdb`（schema 未公开，作为将来兜底再谈）。
- 不截屏、不抢焦点、不轮询。

## 架构

```
VS Code 扩展 (≈120 行 JS，无构建)         pi 扩展 (≈150 行 TS)
事件驱动，debounce 400ms                  before_agent_start 读文件 → 追加一条 message
        │                                          ↑
        └──── %LOCALAPPDATA%\pi-focus\<slug>.json ─┘
              slug: "D:\happy-llm" → "d--happy-llm"
```

单向文件通道。VS Code 侧只写，pi 侧只读。两者不互相依赖，任一侧坏了另一侧无感。

## VS Code 扩展

- 位置：`C:\Users\ptlan\pi-vscode-focus\vscode-ext\`（`package.json` + `extension.js`），
  安装 = 复制到 `%USERPROFILE%\.vscode\extensions\pi-vscode-focus-0.1.0\` 后 Reload Window。
  不打包 vsix，不跑 tsc。
- 激活：`onStartupFinished`，仅当存在工作区文件夹时工作。
- 监听：
  - `window.onDidChangeActiveTextEditor`
  - `window.onDidChangeTextEditorSelection`
  - `window.onDidChangeTextEditorVisibleRanges`
  - `window.tabGroups.onDidChangeTabs` / `onDidChangeTabGroups`
  - `workspace.onDidChangeTextDocument`（增量 → 记录被改行号区间）
  - `workspace.onDidSaveTextDocument`
- 写盘：debounce 400ms，最多 1 次/秒；`fs.writeFile` 到 `.tmp` 再 `rename`（原子）。
- 已知坑（已确认）：markdown 被 `cweijan.vscode-office` 用 webview 打开时
  `window.activeTextEditor` 为 `undefined`。因此**文件身份一律从
  `tabGroups.activeTabGroup.activeTab.input` 取**（`TabInputText` / `TabInputCustom` /
  `TabInputTextDiff` / `TabInputWebview`），光标与选区才用 `activeTextEditor`；
  webview 情况下记为 `editorKind:"webview"`，光标沿用该文件最后一次文本编辑器状态，
  没有就留空。

### 输出 JSON

```json
{
  "schema": 1,
  "folder": "d:\\happy-llm",
  "windowPid": 23488,
  "updatedAt": "2026-11-13T16:31:04.512Z",
  "editor": {
    "path": "docs\\chapter2\\第二章 Transformer架构.md",
    "editorKind": "text",
    "languageId": "markdown",
    "dirty": false,
    "line": 900, "column": 12,
    "selection": { "startLine": 895, "endLine": 905, "chars": 312, "text": "…≤1500字…" },
    "visible": { "firstLine": 845, "lastLine": 960 },
    "heading": "2.1.2 深入理解注意力机制"
  },
  "recentEdits": [
    { "path": "docs\\chapter2\\第二章 Transformer架构.md", "ranges": [[880, 905]], "at": "…", "plus": 18, "minus": 4 }
  ],
  "openTabs": [
    { "path": "docs\\chapter2\\第二章 Transformer架构.md", "active": true },
    { "path": "README.md" }, { "path": "README_en.md" }
  ]
}
```

- 路径一律相对工作区文件夹，pi 侧用 `ctx.cwd` 拼。
- `heading`：仅 markdown，向上最多扫 200 行找最近的 `^#{1,6} `；找不到省略。
- `recentEdits`：最近 90 秒内有改动的文件，最多 5 个；`ranges` 合并相邻行。
- 仅存单个文件，最后写者胜（同一文件夹开两个窗口时以最后动键盘的为准）。

## pi 扩展

- 位置：`C:\Users\ptlan\.pi\agent\extensions\vscode-focus.ts`（单文件，pi 自动加载）。
- `before_agent_start`：
  - `messageType === "custom"` 时跳过（防自激）。
  - 读 `%LOCALAPPDATA%\pi-focus\<slug(cwd)>.json`；不存在 / `folder` 与 cwd 不匹配 → 跳过。
  - `updatedAt` 超过 15 分钟 → 前缀标注 `（可能已过期）`。
  - 与上次注入内容完全相同 → 跳过。
  - 返回 `{ message: { customType: "vscode-focus", display: false, content } }`，
    **不动 `systemPrompt`**（避免破坏 prompt 缓存前缀）。
- 同时注册工具 `vscode_focus`（只读、无参数，返回同样的渲染文本），
  用于长时间任务中途重新确认现场。

注入样例（约 180 token）：

```
[VS Code 现场 16:31] docs\chapter2\第二章 Transformer架构.md（markdown，未保存）
光标 L900 C12 · 选区 L895-905（312 字） · 视口 L845-960 · 小节「2.1.2 深入理解注意力机制」
最近改（90s）：同文件 L880-905(+18/-4)
打开：📄 第二章 Transformer架构.md · README.md · README_en.md
```

## 失败模式

| 情况 | 表现 | 处理 |
|---|---|---|
| VS Code 关了 / 扩展没装 | 文件不更新 | 静默跳过；>15min 标"可能已过期" |
| markdown 走 webview | 无光标、无选区 | 用 tab.input 取文件；光标留空 |
| 工作区有 2 个窗口 | 后写覆盖 | 记 `windowPid`，可日后按窗口分文件 |
| 文件超过 1500 字选区 | 截断 | 加 `…`，并给 `chars` 全长 |
| pi 在别的目录启动 | 找不到 slug | 跳过，不报错 |

## 隐私

仅写本机 `%LOCALAPPDATA%`，不上网，不进 git，不写进仓库。选区文本上限 1500 字。

## 验证

1. 切 tab / 移动光标 / 改几行 → JSON 在 1 秒内更新，字段正确。
2. markdown 用 office webview 打开 → `path` 仍正确，`editorKind:"webview"`。
3. 在 pi 里问"我在看什么"，回答包含文件名 + 行号 + 小节。
4. 关掉 VS Code 再问 → 不注入或标过期。
5. 一次注入的 token 增量 < 300（看 `/usage`）。
6. `pi --no-extensions` 下行为不变（扩展可失败而不阻塞）。

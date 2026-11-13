# pi-vscode-focus

让 [pi](https://pi.dev) 知道你在 VS Code 里正在看什么、改什么——每轮对话自动带上
活动文件、光标、选区、所在小节和最近 90 秒的改动，成本约 200 token。
不用截屏、不用无障碍树、不抢焦点。

```
VS Code 扩展 ──写──> %LOCALAPPDATA%\pi-focus\<slug>.json ──读──> pi 扩展
```

## 安装

```bash
bash install.sh
```

然后：

1. VS Code：`Ctrl+Shift+P` → `Developer: Reload Window`
2. pi 里：`/reload`
3. 问 pi：`我在看什么？`

## 它注入什么

```
[VS Code 现场 16:31] docs\chapter2\第二章 Transformer架构.md（markdown，已保存）
光标 L900 C12 · 选区 L895-905（312 字） · 视口 L845-960 · 小节「2.1.2 深入理解注意力机制」
最近改（90s）：同文件 L880-905(+18/-4)
打开：📄 第二章 Transformer架构.md · README.md · README_en.md
```

pi 还可以随时调用只读工具 `vscode_focus` 重新确认现场（长任务中途有用）。

## 卸载

```bash
rm -rf ~/.vscode/extensions/pi-vscode-focus-0.1.0
rm -rf ~/.pi/agent/extensions/vscode-focus
rm -rf "$LOCALAPPDATA/pi-focus"
```

## 已知限制

- **远程 SSH / WSL / Codespaces 不支持**：扩展写在远端文件系统，pi 在本地找不到。
- **markdown 用 webview 预览时没有光标**：`window.activeTextEditor` 为空，只报文件与上次的文本光标。
- **同一文件夹开两个窗口**：后写者胜，JSON 始终完整（原子写）。
- **状态是节流落盘的**：最多 1 次/秒，切换后最多约 1 秒延迟；超过 15 分钟未更新会标注"可能已过期"。
- **选区文本上限 1500 字**，`chars` 仍是真实全长。

## 开发

```bash
node --test          # 28 条测试，不需要 VS Code
```

- `vscode-ext/lib/focus-core.js` — 纯逻辑（slug、小节查找、区间合并、payload、原子写、节流）
- `vscode-ext/extension.js` — 事件胶水
- `pi-ext/render.mjs` — 注入文本渲染
- `pi-ext/vscode-focus.ts` — pi 扩展（`before_agent_start` + `vscode_focus` 工具）
- `test/extension-glue.test.js` — 用假 `vscode` 模块跑真实的 `activate()`

设计与计划：`DESIGN.md`、`PLAN.md`。

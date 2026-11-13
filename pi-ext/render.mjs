const STALE_MS = 900000;
const RECENT_EDIT_SHOWN = 3;

function samePath(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const norm = (p) => p.replace(/[\\/]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??:??";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function baseName(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  return parts[parts.length - 1];
}

function renderEditor(editor) {
  const lines = [];
  if (!editor) {
    lines.push("（未获取到活动编辑器）");
    return lines;
  }

  const state = editor.dirty ? "未保存" : "已保存";
  const suffix = editor.languageId ? `${editor.languageId}，${state}` : state;
  lines.push(`${editor.path}（${suffix}）`);

  if (editor.line !== undefined) {
    let cursor = `光标 L${editor.line} C${editor.column ?? 1}`;
    if (editor.selection) {
      const s = editor.selection;
      cursor += ` · 选区 L${s.startLine}-${s.endLine}（${s.chars} 字）`;
    }
    if (editor.visible) cursor += ` · 视口 L${editor.visible.firstLine}-${editor.visible.lastLine}`;
    if (editor.heading) cursor += ` · 小节「${editor.heading}」`;
    lines.push(cursor);
  }
  return lines;
}

function renderEdits(recentEdits) {
  if (!recentEdits || recentEdits.length === 0) return undefined;
  const entries = recentEdits.slice(0, RECENT_EDIT_SHOWN).map((edit) => {
    const range = (edit.ranges && edit.ranges[0]) || [0, 0];
    return `${edit.path} L${range[0]}-${range[1]}(+${edit.plus}/-${edit.minus})`;
  });
  return `最近改（90s）：${entries.join(" · ")}`;
}

function renderTabs(openTabs) {
  if (!openTabs || openTabs.length === 0) return undefined;
  const active = openTabs.find((tab) => tab.active) || openTabs[0];
  const rest = openTabs.filter((tab) => tab !== active).map((tab) => baseName(tab.path));
  const parts = [`📄 ${baseName(active.path)}`, ...rest];
  return `打开：${parts.join(" · ")}`;
}

export function renderFocus(focus, cwd, now) {
  if (!focus || !samePath(focus.folder, cwd)) return null;

  const updatedAt = new Date(focus.updatedAt).getTime();
  const stale = Number.isFinite(updatedAt) && now.getTime() - updatedAt > STALE_MS;
  const header = `[VS Code 现场 ${clock(focus.updatedAt)}${stale ? "（可能已过期）" : ""}]`;

  const lines = [header, ...renderEditor(focus.editor)];
  for (const extra of [renderEdits(focus.recentEdits), renderTabs(focus.openTabs)]) {
    if (extra) lines.push(extra);
  }
  return lines.join("\n");
}

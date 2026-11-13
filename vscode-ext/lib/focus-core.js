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

function findHeading(lines, lineNumber) {
  const HEADING_SCAN_LINES = 200;
  const from = Math.max(0, lineNumber - 1 - HEADING_SCAN_LINES);
  for (let i = Math.min(lineNumber - 1, lines.length - 1); i >= from; i--) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i]);
    if (m) return m[1];
  }
  return undefined;
}

function mergeRanges(ranges) {
  const sorted = ranges.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

function buildPayload(raw, now) {
  const SELECTION_TEXT_MAX = 1500;
  const RECENT_EDIT_WINDOW_MS = 90000;
  const RECENT_EDIT_MAX_FILES = 5;

  let editor = null;
  if (raw.editor) {
    const e = raw.editor;
    editor = { path: e.path, editorKind: e.editorKind, dirty: e.dirty === true };
    if (e.languageId !== undefined) editor.languageId = e.languageId;
    if (e.line !== undefined) editor.line = e.line;
    if (e.column !== undefined) editor.column = e.column;
    if (e.selection) {
      editor.selection = {
        startLine: e.selection.startLine,
        endLine: e.selection.endLine,
        chars: e.selection.text.length,
        text: e.selection.text.slice(0, SELECTION_TEXT_MAX),
      };
    }
    if (e.visible) editor.visible = { firstLine: e.visible.firstLine, lastLine: e.visible.lastLine };
    if (e.heading) editor.heading = e.heading;
  }

  const recentEdits = (raw.recentEdits || [])
    .filter((r) => now.getTime() - r.at <= RECENT_EDIT_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_EDIT_MAX_FILES)
    .map((r) => ({ path: r.path, ranges: mergeRanges(r.ranges), at: r.at, plus: r.plus, minus: r.minus }));

  const openTabs = (raw.openTabs || []).map((t) => ({ path: t.path, active: t.active === true }));

  return {
    schema: SCHEMA,
    folder: raw.folder,
    windowPid: raw.windowPid,
    updatedAt: now.toISOString(),
    editor,
    recentEdits,
    openTabs,
  };
}

module.exports = {
  SCHEMA,
  focusDir,
  slugForFolder,
  focusFile,
  findHeading,
  mergeRanges,
  buildPayload,
};

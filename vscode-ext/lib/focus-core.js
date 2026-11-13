const path = require("node:path");
const os = require("node:os");

const SCHEMA = 1;

function resolveFocusDir({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  let base;
  if (platform === "win32") base = env.LOCALAPPDATA || path.join(homedir, "AppData", "Local");
  else if (platform === "darwin") base = path.join(homedir, "Library", "Application Support");
  else base = env.XDG_STATE_HOME || path.join(homedir, ".local", "state");
  return path.join(base, "pi-focus");
}

function focusDir() {
  return resolveFocusDir();
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

async function writeJsonAtomic(file, data) {
  const fs = require("node:fs");
  const dir = path.dirname(file);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = file + ".tmp";
  await fs.promises.writeFile(tmp, JSON.stringify(data), "utf8");
  await fs.promises.rename(tmp, file);
}

function makeThrottledWriter(write, debounceMs = 400, minIntervalMs = 1000) {
  let timer = null;
  let pending = false;
  let running = Promise.resolve();
  let lastWriteAt = 0;

  function delay() {
    const sinceLast = Date.now() - lastWriteAt;
    return Math.max(debounceMs, minIntervalMs - sinceLast, 0);
  }

  async function fire() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    pending = false;
    try {
      await write();
    } finally {
      lastWriteAt = Date.now();
    }
  }

  return {
    schedule() {
      pending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        running = fire();
      }, delay());
    },
    async flush() {
      running = running.then(() => fire());
      await running;
    },
  };
}

function relativize(fsPath, folder) {
  if (!fsPath || !folder) return undefined;
  const rel = path.relative(folder, fsPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join("\\");
}

function accumulateEdit(prev, next) {
  return {
    path: next.path,
    ranges: mergeRanges([...(prev ? prev.ranges : []), ...next.ranges]),
    at: next.at,
    plus: (prev ? prev.plus : 0) + next.plus,
    minus: (prev ? prev.minus : 0) + next.minus,
  };
}

module.exports = {
  SCHEMA,
  resolveFocusDir,
  focusDir,
  slugForFolder,
  focusFile,
  findHeading,
  mergeRanges,
  buildPayload,
  writeJsonAtomic,
  makeThrottledWriter,
  relativize,
  accumulateEdit,
};

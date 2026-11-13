const vscode = require("vscode");
const fs = require("node:fs");
const core = require("./lib/focus-core.js");

const RECENT_EDIT_MAX_KEPT = 10;
const RECENT_EDIT_PRUNE_MS = 300000;

function tabFsPath(input) {
  if (input && input.uri && typeof input.uri.fsPath === "string") return input.uri.fsPath;
  return undefined;
}

function activate(context) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;
  const folder = folders[0].uri.fsPath;

  const state = {
    recentEdits: new Map(),
    lastText: undefined,
  };

  const writer = core.makeThrottledWriter(async () => {
    try {
      const raw = collect();
      await core.writeJsonAtomic(core.focusFile(folder), core.buildPayload(raw, new Date()));
    } catch (error) {
      console.error("pi-vscode-focus: write failed", error);
    }
  });

  function collect() {
    const group = vscode.window.tabGroups.activeTabGroup;
    const activeTab = group ? group.activeTab : undefined;
    const activeEditor = vscode.window.activeTextEditor;

    let fsPath = tabFsPath(activeTab ? activeTab.input : undefined);
    let editorKind = "webview";

    if (activeEditor && activeEditor.document && activeEditor.document.uri) {
      const editorPath = activeEditor.document.uri.fsPath;
      if (!fsPath || editorPath === fsPath) {
        fsPath = editorPath;
        editorKind = "text";
      }
    }
    if (!fsPath) {
      // A webview tab with no uri (Settings, Marketplace, Welcome) does not say
      // which file it shows. Reporting the previous file would be a guess, so
      // report nothing instead.
      fsPath = undefined;
    }

    const relPath = core.relativize(fsPath, folder);
    const displayPath = relPath !== undefined ? relPath : fsPath;
    let editor = null;

    if (displayPath) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri && d.uri.fsPath === fsPath);
      editor = { path: displayPath, editorKind, dirty: doc ? doc.isDirty === true : false };
      if (doc && doc.languageId) editor.languageId = doc.languageId;

      const cursor = editorKind === "text" ? readCursor(activeEditor, doc) : undefined;
      if (cursor) {
        state.lastText = { path: displayPath, ...cursor };
        Object.assign(editor, cursor);
      } else if (state.lastText && state.lastText.path === displayPath) {
        const { path: _ignored, ...rest } = state.lastText;
        Object.assign(editor, rest);
        editor.editorKind = "webview";
      }
    }

    const tabs = group ? group.tabs : [];
    const openTabs = tabs
      .map((tab) => ({ path: core.relativize(tabFsPath(tab.input), folder), active: tab.isActive === true }))
      .filter((tab) => tab.path !== undefined);

    return {
      folder,
      windowPid: process.pid,
      editor,
      recentEdits: Array.from(state.recentEdits.values()),
      openTabs,
    };
  }

  function readCursor(activeEditor, doc) {
    if (!activeEditor || !doc || activeEditor.document !== doc) return undefined;
    const selection = activeEditor.selection;
    const position = selection.active;
    const out = { line: position.line + 1, column: position.character + 1 };

    if (!selection.isEmpty) {
      out.selection = {
        startLine: Math.min(selection.start.line, selection.end.line) + 1,
        endLine: Math.max(selection.start.line, selection.end.line) + 1,
        text: doc.getText(selection),
      };
    }
    const visible = activeEditor.visibleRanges && activeEditor.visibleRanges[0];
    if (visible) out.visible = { firstLine: visible.start.line + 1, lastLine: visible.end.line + 1 };

    if (doc.languageId === "markdown" || doc.languageId === "mdx") {
      const heading = core.findHeading(doc.getText().split(/\r?\n/), out.line);
      if (heading) out.heading = heading;
    }
    return out;
  }

  function onDocumentChange(event) {
    const rel = core.relativize(event.document.uri && event.document.uri.fsPath, folder);
    if (!rel || !event.contentChanges || event.contentChanges.length === 0) return;

    let plus = 0;
    let minus = 0;
    const ranges = [];
    for (const change of event.contentChanges) {
      const startLine = change.range.start.line + 1;
      const endLine = change.range.end.line + 1;
      const added = change.text ? change.text.split(/\r?\n/).length - 1 : 0;
      const removed = Math.max(0, change.range.end.line - change.range.start.line);
      plus += added;
      minus += removed;
      ranges.push([startLine, Math.max(endLine, startLine + added)]);
    }

    state.recentEdits.set(
      rel,
      core.accumulateEdit(state.recentEdits.get(rel), { path: rel, ranges, at: Date.now(), plus, minus }),
    );

    const now = Date.now();
    for (const [key, entry] of state.recentEdits) {
      if (now - entry.at > RECENT_EDIT_PRUNE_MS) state.recentEdits.delete(key);
    }
    if (state.recentEdits.size > RECENT_EDIT_MAX_KEPT) {
      const oldest = Array.from(state.recentEdits.entries()).sort((a, b) => a[1].at - b[1].at);
      for (const [key] of oldest.slice(0, state.recentEdits.size - RECENT_EDIT_MAX_KEPT)) {
        state.recentEdits.delete(key);
      }
    }
    writer.schedule();
  }

  const disposers = [
    vscode.window.onDidChangeActiveTextEditor(() => writer.schedule()),
    vscode.window.onDidChangeTextEditorSelection(() => writer.schedule()),
    vscode.window.onDidChangeTextEditorVisibleRanges(() => writer.schedule()),
    vscode.window.tabGroups.onDidChangeTabs(() => writer.schedule()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => writer.schedule()),
    vscode.workspace.onDidChangeTextDocument(onDocumentChange),
    vscode.workspace.onDidSaveTextDocument(() => writer.schedule()),
  ];

  context.subscriptions.push(...disposers, { dispose: () => void writer.flush() });
  flushOnDeactivate = () => writer.flush();
  writer.schedule();
}

let flushOnDeactivate;

async function deactivate() {
  if (flushOnDeactivate) await flushOnDeactivate();
}

module.exports = { activate, deactivate };

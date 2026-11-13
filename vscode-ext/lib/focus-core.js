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

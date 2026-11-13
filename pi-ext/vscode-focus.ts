import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderFocus } from "./render.mjs";

const NO_FOCUS_TEXT = "未获取到 VS Code 现场（扩展未安装、窗口已关闭，或 pi 不在同一个工作区目录）";

function focusDir(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "pi-focus");
}

export function focusPath(cwd: string): string {
  const slug = cwd.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return path.join(focusDir(), `${slug}.json`);
}

export function readFocusFile(cwd: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(focusPath(cwd), "utf8"));
  } catch {
    return null;
  }
}

export function focusText(cwd: string, now: Date = new Date()): string | null {
  return renderFocus(readFocusFile(cwd) as never, cwd, now);
}

export default function vscodeFocus(pi: ExtensionAPI): void {
  let lastText: string | null = null;

  pi.on("session_start", () => {
    lastText = null;
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (event.messageType === "custom") return undefined;
    const text = focusText(ctx.cwd);
    if (!text || text === lastText) return undefined;
    lastText = text;
    return {
      message: { customType: "vscode-focus", content: text, display: false },
    };
  });

  pi.registerTool({
    name: "vscode_focus",
    label: "VS Code Focus",
    description:
      "读取用户此刻在 VS Code 中的活动文件、光标、选区、所在小节与最近改动。每轮对话已自动注入一次；任务中途需要确认现场时再调用。",
    parameters: { type: "object", properties: {}, additionalProperties: false } as never,
    readOnlyHint: true,
    async execute(_toolCallId: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx?: { cwd?: string }) {
      const cwd = ctx && ctx.cwd ? ctx.cwd : process.cwd();
      const text = focusText(cwd);
      return { content: [{ type: "text", text: text ?? NO_FOCUS_TEXT }] };
    },
  });
}

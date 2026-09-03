import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import { IpcInputError } from "../ipcLimits.js";
import { tailLinesMatching, type LogTailMatch } from "../logReader.js";

/** F1 日志查看 IPC：白名单路径 = userData/logs/lake-notes.log（electron-log 主文件；.old 为轮转产物，一并纳入尾部）。
 * 渲染层只传 keyword/maxLines，绝不接受任意路径。 */
export function registerLogIpc(ipc: IpcRegistrar): void {
  ipc.handle("read_app_log", (opts: unknown) => {
    if (!opts || typeof opts !== "object") throw new IpcInputError("日志读取参数无效");
    const o = opts as { keyword?: string; maxLines?: number; context?: number };
    const maxLines = typeof o.maxLines === "number" && o.maxLines > 0 ? Math.min(Math.floor(o.maxLines), 500) : 200;
    const context = typeof o.context === "number" && o.context >= 0 ? Math.min(Math.floor(o.context), 5) : 1;
    const keyword = typeof o.keyword === "string" ? o.keyword.slice(0, 200) : undefined;
    const logDir = path.join(app.getPath("userData"), "logs");
    const mainPath = path.join(logDir, "lake-notes.log");
    const oldPath = path.join(logDir, "lake-notes.old.log");
    const readTail = (filePath: string): string => {
      try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
    };
    const combined = readTail(mainPath) + "\n" + readTail(oldPath);
    const matches: LogTailMatch[] = tailLinesMatching(combined, { keyword, maxLines, context });
    return {
      matches,
      file: mainPath,
      truncated: matches.length >= maxLines,
      generatedAt: new Date().toISOString(),
    };
  });
}

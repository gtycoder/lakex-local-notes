import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import { IpcInputError } from "../ipcLimits.js";

/** 关于页「数据与存储」概览（只读）。渲染层不拼路径：目录定位只接受下面这组白名单 kind。 */
export interface SystemInfo {
  app: { name: string; version: string; description: string };
  runtime: { electron: string; chromium: string; node: string; platform: string; arch: string };
  deps: Record<string, string>;
  paths: { userData: string; workspace: string; logs: string };
  storage: unknown;
  quickNotes: number;
  packaged: boolean;
}

/** 依赖版本取自 package.json（vendor 内核是 pin 的，报 bug 时必须能看到实际版本）。 */
export function readVersionsFromPackageJson(pkgJsonPath: string): { app: SystemInfo["app"]; deps: Record<string, string> } {
  const wanted = [
    "@dlient/lakex-doc-react", "lakex-drawnix", "better-sqlite3", "sharp",
    "@aws-sdk/client-s3", "react", "electron", "electron-log", "lucide-react", "typescript", "vite",
  ];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
      name?: string; version?: string; description?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const deps: Record<string, string> = {};
    for (const key of wanted) if (all[key]) deps[key] = all[key];
    return { app: { name: pkg.name ?? "lake-notes", version: pkg.version ?? "0.0.0", description: pkg.description ?? "" }, deps };
  } catch {
    return { app: { name: "lake-notes", version: "0.0.0", description: "" }, deps: {} };
  }
}

/** 白名单目录解析（纯函数，可单测）：只允许这几种 kind，绝不接受渲染层传来的任意路径。 */
export function resolveDataFolder(userData: string, workspaceRoot: string, kind: string): { dir: string; revealTarget: string } {
  switch (kind) {
    case "data": return { dir: userData, revealTarget: userData };
    case "workspace": return { dir: workspaceRoot, revealTarget: workspaceRoot };
    case "logs": return { dir: path.join(userData, "logs"), revealTarget: path.join(userData, "logs", "lake-notes.log") };
    case "assets": return { dir: path.join(workspaceRoot, "note-assets"), revealTarget: path.join(workspaceRoot, "note-assets") };
    case "history": return { dir: path.join(workspaceRoot, "history"), revealTarget: path.join(workspaceRoot, "history") };
    case "quickNotes": return { dir: path.join(workspaceRoot, "quick-notes"), revealTarget: path.join(workspaceRoot, "quick-notes") };
    default: throw new IpcInputError(`未知的目录类型: ${kind}`);
  }
}

export function registerSystemInfoIpc(
  ipc: IpcRegistrar,
  deps: {
    store: { getStorageOverview(): unknown };
    quickNotes: { countQuickNotes(): number };
    workspaceRoot: () => string;
  },
): void {
  ipc.handle("get_system_info", (): SystemInfo => {
    const userData = app.getPath("userData");
    const workspace = deps.workspaceRoot();
    const { app: meta, deps: versions } = readVersionsFromPackageJson(path.join(app.getAppPath(), "package.json"));
    return {
      app: { ...meta, version: app.getVersion() || meta.version },
      runtime: {
        electron: process.versions.electron ?? "", chromium: process.versions.chrome ?? "",
        node: process.versions.node ?? "", platform: process.platform, arch: process.arch,
      },
      deps: versions,
      paths: { userData, workspace, logs: path.join(userData, "logs") },
      storage: deps.store.getStorageOverview(),
      quickNotes: deps.quickNotes.countQuickNotes(),
      packaged: app.isPackaged,
    };
  });

  // 在 Finder 中显示：kind 白名单 → 主进程拼路径；目录不存在时退回打开其父级，绝不接受外部传入路径。
  ipc.handle("reveal_data_folder", (kind: unknown): { ok: boolean; path: string } => {
    if (typeof kind !== "string") throw new IpcInputError("目录类型无效");
    const { dir, revealTarget } = resolveDataFolder(app.getPath("userData"), deps.workspaceRoot(), kind);
    if (fs.existsSync(revealTarget)) {
      shell.showItemInFolder(revealTarget);
      return { ok: true, path: dir };
    }
    if (fs.existsSync(dir)) {
      void shell.openPath(dir);
      return { ok: true, path: dir };
    }
    shell.showItemInFolder(path.dirname(dir));
    return { ok: false, path: dir };
  });
}

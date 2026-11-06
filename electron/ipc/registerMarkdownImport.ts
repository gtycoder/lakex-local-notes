/**
 * 261106 Markdown 导入：主进程文件选择 / 读取 IPC（三处同步里的「注册侧」）。
 *
 * 三个通道（契约见 src/lib/types.ts 的 MarkdownPickedFileShape / MarkdownFolderPickShape / ImportImageShape）：
 * - `pick_markdown_files`：多选文件（过滤器 .md/.markdown + 所有文件 ⇒ 不支持的可被计入跳过数）；
 * - `pick_markdown_folder`：选目录 → 递归扫描（保留相对路径；上限 500 截断标记）；
 * - `read_import_image`：读一张本地图片字节（png/jpg/jpeg/gif/webp，≤20MB，扩展名+魔数双校验），
 *   供渲染层物化为文档资产。
 *
 * 边界：用户取消 → 空数组 / 空结果（**不抛**）；单文件读失败只在该条上给 error（不整批失败）。
 * 转换（md→lake）与落盘都不在这里（renderer 管线 + 既有 create_note/save_note）。
 */
import { BrowserWindow, dialog } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import {
  describeMarkdownFile,
  listMarkdownFilesInDir,
  readImportImage,
  type MarkdownFolderScan,
  type MarkdownPickedFile,
} from "../markdownImportScan.js";

/** 主进程侧可注入点（测试替换对话框/描述函数）。 */
export interface MarkdownImportIpcDeps {
  showOpenDialog?: typeof dialog.showOpenDialog;
  describeFile?: (absPath: string) => MarkdownPickedFile;
  scanFolder?: (root: string) => MarkdownFolderScan;
  readImage?: typeof readImportImage;
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerMarkdownImportIpc(ipc: IpcRegistrar, deps: MarkdownImportIpcDeps = {}): void {
  const showOpenDialog = deps.showOpenDialog ?? dialog.showOpenDialog;
  const describeFile = deps.describeFile ?? ((absPath: string) => describeMarkdownFile(absPath));
  const scanFolder = deps.scanFolder ?? ((root: string) => listMarkdownFilesInDir(root));
  const readImage = deps.readImage ?? readImportImage;

  // 多选 .md：取消 → []（不抛）。过滤器带「所有文件」是为了让用户能选非 md（调用方计入跳过数）。
  ipc.handle("pick_markdown_files", async (): Promise<MarkdownPickedFile[]> => {
    const result = await showOpenDialog(focusedWindow() ?? undefined as unknown as BrowserWindow, {
      title: "选择 Markdown 文件（可多选）",
      buttonLabel: "导入",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths.map((filePath) => describeFile(filePath));
  });

  // 目录 → 递归扫描（隐藏目录 / node_modules / .git 跳过；保留子目录 relativePath；上限 500）。
  ipc.handle("pick_markdown_folder", async (): Promise<MarkdownFolderScan> => {
    const result = await showOpenDialog(focusedWindow() ?? undefined as unknown as BrowserWindow, {
      title: "选择包含 Markdown 的文件夹",
      buttonLabel: "导入",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return { files: [], truncated: false };
    return scanFolder(result.filePaths[0]);
  });

  // 读导入图片字节（供渲染层 uploadResource 物化资产）。
  ipc.handle("read_import_image", (filePath: unknown) => {
    if (typeof filePath !== "string" || !filePath) throw new Error("图片路径无效");
    return readImage(filePath);
  });
}

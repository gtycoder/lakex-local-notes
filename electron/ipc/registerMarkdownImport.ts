/**
 * 261106 Markdown 导入：主进程文件选择 / 读取 IPC（三处同步里的「注册侧」）。
 *
 * 两个通道（契约见 src/lib/types.ts 的 MarkdownPickedFileShape / ImportImageShape）：
 * - `pick_markdown_files`：多选文件（过滤器 .md/.markdown + 所有文件 ⇒ 不支持的可被计入跳过数）；
 * （261106 task-91：「文件夹导入」入口已删除 —— md 可多选，目录入口冗余且难判断；对应 IPC 一并移除）
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
  readImportImage,
  type MarkdownPickedFile,
} from "../markdownImportScan.js";
import { describeImportFile, type ImportPickedFile } from "../documentImportScan.js";

/** 主进程侧可注入点（测试替换对话框/描述函数）。 */
export interface MarkdownImportIpcDeps {
  showOpenDialog?: typeof dialog.showOpenDialog;
  describeFile?: (absPath: string) => MarkdownPickedFile;
  /** 新导入（Word/Excel/CSV/Markdown）的文件描述；测试可注入。 */
  describeImport?: (absPath: string) => Promise<ImportPickedFile>;
  readImage?: typeof readImportImage;
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerMarkdownImportIpc(ipc: IpcRegistrar, deps: MarkdownImportIpcDeps = {}): void {
  const showOpenDialog = deps.showOpenDialog ?? dialog.showOpenDialog;
  const describeFile = deps.describeFile ?? ((absPath: string) => describeMarkdownFile(absPath));
  const describeImport = deps.describeImport ?? ((absPath: string) => describeImportFile(absPath));
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


  // 261108：Markdown / Word / Excel / CSV 统一入口；用户取消 → []。
  ipc.handle("pick_import_files", async (): Promise<ImportPickedFile[]> => {
    const result = await showOpenDialog(focusedWindow() ?? undefined as unknown as BrowserWindow, {
      title: "选择导入文件（可多选）",
      buttonLabel: "导入",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "支持的文件", extensions: ["md", "markdown", "docx", "xlsx", "csv"] },
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "Word", extensions: ["docx"] },
        { name: "Excel", extensions: ["xlsx"] },
        { name: "CSV", extensions: ["csv"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return Promise.all(result.filePaths.map((filePath) => describeImport(filePath)));
  });

  // 读导入图片字节（供渲染层 uploadResource 物化资产）。
  ipc.handle("read_import_image", (filePath: unknown) => {
    if (typeof filePath !== "string" || !filePath) throw new Error("图片路径无效");
    return readImage(filePath);
  });
}
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../lib/native";
import { usheetActiveSheetId } from "../features/usheet/usheetActiveSheet";
import { exportBoardImage } from "../features/board/boardExport";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { replaceTreeNode } from "../desktop/desktopTypes";
import type { ExportFormat } from "../components/ui/ExportSubmenuItem";
import type { TreeNode } from "../lib/types";

export interface UseNoteActionsOptions {
  showNotice: (text: string) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
}

/** 文档右键动作（复制 Markdown / 导出 / 复制资料路径 / 设置图标）——从 App.tsx 收拢的纯动作层。 */
export function useNoteActions({ showNotice, setError, setTreeNodes }: UseNoteActionsOptions) {
  /** M1：复制为 Markdown（按 noteId）——读保存时生成的文本缓存，无需打开编辑器 */
  const copyMarkdownById = useCallback(async (noteId: string | null) => {
    if (!noteId) { showNotice("该节点不是文档"); return; }
    try {
      const caches = await native.readNoteCaches(noteId);
      if (!caches.markdown) { showNotice("该文档还没有文本缓存，请先打开并保存一次"); return; }
      await navigator.clipboard.writeText(caches.markdown);
      showNotice("已复制 Markdown（" + caches.markdown.length + " 字符）");
    } catch (reason) {
      setError("复制 Markdown 失败: " + (getNativeErrorMessage(reason)));
    }
  }, [showNotice]);

  /**
   * M1：收口导出（按 noteId）——右键「导出」子菜单统一入口。
   * doc：markdown/html/pdf；bitable：csv / zip（活动数据表）；usheet：csv（活动工作表）/ xlsx（全部工作表）；board：png/svg（画板内导出）。
   * 原生 Lake 导出已按用户要求**彻底移除**。
   */
  const exportNoteById = useCallback(async (noteId: string | null, format: ExportFormat) => {
    if (!noteId) { showNotice("该节点不是文档"); return; }
    // 画板 PNG/SVG：转给画板内已有的导出（走浏览器下载，不需要系统目录框）。
    // 必须放在 nativeDialog 守卫之前：浏览器端这条路径本来就能用。
    if (format === "png" || format === "svg") {
      const ok = await exportBoardImage(noteId, format);
      showNotice(ok
        ? `已导出 ${format.toUpperCase()}（系统下载目录）`
        : "请先打开画板再导出（画板工具栏里也有「导出 SVG / PNG」）");
      return;
    }
    // 浏览器端：导出靠系统目录选择框（宿主专属），暂不支持 —— 明确提示，不弹桌面弹窗
    if (!native.capabilities.nativeDialog) { showNotice("浏览器端暂不支持导出（请在桌面端操作）"); return; }
    try {
      const dir = await native.pickExportDir();
      if (!dir) return; // 用户取消
      if (format === "csv") {
        // 表格类统一入口：多维表 = 活动数据表；表格 = 当前打开的工作表（没打开 ⇒ 后端回退第一张并在提示里写明表名）。
        const result = await native.exportTableCsv(noteId, dir, usheetActiveSheetId(noteId) ?? undefined);
        showNotice(result.sheetName
          ? `已导出 CSV：${result.exportPath}（工作表「${result.sheetName}」，${result.rowCount} 行）`
          : `已导出 CSV：${result.exportPath}（${result.rowCount} 条记录）`);
        return;
      }
      if (format === "xlsx") {
        const result = await native.exportUsheetXlsx(noteId, dir);
        const skippedText = result.skipped > 0 ? `（${result.skipped} 张图片缺失已跳过）` : "";
        showNotice(`已导出 Excel：${result.exportPath}（${result.sheetCount} 个工作表，${result.rowCount} 行，${result.imageCount} 张图片内嵌${skippedText}）`);
        return;
      }
      if (format === "zip") {
        const result = await native.exportBitableZip(noteId, dir);
        const skippedText = result.skipped > 0 ? `（${result.skipped} 个附件缺失已跳过）` : "";
        showNotice(`已导出压缩包：${result.exportPath}（${result.fileCount} 个附件${skippedText}）`);
        return;
      }
      const result = await native.exportNote(noteId, format, dir);
      const skippedText = result.skipped > 0 ? `（${result.skipped} 张图片缺失已跳过）` : "";
      if (format === "markdown") {
        showNotice(`已导出 Markdown 资料包到 ${result.exportPath}（${result.imageCount} 张图片${skippedText}）`);
      } else if (format === "html") {
        showNotice(`已导出 HTML：${result.exportPath}（${result.imageCount} 张图片${skippedText}）`);
      } else if (format === "docx") {
        showNotice(`已导出 Word：${result.exportPath}（${result.imageCount} 张图片内嵌${skippedText}）`);
      } else {
        showNotice(`已导出 PDF：${result.exportPath}（${result.imageCount} 张图片内嵌${skippedText}）`);
      }
    } catch (reason) {
      setError("导出失败: " + (getNativeErrorMessage(reason)));
    }
  }, [showNotice]);

  /** M1：复制资料路径（按 noteId）——标题 + .lake 绝对路径 + 图片目录绝对路径 */
  const copyPathsById = useCallback(async (noteId: string | null) => {
    if (!noteId) { showNotice("该节点不是文档"); return; }
    try {
      const info = await native.getNotePaths(noteId);
      const text = `标题：${info.title}\n正文：${info.lakePath}\n图片目录：${info.assetsDir}`;
      await navigator.clipboard.writeText(text);
      showNotice("已复制资料路径（本机 AI 可读）");
    } catch (reason) {
      setError("复制资料路径失败: " + (getNativeErrorMessage(reason)));
    }
  }, [showNotice]);

  /** M1.6：设置/清除文档或分组的自定义图标 */
  const setNodeIcon = useCallback(async (node: TreeNode, icon: string | null) => {
    try {
      const updated = await native.setNodeIcon(node.id, icon);
      setTreeNodes(replaceTreeNode(updated));
      showNotice(icon ? "已设置图标" : "已清除图标");
    } catch (reason) {
      setError("设置图标失败: " + (getNativeErrorMessage(reason)));
    }
  }, [showNotice]);

  // 文档右键（TreeNode 版）包装
  const copyMarkdownFromCache = useCallback((node: TreeNode) => void copyMarkdownById(node.noteFileId), [copyMarkdownById]);
  const exportAs = useCallback((node: TreeNode, format: ExportFormat) => void exportNoteById(node.noteFileId, format), [exportNoteById]);
  const copyNotePaths = useCallback((node: TreeNode) => void copyPathsById(node.noteFileId), [copyPathsById]);

  return { copyMarkdownById, exportNoteById, copyPathsById, setNodeIcon, copyMarkdownFromCache, exportAs, copyNotePaths };
}

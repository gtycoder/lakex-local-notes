import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { replaceTreeNode } from "../desktop/desktopTypes";
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

  /** M1：收口导出（按 noteId）——右键「导出」子菜单所有格式统一入口（markdown/html/lake/pdf；word 待实现） */
  const exportNoteById = useCallback(async (noteId: string | null, format: "markdown" | "html" | "lake" | "pdf") => {
    if (!noteId) { showNotice("该节点不是文档"); return; }
    // 浏览器端：导出靠系统目录选择框（宿主专属），暂不支持 —— 明确提示，不弹桌面弹窗
    if (!native.capabilities.nativeDialog) { showNotice("浏览器端暂不支持导出（请在桌面端操作）"); return; }
    try {
      const dir = await native.pickExportDir();
      if (!dir) return; // 用户取消
      const result = await native.exportNote(noteId, format, dir);
      const skippedText = result.skipped > 0 ? `（${result.skipped} 张图片缺失已跳过）` : "";
      if (format === "markdown") {
        showNotice(`已导出 Markdown 资料包到 ${result.exportPath}（${result.imageCount} 张图片${skippedText}）`);
      } else if (format === "html") {
        showNotice(`已导出 HTML：${result.exportPath}（${result.imageCount} 张图片${skippedText}）`);
      } else if (format === "pdf") {
        showNotice(`已导出 PDF：${result.exportPath}（${result.imageCount} 张图片内嵌${skippedText}）`);
      } else {
        showNotice(`已导出原生 Lake：${result.exportPath}（${result.imageCount} 张图片内嵌${skippedText}）`);
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
  const exportAs = useCallback((node: TreeNode, format: "markdown" | "html" | "lake" | "pdf") => void exportNoteById(node.noteFileId, format), [exportNoteById]);
  const copyNotePaths = useCallback((node: TreeNode) => void copyPathsById(node.noteFileId), [copyPathsById]);

  return { copyMarkdownById, exportNoteById, copyPathsById, setNodeIcon, copyMarkdownFromCache, exportAs, copyNotePaths };
}

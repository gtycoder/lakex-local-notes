/**
 * 目录栏导入（261106 task-85）：选文件 → 分类/校验 → 串行转换落盘 → 进度/停止/结果。
 *
 * D-04①（261125 审计终审批次）：从 components/app/Sidebar.tsx 纯搬家（零行为变化）。
 * 语义指针：不支持 / 超 20MB / 读失败直接计入「跳过」；取消 = AbortController，取消项在结果里记
 * 「已取消」；结束后刷新目录树并 reveal 目标父级（目录栏自己的滚动容器，内部不用 scrollIntoView，
 * 见 Sidebar 的 scrollRowIntoView 注释）。目标父级 = 触发「＋」的节点最近的笔记本/分组容器。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ImportPickedFileShape, ImportPickerKind, TreeNode } from "../lib/types";
import type { UsheetWorkbook } from "../core/usheetDoc";
import { createNotesFromImportBatch, type FileImportItem } from "../features/import/fileImportBatch";
import { createDesktopMarkdownImportHost } from "../features/import/markdownImportDesktop";
import { convertMarkdownToLake } from "../features/import/markdownImportPipeline";
import { convertHtmlToLake } from "../features/import/htmlImportPipeline";
import type { ImportResultItem } from "../components/app/ImportResultDialog";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { native } from "../lib/native";

export interface UseSidebarImportOptions {
  nodes: TreeNode[];
  /** 刷新目录树（从库里重读整棵树）：导入落盘后 UI 目录可能滞后。 */
  onRefreshTree: () => void | Promise<void>;
  /** 导入结束后的定位入口（ref 语义：rAF 回调里取最新闭包，与原实现一致）。 */
  revealNodeRef: { current: (id: string | null, options?: { expandSelf?: boolean }) => void };
  /** 打开 picker 前收起目录栏自身的浮层（头部「＋」菜单 / 行「＋」菜单 / 右键菜单）。 */
  closeImportOverlays: () => void;
}

/** 导入结果汇总（成功数 + 跳过/失败逐条 + warnings）。 */
export interface SidebarImportResult {
  success: number;
  skipped: ImportResultItem[];
  failed: ImportResultItem[];
  warnings: string[];
}

const baseNameOf = (path: string): string => path.replace(/\\/g, "/").split("/").pop() || path;

export function useSidebarImport({ nodes, onRefreshTree, revealNodeRef, closeImportOverlays }: UseSidebarImportOptions) {
  /** Markdown 导入（261106 task-85）：进度浮层 / 结果汇总 / 中止句柄。 */
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; current: string | null } | null>(null);
  const [importStopping, setImportStopping] = useState(false);
  const [importResult, setImportResult] = useState<SidebarImportResult | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);

  const byIdRef = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  /** 目标父级 = 触发/当前节点最近的「笔记本或分组」容器（根级文档沿祖先链找）；找不到 ⇒ null（禁用并提示）。 */
  const containerAncestorOf = useCallback((id: string | null): string | null => {
    if (!id) return null;
    let cursor = byIdRef.get(id);
    while (cursor) {
      if (cursor.nodeType === "notebook" || cursor.nodeType === "group") return cursor.id;
      cursor = cursor.parentId ? byIdRef.get(cursor.parentId) : undefined;
    }
    return null;
  }, [byIdRef]);

  /** 选中的文件 → 批量导入：不支持的/超 20MB/读失败 直接计入「跳过」；其余串行转换落盘。 */
  const runImport = useCallback(async (targetId: string, picked: readonly ImportPickedFileShape[]) => {
    const skipped: ImportResultItem[] = [];
    const items: FileImportItem[] = [];
    const warnings: string[] = [];
    for (const file of picked) {
      const label = file.relativePath || file.name;
      if (!file.supported) { skipped.push({ name: label, reason: "不支持的文件类型" }); continue; }
      if (file.tooLarge) { skipped.push({ name: label, reason: "超过 20MB" }); continue; }
      if (file.error) { skipped.push({ name: label, reason: "读取失败：" + file.error }); continue; }
      const common = { path: file.path, name: file.name, relativePath: file.relativePath || file.name };
      if (file.kind === "markdown" && typeof file.markdown === "string") {
        items.push({ kind: "markdown", ...common, markdown: file.markdown });
      } else if (file.kind === "docx" && typeof file.html === "string") {
        items.push({ kind: "docx", ...common, html: file.html });
      } else if ((file.kind === "xlsx" || file.kind === "csv") && file.workbook) {
        items.push({ kind: "sheet", ...common, workbook: file.workbook as unknown as UsheetWorkbook });
      } else {
        skipped.push({ name: label, reason: "文件内容解析为空" });
        continue;
      }
      if (file.warnings?.length) warnings.push(...file.warnings.map((warning) => label + "：" + warning));
    }
    if (items.length === 0) {
      setImportResult({ success: 0, skipped, failed: [], warnings });
      return;
    }
    const controller = new AbortController();
    importAbortRef.current = controller;
    setImportStopping(false);
    setImportProgress({ done: 0, total: items.length, current: null });
    try {
      const result = await createNotesFromImportBatch({
        parentNotebookId: targetId,
        items,
        host: createDesktopMarkdownImportHost(),
        convertMarkdown: convertMarkdownToLake,
        convertHtml: (input) => convertHtmlToLake(input),
        signal: controller.signal,
        onProgress: (progress) => setImportProgress({ done: progress.index, total: progress.total, current: progress.path ? baseNameOf(progress.path) : null }),
      });
      const canceled = result.results.filter((entry) => !entry.ok && entry.reason === "导入已取消");
      const failed = result.results
        .filter((entry) => !entry.ok && entry.reason !== "导入已取消")
        .map((entry) => ({ name: baseNameOf(entry.path), reason: entry.reason ?? "未知原因" }));
      setImportResult({
        success: result.summary.done,
        skipped: [...skipped, ...canceled.map((entry) => ({ name: baseNameOf(entry.path), reason: "已取消" }))],
        failed,
        warnings: [...warnings, ...result.warnings],
      });
    } catch (error) {
      setImportResult({ success: 0, skipped, failed: [{ name: "导入", reason: getNativeErrorMessage(error) || "导入失败" }], warnings });
    } finally {
      importAbortRef.current = null;
      setImportProgress(null);
      setImportStopping(false);
      try { await Promise.resolve(onRefreshTree()); } catch { /* 刷新失败不影响已导入结果 */ }
      // 树刷新是异步 setState：等一帧再定位到目标父级（目录栏自己的滚动容器，内部不用 scrollIntoView）
      window.requestAnimationFrame(() => revealNodeRef.current(targetId));
    }
  }, [onRefreshTree, revealNodeRef]);

  const startImport = useCallback(async (targetId: string | null, kind: ImportPickerKind) => {
    if (!targetId || importProgress) return;
    closeImportOverlays();
    let picked: ImportPickedFileShape[] = [];
    try {
      picked = await native.pickImportFiles(kind);
    } catch (error) {
      setImportResult({ success: 0, skipped: [], failed: [{ name: "选择导入文件", reason: getNativeErrorMessage(error) || "无法打开文件选择器" }], warnings: [] });
      return;
    }
    // 用户取消 ⇒ 无副作用
    if (picked.length === 0) return;
    await runImport(targetId, picked);
  }, [importProgress, runImport, closeImportOverlays]);

  const cancelMarkdownImport = useCallback(() => {
    importAbortRef.current?.abort();
    setImportStopping(true);
  }, []);

  return {
    importProgress,
    importStopping,
    importResult,
    setImportResult,
    containerAncestorOf,
    startImport,
    cancelMarkdownImport,
  };
}

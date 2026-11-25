/**
 * 日记空间的 8 个 handleDiary*（261109 起，docs/DIARY.md 硬规则）：
 *  写今天 / 转为文档 / 新建某天 / 删除条目 / 日记本改名 / 日记本换图标 / 转为小记 / 日记内搜索。
 *
 * D-05（261125 审计终审批次）：从 src/App.tsx 纯搬家（零行为变化）；showNotice/setError 等调用面
 * 由 App 注入，原生调用面 native 可注入（缺省 = lib/native 单例，行为与原实现一致）。
 * 语义指针（AGENTS §3#25 / docs/DIARY.md）：日记本固定不可变，「改名/换图标」只开放日记本本体
 * （守卫在 store，非日记本本体一律拒绝）；「转为文档」= 移动 + 落标题（先 move 再 rename）；
 * 「转为小记」= 复制 + 原稿进回收站（可恢复）；删除条目复用目录树删除确认（软删可恢复）。
 */
import { useCallback } from "react";
import type { TreeNode } from "../lib/types";
import { formatDiaryDateKey, planDiaryConvert, planDiaryOpen } from "../core/diary";
import { documentIdOfTreeNode } from "../features/diary/diaryTree";
import { convertDiaryEntryToDocument } from "../features/diary/diaryConvert";
import { diaryOpenErrorMessage, requestDiaryOpenDate } from "../features/diary/diaryOpen";
import { diaryToQuickNoteNotice } from "../features/diary/diaryQuickNote";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { native as nativeModule } from "../lib/native";

/** 日记域用到的原生调用面（可注入；缺省 = lib/native 单例，注入面须保持稳定引用）。 */
type DiaryNativeApi = Pick<typeof nativeModule, "diaryOpenDate" | "diaryToQuickNote" | "renameTreeNode" | "setNodeIcon" | "moveTreeNode">;

export interface UseDiarySpaceHandlersOptions {
  treeNodes: TreeNode[];
  /** 打开文档（space: "diary" 时按日记空间打开）。 */
  openNote: (id: string, locateQuery?: string, newTab?: boolean, space?: "library" | "diary") => unknown;
  /** 刷新目录树（日记的笔记本/年组/月组只在重读后可见）。 */
  refreshTree: () => Promise<void>;
  showNotice: (text: string) => void;
  setError: (text: string | null) => void;
  /** 「删除」日记条目 = 复用目录树的删除确认（软删进回收站，可恢复）。 */
  sidebarRequestDelete: (node: TreeNode) => void;
  /** 日记内搜索 = 打开现有全局搜索面板（日记已在 FTS 里，不新增索引）。 */
  sidebarOpenSearch: () => void;
  /** 原生调用面注入点（缺省 = lib/native 单例；搬家前后调用文本不变）。 */
  native?: DiaryNativeApi;
}

export function useDiarySpaceHandlers(options: UseDiarySpaceHandlersOptions) {
  const {
    treeNodes, openNote, refreshTree, showNotice, setError,
    sidebarRequestDelete, sidebarOpenSearch,
  } = options;
  /** 原生调用面（注入优先；下面的代码与 App 原文逐字一致，只换宿主）。 */
  const native: DiaryNativeApi = options.native ?? nativeModule;

  /** 写「今天」：已存在就直接打开；否则走主进程 `diary_open_date`（单事务 ensure，连点只产生一篇）。
   *  IPC 未接线时**明确出声**，绝不静默失败、也不在渲染层自己建文档。 */
  const handleDiaryWriteToday = useCallback(async (dateKey: string) => {
    const todayKey = dateKey || formatDiaryDateKey();
    const plan = planDiaryOpen(treeNodes, todayKey);
    // core 的 existingNoteId 是**树节点 id**；打开文档要 noteFileId（两者不同，见 features/diary/diaryTree.ts）。
    const existingDocumentId = documentIdOfTreeNode(treeNodes, plan.existingNoteId);
    if (existingDocumentId) { await openNote(existingDocumentId); return; }
    const outcome = await requestDiaryOpenDate(todayKey);
    if (!outcome.ok) { showNotice(diaryOpenErrorMessage(outcome)); return; }
    // 树来自主进程（新建的 笔记本/年组/月组/文档 只有重读才可见），随后照既有方式打开。
    await refreshTree();
    await openNote(outcome.result.noteId);
  }, [treeNodes, openNote, refreshTree, showNotice]);

  /** 「转为文档」：把日记条目移到目标笔记本（**移动**，同一 note；正文/历史/回收站都跟着走）+ 落标题。
   *  判据（是否日记条目、目标是否合法）由 core.planDiaryConvert 给；动作顺序与失败可见由
   *  features/diary/diaryConvert 的单一实现负责（先 move 再 rename —— 日记条目不接受改名）。
   *  排序：追加到目标笔记本末尾（这不是排序动作，之后仍可在目录里拖）。 */
  const handleDiaryConvertEntry = useCallback((nodeId: string, targetNotebookId: string, title: string) => {
    const plan = planDiaryConvert(treeNodes, nodeId, targetNotebookId);
    if (!plan.ok) { setError("转为文档失败：目标位置或这篇日记已失效，请刷新后重试"); return; }
    void convertDiaryEntryToDocument({
      move: async (id, targetId) => {
        const nextOrder = treeNodes
          .filter((node) => node.parentId === targetId && node.id !== id)
          .reduce((max, node) => Math.max(max, node.sortOrder), -1) + 1;
        await native.moveTreeNode(id, targetId, nextOrder);
      },
      rename: async (id, nextTitle) => { await native.renameTreeNode(id, nextTitle); },
      refresh: refreshTree,
      notice: showNotice,
      error: setError,
    }, { nodeId, targetNotebookId, title, previousTitle: plan.entry.title });
  }, [treeNodes, refreshTree, showNotice, setError, native]);
  /** 新建某天的日记（261109：一天允许多篇）：走 IPC `mode:"new"`，建完刷新树并按**日记空间**打开。 */
  const handleDiaryCreateEntry = useCallback(async (dateKey: string) => {
    try {
      const result = await native.diaryOpenDate(dateKey, "new");
      await refreshTree();
      await openNote(result.noteId, "", false, "diary");
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }, [openNote, refreshTree, setError, native]);

  /** 「删除」日记条目：复用目录树的删除确认与 deleteTreeNode（软删进回收站，可恢复）。 */
  const handleDiaryDeleteEntry = useCallback((nodeId: string) => {
    const node = treeNodes.find((item) => item.id === nodeId);
    if (node) sidebarRequestDelete(node);
  }, [treeNodes, sidebarRequestDelete]);

  /** 日记本设置（261113 用户裁决：只开放改名/换图标）。守卫在 store：非日记本本身一律拒绝。 */
  const handleDiaryRenameNotebook = useCallback(async (notebookId: string, title: string) => {
    try {
      await native.renameTreeNode(notebookId, title);
      await refreshTree();
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }, [refreshTree, setError, native]);
  const handleDiarySetNotebookIcon = useCallback(async (notebookId: string, icon: string | null) => {
    try {
      await native.setNodeIcon(notebookId, icon);
      await refreshTree();
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }, [refreshTree, setError, native]);

  /** 「转为小记」（261112 task-92 起；261113 用户裁决 = **复制 + 原稿进回收站**，卡片零剥离）：
   *  主进程把同一篇日记的 Lake 正文复制成一条小记（媒体复制到小记作用域、引用改写），
   *  随后原日记软删进回收站（**可恢复**，原资产保留）。 */
  const handleDiaryToQuickNote = useCallback(async (nodeId: string) => {
    try {
      // 转换在主进程（同一份正文/资产移动 + 作用域改写 + Lake 侧移除）；渲染层只显示结果。
      const result = await native.diaryToQuickNote(nodeId);
      showNotice(diaryToQuickNoteNotice(result));
      await refreshTree();
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }, [refreshTree, setError, showNotice, native]);

  /** 日记内搜索入口 = 打开**现有**全局搜索面板（日记是文档，已在 FTS 里；不新增索引）。
   *  范围收窄 = 面板的 `scopeNoteIds`（App 搜索面板处传入 `diaryNoteIds`），纯显示层过滤。 */
  const handleDiaryOpenSearch = useCallback(() => { sidebarOpenSearch(); }, [sidebarOpenSearch]);

  return {
    handleDiaryWriteToday,
    handleDiaryConvertEntry,
    handleDiaryCreateEntry,
    handleDiaryDeleteEntry,
    handleDiaryRenameNotebook,
    handleDiarySetNotebookIcon,
    handleDiaryToQuickNote,
    handleDiaryOpenSearch,
  };
}

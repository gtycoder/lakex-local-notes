/**
 * 手写板页导航域（261125 D-06 拆分：从 InkPad.tsx 原样搬出，纯搬移零行为变化）。
 *
 * 职责：翻页 / 页面增删排序 / 页签（page.note）/ 纸张 / 阅读态滑动翻页 / 「页面」面板开合与视图。
 * 边界（改这里先读 docs/INK-PAD.md）：
 *  1. **切页是纯视图（P5）**：selectPage 只更新内存 activePageId，不序列化、不标脏、不排保存；
 *     v3 起「当前页」是设备本地导航（inkNav.ts），不写正文。
 *  2. 页面增删/排序/页签/纸张是**正文数据**：一次可撤销提交（commit + 页级补丁，见 useInkHistory）。
 *  3. 纸张预设与「PDF 页禁切纸张」判据是本域单一来源（BACKGROUNDS / isPdfPageBackground）。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction, type TouchEvent as ReactTouchEvent } from "react";
import { createInkPage, type InkBackground, type InkDoc, type InkPage } from "../../core/inkDoc.js";
import { inkOrderDelta, inkPagePatch, replacePage, type InkPatch } from "./history.js";
import { newInkId } from "./ids.js";
import { writeInkNavPage } from "./inkNav.js";
import type { InkPagesView } from "./InkPagesPanel.js";

export const BACKGROUNDS: ReadonlyArray<{ value: InkBackground; label: string }> = [
  { value: "blank", label: "空白" },
  { value: "lined", label: "横线" },
  { value: "grid", label: "网格" },
  { value: "dot", label: "点阵" },
];

/**
 * PDF 导入页：页图铺满整页 ⇒ 纸张底纹永远看不见。
 * 用户实测：PDF 页上切「横线/网格」画面毫无变化，却把文档标脏并触发保存（tab 上多一个未保存点）——
 * 无效操作 + 假脏，直接禁掉（不改数据，不写盘）。
 */
export function isPdfPageBackground(page: InkPage): boolean {
  const image = page.backgroundImage;
  if (!image) return false;
  return image.source === "pdf-page" || image.pdf !== undefined;
}

export interface InkPageNavDeps {
  doc: InkDoc | null;
  page: InkPage | null;
  docRef: MutableRefObject<InkDoc | null>;
  setDoc: Dispatch<SetStateAction<InkDoc | null>>;
  /** 唯一正文提交入口（useInkHistory）：patch=null = 本次改动不进撤销栈。 */
  commit: (next: InkDoc, patch: InkPatch | null) => void;
  readOnly: boolean;
  /** 设备本地「当前页」导航键（inkNav.ts）；不传 = 内存态。 */
  noteId?: string;
}

export interface InkPageNavState {
  pagesOpen: boolean;
  setPagesOpen: Dispatch<SetStateAction<boolean>>;
  /** 「页面」面板的视图（缩略图 / 大纲）：设备本地视图状态，不写正文。 */
  pagesView: InkPagesView;
  setPagesView: Dispatch<SetStateAction<InkPagesView>>;
  pendingDeletePageId: string | null;
  setPendingDeletePageId: Dispatch<SetStateAction<string | null>>;
  selectPage: (id: string) => void;
  switchPage: (delta: number) => void;
  movePage: (id: string, delta: -1 | 1) => void;
  movePageTo: (id: string, toIndex: number) => void;
  addPage: () => void;
  requestDeletePage: (id: string) => void;
  confirmDeletePage: () => void;
  /** 写页签：text 已 trim；空串 = 纯标记（字段存在、值为空），与「清除页签」是两件事。 */
  savePageNote: (text: string) => void;
  clearPageNote: () => void;
  setBackground: (background: InkBackground) => void;
  onStageTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => void;
  onStageTouchEnd: (event: ReactTouchEvent<HTMLDivElement>) => void;
  clearStageSwipe: () => void;
}

export function useInkPageNav({ doc, page, docRef, setDoc, commit, readOnly, noteId }: InkPageNavDeps): InkPageNavState {
  const [pagesOpen, setPagesOpen] = useState(false);
  /** 「页面」面板的视图（缩略图 / 大纲）：设备本地视图状态，不写正文。 */
  const [pagesView, setPagesView] = useState<InkPagesView>("thumbs");
  /** 大纲面板开合（页备注本身是正文数据，不需要额外状态）。 */
  const [pendingDeletePageId, setPendingDeletePageId] = useState<string | null>(null);
  /** 阅读态左右滑动翻页：记录单指起点（不参与绘制）。 */
  const swipeStartRef = useRef<{ x: number; y: number; id: number } | null>(null);

  // 261103 十三批：相邻页背景图「预解码」已实测否决（A/B：未预取 30.4ms vs 预取后 32.0ms 翻页，
  // 说明 30ms 级成本在 SVG/React 重渲染而不是图片 decode）⇒ 不留这段代码，避免无收益的复杂度。
  // 翻页/建页/删页/导入都会改内存 activePageId：同步到设备本地导航（不写正文、不标脏、不进 S3）。
  useEffect(() => {
    if (!noteId || !doc?.activePageId) return;
    writeInkNavPage(noteId, doc.activePageId);
  }, [doc?.activePageId, noteId]);

  useEffect(() => {
    if (!doc || !page) return;
    if (doc.activePageId !== page.id) {
      const next = { ...doc, activePageId: page.id };
      docRef.current = next;
      setDoc(next);
    }
  }, [doc, page]);

  const addPage = useCallback(() => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const nextPage = createInkPage(newInkId("page"), "blank");
    const next = { ...current, pages: [...current.pages, nextPage], activePageId: nextPage.id };
    const patch: InkPatch = inkPagePatch(null, nextPage);
    const order = inkOrderDelta(current.pages, next.pages);
    if (order) patch.order = order;
    commit(next, patch);
  }, [commit, readOnly]);

  const selectPage = useCallback((id: string) => {
    const current = docRef.current;
    if (!current || !current.pages.some((item) => item.id === id)) return;
    // 切页是纯视图（P5）：只更新内存 activePageId，不序列化、不标脏、不排保存。
    // 后续真实编辑保存时 activePageId 随正文一起写回；v3 起该字段移出正文（设备本地导航）。
    const updated = { ...current, activePageId: id };
    docRef.current = updated;
    setDoc(updated);
  }, []);

  const movePage = useCallback((id: string, delta: -1 | 1) => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const index = current.pages.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.pages.length) return;
    const pages = [...current.pages];
    const [moved] = pages.splice(index, 1);
    pages.splice(target, 0, moved);
    const order = inkOrderDelta(current.pages, pages);
    commit({ ...current, pages }, order ? { pages: [], order } : null);
  }, [commit, readOnly]);

  /** 页面排序（缩略图长按拖拽）：把某页移到 toIndex（= 移除它之后的目标下标），一次可撤销提交。 */
  const movePageTo = useCallback((id: string, toIndex: number) => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const index = current.pages.findIndex((item) => item.id === id);
    if (index < 0) return;
    const target = Math.max(0, Math.min(current.pages.length - 1, toIndex));
    if (target === index) return;
    const pages = [...current.pages];
    const [moved] = pages.splice(index, 1);
    pages.splice(target, 0, moved);
    const order = inkOrderDelta(current.pages, pages);
    commit({ ...current, pages }, order ? { pages: [], order } : null);
  }, [commit, readOnly]);

  /** 保存当前页备注（v4 正文数据：进撤销栈、标脏、随同步走；空串 = 删除备注）。 */
  /** 写页签：text 已 trim；**空串 = 纯标记**（字段存在、值为空），与「清除页签」是两件事。 */
  const savePageNote = useCallback((text: string) => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const before = current.pages.find((item) => item.id === current.activePageId);
    if (!before) return;
    const nextText = text.trim();
    if (before.note === nextText) return;
    const nextPage = { ...before, note: nextText };
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, readOnly]);

  /** 清除页签（删掉 note 字段 ⇒ 这一页又没有页签了）。 */
  const clearPageNote = useCallback(() => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const before = current.pages.find((item) => item.id === current.activePageId);
    if (!before || before.note === undefined) return;
    const nextPage = { ...before };
    delete nextPage.note;
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, readOnly]);

  const requestDeletePage = useCallback((id: string) => {
    if (readOnly) return;
    setPendingDeletePageId(id);
  }, [readOnly]);

  const confirmDeletePage = useCallback(() => {
    const current = docRef.current;
    const id = pendingDeletePageId;
    if (!current || !id || readOnly || current.pages.length <= 1) return;
    const index = current.pages.findIndex((item) => item.id === id);
    if (index < 0) { setPendingDeletePageId(null); return; }
    const removed = current.pages[index];
    const pages = current.pages.filter((item) => item.id !== id);
    const activePageId = current.activePageId === id
      ? pages[Math.max(0, index - 1)]?.id ?? pages[0]?.id
      : current.activePageId;
    setPendingDeletePageId(null);
    const patch: InkPatch = inkPagePatch(removed, null);
    const order = inkOrderDelta(current.pages, pages);
    if (order) patch.order = order;
    commit({ ...current, pages, activePageId }, patch);
  }, [commit, pendingDeletePageId, readOnly]);

  const switchPage = useCallback((delta: number) => {
    const current = docRef.current;
    if (!current) return;
    const index = current.pages.findIndex((item) => item.id === current.activePageId);
    const next = current.pages[Math.max(0, Math.min(current.pages.length - 1, index + delta))];
    if (!next || next.id === current.activePageId) return;
    selectPage(next.id);
  }, [selectPage]);

  const onStageTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (!readOnly || event.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
  }, [readOnly]);

  const clearStageSwipe = useCallback(() => {
    swipeStartRef.current = null;
  }, []);

  /** 只读态：单指横向滑动 ≥60px 且明显大于纵向位移 ⇒ 翻页（纯视图，不写正文）。 */
  const onStageTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!readOnly || !start || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    if (touch.identifier !== start.id) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    switchPage(dx < 0 ? 1 : -1);
  }, [readOnly, switchPage]);

  const setBackground = useCallback((background: InkBackground) => {
    const current = docRef.current;
    if (!current || !page || readOnly) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before) return;
    // PDF 页：底纹看不见 ⇒ 切换是无效操作，禁止标脏/写盘（按钮同时置灰）。
    if (isPdfPageBackground(before)) return;
    const nextPage = { ...before, background };
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page, readOnly]);

  return {
    pagesOpen, setPagesOpen, pagesView, setPagesView,
    pendingDeletePageId, setPendingDeletePageId,
    selectPage, switchPage, movePage, movePageTo, addPage,
    requestDeletePage, confirmDeletePage, savePageNote, clearPageNote,
    setBackground, onStageTouchStart, onStageTouchEnd, clearStageSwipe,
  };
}

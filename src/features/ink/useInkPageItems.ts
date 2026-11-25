/**
 * 手写板页内对象域（贴图 / 文字块）（261125 D-06 拆分：从 InkPad.tsx 原样搬出，纯搬移零行为变化）。
 *
 * 职责：页内贴图与文字块的插入 / 删除 / 缩放 / 文字编辑（双击进入、提交删空即删块）+ Delete/Backspace 删除选中。
 * 边界（改这里先读 docs/INK-PAD.md）：
 *  1. 页内对象是 **v4 正文数据**（进撤销栈、标脏、随同步走）：所有改动走一次可撤销提交（commit + inkPagePatch）。
 *  2. 缩放拖动的临时态只改内存（docRef + setDoc），松手才 commit 一次；取消/无改动回滚到 before 快照
 *     （对象拖动分支在 useInkTools.ts 的画布指针管线里，与落笔共用同一套 pointer 捕获与批次渲染纪律）。
 *  3. 选中态（selectedImageId / selectedTextId）由 useInkTools 的命中测试维护；本 hook 只消费与置换选中。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import type { InkDoc, InkPage } from "../../core/inkDoc.js";
import { inkPagePatch, replacePage, type InkPatch } from "./history.js";
import { newInkId } from "./ids.js";
import { INK_IMAGE_MIN_EDGE, placeInkPageImage, removePageImage, resizePageImage } from "./inkPageImages.js";
import { INK_TEXT_DEFAULT_FONT_SIZE, bumpPageTextFontSize, placeInkPageText, removePageText, resizePageText, updatePageText } from "./inkPageTexts.js";
import type { InkPadProps } from "./InkPad";

export interface InkPageItemsDeps {
  docRef: MutableRefObject<InkDoc | null>;
  setDoc: Dispatch<SetStateAction<InkDoc | null>>;
  /** 唯一正文提交入口（useInkHistory）：patch=null = 本次改动不进撤销栈。 */
  commit: (next: InkDoc, patch: InkPatch | null) => void;
  page: InkPage | null;
  readOnly: boolean;
  /** 当前笔/文字颜色（useInkTools）：新文字块的初始色。 */
  color: string;
  /** 画布选中态（useInkTools 命中测试维护）；插入/删除时按需置换选中。 */
  selectedImageId: string | null;
  setSelectedImageId: Dispatch<SetStateAction<string | null>>;
  selectedTextId: string | null;
  setSelectedTextId: Dispatch<SetStateAction<string | null>>;
  /** 插入页内贴图（宿主注入：选图 + 上传资产）；不注入 = 无插入入口。 */
  onInsertPageImage?: InkPadProps["onInsertPageImage"];
  /** 瞬时失败提示（宿主注入 toast 或板内横幅，见 InkPadProps.onTransientMessage）。 */
  notifyError: (text: string, options?: { append?: boolean }) => void;
}

export interface InkPageItemsState {
  /** v4 页内文字块：编辑中（草稿）。 */
  textEditing: { id: string; draft: string; original: string } | null;
  setTextEditing: Dispatch<SetStateAction<{ id: string; draft: string; original: string } | null>>;
  insertPageImage: () => Promise<void>;
  deleteSelectedImage: () => void;
  /** 贴图缩放手柄（锚点 = 左上角，保持宽高比；松手才 commit）。 */
  startImageResize: (event: ReactPointerEvent<HTMLElement>) => void;
  insertPageText: () => void;
  startTextEditing: (id: string) => void;
  commitPageText: () => void;
  removeText: (id: string) => void;
  /** 文字块右下角拖宽：拖动只改内存，松手 commit 一次（换行随之重排）。 */
  startTextResize: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  /** 字号 ±：一次可撤销提交。 */
  bumpTextFontSize: (id: string, delta: number) => void;
  deleteSelectedText: () => void;
}

export function useInkPageItems({
  docRef, setDoc, commit, page, readOnly, color,
  selectedImageId, setSelectedImageId, selectedTextId, setSelectedTextId,
  onInsertPageImage, notifyError,
}: InkPageItemsDeps): InkPageItemsState {
  /** v4 页内文字块：编辑中（草稿）。 */
  const [textEditing, setTextEditing] = useState<{ id: string; draft: string; original: string } | null>(null);
  /** 贴图缩放手柄拖动中（锚点 = 左上角，保持宽高比；松手才 commit）。 */
  const imageResizeRef = useRef<{ id: string; before: InkPage["images"]; startWidth: number; originX: number } | null>(null);

  /** 插入页内贴图：宿主选图上传 → 按「页宽 40%、居中」落到当前页（一次可撤销提交）。 */
  const insertPageImage = useCallback(async () => {
    if (!onInsertPageImage || readOnly) return;
    const current = docRef.current;
    if (!current || !page) return;
    try {
      const picked = await onInsertPageImage();
      if (!picked) return;
      const before = current.pages.find((item) => item.id === page.id);
      if (!before) return;
      const image = placeInkPageImage(before, { id: newInkId("img"), url: picked.url, naturalWidth: picked.naturalWidth, naturalHeight: picked.naturalHeight });
      const nextPage = { ...before, images: [...(before.images ?? []), image] };
      commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
      setSelectedImageId(image.id);
    } catch (reason) {
      notifyError("插入图片失败：" + (reason instanceof Error ? reason.message : String(reason)));
    }
  }, [commit, notifyError, onInsertPageImage, page, readOnly]);

  /** 删除选中的贴图（一次可撤销提交）。 */
  const deleteSelectedImage = useCallback(() => {
    const current = docRef.current;
    const id = selectedImageId;
    if (!current || !id || !page || readOnly) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before || !before.images?.some((image) => image.id === id)) return;
    const remaining = removePageImage(before, id);
    const nextPage = { ...before };
    if (remaining.length > 0) nextPage.images = remaining;
    else delete nextPage.images;
    setSelectedImageId(null);
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page, readOnly, selectedImageId]);

  /**
   * 贴图缩放手柄：拖动期间只改内存（docRef + setDoc），松手才 commit 一次；
   * 保持宽高比、锚点左上角、最小边 24（与 resizePageImage 的口径一致）。
   * 用 window 监听而不是 setPointerCapture：捕获会把事件重定向到句柄，后续 click 语义也跟着变（AGENTS §7.20）。
   */
  const startImageResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const id = selectedImageId;
    const current = docRef.current;
    if (!id || !current || !page || readOnly) return;
    const image = (page.images ?? []).find((item) => item.id === id);
    const frame = (event.currentTarget as HTMLElement).closest(".ink-page-frame") as HTMLElement | null;
    const rect = frame?.getBoundingClientRect();
    if (!image || !rect || rect.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    imageResizeRef.current = { id, before: page.images, startWidth: image.width, originX: image.x };
    const pageWidth = page.width;
    const restore = (): void => {
      const doc = docRef.current;
      const pageNow = doc?.pages.find((item) => item.id === page.id);
      if (!doc || !pageNow) return;
      const restoredPage = { ...pageNow };
      if (imageResizeRef.current?.before) restoredPage.images = imageResizeRef.current.before;
      else if (!imageResizeRef.current) return;
      const restored = replacePage(doc, restoredPage);
      docRef.current = restored;
      setDoc(restored);
    };
    const onMove = (moveEvent: PointerEvent): void => {
      const resizing = imageResizeRef.current;
      const doc = docRef.current;
      const pageNow = doc?.pages.find((item) => item.id === page.id);
      if (!resizing || !doc || !pageNow) return;
      const x = ((moveEvent.clientX - rect.left) / rect.width) * pageWidth;
      const scale = Math.max(INK_IMAGE_MIN_EDGE / resizing.startWidth, (x - resizing.originX) / resizing.startWidth);
      const images = resizePageImage({ ...pageNow, images: resizing.before }, resizing.id, scale);
      if (!images) return;
      const nextDoc = replacePage(doc, { ...pageNow, images });
      docRef.current = nextDoc;
      setDoc(nextDoc);
    };
    const cleanup = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    const onUp = (): void => {
      const resizing = imageResizeRef.current;
      cleanup();
      imageResizeRef.current = null;
      const doc = docRef.current;
      const pageNow = doc?.pages.find((item) => item.id === page.id);
      if (!resizing || !doc || !pageNow) return;
      const beforePage = { ...pageNow };
      if (resizing.before) beforePage.images = resizing.before;
      else delete beforePage.images;
      const changed = JSON.stringify(pageNow.images ?? []) !== JSON.stringify(resizing.before ?? []);
      if (changed) commit(replacePage(doc, pageNow), inkPagePatch(beforePage, pageNow));
      else {
        const restored = replacePage(doc, beforePage);
        docRef.current = restored;
        setDoc(restored);
      }
    };
    const onCancel = (): void => {
      cleanup();
      restore();
      imageResizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }, [commit, page, readOnly, selectedImageId]);

  /** 插入文字块：空文本先落盘再进入编辑（一次可撤销提交）。 */
  const insertPageText = useCallback(() => {
    const current = docRef.current;
    if (!current || !page || readOnly) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before) return;
    const text = placeInkPageText(before, { id: newInkId("txt"), width: 0, fontSize: INK_TEXT_DEFAULT_FONT_SIZE, color });
    const nextPage = { ...before, texts: [...(before.texts ?? []), text] };
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
    setSelectedImageId(null);
    setSelectedTextId(text.id);
    setTextEditing({ id: text.id, draft: "", original: "" });
  }, [color, commit, page, readOnly]);

  /** 开始编辑某段文字（双击进入）。 */
  const startTextEditing = useCallback((id: string) => {
    const current = docRef.current;
    if (!current || !page || readOnly) return;
    const item = (page.texts ?? []).find((entry) => entry.id === id);
    if (!item) return;
    setSelectedImageId(null);
    setSelectedTextId(id);
    setTextEditing({ id, draft: item.text, original: item.text });
  }, [page, readOnly]);

  /** 提交编辑：空文本且原来也空 ⇒ 删掉这个块；否则写回正文（一次可撤销提交）。 */
  const commitPageText = useCallback(() => {
    const editing = textEditing;
    setTextEditing(null);
    if (!editing) return;
    const current = docRef.current;
    if (!current || !page) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before || !(before.texts ?? []).some((item) => item.id === editing.id)) return;
    if (!editing.draft.trim() && !editing.original.trim()) {
      const remaining = removePageText(before, editing.id);
      const nextPage = { ...before };
      if (remaining.length > 0) nextPage.texts = remaining;
      else delete nextPage.texts;
      setSelectedTextId(null);
      commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
      return;
    }
    if (editing.draft === editing.original) return;
    const texts = updatePageText(before, editing.id, editing.draft);
    if (!texts) return;
    const nextPage = { ...before, texts };
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page, textEditing]);

  const removeText = useCallback((id: string) => {
    const current = docRef.current;
    if (!current || !page || readOnly) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before || !(before.texts ?? []).some((item) => item.id === id)) return;
    const remaining = removePageText(before, id);
    const nextPage = { ...before };
    if (remaining.length > 0) nextPage.texts = remaining;
    else delete nextPage.texts;
    setSelectedTextId(null);
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page, readOnly, selectedTextId]);

  /** 文字块右下角拖宽：拖动只改内存，松手 commit 一次（换行随之重排）。 */
  const startTextResize = useCallback((event: ReactPointerEvent<HTMLElement>, id: string) => {
    const current = docRef.current;
    if (!id || !current || !page || readOnly) return;
    const item = (page.texts ?? []).find((entry) => entry.id === id);
    const frame = (event.currentTarget as HTMLElement).closest(".ink-page-frame") as HTMLElement | null;
    const rect = frame?.getBoundingClientRect();
    if (!item || !rect || rect.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const before = page.texts;
    const pageWidth = page.width;
    const originX = item.x;
    const onMove = (moveEvent: PointerEvent): void => {
      const doc = docRef.current;
      const pageNow = doc?.pages.find((entry) => entry.id === page.id);
      if (!doc || !pageNow) return;
      const x = ((moveEvent.clientX - rect.left) / rect.width) * pageWidth;
      const texts = resizePageText({ ...pageNow, texts: before ?? pageNow.texts }, id, x - originX);
      if (!texts) return;
      const nextDoc = replacePage(doc, { ...pageNow, texts });
      docRef.current = nextDoc;
      setDoc(nextDoc);
    };
    const cleanup = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    const restore = (): void => {
      const doc = docRef.current;
      const pageNow = doc?.pages.find((entry) => entry.id === page.id);
      if (!doc || !pageNow || !before) return;
      const nextDoc = replacePage(doc, { ...pageNow, texts: before });
      docRef.current = nextDoc;
      setDoc(nextDoc);
    };
    const onUp = (): void => {
      cleanup();
      const doc = docRef.current;
      const pageNow = doc?.pages.find((entry) => entry.id === page.id);
      if (!doc || !pageNow || !before) return;
      const beforePage = { ...pageNow, texts: before };
      const changed = JSON.stringify(pageNow.texts ?? []) !== JSON.stringify(before ?? []);
      if (changed) commit(replacePage(doc, pageNow), inkPagePatch(beforePage, pageNow));
      else restore();
    };
    const onCancel = (): void => {
      cleanup();
      restore();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }, [commit, page, readOnly]);

  /** 字号 ±：一次可撤销提交。 */
  const bumpTextFontSize = useCallback((id: string, delta: number) => {
    const current = docRef.current;
    if (!current || !page || readOnly) return;
    const before = current.pages.find((entry) => entry.id === page.id);
    if (!before) return;
    const texts = bumpPageTextFontSize(before, id, delta);
    if (!texts || texts === before.texts) return;
    const nextPage = { ...before, texts };
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page, readOnly]);

  const deleteSelectedText = useCallback(() => {
    if (selectedTextId) removeText(selectedTextId);
  }, [removeText, selectedTextId]);

  // Delete/Backspace 删除选中元素（贴图或文字块；只在真有选中时挂监听，避免影响编辑器其它按键）
  useEffect(() => {
    if ((!selectedImageId && !selectedTextId) || readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      if (selectedImageId) deleteSelectedImage();
      else if (selectedTextId) deleteSelectedText();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelectedImage, deleteSelectedText, readOnly, selectedImageId, selectedTextId]);

  return {
    textEditing, setTextEditing,
    insertPageImage, deleteSelectedImage, startImageResize,
    insertPageText, startTextEditing, commitPageText, removeText, startTextResize,
    bumpTextFontSize, deleteSelectedText,
  };
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { bitablesToBody, type BitableDoc, type BitableTable } from "../../core/bitableDoc";
import { createSnapshotHistory } from "../../core/bitableHistory";
import type { EditorCaptureHandler } from "../../core/editorCapture";

const AUTOSAVE_DEBOUNCE_MS = 800;
type Update = (doc: BitableDoc) => BitableDoc;

/**
 * 正文序列化口径（261006 用户选 C）：**导航字段不参与** —— `activeTableId` 与每张表的 `activeViewId`
 * 一律写「第一张表 / 第一个视图」。导航现在是**设备本地 UI 状态**（`BitableEditor` 存 localStorage），
 * 所以切换数据表 / 视图不会改动正文 ⇒ 不落盘、不标脏、不进 S3；正文里的导航字段恒为默认值（惰性、不再是真相）。
 * 归一逻辑已收口到 core（`bitablesToBody` 内部走 `canonicalBitableNav`，CORE-05），
 * 桌面 / 移动端 / 将来任何写入口都只调这一份，不再各抄一遍 map。
 * 正文格式与移动端 / 搜索 / 导出共用同一份 core 序列化，未改字段结构（保持 `parseBitableBody` 可读旧数据）。
 */
function serializeBody(tables: BitableTable[]): string {
  return bitablesToBody(tables);
}

/** 一份文档的写入/导航/历史与发布。只读禁止新编辑，之前的输入另交草稿，不写回正文。 */
export function useBitableSession(initialDoc: () => BitableDoc, options: {
  readOnly: boolean;
  onChange: (content: string) => void;
  onPreserveDraft?: (content: string) => void;
  /** 审计 F15：用户一改动立即通知（早于内部 800ms 防抖），让外层 dirty / 关闭 / 退出及时看到。 */
  onDirty?: () => void;
  /** 审计 F15：注册按需同步序列化（关闭/保存/退出时现取），避免「改完 <800ms 就关」丢最后编辑。 */
  onEditorCapture?: EditorCaptureHandler;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const docRef = useRef(doc);
  const latest = useRef(options);
  latest.current = options;
  const [history] = useState(() => createSnapshotHistory<BitableTable[]>(100));
  const lastSerializedRef = useRef<string | null>(null);
  if (lastSerializedRef.current === null) lastSerializedRef.current = serializeBody(doc.tables);
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const pendingEditRef = useRef(false);
  const lastEditableRef = useRef(doc);
  const gestureRef = useRef<BitableTable[] | null>(null);

  const apply = useCallback((update: Update, edit: boolean) => {
    if (!mountedRef.current || (edit && latest.current.readOnly)) return;
    const prev = docRef.current;
    const next = update(prev);
    if (next === prev) return;
    if (edit && next.tables !== prev.tables && !gestureRef.current) history.push(prev.tables);
    docRef.current = next;
    if (!latest.current.readOnly) {
      lastEditableRef.current = next;
      pendingRef.current = true;
      if (edit) {
        pendingEditRef.current = true;
        latest.current.onDirty?.(); // 立即标脏（不等 800ms 内部防抖）
      }
    }
    setDoc(next);
  }, [history]);
  const updateDoc = useCallback((update: Update) => apply(update, true), [apply]);
  const navigateDoc = useCallback((update: Update) => apply(update, false), [apply]);

  const flushNow = useCallback(() => {
    if (!pendingRef.current) return;
    const current = lastEditableRef.current;
    const json = serializeBody(current.tables);
    if (json === lastSerializedRef.current) {
      pendingRef.current = false;
      pendingEditRef.current = false;
      return;
    }
    if (latest.current.readOnly) {
      // 只读导航无须备份。真正的未发布编辑必须由宿主接管，不能偷偷走 onChange。
      if (pendingEditRef.current) {
        if (!latest.current.onPreserveDraft) return;
        latest.current.onPreserveDraft(json);
      }
    } else latest.current.onChange(json);
    lastSerializedRef.current = json;
    pendingRef.current = false;
    pendingEditRef.current = false;
  }, []);

  useEffect(() => {
    if (options.readOnly || !pendingRef.current) return;
    const timer = window.setTimeout(flushNow, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc, options.readOnly, flushNow]);
  useLayoutEffect(() => {
    if (options.readOnly) flushNow();
  }, [options.readOnly, flushNow]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; flushNow(); };
  }, [flushNow]);

  // 审计 F15：注册按需同步序列化（关闭/保存/退出时现取），不依赖 800ms 内部防抖。
  const captureContent = useCallback((): string | null => {
    if (latest.current.readOnly) return null;
    const current = lastEditableRef.current;
    return serializeBody(current.tables);
  }, []);
  useEffect(() => {
    latest.current.onEditorCapture?.(captureContent);
    return () => { latest.current.onEditorCapture?.(null); };
  }, [captureContent]);

  const beginGesture = useCallback(() => {
    if (!latest.current.readOnly && !gestureRef.current) gestureRef.current = docRef.current.tables;
  }, []);
  const endGesture = useCallback(() => {
    const before = gestureRef.current;
    gestureRef.current = null;
    if (before && before !== docRef.current.tables) history.push(before);
  }, [history]);

  const restore = useCallback((redo: boolean) => {
    if (latest.current.readOnly) return;
    endGesture();
    const current = docRef.current;
    const tables = redo ? history.redo(current.tables) : history.undo(current.tables);
    if (!tables) return;
    // 历史回滚数据和视图配置，但不回滚仍有效的当前导航。
    const nextTables = tables.map((table) => {
      const activeViewId = current.tables.find((item) => item.id === table.id)?.activeViewId;
      return activeViewId && table.views.some((view) => view.id === activeViewId)
        ? { ...table, activeViewId } : table;
    });
    const next = { ...current, tables: nextTables, activeTableId: nextTables.some((table) => table.id === current.activeTableId) ? current.activeTableId : nextTables[0].id };
    docRef.current = next;
    lastEditableRef.current = next;
    pendingRef.current = true;
    pendingEditRef.current = true;
    setDoc(next);
  }, [history, endGesture]);
  const undoEdit = useCallback(() => restore(false), [restore]);
  const redoEdit = useCallback(() => restore(true), [restore]);
  return { doc, docRef, updateDoc, navigateDoc, beginGesture, endGesture, undoEdit, redoEdit };
}

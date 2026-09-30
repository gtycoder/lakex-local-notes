import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { bitablesToBody, type BitableDoc, type BitableTable } from "../../core/bitableDoc";
import { createSnapshotHistory } from "../../core/bitableHistory";

const AUTOSAVE_DEBOUNCE_MS = 800;
type Update = (doc: BitableDoc) => BitableDoc;

/** 一份文档的写入/导航/历史与发布。只读禁止新编辑，之前的输入另交草稿，不写回正文。 */
export function useBitableSession(initialDoc: () => BitableDoc, options: {
  readOnly: boolean;
  onChange: (content: string) => void;
  onPreserveDraft?: (content: string) => void;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const docRef = useRef(doc);
  const latest = useRef(options);
  latest.current = options;
  const [history] = useState(() => createSnapshotHistory<BitableTable[]>(100));
  const lastSerializedRef = useRef<string | null>(null);
  if (lastSerializedRef.current === null) lastSerializedRef.current = bitablesToBody(doc.tables, doc.activeTableId);
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
      if (edit) pendingEditRef.current = true;
    }
    setDoc(next);
  }, [history]);
  const updateDoc = useCallback((update: Update) => apply(update, true), [apply]);
  const navigateDoc = useCallback((update: Update) => apply(update, false), [apply]);

  const flushNow = useCallback(() => {
    if (!pendingRef.current) return;
    const current = lastEditableRef.current;
    const json = bitablesToBody(current.tables, current.activeTableId);
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

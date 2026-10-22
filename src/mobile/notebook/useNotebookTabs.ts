import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectEvictionIds } from "../../core/tabLimit";
import type { NoteKind } from "../../core/noteKind";
import { loadSettings } from "../../lib/settings";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import type { LocalNote } from "../data/noteRepository";

export interface NotebookTab {
  id: string;
  title: string;
  content: string;
  editing: boolean;
  loaded: boolean;
  lastAccessedAt: number;
  kind: NoteKind;
}

export interface OpenNotebookTabOptions {
  activate?: boolean;
  enterEditor?: boolean;
  load?: boolean;
}

export function notebookTabsStorageKey(notebookId: string): string {
  return "local-lakex-notes-mobile.tabs." + notebookId;
}

interface UseNotebookTabsOptions {
  notebookId: string;
  initialNoteId?: string | null;
  getTitle: (id: string) => string | undefined;
  readBody: (id: string) => Promise<LocalNote | null>;
  onReadError: (reason: unknown) => void;
  onMissing: () => void;
  /** 编辑器实例、capture 等 tab 外部资源；关闭或 LRU 淘汰时同步释放。 */
  onDrop?: (id: string) => void;
}

/** NotebookWorkspace 的标签会话所有者：tabs / active / loaded / mounted / LRU / 关闭全部。 */
export function useNotebookTabs(opts: UseNotebookTabsOptions) {
  const [tabs, setTabs] = useState<NotebookTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(opts.initialNoteId ?? null);
  const [mountedIds, setMountedIds] = useState<Set<string>>(() => new Set());
  const [freshId, setFreshId] = useState<string | null>(null);
  const [readTick, setReadTick] = useState(0);

  const tabsRef = useRef<NotebookTab[]>([]);
  const activeIdRef = useRef<string | null>(activeId);
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const tabEpochRef = useRef(0);
  const previousTabIdsRef = useRef<Set<string>>(new Set());
  const getTitleRef = useRef(opts.getTitle);
  const readBodyRef = useRef(opts.readBody);
  const onReadErrorRef = useRef(opts.onReadError);
  const onMissingRef = useRef(opts.onMissing);
  const onDropRef = useRef(opts.onDrop);

  tabsRef.current = tabs;
  activeIdRef.current = activeId;
  getTitleRef.current = opts.getTitle;
  readBodyRef.current = opts.readBody;
  onReadErrorRef.current = opts.onReadError;
  onMissingRef.current = opts.onMissing;
  onDropRef.current = opts.onDrop;

  /** 只给真正激活的标签读正文；恢复历史标签时先建占位，不并发预读。 */
  const loadTabBody = useCallback((id: string): Promise<void> => {
    const current = tabsRef.current.find((tab) => tab.id === id);
    if (pendingIdsRef.current.has(id) || current?.loaded) return Promise.resolve();
    pendingIdsRef.current.add(id);
    setReadTick((tick) => tick + 1);
    const epoch = tabEpochRef.current;
    return readBodyRef.current(id).then((note) => {
      if (epoch !== tabEpochRef.current) return;
      if (!note) {
        setTabs((prev) => prev.filter((tab) => tab.id !== id));
        pendingIdsRef.current.delete(id);
        if (activeIdRef.current === id) {
          activeIdRef.current = null;
          setActiveId(null);
        }
        onMissingRef.current();
        return;
      }
      setFreshId(id);
      window.setTimeout(() => setFreshId((cur) => (cur === id ? null : cur)), 260);
      setTabs((prev) => prev.map((tab) => tab.id === id
        ? { ...tab, title: note.title, content: note.content, kind: note.kind, loaded: true, lastAccessedAt: Date.now() }
        : tab));
    }).catch((reason) => {
      onReadErrorRef.current(reason);
    }).finally(() => {
      pendingIdsRef.current.delete(id);
      setReadTick((tick) => tick + 1);
    });
  }, []);

  const openTab = useCallback((id: string, options: OpenNotebookTabOptions = {}): Promise<void> => {
    const activate = options.activate ?? true;
    const enterEditor = options.enterEditor ?? false;
    const load = options.load ?? activate;
    if (activate) {
      activeIdRef.current = id;
      setActiveId(id);
    }
    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === id);
      const next = existing
        ? prev.map((tab) => tab.id === id
          ? { ...tab, editing: enterEditor ? true : tab.editing, lastAccessedAt: Date.now() }
          : tab)
        : [...prev, {
            id,
            title: getTitleRef.current(id) || "无标题文档",
            content: "",
            editing: activate && enterEditor,
            loaded: false,
            lastAccessedAt: Date.now(),
            kind: "doc" as const,
          }];
      const evicted = selectEvictionIds(next.map((tab) => ({ noteId: tab.id, lastAccessedAt: tab.lastAccessedAt })), {
        limit: loadSettings().maxOpenTabs,
        activeNoteId: activeIdRef.current,
        pinnedNoteIds: new Set(),
      });
      if (evicted.length === 0) return next;
      const evictedSet = new Set(evicted);
      return next.filter((tab) => !evictedSet.has(tab.id));
    });
    return load ? loadTabBody(id) : Promise.resolve();
  }, [loadTabBody]);

  const removeTab = useCallback((id: string) => {
    const current = tabsRef.current;
    const index = current.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const next = current.filter((tab) => tab.id !== id);
    setTabs(next);
    pendingIdsRef.current.delete(id);
    if (activeIdRef.current === id) {
      const nextActive = next.length ? next[Math.min(index, next.length - 1)].id : null;
      activeIdRef.current = nextActive;
      setActiveId(nextActive);
    }
  }, []);

  const clearTabs = useCallback(() => {
    tabEpochRef.current += 1;
    pendingIdsRef.current.clear();
    setTabs([]);
    activeIdRef.current = null;
    setActiveId(null);
    setFreshId(null);
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<Omit<NotebookTab, "id">>) => {
    setTabs((prev) => prev.map((tab) => tab.id === id ? { ...tab, ...patch } : tab));
  }, []);

  const active = useMemo(() => tabs.find((tab) => tab.id === activeId) ?? null, [tabs, activeId]);

  // 标签保持：打开标签变化即落本地（仅本机，不参与同步）
  const tabsKey = notebookTabsStorageKey(opts.notebookId);
  useEffect(() => { writeLocalStorage(tabsKey, JSON.stringify(tabs.map((tab) => tab.id))); }, [tabs, tabsKey]);

  // 活动页悬空自愈：没有标签且没有在途读取时收回 activeId；其余情况落到第一个标签。
  useEffect(() => {
    if (tabs.length === 0) {
      if (activeId && !pendingIdsRef.current.has(activeId)) {
        activeIdRef.current = null;
        setActiveId(null);
      }
      return;
    }
    if (activeId && tabs.some((tab) => tab.id === activeId)) return;
    if (activeId && pendingIdsRef.current.has(activeId)) return;
    activeIdRef.current = tabs[0].id;
    setActiveId(tabs[0].id);
  }, [activeId, tabs, readTick]);

  // 活动页首次加载完成后才挂正文；挂过即保持 keep-alive。
  useEffect(() => {
    if (!active?.loaded) return;
    setMountedIds((prev) => prev.has(active.id) ? prev : new Set(prev).add(active.id));
  }, [active?.id, active?.loaded]);

  useEffect(() => {
    const ids = new Set(tabs.map((tab) => tab.id));
    for (const id of previousTabIdsRef.current) {
      if (!ids.has(id)) onDropRef.current?.(id);
    }
    previousTabIdsRef.current = ids;
    setMountedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [tabs]);

  return {
    tabs,
    tabsRef,
    active,
    activeId,
    mountedIds,
    freshId,
    openTab,
    loadTabBody,
    removeTab,
    clearTabs,
    updateTab,
  };
}

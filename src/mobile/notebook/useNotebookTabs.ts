import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectEvictionIds } from "../../core/tabLimit";
import type { NoteKind } from "../../core/noteKind";
import { loadSettings } from "../../lib/settings";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import type { LocalNote } from "../data/noteRepository";
// 标签存档键的单一来源 = tabSessionCleanup（冷启动/删笔记本清理共用同一份键格式）；
// 这里 re-export 保既有调用方（tabRestore 测试等）不变。
import { notebookTabsActiveStorageKey, notebookTabsStorageKey } from "./tabSessionCleanup";
export { notebookTabsActiveStorageKey, notebookTabsStorageKey };

export interface NotebookTab {
  id: string;
  title: string;
  content: string;
  editing: boolean;
  loaded: boolean;
  lastAccessedAt: number;
  kind: NoteKind;
  /** 编辑锁（桌面端锁定）：移动端必须只读 —— 强制退出编辑态、不给编辑入口（task-56 N4）。 */
  editLocked?: boolean;
}

export interface OpenNotebookTabOptions {
  activate?: boolean;
  enterEditor?: boolean;
  load?: boolean;
}

/** 读上次保存的标签 id（**只读**；损坏/无存储 ⇒ []）。恢复顺序由 workspace 过滤后交给 restore()。 */
function readSavedNotebookTabIds(notebookId: string): string[] {
  try {
    const raw = localStorage.getItem(notebookTabsStorageKey(notebookId));
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

/** 读上次保存的活动页 id（**只读**；缺失/空串/损坏 ⇒ null ⇒ 调用方回落列表最后一个）。 */
function readSavedNotebookActiveId(notebookId: string): string | null {
  try {
    const raw = localStorage.getItem(notebookTabsActiveStorageKey(notebookId));
    return raw ? raw : null;
  } catch {
    return null;
  }
}

/** 清 localStorage key：存储被禁用/隐私模式只 warn，不影响交互（读路径拿不到等同不存在）。 */
function removeLocalStorageKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`[prefs] 删除 localStorage 失败：${key}`, error);
  }
}

/** 恢复/初始占位标签：正文未读（loaded=false），lastAccessedAt 用递增序号 —— 都比之后新开的标签旧（LRU 先淘汰它们）。 */
function placeholderTab(id: string, title: string, order: number): NotebookTab {
  return {
    id,
    title: title || "无标题文档",
    content: "",
    editing: false,
    loaded: false,
    lastAccessedAt: order,
    kind: "doc",
  };
}

interface UseNotebookTabsOptions {
  notebookId: string;
  initialNoteId?: string | null;
  getTitle: (id: string) => string | undefined;
  readBody: (id: string) => Promise<LocalNote | null>;
  onReadError: (reason: unknown) => void;
  /** 读不到正文（行不存在 / 正文文件缺失）：带上 noteId，宿主据此"每篇每会话只提示一次"。 */
  onMissing: (id: string) => void;
  /** 编辑器实例、capture 等 tab 外部资源；关闭或 LRU 淘汰时同步释放。 */
  onDrop?: (id: string) => void;
  /** 尝试编辑一篇「已锁定（桌面端锁）」的文档：宿主给可见提示（不静默）。 */
  onLockedEdit?: (id: string) => void;
}

/** NotebookWorkspace 的标签会话所有者：tabs / active / loaded / mounted / LRU / 关闭全部。 */
export function useNotebookTabs(opts: UseNotebookTabsOptions) {
  const tabsKey = notebookTabsStorageKey(opts.notebookId);
  const activeKey = notebookTabsActiveStorageKey(opts.notebookId);
  /**
   * 挂载时读一次存档，直接作为 tabs 的 **initial state**：
   * - 不再依赖「首次持久化 effect 跳过写」这种隐式约定（旧实现与 workspace 恢复 effect 有顺序耦合：
   *   一旦顺序变化/新增 effect，挂载首帧就会把上次存档写成 []，表现为「每次进笔记本只剩第一篇」）；
   * - 首帧写回的仍是同一份存档（幂等），之后的变化（含关闭全部写 []）照常落盘。
   */
  const savedIdsRef = useRef<string[] | null>(null);
  if (savedIdsRef.current === null) savedIdsRef.current = readSavedNotebookTabIds(opts.notebookId);
  const savedIds = savedIdsRef.current ?? [];
  /** 存档里的 active（旧格式 ⇒ null）。与 ids 同一次挂载只读一次（不能用 null 当「未读」哨兵）。 */
  const savedActiveRef = useRef<{ id: string | null } | null>(null);
  if (savedActiveRef.current === null) savedActiveRef.current = { id: readSavedNotebookActiveId(opts.notebookId) };
  const savedActiveId = savedActiveRef.current.id;
  const [tabs, setTabs] = useState<NotebookTab[]>(() => savedIds.map((id, i) => placeholderTab(id, opts.getTitle(id) ?? "", i)));
  // 261102 回归修复（用户报「退出时停在画板，重进却回到表格」）：优先恢复**上次退出时的活动页**；
  // 旧存档没有 active / active 已不在 ids 里（损坏或文档被删）⇒ 回落「列表最后一个」（旧行为）。
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (opts.initialNoteId) return opts.initialNoteId;
    if (savedActiveId && savedIds.includes(savedActiveId)) return savedActiveId;
    return savedIds.length > 0 ? savedIds[savedIds.length - 1] : null;
  });
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
  const onLockedEditRef = useRef(opts.onLockedEdit);

  tabsRef.current = tabs;
  activeIdRef.current = activeId;
  getTitleRef.current = opts.getTitle;
  readBodyRef.current = opts.readBody;
  onReadErrorRef.current = opts.onReadError;
  onMissingRef.current = opts.onMissing;
  onDropRef.current = opts.onDrop;
  onLockedEditRef.current = opts.onLockedEdit;

  /** 只给真正激活的标签读正文；恢复历史标签时先建占位，不并发预读。 */
  const loadTabBody = useCallback((id: string, force = false): Promise<void> => {
    const current = tabsRef.current.find((tab) => tab.id === id);
    if (pendingIdsRef.current.has(id) || (current?.loaded && !force)) return Promise.resolve();
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
        onMissingRef.current(id);
        return;
      }
      setFreshId(id);
      window.setTimeout(() => setFreshId((cur) => (cur === id ? null : cur)), 260);
      // 261112 task-56（N4）：锁信息在正文读出后才知道 ⇒ 一旦锁定就强制退出编辑态并给可见提示。
      if (note.editLocked) {
        const wasEditing = tabsRef.current.find((tab) => tab.id === id)?.editing === true;
        if (wasEditing) onLockedEditRef.current?.(id);
      }
      setTabs((prev) => prev.map((tab) => tab.id === id
        ? {
            ...tab, title: note.title, content: note.content, kind: note.kind, loaded: true, lastAccessedAt: Date.now(),
            editLocked: note.editLocked === true,
            editing: note.editLocked ? false : tab.editing,
          }
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
          ? {
              ...tab,
              // 已锁定（已知）的文档不允许进入编辑态：提示由宿主给，这里保持只读。
              editing: enterEditor ? (tab.editLocked ? false : true) : tab.editing,
              lastAccessedAt: Date.now(),
            }
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
    if (enterEditor) {
      const known = tabsRef.current.find((tab) => tab.id === id);
      if (known?.editLocked) onLockedEditRef.current?.(id);
    }
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

  /**
   * 批量移除标签（261114 task-8）：删除一篇文档会级联软删整棵子树 ⇒ 一次要关多个标签。
   * ⚠️ 不能循环调 removeTab：它读的 tabsRef 在重渲染前不变，同一次事件里多次调用会用同一份旧快照
   * 互相覆盖（实测：删 PARENT>CHILD>GRAND 后，被删文档的标签反而留在 tab 条上）。
   * 这里只做一次 setTabs + 一次 setActiveId（活动页被删时按"原位置之后的第一张"回落，与单张关闭一致）。
   */
  const removeTabs = useCallback((ids: readonly string[]) => {
    const drop = new Set(ids);
    if (drop.size === 0) return;
    const current = tabsRef.current;
    if (!current.some((tab) => drop.has(tab.id))) return;
    const activeId = activeIdRef.current;
    const activeIndex = activeId ? current.findIndex((tab) => tab.id === activeId) : -1;
    const next = current.filter((tab) => !drop.has(tab.id));
    for (const id of drop) pendingIdsRef.current.delete(id);
    setTabs(next);
    if (activeId && drop.has(activeId)) {
      // 与单张关闭同语义：落在被删活动页原位置之后的第一个保留标签（越界取最后一个；全删为 null）。
      const keptBefore = activeIndex < 0 ? 0 : current.slice(0, activeIndex).filter((tab) => !drop.has(tab.id)).length;
      const nextActive = next.length ? next[Math.min(keptBefore, next.length - 1)].id : null;
      activeIdRef.current = nextActive;
      setActiveId(nextActive);
    }
  }, []);

  /**
   * 恢复一份标签会话（**一次 setTabs + 一次 setActiveId**，不再逐个 openTab ⇒ 不会出现中间态顺序）：
   * workspace 负责按目录已知 id 过滤，hook 负责顺序/去重/上限/激活页。
   * 只建占位（不读正文）：活动页由既有的「活动页未加载则补读」effect 懒加载，其它页切到时再读。
   */
  const restore = useCallback((ids: string[], nextActiveId: string | null, options: { enterEditor?: boolean } = {}) => {
    const unique: string[] = [];
    for (const id of ids) if (id && !unique.includes(id)) unique.push(id);
    const active = nextActiveId && unique.includes(nextActiveId) ? nextActiveId : (unique.length > 0 ? unique[unique.length - 1] : null);
    tabEpochRef.current += 1;
    pendingIdsRef.current.clear();
    const evicted = selectEvictionIds(
      unique.map((id, i) => ({ noteId: id, lastAccessedAt: i })),
      { limit: loadSettings().maxOpenTabs, activeNoteId: active, pinnedNoteIds: new Set() },
    );
    const evictedSet = new Set(evicted);
    const restored = unique
      .filter((id) => !evictedSet.has(id))
      .map((id, i) => ({ ...placeholderTab(id, getTitleRef.current(id) ?? "", i), editing: options.enterEditor === true && id === active }));
    activeIdRef.current = active;
    setTabs(restored);
    setActiveId(active);
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

  // 标签保持：变化即落本地（仅本机，不参与同步）。首帧写回的 = initial state 里那份存档（幂等），
  // 因此不需要「首次跳过写」；关闭全部照常写 []（clearTabsOnExit 的语义仍由启动时清存档承担）。
  // 261102：ids 与 active **一起**写（companion key）—— 只存 ids 时，重启只能拿「列表最后一个」当活动页，
  // 而切换标签并不会把标签挪到数组末尾 ⇒ 用户停在非末尾那页时，重进就跳错文档（用户报的 bug）。
  // active 为空（关闭全部）时移除 companion key，不要写空串。
  useEffect(() => {
    writeLocalStorage(tabsKey, JSON.stringify(tabs.map((tab) => tab.id)));
    if (activeId) writeLocalStorage(activeKey, activeId);
    else removeLocalStorageKey(activeKey);
  }, [tabs, activeId, activeKey, tabsKey]);

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
    savedTabIds: savedIds,
    /** 存档里的活动页 id（旧格式/损坏 ⇒ null；workspace 原样交给 restore()，由它校验是否仍在该笔记本里）。 */
    savedTabActiveId: savedActiveId,
    active,
    activeId,
    mountedIds,
    freshId,
    openTab,
    restore,
    loadTabBody,
    removeTab,
    removeTabs,
    clearTabs,
    updateTab,
  };
}

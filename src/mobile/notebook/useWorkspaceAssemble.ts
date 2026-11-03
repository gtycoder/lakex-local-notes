import { useEffect, useRef } from "react";
import type { NotebookTab } from "./useNotebookTabs";
import type { NotebookTreeItem } from "./useNotebookTreeData";

/**
 * 工作区「首次组装」逻辑（261103 P11-②，原 NotebookWorkspace 内联代码逐字搬移，未改行为）：
 * 初次进入恢复/显式打开（autoOpenedRef 只做一次）、已进入后被再次指定文档、活动占位页懒读正文。
 * 三个 effect 的先后顺序与依赖数组逐字保留（restore 必须在首次 render 后；读取要等恢复决策落定）。
 */
export interface UseWorkspaceAssembleOptions {
  tree: NotebookTreeItem[];
  firstNote: NotebookTreeItem | null;
  savedTabIds: string[];
  savedTabActiveId: string | null;
  initialNoteId?: string | null;
  initialMode?: "viewer" | "editor";
  restore: (ids: string[], nextActiveId: string | null, options?: { enterEditor?: boolean }) => void;
  openTab: (id: string, options?: { enterEditor?: boolean }) => Promise<void>;
  active: NotebookTab | null;
  loadTabBody: (id: string, force?: boolean) => Promise<void>;
}

export function useWorkspaceAssemble(options: UseWorkspaceAssembleOptions) {
  const { tree, firstNote, savedTabIds, savedTabActiveId, initialNoteId, initialMode, restore, openTab, active, loadTabBody } = options;
  /** 只做一次「初次进入」决策（显式文档 / 存档恢复 / 树中第一篇）。 */
  const autoOpenedRef = useRef(false);

  // 初次进入（仅一次）：
  //  - 显式指定了要打开的文档（首页/搜索/新建）→ 它排第一并激活（修"从首页点文档直达不了"），
  //    其余上次已存的标签（不含它）按原顺序跟在后面，不覆盖它的激活态；
  //  - 否则恢复上次打开的标签（本地持久化 ids + companion active：优先回到**上次退出的活动页**，
  //    旧存档没有 active 时回落「列表最后一个」—— 261102 用户回归「退出停在画板，重进却回到表格」）；
  //  - 否则开树中第一个。
  // 这里只做「按目录已知 id 过滤」，顺序/上限/激活页全部交给 hook 的 restore()（一次 dispatch，
  // 不再靠 openTab 的调用顺序 + effect 执行顺序这种隐式协议）。
  useEffect(() => {
    if (autoOpenedRef.current) return;
    const knownNoteIds = new Set(tree.filter((item) => item.kind === "note").map((item) => item.id));
    const saved = savedTabIds.filter((id) => knownNoteIds.has(id) || id === initialNoteId);
    if (initialNoteId) {
      autoOpenedRef.current = true;
      restore([initialNoteId, ...saved.filter((id) => id !== initialNoteId)], initialNoteId, { enterEditor: initialMode === "editor" });
      return;
    }
    if (saved.length > 0) {
      autoOpenedRef.current = true;
      // 活动页交给存档里的 active（restore 会校验它仍在这批 id 里，否则回落最后一个）。
      restore(saved, savedTabActiveId);
      return;
    }
    if (firstNote) {
      autoOpenedRef.current = true;
      restore([firstNote.id], firstNote.id);
      return;
    }
    // 目录里没有任何可用文档：把存档里已失效的占位清掉（hook 的 initial state 可能还带着它们）。
    if (savedTabIds.length > 0) restore([], null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, firstNote, savedTabIds, savedTabActiveId, initialNoteId, initialMode, restore]);

  // 已进入工作区后又被指定文档（新建 / 首页 / 搜索）：组件 key 是 notebookId，
  // 同一笔记本内再指定文档不会重挂载，「初次进入」那段被 autoOpenedRef 挡住 ⇒ 必须在这里显式打开，
  // 否则会"文档建好了但界面不跳转"。
  const handledInitialRef = useRef<string | null>(initialNoteId ?? null);
  useEffect(() => {
    if (!initialNoteId || handledInitialRef.current === initialNoteId) return;
    handledInitialRef.current = initialNoteId;
    void openTab(initialNoteId, { enterEditor: initialMode === "editor" });
  }, [initialNoteId, initialMode, openTab]);

  /** 活动占位页统一在这里补读正文；openTab / 自愈 / 恢复都共用同一条懒加载路径。
   *  恢复决策（autoOpenedRef）落定前不读：initial state 还带着未按目录过滤的存档 id，
   *  抢先读可能读到已删文档并误弹「不存在」。 */
  useEffect(() => {
    if (!autoOpenedRef.current) return;
    if (!active || active.loaded) return;
    void loadTabBody(active.id);
  }, [active?.id, active?.loaded, loadTabBody]);
}

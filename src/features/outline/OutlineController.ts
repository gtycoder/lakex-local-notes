/**
 * 大纲控制器（应用自有，框架无关，纯 TS 可单测）。
 *
 * 设计要点（参考思源 Outline.ts + Lake 内核 toc 数据）：
 *  - 数据源：内核 `getDocExtraContent().toc`（扁平：{id,text,level,depth,type}）。
 *  - 树构建：用 depth（压缩级别）做父子嵌套，与 Lake 原生渲染语义一致；
 *    level（真实 h1-h6）保留用于级别展示。
 *  - 事件驱动更新：updateToc 重建树时保留仍存在的选中项与折叠集合；
 *    订阅方通过 subscribe/getVersion 感知变更（React 18 useSyncExternalStore）。
 *  - 折叠集合持久化：按 noteId 存 localStorage（注入 storage 以便单测）。
 */

export interface OutlineEntry {
  id: string;
  text: string;
  level: number; // 真实标题级别 1-6
  depth: number; // 压缩级别 1..N（Lake 内核给出）
  type?: string; // h1..h6
}

export interface OutlineNode {
  id: string;
  text: string;
  level: number;
  depth: number;
  parentId: string | null;
  children: OutlineNode[];
  hasChildren: boolean;
}

/**
 * 右侧栏形态：右侧 34px activity rail 始终常驻，rail 内的大纲按钮切换两态：
 *  - docked：独立宽度的大纲面板 + rail 占据右侧 grid，编辑器自适应收缩。
 *  - collapsed：仅保留 rail；hover rail 时，大纲面板从左侧以 overlay 预览。
 */
export type OutlineMode = "docked" | "collapsed";

export interface OutlineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): OutlineStorage | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    /* 无 localStorage 环境（单测/SSR） */
  }
  return null;
}

const storagePrefix = "local-lakex-notes:outline:collapsed:";

export class OutlineController {
  private roots: OutlineNode[] = [];
  private nodeMap = new Map<string, OutlineNode>();
  private collapsedIds = new Set<string>();
  private selectedId: string | null = null;
  private filterText = "";
  private keepCurrentExpand = false;
  private prefsStorageKey = "local-lakex-notes:outline:prefs";
  private version = 0;
  private listeners = new Set<() => void>();
  private storage: OutlineStorage | null;
  private storageKey: string;

  constructor(noteId: string, storage?: OutlineStorage | null) {
    this.storageKey = storagePrefix + noteId;
    this.storage = storage === undefined ? defaultStorage() : storage;
    this.loadCollapsed();
    this.loadPrefs();
  }

  // ---- 订阅（React useSyncExternalStore）----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* 单个订阅者异常不影响其他订阅者 */
      }
    }
  }

  // ---- 数据更新 ----
  updateToc(entries: OutlineEntry[]): void {
    const previousSelected = this.selectedId;
    const previousCollapsed = this.collapsedIds;

    this.roots = [];
    this.nodeMap.clear();
    this.collapsedIds = new Set();

    const byDepth = new Map<number, OutlineNode[]>();
    const lastAtDepth: OutlineNode[] = [];

    // 先建节点（按文档顺序）
    const ordered: OutlineNode[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!entry || !entry.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const node: OutlineNode = {
        id: entry.id,
        text: entry.text ?? "",
        level: entry.level,
        // 压缩深度理论上 ≤6（对应 h1-h6）；对异常/超大 depth 收敛到 6，
        // 防止 computeGuides / indent 按外部数据做无界循环或生成超大样式串。
        depth: Math.min(6, Math.max(1, entry.depth || 1)),
        parentId: null,
        children: [],
        hasChildren: false,
      };
      ordered.push(node);
      this.nodeMap.set(node.id, node);
      const arr = byDepth.get(node.depth) || [];
      arr.push(node);
      byDepth.set(node.depth, arr);
    }

    // 嵌套：depth 严格递增则成为上一个节点的子级；否则回溯到第一个更浅的层级
    const stack: OutlineNode[] = [];
    for (const node of ordered) {
      while (stack.length > 0 && stack[stack.length - 1].depth >= node.depth) {
        stack.pop();
      }
      const parent = stack.length > 0 ? stack[stack.length - 1] : null;
      if (parent) {
        node.parentId = parent.id;
        parent.children.push(node);
        parent.hasChildren = true;
      } else {
        this.roots.push(node);
      }
      stack.push(node);
    }

    // 折叠集合：只保留仍存在的 id
    for (const id of previousCollapsed) {
      if (this.nodeMap.has(id)) {
        this.collapsedIds.add(id);
      }
    }

    // 选中：仍存在则保留，否则清空
    if (previousSelected && this.nodeMap.has(previousSelected)) {
      this.selectedId = previousSelected;
    } else {
      this.selectedId = null;
    }

    void byDepth;
    void lastAtDepth;
    this.emit();
  }

  getRootItems(): OutlineNode[] {
    return this.roots;
  }

  getNode(id: string): OutlineNode | null {
    return this.nodeMap.get(id) || null;
  }

  /** 大纲条目总数（用于“无大纲则默认收起”等判定） */
  getEntryCount(): number {
    return this.nodeMap.size;
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit();
  }

  isCollapsed(id: string): boolean {
    return this.collapsedIds.has(id);
  }

  toggleCollapsed(id: string): void {
    const node = this.nodeMap.get(id);
    if (!node || !node.hasChildren) return;
    if (this.collapsedIds.has(id)) {
      this.collapsedIds.delete(id);
    } else {
      this.collapsedIds.add(id);
    }
    this.persistCollapsed();
    this.emit();
  }

  setCollapsed(id: string, collapsed: boolean): void {
    const node = this.nodeMap.get(id);
    if (!node || !node.hasChildren) return;
    let changed = false;
    if (collapsed) {
      if (!this.collapsedIds.has(id)) {
        this.collapsedIds.add(id);
        changed = true;
      }
    } else {
      changed = this.collapsedIds.delete(id);
    }
    if (!changed) return;
    this.persistCollapsed();
    this.emit();
  }

  expandAll(): void {
    if (this.collapsedIds.size === 0) return;
    this.collapsedIds.clear();
    this.persistCollapsed();
    this.emit();
  }

  collapseAll(): void {
    let changed = false;
    const visit = (node: OutlineNode): void => {
      if (node.hasChildren && !this.collapsedIds.has(node.id)) {
        this.collapsedIds.add(node.id);
        changed = true;
      }
      for (const child of node.children) visit(child);
    };
    for (const root of this.roots) visit(root);
    if (!changed) return;
    this.persistCollapsed();
    this.emit();
  }

  /** 展开到第 n 层（depth <= n 全部展开，更深层级折叠） */
  expandToLevel(n: number): void {
    let changed = false;
    const visit = (node: OutlineNode): void => {
      if (node.hasChildren) {
        if (node.depth < n && this.collapsedIds.has(node.id)) {
          this.collapsedIds.delete(node.id);
          changed = true;
        } else if (node.depth >= n && !this.collapsedIds.has(node.id)) {
          this.collapsedIds.add(node.id);
          changed = true;
        }
      }
      for (const child of node.children) visit(child);
    };
    for (const root of this.roots) visit(root);
    if (!changed) return;
    this.persistCollapsed();
    this.emit();
  }

  /** 当前可见条目（遵循折叠），文档序（前序）。筛选时只显示命中项及其祖先（自动展开）。 */
  getVisibleItems(): OutlineNode[] {
    if (this.filterText) {
      const matched = new Set<string>();
      const mark = (node: OutlineNode): void => {
        if (node.text.toLowerCase().includes(this.filterText)) {
          matched.add(node.id);
          let p = node.parentId;
          while (p) {
            matched.add(p);
            p = this.nodeMap.get(p)?.parentId || null;
          }
        }
        for (const child of node.children) mark(child);
      };
      for (const root of this.roots) mark(root);
      const result: OutlineNode[] = [];
      const visit = (node: OutlineNode): void => {
        if (!matched.has(node.id)) return;
        result.push(node);
        for (const child of node.children) visit(child);
      };
      for (const root of this.roots) visit(root);
      return result;
    }
    const result: OutlineNode[] = [];
    const visit = (node: OutlineNode): void => {
      result.push(node);
      if (node.hasChildren && !this.collapsedIds.has(node.id)) {
        for (const child of node.children) visit(child);
      }
    };
    for (const root of this.roots) visit(root);
    return result;
  }

  // ---- 筛选 ----
  setFilterText(text: string): void {
    const t = text.trim().toLowerCase();
    if (t === this.filterText) return;
    this.filterText = t;
    this.emit();
  }

  getFilterText(): string {
    return this.filterText;
  }

  // ---- 保持当前展开 ----
  setKeepCurrentExpand(value: boolean): void {
    if (value === this.keepCurrentExpand) return;
    this.keepCurrentExpand = value;
    this.persistPrefs();
    this.emit();
  }

  isKeepCurrentExpand(): boolean {
    return this.keepCurrentExpand;
  }


  /** 保持当前选中：展开其所有祖先（思源 keepCurrentExpand 思路） */
  expandAncestorsOf(id: string): boolean {
    const node = this.nodeMap.get(id);
    if (!node) return false;
    let changed = false;
    let parentId = node.parentId;
    while (parentId) {
      const parent = this.nodeMap.get(parentId);
      if (!parent) break;
      if (this.collapsedIds.has(parent.id)) {
        this.collapsedIds.delete(parent.id);
        changed = true;
      }
      parentId = parent.parentId;
    }
    if (changed) {
      this.persistCollapsed();
      this.emit();
    }
    return changed;
  }

  getAncestorIds(id: string): string[] {
    const result: string[] = [];
    let parentId = this.nodeMap.get(id)?.parentId || null;
    while (parentId) {
      result.unshift(parentId);
      parentId = this.nodeMap.get(parentId)?.parentId || null;
    }
    return result;
  }

  // ---- 持久化 ----
  private loadCollapsed(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.collapsedIds = new Set(parsed.filter((id): id is string => typeof id === "string"));
      }
    } catch {
      this.storage.removeItem(this.storageKey);
    }
  }

  private persistCollapsed(): void {
    if (!this.storage) return;
    try {
      if (this.collapsedIds.size === 0) {
        this.storage.removeItem(this.storageKey);
      } else {
        this.storage.setItem(this.storageKey, JSON.stringify([...this.collapsedIds]));
      }
    } catch {
      /* 持久化失败不影响运行 */
    }
  }

  private loadPrefs(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.prefsStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.keepCurrentExpand === "boolean") {
        this.keepCurrentExpand = parsed.keepCurrentExpand;
      }
    } catch {
      this.storage.removeItem(this.prefsStorageKey);
    }
  }

  private persistPrefs(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.prefsStorageKey, JSON.stringify({ keepCurrentExpand: this.keepCurrentExpand }));
    } catch {
      /* 持久化失败不影响运行 */
    }
  }
}

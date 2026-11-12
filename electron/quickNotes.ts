/**
 * 小记库门面（**保持既有导入路径不变**：所有 `./quickNotes.js` 仍指向这里）。
 *
 * 261112 拆分（05 报告 S-3）：QuickNotesStore 实现拆到 `electron/quickNotes/`
 * （schema / staging / savePipeline / trashLifecycle / searchIndex / tagLinks / missingBody / index
 *  + context 共享工具）。本文件只做 re-export 与**降级替身**（facade 级别的东西）——
 * **不要**在这里加业务实现（否则又会长回单文件）。
 */
import { AppError } from "../src/core/storeErrors.js";
import type { QuickNotesStore } from "./quickNotes/index.js";

export * from "./quickNotes/index.js";

/**
 * 「小记库不可用」降级替身（Batch3-A，261105）：**只在 QuickNotesStore 构造失败时**由 main 使用。
 *
 * 为什么用 Proxy 而不是把所有 IPC 签名改成可空：小记 API 有几十个入口，逐个改类型会把崩溃面
 * 搬进类型系统。替身同时满足契约的两半——「主界面照常启动」+「小记相关操作返回可读错误」：
 * - 读类（列表/计数/待同步摘要/标签目录）返回**安全空值**：侧栏、状态栏、待同步广播不能因为
 *   小记库坏了而崩（尤其 main 的 afterInvoke 每次 IPC 都会读 getPendingSyncSummary）；
 * - 写/同步/备份类一律抛 AppError("Internal", 可读原因)，IPC 层会转成结构化错误给渲染层；
 * - **绝不**能被 setQuickNotesStoreForV3 注册：loadState 看到空的小记世界会把远端小记判成
 *   待下载/删除（main 已按 availability 分流，desktopSync 另有同步前置断言）。
 */
const unavailableQuickNotesStores = new WeakSet<object>();

/** 是否是降级替身（同步/诊断/测试的显式判据；不依赖 instanceof）。 */
export function isQuickNotesUnavailableStore(store: QuickNotesStore): boolean {
  return unavailableQuickNotesStores.has(store as unknown as object);
}

export function createUnavailableQuickNotesStore(message: string): QuickNotesStore {
  const fail = (member: string): never => {
    throw new AppError("Internal", message + "［" + member + "］");
  };
  const emptyList = (): never[] => [];
  const safeReads: Record<string, unknown> = {
    listQuickNotes: emptyList,
    listQuickNoteTrash: emptyList,
    listAllDeleted: emptyList,
    listDeletedForSync: emptyList,
    listDeferredDeletedForSync: emptyList,
    listMissingQuickNotes: emptyList,
    listQuickNotesForSync: emptyList,
    listQuickNoteTagIds: emptyList,
    countQuickNotes: () => 0,
    getPendingSyncSummary: () => ({ items: 0, resources: 0 }),
    getTombstonesWaterline: () => "0",
    search: emptyList,
    // 派生索引维护是幂等后台动作：降级时静默 no-op（启动对账/搜索重建不会因此报错）。
    ensureSearchIndex: () => undefined,
    rebuildSearchIndex: () => undefined,
    // 标签目录读（标签管理页显示为空）；写操作走下面的 fail（可读错误）。
    tagService: {
      list: emptyList,
      create: () => fail("tagService.create"),
      update: () => fail("tagService.update"),
      reorder: () => fail("tagService.reorder"),
      merge: () => fail("tagService.merge"),
      delete: () => fail("tagService.delete"),
    },
  };
  /** 目录/关联等命名空间：任何访问都给出可读错误（它们只在同步路径被用到，而同步已被前置断言拦住）。 */
  const deniedNamespace = (namespace: string): unknown => new Proxy({}, {
    get: (_target, property) => {
      if (typeof property === "string") throw new AppError("Internal", message + "［" + namespace + "." + property + "］");
      return undefined;
    },
  });
  safeReads.tags = deniedNamespace("tags");
  safeReads.links = deniedNamespace("links");
  const stub = new Proxy({} as QuickNotesStore, {
    get(_target, property) {
      // 避免被 await 当成 thenable（否则任何 await quickNotes 的地方会永久挂起）。
      if (property === "then") return undefined;
      if (typeof property === "string" && Object.prototype.hasOwnProperty.call(safeReads, property)) return safeReads[property];
      if (typeof property !== "string") return undefined;
      return (..._args: unknown[]) => fail(property);
    },
    has() { return true; },
  });
  unavailableQuickNotesStores.add(stub as unknown as object);
  return stub;
}
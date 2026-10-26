/**
 * 小记（quick-notes）S3 对象布局的**唯一来源**（B1，261016）。
 *
 * ## 为什么必须独立成文件
 * 这套 key 曾同时写在旧 `quickNotePush.ts` 与 `quickNotesSyncEngine.ts` 里（两者均已删除；逐字相同的三行），
 * 且 `quick-notes` 这个前缀常量本身在 core 与 electron 各定义过一次。
 * 而「保存并同步」正是**单条推送**与**整轮同步**两条路径共用同一份清单与同一个对象命名空间：
 * 两处各写一份 ⇒ 将来改布局只改一处时，单条推送会与整轮同步指向**不同的对象**
 * （表现为重复上传，或他端读不到刚推上去的那条、进而在 GC 时被误判）。
 * 见 `AGENTS.md` C1-4。
 *
 * ## 两种用法（同一布局，前缀归属不同）
 * - **core / 移动端**：自己带同步前缀直连 S3 ⇒ 用 `quickNoteKeys(prefix)`；
 * - **桌面主进程**：`ObjectStore` 内部已套前缀、使用相对 key ⇒ 用 `quickNote*KeyRel()`。
 *
 * 布线格式由 `src/core/quickNoteKeys.test.ts` 用**字面量**独立钉住
 * （单一来源负责"只定义一次"，测试负责"格式没被悄悄改"）。
 */

/** 小记在对象存储里的顶层前缀（与 Lake 正文命名空间完全隔离）。 */
export const QUICK_NOTES_ROOT = "quick-notes";

/** 小记正文对象的扩展名（内容哈希寻址）。 */
export const QUICK_NOTE_OBJECT_EXT = "qnote";

/** 相对 key：小记清单（单文件覆盖写、没有 CAS）。 */
export function quickNoteManifestKeyRel(): string {
  return `${QUICK_NOTES_ROOT}/manifests/latest.json`;
}

/** 相对 key：小记正文对象（按内容哈希寻址 ⇒ PUT 幂等）。 */
export function quickNoteObjectKeyRel(contentHash: string): string {
  return `${QUICK_NOTES_ROOT}/objects/${contentHash}.${QUICK_NOTE_OBJECT_EXT}`;
}

/** 相对 key：小记图片对象。 */
export function quickNoteAssetKeyRel(noteId: string, filename: string): string {
  return `${QUICK_NOTES_ROOT}/assets/${noteId}/${filename}`;
}

/** 相对前缀：列对象/做差集时用。 */
export function quickNoteObjectsPrefixRel(): string {
  return `${QUICK_NOTES_ROOT}/objects/`;
}

/** 相对前缀：列对象/做差集时用。 */
export function quickNoteAssetsPrefixRel(): string {
  return `${QUICK_NOTES_ROOT}/assets/`;
}

/** 带同步前缀的 key 组：形状与调用点原先的局部函数/常量一致（便于零改动替换）。 */
export interface QuickNoteKeys {
  /** 清单 key（字符串，不是函数）。 */
  manifestKey: string;
  /** 正文对象 key。 */
  objectKey(contentHash: string): string;
  /** 图片对象 key。 */
  assetKey(noteId: string, filename: string): string;
}

/** 按同步前缀派生小记的 key 组。 */
export function quickNoteKeys(prefix: string): QuickNoteKeys {
  const base = `${prefix}/${QUICK_NOTES_ROOT}`;
  return {
    manifestKey: `${base}/manifests/latest.json`,
    objectKey: (contentHash) => `${base}/objects/${contentHash}.${QUICK_NOTE_OBJECT_EXT}`,
    assetKey: (noteId, filename) => `${base}/assets/${noteId}/${filename}`,
  };
}

/**
 * 移动端运行时桥：实现 window.lakeNative 契约（对齐桌面 preload 的 IPC 语义）。
 *
 * C3-5 拆域后本文件**只做组合**：
 * - context.ts  DB/资源缓存/互斥域/S3 工厂/同步设置
 * - assets.ts   本地资源读写/预览/另存/孤儿清理/上传
 * - sync.ts     同步/S3/GC/诊断/推送回核
 * - notes.ts    文档/历史/回收站
 * - quickNotes.ts 小记
 * - tree.ts     目录树/笔记本/图标/排序
 * - home.ts     首页只读投影
 */
import { ensureDb } from "./bridge/context";
import { assetsDomain } from "./bridge/assets";
import { syncDomain } from "./bridge/sync";
import { notesDomain } from "./bridge/notes";
import { quickNotesDomain } from "./bridge/quickNotes";
import { treeDomain } from "./bridge/tree";
import { homeDomain } from "./bridge/home";
import { aiDomain } from "./bridge/ai";
import { backfillQuickNoteListMetadata, migrateQuickNotesV3 } from "./data/quickNotesRepository";

export type { HistoryMobileSettings } from "./data/historyRepository.js";

export const bridge = {
  ...syncDomain,
  ...assetsDomain,
  ...notesDomain,
  ...quickNotesDomain,
  ...treeDomain,
  ...homeDomain,
  ...aiDomain,
  async init(): Promise<void> {
    const d = await ensureDb();
    // 261024：小记内容 v2（tags 名称）→ v3（tagIds）+ 标签目录补行；失败不阻断 App，下次启动重试。
    await migrateQuickNotesV3(d).catch((error) => console.warn("[quick-notes] v3 tag migration failed", error));
    // 一次性把旧小记的标签/首图元数据回填到 SQLite；失败不阻断 App，下次启动重试。
    await backfillQuickNoteListMetadata(d).catch((error) => console.warn("[quick-notes] list metadata backfill failed", error));
    // 资源显示走 AssetServer（Filesystem 文件直读，无需预加载/迁移）。
  },
};

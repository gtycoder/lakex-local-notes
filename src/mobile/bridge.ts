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
 */
import { ensureDb } from "./bridge/context";
import { assetsDomain } from "./bridge/assets";
import { syncDomain } from "./bridge/sync";
import { notesDomain } from "./bridge/notes";
import { quickNotesDomain } from "./bridge/quickNotes";
import { treeDomain } from "./bridge/tree";

export type { HistoryMobileSettings } from "./data/historyRepository.js";

export const bridge = {
  ...syncDomain,
  ...assetsDomain,
  ...notesDomain,
  ...quickNotesDomain,
  ...treeDomain,
  async init(): Promise<void> {
    await ensureDb();
    // 资源显示走 AssetServer（Filesystem 文件直读，无需预加载/迁移）。
  },
};

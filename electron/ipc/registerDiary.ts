/**
 * 日记 IPC（桌面，261109；跨片契约 docs/DIARY.md「IPC 契约」）。
 *
 * 只有一个通道 `diary_open_date`：幂等打开某一天（已存在就返回，不存在则在单事务里补齐
 * 笔记本 → 年组 → 月组 → 文档）。**渲染层只传 dateKey**：主进程重新 plan，不接受 nodeId，
 * 从机制上排除 TOCTOU（连点两次只产生一篇）。
 *
 * 清单/树不走新通道 —— 渲染层继续用 `list_tree_nodes`（`TreeNode.space` 已带出）。
 *
 * 通道在三处登记（护栏 electron/ipc/ipcChannelParity.test.ts）：
 * ① 本文件 handle ② electron/preload.cjs invoke ③ electron/webApiServer.ts WEB_METHODS。
 */
import type { IpcRegistrar } from "./registrar.js";
import type { DiaryOpenResult } from "../diaryStore.js";

export interface DiaryIpcDeps {
  /** 实现 = Store.openDiaryDate（判据/事务全在 electron/diaryStore.ts）。 */
  openDate: (dateKey: string) => DiaryOpenResult;
}

export function registerDiaryIpc(ipc: IpcRegistrar, deps: DiaryIpcDeps): void {
  ipc.handle("diary_open_date", (dateKey: string): DiaryOpenResult => deps.openDate(dateKey));
}

/**
 * 日记 IPC（桌面，261109；跨片契约 docs/DIARY.md「IPC 契约」）。
 *
 * 两个通道：
 * · `diary_open_date`：幂等打开某一天（已存在就返回，不存在则在单事务里补齐
 *   笔记本 → 年组 → 月组 → 文档）。**渲染层只传 dateKey**：主进程重新 plan，不接受 nodeId，
 *   从机制上排除 TOCTOU（连点两次只产生一篇）。
 * · `diary_unmark`（261110 收尾）：取消**整本**日记标记（笔记本 space 置 NULL，子树原样保留）。
 *   主进程用 core `planDiaryUnmark` 重新校验（不信渲染层），单条原子 UPDATE，幂等（cleared=false 不报错）。
 *
 * 清单/树不走新通道 —— 渲染层继续用 `list_tree_nodes`（`TreeNode.space` 已带出）。
 *
 * 通道在三处登记（护栏 electron/ipc/ipcChannelParity.test.ts）：
 * ① 本文件 handle ② electron/preload.cjs invoke ③ electron/webApiServer.ts WEB_METHODS。
 */
import type { IpcRegistrar } from "./registrar.js";
import type { DiaryOpenResult, DiaryUnmarkResult } from "../diaryStore.js";

export interface DiaryIpcDeps {
  /** 实现 = Store.openDiaryDate（判据/事务全在 electron/diaryStore.ts）。 */
  openDate: (dateKey: string, options?: { mode?: "open" | "new" }) => DiaryOpenResult;
  /** 实现 = Store.unmarkDiaryNotebook（core planDiaryUnmark + 单条原子 UPDATE）。 */
  unmark: (notebookId: string) => DiaryUnmarkResult;
}

export function registerDiaryIpc(ipc: IpcRegistrar, deps: DiaryIpcDeps): void {
  // mode 省略 = "open"（当天最新/没有就建）；"new" = 一天多篇（加号 / 选日期建新的）。
  ipc.handle("diary_open_date", (dateKey: string, mode?: unknown): DiaryOpenResult =>
    deps.openDate(dateKey, { mode: mode === "new" ? "new" : "open" }));
  // 取消日记标记（整本）：只改笔记本行 space；已取消/不是日记本 ⇒ cleared:false（幂等，不抛错）。
  ipc.handle("diary_unmark", (notebookId: unknown): DiaryUnmarkResult =>
    deps.unmark(String(notebookId ?? "")));
}

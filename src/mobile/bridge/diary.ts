/**
 * 日记域（261109 v1，261110 补 mode + 取消日记标记）：移动端入口 = 「打开/新建某一天」+「取消整本日记标记」。
 *
 * 移动端没有主进程：桌面那条 `diary_open_date(dateKey, mode)` IPC 的等价物就是这里 ——
 * 同一份 ensure 在 data 层（`src/mobile/diary/diaryRepository.ts`）执行，桥只负责
 * ① 取写域（本地写必须串行、不得被网络阶段穿插，AGENTS §4 互斥域）② 开库。
 *
 * `mode`（与桌面 preload/native.ts 的签名逐字一致）：
 * · `"open"`（默认）= 幂等：当天已有就打开最新一篇（「写今天 / 继续写今天」、首页 ＋→日记）；
 * · `"new"` = 永远新建一篇（日记页右上角 ＋ = 今天新建、日历 = 选任意日期新建；一天允许多篇）。
 *
 * 互斥域：`diaryOpenDate` / `clearDiaryMark` 都已在 `src/core/maintenancePolicy.ts` 的 `WRITE_OPS` 登记
 * （前者产生目录行、后者改目录行的 space，都是本地写，必须与其它目录写串行），
 * 并由 `maintenancePolicyCoverage.test.ts` 纳入一致性检查。
 */
import { ensureDb, runWrite } from "./context";
import {
  clearDiaryNotebookMark,
  ensureDiaryNote,
  type DiaryOpenMode,
  type DiaryOpenResult,
  type DiaryUnmarkResult,
} from "../diary/diaryRepository.js";

export type { DiaryOpenMode };

export const diaryDomain = {
  /**
   * 打开（幂等）/ 新建（mode="new"）某天日记。dateKey = 本地日期 YYYY-MM-DD。
   * 连点防重在两层：本桥的写域串行（同域不并发）+ 页面侧的在途守卫；数据层整个 ensure 在一个事务里。
   */
  async diaryOpenDate(dateKey: string, mode: DiaryOpenMode = "open"): Promise<DiaryOpenResult> {
    return runWrite("diaryOpenDate", async () => {
      const d = await ensureDb();
      return await ensureDiaryNote(d, dateKey, mode);
    });
  },
  /**
   * 取消**整本**日记标记（桌面 `diary_unmark` 的移动等价物）：笔记本 space 置 NULL，
   * 笔记本与文档原样保留；已取消/不是日记本 ⇒ cleared:false（幂等，不报错）。
   */
  async clearDiaryMark(notebookId: string): Promise<DiaryUnmarkResult> {
    return runWrite("clearDiaryMark", async () => {
      const d = await ensureDb();
      return await clearDiaryNotebookMark(d, notebookId);
    });
  },
};

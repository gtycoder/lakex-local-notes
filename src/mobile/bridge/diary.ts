/**
 * 日记域（261109 v1，261110 补 mode）：移动端入口 = 「打开/新建某一天」。
 * （用户 261112 裁决：**不做**整本「取消日记标记」；space 的读取/同步/知识库过滤保留，历史值照常兼容。）
 *
 * 移动端没有主进程：桌面那条 `diary_open_date(dateKey, mode)` IPC 的等价物就是这里 ——
 * 同一份 ensure 在 data 层（`src/mobile/diary/diaryRepository.ts`）执行，桥只负责
 * ① 取写域（本地写必须串行、不得被网络阶段穿插，AGENTS §4 互斥域）② 开库。
 *
 * `mode`（与桌面 preload/native.ts 的签名逐字一致）：
 * · `"open"`（默认）= 幂等：当天已有就打开最新一篇（「写今天 / 继续写今天」、首页 ＋→日记）；
 * · `"new"` = 永远新建一篇（日记页右上角 ＋ = 今天新建、日历 = 选任意日期新建；一天允许多篇）。
 *
 * 互斥域：`diaryOpenDate` 已在 `src/core/maintenancePolicy.ts` 的 `WRITE_OPS` 登记
 * （它产生目录行，是本地写，必须与其它目录写串行），并由 `maintenancePolicyCoverage.test.ts` 纳入一致性检查。
 */
import { ensureDb, runWrite } from "./context";
import {
  ensureDiaryNote,
  type DiaryOpenMode,
  type DiaryOpenResult,
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
};

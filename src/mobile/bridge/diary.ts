/**
 * 日记域（261109 v1）：移动端唯一入口是「打开/写某一天」。
 *
 * 移动端没有主进程：桌面那条 `diary_open_date` IPC 的等价物就是这里 ——
 * 同一份 ensure 在 data 层（`src/mobile/diary/diaryRepository.ts`）执行，桥只负责
 * ① 取写域（本地写必须串行、不得被网络阶段穿插，AGENTS §4 互斥域）② 开库。
 *
 * 互斥域：`diaryOpenDate` 已在 `src/core/maintenancePolicy.ts` 的 `WRITE_OPS` 登记
 * （它会产生 tree_nodes 行，必须与其它目录写串行），并由 `maintenancePolicyCoverage.test.ts` 纳入一致性检查。
 */
import { ensureDb, runWrite } from "./context";
import { ensureDiaryNote, type DiaryOpenResult } from "../diary/diaryRepository.js";

export const diaryDomain = {
  /** 幂等打开某天日记（今天/任意历史日期同一入口）。dateKey = 本地日期 YYYY-MM-DD。 */
  async diaryOpenDate(dateKey: string): Promise<DiaryOpenResult> {
    return runWrite("diaryOpenDate", async () => {
      const d = await ensureDb();
      return await ensureDiaryNote(d, dateKey);
    });
  },
};

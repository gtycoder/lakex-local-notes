/**
 * 移动端本地库健康判定（261105）：坏库不能再只表现为「启动失败，重试」。
 *
 * 判据来源与桌面同口径（electron/store.ts:733 的 `PRAGMA integrity_check`），移动端用更轻的
 * `PRAGMA quick_check`（只找结构性损坏，不做全页校验；2 万文档量级也在毫秒级）+ 外键检查。
 *
 * 两条路径都会产生「坏库」：
 *  - DB 打开就抛（文件损坏/不是数据库/IO 错误）⇒ classifyDbOpenError 归类；
 *  - 打开成功但 quick_check 报错 ⇒ checkMobileDbHealth。
 * 页面只消费这里的结果，别在 UI 里再写一套判据。
 */
import type { MobileDb } from "./sqliteDb.js";

export interface MobileDbHealth {
  ok: boolean;
  /** quick_check 返回的原文（ok 时就是 "ok"）。 */
  quickCheck: string;
  foreignKeyErrors: number;
}

export type DbOpenErrorKind = "corrupt" | "other";

/** 打开/迁移阶段抛错 → 是否属于「坏库」（其余按普通启动失败处理）。 */
export function classifyDbOpenError(error: unknown): DbOpenErrorKind {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (!message) return "other";
  return /malformed|not a database|database disk image|sqlite_corrupt|corrupt|disk i\/o error/.test(message) ? "corrupt" : "other";
}

/** 跑一次健康检查；任何 PRAGMA 失败都按「不健康」返回（不抛，页面只需一个结论）。 */
export async function checkMobileDbHealth(d: MobileDb): Promise<MobileDbHealth> {
  try {
    const row = await d.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    const quickCheck = String(row?.quick_check ?? "unknown");
    let foreignKeyErrors = 0;
    try {
      const fk = await d.prepare("PRAGMA foreign_key_check").all() as unknown[];
      foreignKeyErrors = fk.length;
    } catch {
      // 外键检查失败不单独判坏（老库可能没有 FK/或该 PRAGMA 不可用）。
      foreignKeyErrors = 0;
    }
    return { ok: quickCheck === "ok" && foreignKeyErrors === 0, quickCheck, foreignKeyErrors };
  } catch (error) {
    return { ok: false, quickCheck: "检查失败：" + (error instanceof Error ? error.message : String(error)), foreignKeyErrors: 0 };
  }
}

/** 人读一行摘要（坏库页/诊断复制共用）。 */
export function describeDbHealth(health: MobileDbHealth): string {
  if (health.ok) return "本地库检查通过";
  return "本地库检查未通过：quick_check=" + health.quickCheck + "，外键错误=" + health.foreignKeyErrors;
}

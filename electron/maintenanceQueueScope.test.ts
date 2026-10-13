/**
 * 桌面维护队列**范围**护栏：enqueueMaintenance 只能包"轮次级维护操作"。
 *
 * 为什么要有：移动端 F16 的根因就是"本地写被并进了维护队列"（实测弱网下写等 152.0s）。
 * 桌面目前是对的（5 个用法 = 2 个包装 + 3 个依赖注入，见用例名），这条测试把它钉住 ——
 * 以后谁把普通保存/笔记写塞进 enqueueMaintenance，这里立刻红。
 *
 * 判据来源：src/core/maintenancePolicy.ts（write 与 maintenance 必须分域）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(path.join(process.cwd(), "electron/main.ts"), "utf8");
const LINES = SOURCE.split("\n");

/** 允许出现在维护队列包裹范围内的维护操作标记（轮次级）。 */
const MAINTENANCE_MARKERS = ["syncNowViaEngine", "backupDatabaseTo", "runGcReconcile", "runFullSync"] as const;

/** 本地写标记：这些绝不能出现在维护队列的包裹范围内。 */
const LOCAL_WRITE_MARKERS = ["saveNote", "createNoteIn", "renameTreeNode", "moveTreeNode", "trashNote", "restoreTrash"] as const;

function occurrenceLines(): number[] {
  const out: number[] = [];
  LINES.forEach((line, i) => {
    // 只算"调用/传递"用法，不算定义（`function enqueueMaintenance<T>` 被负向先行断掉）。
    // 覆盖两种写法：直接包装 `enqueueMaintenance(async …)` 与依赖注入 `…, enqueueMaintenance)` / `…, enqueueMaintenance, …`。
    if (/\benqueueMaintenance\b(?!\s*<)/.test(line)) out.push(i);
  });
  return out;
}

describe("桌面维护队列范围（F16 的反向护栏）", () => {
  it("用法只有 5 处：2 个包装（整轮同步 / 定期 GC 对账）+ 3 个依赖注入（备份 / 同步装配 / 小记推送回核）", () => {
    // 261013 收紧正则后**暴露出** registerSyncIpc 的依赖注入此前没被数到（旧正则只认 `enqueueMaintenance(` 与 `, enqueueMaintenance)`）。
    // 第 5 处 = registerQuickNotesIpc 拿到 enqueueMaintenance，用来给 sync_quick_note 做**推送后回核**
    // （单条推送本身走高优先域，判据见 src/core/maintenancePolicy.ts 的 PRIORITY_OPS）。
    expect(occurrenceLines()).toHaveLength(5);
  });

  it("每处用法都落在已知的维护操作上下文里", () => {
    for (const i of occurrenceLines()) {
      const window = LINES.slice(Math.max(0, i - 15), i + 15).join("\n");
      const hit = MAINTENANCE_MARKERS.filter((m) => window.includes(m));
      expect(hit.length, `main.ts:${i + 1} 的 enqueueMaintenance 附近找不到维护操作标记`).toBeGreaterThan(0);
    }
  });

  it("维护队列范围内不得出现本地写（F16 的成因）", () => {
    for (const i of occurrenceLines()) {
      const window = LINES.slice(Math.max(0, i - 15), i + 15).join("\n");
      const bad = LOCAL_WRITE_MARKERS.filter((m) => window.includes(m));
      expect(bad, `main.ts:${i + 1} 的维护队列范围内出现本地写标记：${bad.join(", ")}`).toEqual([]);
    }
  });
});

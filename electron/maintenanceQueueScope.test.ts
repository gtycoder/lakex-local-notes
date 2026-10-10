/**
 * 桌面维护队列**范围**护栏：enqueueMaintenance 只能包"轮次级维护操作"。
 *
 * 为什么要有：移动端 F16 的根因就是"本地写被并进了维护队列"（实测弱网下写等 152.0s）。
 * 桌面目前是对的（3 个用法：整轮同步 / 数据库备份 / 定期 GC 对账），这条测试把它钉住 ——
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
const MAINTENANCE_MARKERS = ["syncNowViaEngine", "backupDatabaseTo", "runGcReconcile"] as const;

/** 本地写标记：这些绝不能出现在维护队列的包裹范围内。 */
const LOCAL_WRITE_MARKERS = ["saveNote", "createNoteIn", "renameTreeNode", "moveTreeNode", "trashNote", "restoreTrash"] as const;

function occurrenceLines(): number[] {
  const out: number[] = [];
  LINES.forEach((line, i) => {
    // 只算"调用/传递"用法，不算定义（function enqueueMaintenance<T>）。
    if (/enqueueMaintenance\s*\(|,\s*enqueueMaintenance\s*\)/.test(line)) out.push(i);
  });
  return out;
}

describe("桌面维护队列范围（F16 的反向护栏）", () => {
  it("用法只有 3 处：整轮同步 / 数据库备份 / 定期 GC 对账", () => {
    expect(occurrenceLines()).toHaveLength(3);
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

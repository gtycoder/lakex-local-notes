/**
 * 桌面维护队列**范围**护栏：enqueueMaintenance 只能包"轮次级维护操作"。
 *
 * 为什么要有：移动端 F16 的根因就是"本地写被并进了维护队列"（实测弱网下写等 152.0s）。
 * 这条测试把它钉住 —— 以后谁把普通保存/笔记写塞进 enqueueMaintenance，这里立刻红。
 *
 * 261112 拆分（05 报告 S-5）后判据从「单文件 6 处」升级为**双文件分类计数**（更强，不是放宽）：
 *  - **唯一实现**必须留在入口 `electron/main.ts`（`function enqueueMaintenance<T>`）；
 *  - 接线层 `electron/boot/ipcWiring.ts` **不得**自带第二条队列/另一套串行原语；
 *  - 用法分两类分别计数：
 *      main = 2 处「包装」（整轮同步 / 自动备份 VACUUM）+ 2 处「注入」（传给接线层 1 次 / 给对账器 1 次）
 *      wiring = 1 处「声明」（deps 字段）+ 3 处「域注入」（registerNotesIpc / registerSyncIpc / registerQuickNotesIpc）
 *  - 每个用法点 ±15 行内**必须**出现维护操作标记（证明它在轮次级上下文里），
 *    且**不得**出现本地写标记（F16 的直接判据）。
 *
 * 判据来源：src/core/maintenancePolicy.ts（write 与 maintenance 必须分域）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MAIN_FILE = "electron/main.ts";
const WIRING_FILE = "electron/boot/ipcWiring.ts";
const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const MAIN = read(MAIN_FILE);
const WIRING = read(WIRING_FILE);

const MAIN_LINES = MAIN.split("\n");
const WIRING_LINES = WIRING.split("\n");

/** 允许出现在维护队列包裹范围内的维护操作标记（轮次级）。 */
const MAINTENANCE_MARKERS = ["syncNowViaEngine", "backupDatabaseTo", "runGcReconcile", "runFullSync", "FileMetadataReconciler", "runBackupCycle"] as const;

/** 本地写标记：这些绝不能出现在维护队列的包裹范围内。 */
const LOCAL_WRITE_MARKERS = ["saveNote", "createNoteIn", "renameTreeNode", "moveTreeNode", "trashNote", "restoreTrash"] as const;

/** 允许接收维护队列的域（注入点白名单；多一个就说明有新的域被并进维护域）。 */
const ALLOWED_INJECTION_DOMAINS = ["registerNotesIpc(", "registerSyncIpc(", "registerQuickNotesIpc("] as const;

function occurrenceLines(lines: readonly string[]): number[] {
  const out: number[] = [];
  lines.forEach((line, i) => {
    // 只算"调用/传递/声明"用法，不算唯一实现（`function enqueueMaintenance<T>` 被负向先行断掉）。
    if (/\benqueueMaintenance\b(?!\s*<)/.test(line)) out.push(i);
  });
  return out;
}

function windowOf(lines: readonly string[], i: number): string {
  return lines.slice(Math.max(0, i - 15), i + 15).join("\n");
}

/** 逐处断言：在维护上下文里 + 不碰本地写。返回该处的上下文窗口，供域白名单复用。 */
function assertMaintenanceContext(label: string, lines: readonly string[], i: number): string {
  const window = windowOf(lines, i);
  const hit = MAINTENANCE_MARKERS.filter((m) => window.includes(m));
  expect(hit.length, `${label}:${i + 1} 的 enqueueMaintenance 附近找不到维护操作标记`).toBeGreaterThan(0);
  const bad = LOCAL_WRITE_MARKERS.filter((m) => window.includes(m));
  expect(bad, `${label}:${i + 1} 的维护队列范围内出现本地写标记：${bad.join(", ")}`).toEqual([]);
  return window;
}

describe("桌面维护队列范围（F16 的反向护栏）", () => {
  it("唯一实现在入口文件：main 定义队列，接线层不得自带第二条队列/第二套串行", () => {
    expect(MAIN).toMatch(/function enqueueMaintenance<T>\(task: \(\) => Promise<T>\): Promise<T> \{/);
    // 防绕过：接线层若自己实现队列（或引入另一套串行原语），等于把维护域拆成两份。
    expect(WIRING).not.toMatch(/function enqueueMaintenance/);
    expect(WIRING).not.toContain("KeyedAsyncQueue");
    expect(WIRING).not.toContain("let maintenanceQueue");
  });

  it("用法分布：main 4 处（2 包装 + 2 注入）、接线层 4 处（1 声明 + 3 域注入）", () => {
    // main：runFullSync 包装 / 自动备份包装 / 传给接线层 / 给 FileMetadataReconciler
    expect(occurrenceLines(MAIN_LINES), "main.ts 的 enqueueMaintenance 用法数变了 ⇒ 确认是有意的并更新本条").toHaveLength(4);
    // wiring：deps 字段声明 / registerNotesIpc / registerSyncIpc / registerQuickNotesIpc
    expect(occurrenceLines(WIRING_LINES), "ipcWiring.ts 的 enqueueMaintenance 用法数变了 ⇒ 确认是有意的并更新本条").toHaveLength(4);
    // 包装用法必须是 await（不许"丢进队列不等待"，那会吞掉同步失败）
    expect(MAIN.match(/await enqueueMaintenance\(/g) ?? []).toHaveLength(2);
  });

  it("每处用法都落在已知的维护操作上下文里，且不碰本地写", () => {
    for (const i of occurrenceLines(MAIN_LINES)) assertMaintenanceContext(MAIN_FILE, MAIN_LINES, i);
    for (const i of occurrenceLines(WIRING_LINES)) assertMaintenanceContext(WIRING_FILE, WIRING_LINES, i);
  });

  it("注入点白名单：接线层的 3 处注入只能给「整轮同步 / 备份快照 / 缺正文补拉」三个域", () => {
    const injectionLines = WIRING_LINES
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /deps\.enqueueMaintenance/.test(line))
      .map(({ i }) => i);
    expect(injectionLines, "deps.enqueueMaintenance 的注入点数量变了").toHaveLength(3);
    for (const i of injectionLines) {
      const window = windowOf(WIRING_LINES, i);
      const domain = ALLOWED_INJECTION_DOMAINS.filter((d) => window.includes(d));
      expect(domain.length, `${WIRING_FILE}:${i + 1} 的注入点不在白名单域内（新增域必须显式评审）`).toBeGreaterThan(0);
    }
    // main 必须恰好一次把队列交给接线层（否则接线层拿到的可能是另一个队列/未注入）
    expect(MAIN).toMatch(/registerIpc\(\{[\s\S]*?\n\s+enqueueMaintenance,[\s\S]*?\}\)/);
  });
});

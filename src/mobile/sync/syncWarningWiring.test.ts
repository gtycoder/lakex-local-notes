/**
 * task-67 接线护栏（静态源码契约）：同步 warning 的「单篇 apply 跳过」与「N 项被跳过」摘要必须单一来源。
 *  ① 移动端 v3 把 apply 跳过映射成独立 kind `apply_skipped`（与桌面 desktopSync 同口径），不再复用 remote_incomplete；
 *  ② 两处 toast 的「N 项被跳过」改用 core/syncWarningText 摘要（不手写计数短句）；
 *  ③ 「上次同步」状态落盘跳过项摘要（上限 20 条），设置页优先用落盘的完整分组计数。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const V3_SYNC = code(read("src/mobile/v3/sync.ts"));
const BRIDGE_SYNC = code(read("src/mobile/bridge/sync.ts"));
const HOME = code(read("src/mobile/home/HomePage.tsx"));
const WORKSPACE_SYNC = code(read("src/mobile/notebook/useWorkspaceSync.ts"));
const SETTINGS = code(read("src/mobile/settings/SettingsDrawer.tsx"));
const SYNC_HOOK = code(read("src/mobile/settings/useSyncSettingsForm.ts"));
const STATUS_STORE = code(read("src/mobile/sync/syncStatusStore.ts"));

describe("task-67 同步 warning 摘要单一来源", () => {
  it("v3 同步：单篇 apply 失败用 apply_skipped（不是 remote_incomplete）", () => {
    expect(V3_SYNC).toContain('kind: "apply_skipped"');
    expect(V3_SYNC).not.toContain('kind: "remote_incomplete", noteId: w.id');
  });

  it("两处 toast 的跳过计数改用 core/syncWarningText 摘要", () => {
    for (const src of [HOME, WORKSPACE_SYNC]) {
      expect(src).toContain("syncWarningSummaryText(");
      expect(src).toContain("syncWarningSummary(");
      expect(src).not.toContain("项被跳过");
    }
  });

  it("状态行不再拼手写跳过计数（摘要由调用方/toast 统一生成）", () => {
    expect(BRIDGE_SYNC).not.toContain("项被跳过");
    // 跳过项摘要随状态落盘（重启不丢）。
    expect(BRIDGE_SYNC).toContain("warnings: summary.warnings");
  });

  it("syncStatusStore 落盘精简摘要（上限常量）+ 设置页优先用落盘的分组计数", () => {
    expect(STATUS_STORE).toContain("MAX_PERSISTED_SYNC_WARNINGS = 20");
    expect(STATUS_STORE).toContain("warningSummary");
    expect(SYNC_HOOK).toContain("readSyncStatus()?.warnings");
    expect(SETTINGS).toContain("syncWarningDigest ?? syncWarningSummary(syncWarnings)");
  });
});

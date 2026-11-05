/**
 * 「同步记录」入口接线护栏（261105 P1 第 4 项，静态源码契约）：
 * 入口必须在「上次同步」下方、有未读才显示；列表页必须有打开笔记与刷新回调；
 * 未读数由 useSyncSettingsForm 统一读取（打开设置/每轮同步结束各刷一次），不在组件里另打一份查询。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const DRAWER = read("src/mobile/settings/SettingsDrawer.tsx");
const HOOK = read("src/mobile/settings/useSyncSettingsForm.ts");
const BRIDGE = read("src/mobile/bridge/notes.ts");

describe("设置页同步记录入口", () => {
  it("入口位于「上次同步」下方，并传未读数", () => {
    const lastSyncAt = DRAWER.indexOf("上次同步：{lastSyncText}");
    const entryAt = DRAWER.indexOf("<SyncConflictsEntry");
    expect(lastSyncAt).toBeGreaterThan(-1);
    expect(entryAt).toBeGreaterThan(lastSyncAt);
    expect(DRAWER).toContain("count={conflictUnacked}");
  });

  it("列表页接线：打开笔记回调 + 变更后刷新角标", () => {
    expect(DRAWER).toContain("<SyncConflictsSheet");
    expect(DRAWER).toContain("onOpenNote={onOpenNote}");
    expect(DRAWER).toContain("onChanged={() => void reloadConflicts()}");
  });

  it("未读数单一来源：hook 里读 listSyncConflicts，并在打开/同步结束/状态变化时刷新", () => {
    expect(HOOK).toContain("listSyncConflicts");
    expect(HOOK).toContain("conflictUnacked");
    expect(HOOK).toContain("reloadConflicts");
    // 打开设置时刷一次
    expect(HOOK).toMatch(/if \(!open\) return;[\s\S]{0,200}reloadConflicts\(\)/);
    // 同步结束后刷一次
    expect(HOOK).toMatch(/await reloadSyncReports\(\);[\s\S]{0,120}await reloadConflicts\(\);/);
    // 自动同步（状态写入）也刷新
    expect(HOOK).toMatch(/subscribeSyncStatus\(\(\) => \{[\s\S]{0,120}reloadConflicts\(\)/);
  });

  it("P2-D：已处理记录不再返回 ok:true（语义显式化为 already-resolved）", () => {
    expect(BRIDGE).toContain('reason: "already-resolved"');
    expect(BRIDGE).not.toMatch(/if \(row\.resolvedAt\) return \{ ok: true/);
  });
});

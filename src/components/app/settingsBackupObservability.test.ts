import { describe, expect, it } from "vitest";
import { backupResultView, backupUsageView } from "./settingsBackupObservability";
import type { BackupStateShape, BackupUsageShape } from "../../lib/types";

/**
 * 261105 task-68：备份可观测状态行文案（设置 → 备份与恢复）。
 * 三态（ok/partial/failed）+ 失败引导 + 占用（统计中/目录未创建/空目录/多份/超限/半份组警告）。
 */
const state = (over: Partial<BackupStateShape> = {}): BackupStateShape => ({
  lastBackupAt: "2026-11-06T14:08:04.000Z",
  result: "ok",
  message: "已备份主库：metadata-2026-11-06T14-08-04.sqlite3；小记库：quicknotes-2026-11-06T14-08-04.sqlite3",
  mainFile: "metadata-2026-11-06T14-08-04.sqlite3",
  quickNotesFile: "quicknotes-2026-11-06T14-08-04.sqlite3",
  ...over,
});

const usage = (over: Partial<BackupUsageShape> = {}): BackupUsageShape => ({
  dir: "/tmp/userData/backups",
  exists: true,
  groups: 2,
  files: 4,
  totalBytes: 10240,
  newestAt: "2026-11-06T14:08:04.000Z",
  oldestAt: "2026-11-01T00:00:00.000Z",
  warnings: [],
  ...over,
});

describe("上次备份结果（ok / partial / failed）", () => {
  it("没备份过 ⇒ null（UI 显示「还没有备份记录」）", () => {
    expect(backupResultView(null)).toBeNull();
  });

  it("成功：ok 色阶、成功标签、不给重试与引导", () => {
    const view = backupResultView(state())!;
    expect(view.tone).toBe("ok");
    expect(view.label).toBe("成功");
    expect(view.headline).toContain("上次备份：");
    expect(view.headline).toContain("（成功）");
    expect(view.message).toContain("已备份主库");
    expect(view.guidance).toBeNull();
    expect(view.retry).toBe(false);
  });

  it("部分成功：warn 色阶、原因原样展示、引导「立即备份」再试", () => {
    const view = backupResultView(state({
      result: "partial",
      message: "已备份主库：metadata-x.sqlite3；注意：小记库不可用：本次未备份小记库",
    }))!;
    expect(view.tone).toBe("warn");
    expect(view.label).toBe("部分成功");
    expect(view.headline).toContain("（部分成功）");
    expect(view.message).toContain("小记库不可用");
    expect(view.guidance).toContain("立即备份");
    expect(view.retry).toBe(true);
  });

  it("失败：error 色阶、给重试与「查看日志/更早备份」引导（并说明本地数据不受影响）", () => {
    const view = backupResultView(state({ result: "failed", message: "主库备份失败：disk I/O error", mainFile: null }))!;
    expect(view.tone).toBe("error");
    expect(view.label).toBe("失败");
    expect(view.headline).toContain("（失败）");
    expect(view.message).toContain("disk I/O error");
    expect(view.guidance).toContain("立即备份");
    expect(view.guidance).toContain("本地数据不受影响");
    expect(view.retry).toBe(true);
  });

  it("时间不可解析时不抛，只是不给时间", () => {
    const view = backupResultView(state({ lastBackupAt: "not-a-date" }))!;
    expect(view.headline).toBe("上次备份：成功");
  });
});

describe("备份占用（只读统计口径）", () => {
  it("还没读到 ⇒ 统计中…（不误报 0 份）", () => {
    expect(backupUsageView(null)).toMatchObject({ tone: "ok", countText: "统计中…", sizeText: "" });
  });

  it("目录不存在 ⇒ 还没有备份 + 说明「目录尚未创建」，不报错", () => {
    const view = backupUsageView(usage({ exists: false, groups: 0, files: 0, totalBytes: 0, newestAt: null, oldestAt: null }));
    expect(view.countText).toBe("还没有备份");
    expect(view.note).toContain("尚未创建");
    expect(view.tone).toBe("ok");
  });

  it("目录就绪但还没有备份 ⇒ 还没有备份", () => {
    const view = backupUsageView(usage({ groups: 0, files: 0, totalBytes: 0, newestAt: null, oldestAt: null }));
    expect(view.countText).toBe("还没有备份");
    expect(view.sizeText).toBe("");
    expect(view.newestText).toBeNull();
  });

  it("多份：份数/体积/上限/最新时间", () => {
    const view = backupUsageView(usage(), { maxTotalBytes: 300 * 1024 * 1024 });
    expect(view.countText).toBe("共 2 份");
    expect(view.sizeText).toBe("10.0 KB");
    expect(view.limitText).toBe("上限 300.0 MB");
    expect(view.newestText).toContain("最新 ");
    expect(view.tone).toBe("ok");
    expect(view.note).toBeNull();
  });

  it("超出总大小上限（超小上限时轮转只能留一份）⇒ warn 并说明", () => {
    const view = backupUsageView(usage({ totalBytes: 5 * 1024 * 1024 }), { maxTotalBytes: 1024 * 1024 });
    expect(view.tone).toBe("warn");
    expect(view.note).toContain("超过总大小上限");
  });

  it("半份组警告可见（最多 2 条，多的折叠计数）", () => {
    const view = backupUsageView(usage({ warnings: ["备份组不完整（缺主库或小记库文件）：a", "备份组不完整（缺主库或小记库文件）：b", "统计备份文件失败 c：ENOENT"] }));
    expect(view.note).toContain("a");
    expect(view.note).toContain("b");
    expect(view.note).not.toContain("c");
    expect(view.note).toContain("还有 1 条");
  });
});

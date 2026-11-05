/**
 * Batch3-A：小记库可用性判定 + 降级替身单测。
 * 语义：quick-notes 库打不开 ≠ 整个应用坏库 —— 主界面照常、小记 IPC 给可读错误、同步暂停、诊断可见。
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  assertQuickNotesSyncAvailable,
  buildQuickNotesUnavailableReport,
  decideQuickNotesAvailability,
  getQuickNotesAvailability,
  quickNotesDegradedMessage,
  setQuickNotesAvailability,
} from "./quickNotesAvailability.js";
import { createUnavailableQuickNotesStore, isQuickNotesUnavailableStore } from "./quickNotes.js";
import { formatS3v3Diagnostics } from "../src/core/s3v3Report.js";
import { AppError } from "../src/core/storeErrors.js";

const fixedNow = () => "2026-11-05T00:00:00.000Z";

describe("decideQuickNotesAvailability（纯判定）", () => {
  it("没有打开异常 ⇒ ok", () => {
    expect(decideQuickNotesAvailability()).toEqual({ mode: "ok" });
    expect(decideQuickNotesAvailability({ openError: null })).toEqual({ mode: "ok" });
  });

  it("QuickNotesStore 构造抛错 ⇒ degraded（带 reason/detail/at）", () => {
    const availability = decideQuickNotesAvailability({ openError: new Error("SQLITE_CORRUPT: database disk image is malformed"), now: fixedNow });
    expect(availability).toEqual({
      mode: "degraded",
      reason: "小记库（quick-notes/metadata.sqlite3）无法打开",
      detail: "SQLITE_CORRUPT: database disk image is malformed",
      at: "2026-11-05T00:00:00.000Z",
    });
  });

  it("可读告警包含原因、影响范围与恢复出口（备份 + 从云端恢复 + 同步诊断）", () => {
    const availability = decideQuickNotesAvailability({ openError: new Error("boom"), now: fixedNow });
    if (availability.mode !== "degraded") throw new Error("expected degraded");
    const message = quickNotesDegradedMessage(availability);
    expect(message).toContain("boom");
    expect(message).toContain("文档/表格");
    expect(message).toContain("同步诊断");
    expect(message).toContain("备份数据目录");
    expect(message).toContain("从云端恢复");
  });
});

describe("进程内 availability 状态 + 同步前置断言", () => {
  beforeEach(() => setQuickNotesAvailability({ mode: "ok" }));

  it("set/get 往返", () => {
    const degraded = decideQuickNotesAvailability({ openError: new Error("x"), now: fixedNow });
    setQuickNotesAvailability(degraded);
    expect(getQuickNotesAvailability()).toEqual(degraded);
  });

  it("降级 + 小记通道启用 ⇒ 同步前置断言抛可读错误；通道关闭/正常状态不拦", () => {
    setQuickNotesAvailability(decideQuickNotesAvailability({ openError: new Error("bad db"), now: fixedNow }));
    expect(() => assertQuickNotesSyncAvailable(true)).toThrow(/小记库不可用，已暂停同步/);
    expect(() => assertQuickNotesSyncAvailable(true)).toThrow(/从云端恢复/);
    // 显式关闭小记通道（调试/无小记场景）不拦；正常状态也不拦。
    expect(() => assertQuickNotesSyncAvailable(false)).not.toThrow();
    setQuickNotesAvailability({ mode: "ok" });
    expect(() => assertQuickNotesSyncAvailable(true)).not.toThrow();
  });
});

describe("设置→同步诊断可见（复用 S3v3DiagnosticReport 通道）", () => {
  it("降级报告：失败轮 + 1 条告警 + error 摘要，格式化文本里可见原因与出口", () => {
    const availability = decideQuickNotesAvailability({ openError: new Error("SQLITE_NOTADB"), now: fixedNow });
    if (availability.mode !== "degraded") throw new Error("expected degraded");
    const report = buildQuickNotesUnavailableReport(availability);
    expect(report).toMatchObject({
      at: "2026-11-05T00:00:00.000Z",
      ok: false,
      warningCount: 1,
      uploaded: 0,
      downloaded: 0,
      generation: null,
    });
    expect(report.warnings[0]).toContain("SQLITE_NOTADB");
    expect(report.error).toMatchObject({ code: "quick-notes-unavailable", errorClass: "fatal" });
    const text = formatS3v3Diagnostics([report]);
    expect(text).toContain("失败");
    expect(text).toContain("quick-notes-unavailable");
    expect(text).toContain("小记库不可用");
    expect(text).toContain("从云端恢复");
  });
});

describe("降级替身 createUnavailableQuickNotesStore", () => {
  const message = "小记库不可用：测试原因（test detail）。请先在 设置→同步诊断 查看原因。";

  it("读类返回安全空值（主界面/侧栏/待同步广播不因小记库坏了而崩）", () => {
    const stub = createUnavailableQuickNotesStore(message);
    expect(stub.listQuickNotes()).toEqual([]);
    expect(stub.listQuickNoteTrash()).toEqual([]);
    expect(stub.listMissingQuickNotes({ cloudConfigured: false })).toEqual([]);
    expect(stub.listDeletedForSync()).toEqual([]);
    expect(stub.listQuickNotesForSync()).toEqual([]);
    expect(stub.countQuickNotes()).toBe(0);
    expect(stub.getPendingSyncSummary()).toEqual({ items: 0, resources: 0 });
    expect(stub.search("任意")).toEqual([]);
    expect(stub.tagService.list()).toEqual([]);
    // 启动/后台维护类幂等 no-op，不抛错。
    expect(() => stub.ensureSearchIndex()).not.toThrow();
    expect(() => stub.rebuildSearchIndex()).not.toThrow();
  });

  it("写/读单条/备份/同步类抛可读 AppError（带原方法名，IPC 会转结构化错误）", () => {
    const stub = createUnavailableQuickNotesStore(message);
    for (const call of [
      () => stub.readQuickNote("q1"),
      () => stub.createQuickNote({ text: "x", draftId: "d", stagedImageIds: [] }),
      () => stub.deleteQuickNote("q1"),
      () => stub.purgeQuickNote("q1"),
      () => stub.backupDatabaseTo("/tmp/x.sqlite3"),
      () => stub.markTargetNotesSynced(),
      () => stub.importRemoteQuickNote({ id: "q1", createdAt: "t", updatedAt: "t", contentHash: "h", isConflict: false }, Buffer.from("x"), []),
    ]) {
      let caught: unknown = null;
      try { call(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(AppError);
      const appError = caught as AppError;
      expect(appError.message).toContain("小记库不可用");
      expect(appError.message).toContain("［");
      expect(appError.code).toBe("INTERNAL");
    }
  });

  it("目录/关联命名空间访问也给出可读错误（同步路径才会用到，已被前置断言拦住）", () => {
    const stub = createUnavailableQuickNotesStore(message);
    expect(() => stub.tags.list()).toThrow(/小记库不可用/);
    expect(() => stub.links.listFor("q1")).toThrow(/小记库不可用/);
  });

  it("await 不会挂起（Proxy 不暴露 thenable） + 静态标记可判定", async () => {
    const stub = createUnavailableQuickNotesStore(message);
    expect(isQuickNotesUnavailableStore(stub)).toBe(true);
    await expect(Promise.resolve(stub)).resolves.toBe(stub);
    expect(isQuickNotesUnavailableStore({} as never)).toBe(false);
  });
});

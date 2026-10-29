import { describe, expect, it } from "vitest";
import {
  S3V3_DIAGNOSTIC_FAILED_KEEP,
  S3V3_DIAGNOSTIC_KEEP,
  buildS3v3DiagnosticReport,
  createS3v3PhaseCollector,
  formatS3v3Diagnostics,
  parseS3v3DiagnosticReports,
  pushS3v3DiagnosticReport,
  type S3v3DiagnosticReport,
} from "./s3v3Report.js";

/** SD-13：同步诊断报告（落 device_state / 设置页一键复制）的纯逻辑护栏。 */

const report = (at: string, ok = true): S3v3DiagnosticReport => buildS3v3DiagnosticReport({ at, ok, durationMs: 1200, uploaded: 2, downloaded: 3, phases: [{ phase: "bodies", ms: 800 }] });

describe("SD-13 · 诊断报告构造", () => {
  it("计数/失败对象：只收有对象指向的 warning，且封顶", () => {
    const warnings = [
      { kind: "remote_incomplete", message: "缺正文: n1", noteId: "n1", title: "文档1" },
      { kind: "asset_missing", message: "缺附件: n2/a.png", noteId: "n2", filename: "a.png" },
      { kind: "local_body_missing", message: "没有对象指向的警告" },
      ...Array.from({ length: S3V3_DIAGNOSTIC_FAILED_KEEP + 5 }, (_, i) => ({ kind: "asset_missing", message: "缺附件", noteId: "x" + i })),
    ];
    const r = buildS3v3DiagnosticReport({ at: "2026-10-28T00:00:00.000Z", ok: true, durationMs: 12.4, warnings, uploaded: -1, downloaded: 3 });
    expect(r.durationMs).toBe(12);
    expect(r.uploaded).toBe(0);
    expect(r.warningCount).toBe(warnings.length);
    expect(r.failed.length).toBe(S3V3_DIAGNOSTIC_FAILED_KEEP);
    expect(r.failed[0]).toMatchObject({ kind: "remote_incomplete", id: "n1", title: "文档1" });
    expect(r.failed[1]).toMatchObject({ filename: "a.png" });
    expect(r.warnings[0]).toBe("缺正文: n1");
    expect(r.warnings.length).toBeLessThanOrEqual(S3V3_DIAGNOSTIC_FAILED_KEEP);
  });

  it("失败轮的 error 摘要保留 code/分类/消息（成功轮缺省）", () => {
    const ok = buildS3v3DiagnosticReport({ at: "t", ok: true, durationMs: 1 });
    expect(ok.error).toBeUndefined();
    const bad = buildS3v3DiagnosticReport({ at: "t", ok: false, durationMs: 5, error: { message: "锁被占用" } });
    expect(bad.error).toEqual({ code: "unknown", errorClass: "retryable", message: "锁被占用" });
  });
});

describe("SD-13 · 阶段收集器", () => {
  it("阶段耗时 + 多批进度的对象数/字节累加", () => {
    const c = createS3v3PhaseCollector();
    c.phase("load-state", 12);
    c.phase("bodies", 800);
    c.progress({ phase: "bodies", done: 10, total: 10, bytesDone: 100, bytesTotal: 100 });
    c.phase("assets", 300);
    // 同一阶段被多条流水线复用：done 回退 = 新一批开始，按上一批 total 结算。
    c.progress({ phase: "assets", done: 1, total: 4, bytesDone: 50, bytesTotal: 200 });
    c.progress({ phase: "assets", done: 4, total: 4, bytesDone: 200, bytesTotal: 200 });
    c.progress({ phase: "assets", done: 1, total: 2, bytesDone: 30, bytesTotal: 30 });
    const snap = c.snapshot();
    expect(snap.map((p) => p.phase)).toEqual(["load-state", "bodies", "assets"]);
    expect(snap[0]).toEqual({ phase: "load-state", ms: 12 });
    expect(snap[1]).toMatchObject({ objects: 10, totalObjects: 10, bytes: 100, totalBytes: 100 });
    expect(snap[2]).toMatchObject({ objects: 5, totalObjects: 6, bytes: 230, totalBytes: 230 });
  });
});

describe("SD-13 · 环形保留 / 解析 / 文本", () => {
  it("只保留最近 3 轮（写入方无需关心淘汰）", () => {
    let list: S3v3DiagnosticReport[] = [];
    for (const at of ["a", "b", "c", "d", "e"]) list = pushS3v3DiagnosticReport(list, report(at));
    expect(list.length).toBe(S3V3_DIAGNOSTIC_KEEP);
    expect(list.map((r) => r.at)).toEqual(["c", "d", "e"]);
  });

  it("解析坏数据不抛错，且只回最近 3 轮", () => {
    expect(parseS3v3DiagnosticReports(null)).toEqual([]);
    expect(parseS3v3DiagnosticReports([{ at: 1 }, null, "x"])).toEqual([]);
    const raw = [1, 2, 3, 4, 5].map((n) => ({ at: "2026-10-2" + n, ok: true, durationMs: n, failed: [{ kind: "asset_missing", message: "x", id: "n" + n }] }));
    const parsed = parseS3v3DiagnosticReports(raw);
    expect(parsed.map((r) => r.at)).toEqual(["2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(parsed[2].failed[0]).toMatchObject({ kind: "asset_missing", id: "n5" });
    // warningCount 是原始总数（failed 只是有对象指向的子集），回读不得被缩水。
    const preserved = parseS3v3DiagnosticReports([{ at: "t", ok: true, durationMs: 1, warningCount: 7, failed: [{ kind: "asset_missing", message: "x", id: "n1" }] }]);
    expect(preserved[0].warningCount).toBe(7);
    expect(preserved[0].failed).toHaveLength(1);
    const withText = parseS3v3DiagnosticReports([{ at: "t", ok: true, durationMs: 1, warningCount: 2, warnings: ["a", "b"] }]);
    expect(withText[0].warnings).toEqual(["a", "b"]);
  });

  it("一键复制文本：标题/阶段/失败对象/错误都在，空列表返回空串", () => {
    expect(formatS3v3Diagnostics([])).toBe("");
    const text = formatS3v3Diagnostics([
      buildS3v3DiagnosticReport({
        at: "2026-10-28T12:00:00.000Z", ok: true, durationMs: 2300, generation: 12, published: true,
        uploaded: 3, downloaded: 5, deleted: 1, conflicts: 0,
        warnings: [{ kind: "remote_incomplete", message: "缺正文: n1", noteId: "n1" }],
        phases: [{ phase: "bodies", ms: 1500, objects: 100, totalObjects: 100, bytes: 2 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 }],
      }),
      buildS3v3DiagnosticReport({ at: "2026-10-28T13:00:00.000Z", ok: false, durationMs: 800, error: { code: "lock-busy", errorClass: "retryable", message: "另一台设备正在发布同步" }, phases: [{ phase: "publish-lock", ms: 800 }] }),
    ]);
    expect(text).toContain("最近 2 轮");
    expect(text).toContain("gen 12");
    expect(text).toContain("↑3 ↓5");
    expect(text).toContain("bodies 1.5s");
    expect(text).toContain("2.0MiB");
    expect(text).toContain("n1 [remote_incomplete] 缺正文: n1");
    expect(text).toContain("警告：缺正文: n1");
    expect(text).toContain("retryable · lock-busy · 另一台设备正在发布同步");
  });
});

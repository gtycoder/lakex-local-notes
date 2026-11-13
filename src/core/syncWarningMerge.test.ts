import { describe, expect, it } from "vitest";
import { mergeSyncWarnings, syncWarningOfApplyFailure } from "./syncWarningMerge.js";
import type { SyncWarning } from "./sharedTypes.js";

const w = (kind: SyncWarning["kind"], message: string, extra: Partial<SyncWarning> = {}): SyncWarning => ({ kind, message, ...extra });

describe("mergeSyncWarnings（W4：一行式 warning 不能只进日志）", () => {
  it("把没有结构化明细的一行式 warning 补成 remote_incomplete", () => {
    const out = mergeSyncWarnings({ structured: [], logLines: ["上传失败，保持 local 下轮重试: n1 timeout"] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("remote_incomplete");
    expect(out[0].message).toContain("上传失败");
  });

  it("与结构化项重复（互相包含）时只保留结构化项，不重复计数", () => {
    const structured = [w("local_body_missing", "缺正文: n1", { noteId: "n1", title: "文档1" })];
    const out = mergeSyncWarnings({ structured, logLines: ["缺正文: n1"] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("local_body_missing");
  });

  it("extra（apply_skipped）不会被归到 remote_incomplete", () => {
    const out = mergeSyncWarnings({
      structured: [],
      extra: [w("apply_skipped", "已跳过这篇（本地内容未改动）", { noteId: "n1" })],
      logLines: ["apply 跳过 n1：已跳过这篇（本地内容未改动）"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("apply_skipped");
  });

  it("空行被忽略、顺序稳定（structured → extra → logLines）", () => {
    const out = mergeSyncWarnings({ structured: [w("asset_missing", "a")], extra: [], logLines: ["", "  ", "b"] });
    expect(out.map((x) => x.message)).toEqual(["a", "b"]);
  });
});

describe("syncWarningOfApplyFailure（task-104 F-07：apply 失败 kind 单一来源）", () => {
  it("core 产出 apply_skipped 时原样透传（不再被两端改写成 remote_incomplete）", () => {
    const out = syncWarningOfApplyFailure({ code: "apply_skipped", space: "lake", id: "n1", title: "文档1", detail: "写失败" });
    expect(out).toMatchObject({ kind: "apply_skipped", noteId: "n1", title: "文档1", message: "写失败" });
  });

  it("其它 PlanWarning 仍按 remote_incomplete 归类（只有 apply 失败有独立 kind）", () => {
    expect(syncWarningOfApplyFailure({ code: "cleanup_failed", space: "lake", detail: "x" }).kind).toBe("remote_incomplete");
    expect(syncWarningOfApplyFailure({ code: "asset_missing", space: "lake", filename: "a.png" }).filename).toBe("a.png");
  });
});

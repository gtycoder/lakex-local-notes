import { describe, expect, it } from "vitest";
import { mergeSyncWarnings } from "./syncWarningMerge.js";
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

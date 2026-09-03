/**
 * GC 诊断纯函数回归（2026-09-03 用户现象："待回收键 23 个，但立即对账/深度清理都是 0"）。
 * 断言的核心不是"能不能删"，而是**界面必须把三种集合拆开说清**：
 * 已标记/已过窗口/窗口内/云端未引用/时间戳未知。
 */
import { describe, expect, it } from "vitest";
import {
  computeGcDiagnostics, formatWindowRemaining, gcCutoffMs, isPastWindow,
  isInsideWindow, namespaceOf,
} from "./gcDiagnostics.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("窗口判定", () => {
  it("cutoff = now - 窗口；边界时刻算作已过窗口（与执行器一致）", () => {
    const cutoff = gcCutoffMs(NOW, 7);
    expect(cutoff).toBe(NOW - 7 * DAY);
    expect(isPastWindow(iso(7 * DAY + 1000), cutoff)).toBe(true);
    expect(isPastWindow(new Date(cutoff).toISOString(), cutoff)).toBe(true);   // 边界
    expect(isPastWindow(iso(6 * DAY), cutoff)).toBe(false);
    expect(isInsideWindow(iso(6 * DAY), cutoff)).toBe(true);
  });

  it("时间戳缺失/非法：既不过期也不在窗口内（保守：判不出就不删）", () => {
    const cutoff = gcCutoffMs(NOW, 7);
    for (const bad of ["", "  ", "not-a-date", undefined as unknown as string]) {
      expect(isPastWindow(bad, cutoff)).toBe(false);
      expect(isInsideWindow(bad, cutoff)).toBe(false);
    }
  });

  it("窗口 0 天 = 全部到期（含刚写入的对象）", () => {
    const cutoff = gcCutoffMs(NOW, 0);
    expect(isPastWindow(new Date(NOW).toISOString(), cutoff)).toBe(true);
    expect(isPastWindow(new Date(NOW + DAY).toISOString(), cutoff)).toBe(false); // 未来时间戳不删
  });
});

describe("命名空间", () => {
  it("取首段前缀，异常键归 other", () => {
    expect(namespaceOf("objects/n1-h.lake")).toBe("objects");
    expect(namespaceOf("quick-notes/objects/abc.qnote")).toBe("quick-notes");
    expect(namespaceOf("orphan.lake")).toBe("other");
    expect(namespaceOf("/abs/key")).toBe("other");
  });
});

describe("待回收表（s3_gc_pending）分类", () => {
  it("复现用户现象：23 个全部在窗口内 ⇒ due=0（对账自然删不出东西）", () => {
    const pending = Array.from({ length: 23 }, (_, i) => ({
      key: `objects/n${i}-h${i}.lake`,
      markedAt: iso(i * 3_600_000),            // 最近 23 小时内陆续标记
    }));
    const d = computeGcDiagnostics({ pending, cloud: [], keep: new Set(), nowMs: NOW, retentionDays: 7 });
    expect(d.pending.total).toBe(23);
    expect(d.pending.due).toBe(0);
    expect(d.pending.dueDeletable).toBe(0);
    expect(d.pending.inWindow).toBe(23);
    // 最早标记 = iso(22h) ⇒ 可回收时刻 = 最早标记 + 7 天
    expect(d.pending.nextEligibleAt).toBe(new Date(NOW - 22 * 3_600_000 + 7 * DAY).toISOString());
    expect(d.pending.oldestMarkedAt).toBe(iso(22 * 3_600_000));
  });

  it("过期且不被引用 = 对账将删；过期但仍被引用 = 对账保留（不清表）", () => {
    const d = computeGcDiagnostics({
      pending: [
        { key: "objects/a.lake", markedAt: iso(8 * DAY) },     // 过期 + 未引用 → 可删
        { key: "objects/b.lake", markedAt: iso(9 * DAY) },     // 过期 + 仍引用 → 保留
        { key: "assets/c.png", markedAt: iso(1 * DAY) },       // 窗口内
      ],
      cloud: [],
      keep: new Set(["objects/b.lake"]),
      nowMs: NOW,
      retentionDays: 7,
    });
    expect(d.pending).toMatchObject({ total: 3, due: 2, dueDeletable: 1, dueReferenced: 1, inWindow: 1 });
  });

  it("脏 marked_at 计入 ageUnknown，不影响其它分类", () => {
    const d = computeGcDiagnostics({
      pending: [{ key: "objects/a.lake", markedAt: "" }, { key: "objects/b.lake", markedAt: iso(8 * DAY) }],
      cloud: [], keep: new Set(), nowMs: NOW, retentionDays: 7,
    });
    expect(d.pending).toMatchObject({ total: 2, ageUnknown: 1, due: 1, dueDeletable: 1, inWindow: 0 });
    expect(d.pending.oldestMarkedAt).toBe(iso(8 * DAY));
  });
});

describe("云端实扫分类", () => {
  const cloud: Array<{ key: string; lastModified: string; size: number }> = [
    { key: "manifests/latest.json", lastModified: iso(8 * DAY), size: 100 },   // keep 命中
    { key: "objects/old.lake", lastModified: iso(8 * DAY), size: 1000 },       // 未引用 + 过期
    { key: "objects/young.lake", lastModified: iso(2 * DAY), size: 500 },      // 未引用 + 窗口内
    { key: "assets/old.png", lastModified: iso(10 * DAY), size: 2000 },        // 未引用 + 过期
    { key: "assets/noage.png", lastModified: "", size: 7 },                    // 时间戳缺失
  ];

  it("总量/未引用/可删/窗口内/未知 分开统计，字节数随之累计", () => {
    const d = computeGcDiagnostics({
      pending: [], cloud, keep: new Set(["manifests/latest.json"]), nowMs: NOW, retentionDays: 7,
    });
    expect(d.cloud).toMatchObject({
      objects: 5, bytes: 3607,
      unreferenced: 4, unreferencedBytes: 3507,
      due: 2, dueBytes: 3000,
      inWindow: 1,
      ageUnknown: 1,
    });
    // 窗口内最早可删 = young.lake 时间戳 + 7 天
    expect(d.cloud.nextEligibleAt).toBe(new Date(NOW - 2 * DAY + 7 * DAY).toISOString());
  });

  it("按命名空间分组并按名排序，keep 命中的命名空间仍统计总量", () => {
    const d = computeGcDiagnostics({ pending: [], cloud, keep: new Set(["manifests/latest.json"]), nowMs: NOW, retentionDays: 7 });
    expect(d.cloud.namespaces.map((n) => n.namespace)).toEqual(["assets", "manifests", "objects"]);
    const assets = d.cloud.namespaces.find((n) => n.namespace === "assets")!;
    expect(assets).toMatchObject({ cloudObjects: 2, unreferenced: 2, due: 1, inWindow: 0, ageUnknown: 1 });
    const manifests = d.cloud.namespaces.find((n) => n.namespace === "manifests")!;
    expect(manifests).toMatchObject({ cloudObjects: 1, unreferenced: 0, due: 0, cloudBytes: 100 });
  });

  it("小记子空间独立成组（quick-notes/ 与 Lake 三前缀并列）", () => {
    const d = computeGcDiagnostics({
      pending: [],
      cloud: [{ key: "quick-notes/objects/x.qnote", lastModified: iso(9 * DAY), size: 42 }],
      keep: new Set(), nowMs: NOW, retentionDays: 7,
    });
    expect(d.cloud.namespaces).toEqual([expect.objectContaining({ namespace: "quick-notes", due: 1, dueBytes: 42 })]);
  });
});

describe("诊断与执行器同源（预览数 == 实删数）", () => {
  it("due/dueDeletable 用的就是执行器的 cutoff 与 keep 判定", () => {
    const pending = [{ key: "objects/a.lake", markedAt: iso(7 * DAY) }];   // 恰好边界
    const d = computeGcDiagnostics({ pending, cloud: [], keep: new Set(), nowMs: NOW, retentionDays: 7 });
    const cutoff = gcCutoffMs(NOW, 7);
    // 与 runGcReconcile 的判定式完全一致：Date.parse(markedAt) <= cutoff
    expect(Date.parse(pending[0].markedAt) <= cutoff).toBe(true);
    expect(d.pending.dueDeletable).toBe(1);
  });
});

describe("剩余窗口文案", () => {
  it("未来按小时/天取整；已过时刻显示已可回收；null 透传", () => {
    expect(formatWindowRemaining(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe("约 1 小时后");
    expect(formatWindowRemaining(new Date(NOW + 25 * 3_600_000).toISOString(), NOW)).toBe("约 2 天后");
    expect(formatWindowRemaining(new Date(NOW - 1000).toISOString(), NOW)).toBe("已可回收");
    expect(formatWindowRemaining(null, NOW)).toBeNull();
    expect(formatWindowRemaining("garbage", NOW)).toBeNull();
  });
});

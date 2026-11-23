import { describe, expect, it } from "vitest";
import {
  applyEncounterAction,
  probeCloudTarget,
  s3SettingsChanged,
  applyQuickEncounterAction,
  classifyCloudProbe,
  encounterFactsText,
  needsFirstEncounterDecision,
  probeHint,
  targetKeyOf,
} from "./firstEncounter.js";

describe("云端首次相遇：配置探测三态（功能一）", () => {
  it("前缀下空 = empty，静默通过", () => {
    expect(classifyCloudProbe({ objectCount: 0, hasLibraryMarker: false })).toBe("empty");
    expect(probeHint("empty")).toBeNull();
  });
  it("有本产品库标记 = ours，提示首次同步将询问", () => {
    expect(classifyCloudProbe({ objectCount: 9, hasLibraryMarker: true })).toBe("ours");
    expect(probeHint("ours")?.tone).toBe("info");
  });
  it("有对象但无标记 = foreign，黄色提醒确认前缀", () => {
    expect(classifyCloudProbe({ objectCount: 9, hasLibraryMarker: false })).toBe("foreign");
    expect(probeHint("foreign")?.tone).toBe("warn");
  });
  it("targetKey：前缀首尾斜杠归一、bucket/endpoint 参与身份", () => {
    const a = targetKeyOf({ endpoint: "https://S3.example.com", region: "r", bucket: "b", prefix: "/x/" });
    const b = targetKeyOf({ endpoint: "https://s3.example.com", region: "r", bucket: "b", prefix: "x" });
    expect(a).toBe(b);
    expect(targetKeyOf({ endpoint: "https://s3.example.com", region: "r", bucket: "b2", prefix: "x" })).not.toBe(b);
    expect(targetKeyOf({ endpoint: "https://s3.example.com", region: "r", bucket: "b", prefix: "y" })).not.toBe(b);
  });
});

describe("云端首次相遇：询问触发（功能二）", () => {
  it("无共同历史 且 云端非空 且 本地非空 ⇒ 问", () => {
    expect(needsFirstEncounterDecision({ noRelationship: true, cloudNonEmpty: true, localNonEmpty: true })).toBe(true);
  });
  it("任一不满足 ⇒ 不问（已有关系 / 空桶首传 / 本地为空直接拉取）", () => {
    expect(needsFirstEncounterDecision({ noRelationship: false, cloudNonEmpty: true, localNonEmpty: true })).toBe(false);
    expect(needsFirstEncounterDecision({ noRelationship: true, cloudNonEmpty: false, localNonEmpty: true })).toBe(false);
    expect(needsFirstEncounterDecision({ noRelationship: true, cloudNonEmpty: true, localNonEmpty: false })).toBe(false);
  });
  it("事实行文案", () => {
    expect(encounterFactsText({ localNotes: 100, cloudNotes: 50, overlapNotes: 0 })).toBe("本机 100 篇 / 云端 50 篇 / 重合 0 篇");
  });
});

describe("四选项对文档决策的映射", () => {
  const ctxBoth = { localPresent: true, remotePresent: true };
  const ctxLocalOnly = { localPresent: true, remotePresent: false };
  const ctxRemoteOnly = { localPresent: false, remotePresent: true };

  it("smart：原判定不动（有基线判真删、无基线不删）", () => {
    expect(applyEncounterAction("smart", "remote-purged-move-to-trash", ctxBoth)).toBe("remote-purged-move-to-trash");
    expect(applyEncounterAction("smart", "upload", ctxLocalOnly)).toBe("upload");
  });

  it("additive 只增不删：云端缺席不传播（重传）、本地删除意图推迟、冲突本机胜", () => {
    expect(applyEncounterAction("additive", "remote-purged-move-to-trash", ctxBoth)).toBe("upload");
    expect(applyEncounterAction("additive", "local-purge-wins", ctxRemoteOnly)).toBe("none");
    expect(applyEncounterAction("additive", "remote-wins-keep-history", ctxBoth)).toBe("upload");
    expect(applyEncounterAction("additive", "download", ctxRemoteOnly)).toBe("download"); // 远端独有照常下载（并集）
  });

  it("local-wins：远端独有 → download-to-trash；云端删除不认（重传）；冲突本机胜", () => {
    expect(applyEncounterAction("local-wins", "download", ctxRemoteOnly)).toBe("download-to-trash");
    expect(applyEncounterAction("local-wins", "download", ctxBoth)).toBe("upload");
    expect(applyEncounterAction("local-wins", "remote-purged-move-to-trash", ctxBoth)).toBe("upload");
    expect(applyEncounterAction("local-wins", "remote-wins-keep-history", ctxBoth)).toBe("upload");
    expect(applyEncounterAction("local-wins", "local-purge-wins", ctxRemoteOnly)).toBe("local-purge-wins"); // 本机显式删除照常传播
  });

  it("cloud-wins：本地独有 → 云端已删回收站；冲突远端胜；显式删除意图让位于云端", () => {
    expect(applyEncounterAction("cloud-wins", "upload", ctxLocalOnly)).toBe("remote-purged-move-to-trash");
    expect(applyEncounterAction("cloud-wins", "upload", ctxBoth)).toBe("remote-wins-keep-history");
    expect(applyEncounterAction("cloud-wins", "local-purge-wins", ctxRemoteOnly)).toBe("download");
    expect(applyEncounterAction("cloud-wins", "download", ctxRemoteOnly)).toBe("download");
    expect(applyEncounterAction("cloud-wins", "remote-purged-move-to-trash", ctxBoth)).toBe("remote-purged-move-to-trash");
  });
});

describe("四选项对小记决策的映射（绝不物删）", () => {
  const ctxBoth = { localPresent: true, remotePresent: true };
  const ctxLocalOnly = { localPresent: true, remotePresent: false };
  const ctxRemoteOnly = { localPresent: false, remotePresent: true };

  it("additive：双向都不删（云端缺席重传 / 本机删除推迟 / 冲突本机胜）", () => {
    expect(applyQuickEncounterAction("additive", "local-delete", ctxBoth)).toBe("upload");
    expect(applyQuickEncounterAction("additive", "local-delete", ctxRemoteOnly)).toBe("none");
    expect(applyQuickEncounterAction("additive", "local-purge", ctxRemoteOnly)).toBe("none");
    expect(applyQuickEncounterAction("additive", "remote-wins-history", ctxBoth)).toBe("upload");
  });

  it("local-wins：远端独有 → 安全兜底下载；双方都在=本机胜；云端删除不认", () => {
    // 远端独有 = 安全兜底普通下载（内容必保；回收站变体待物化面修通，见 firstEncounter.ts 注）。
    expect(applyQuickEncounterAction("local-wins", "download", ctxRemoteOnly)).toBe("download");
    expect(applyQuickEncounterAction("local-wins", "download", ctxBoth)).toBe("upload");
    expect(applyQuickEncounterAction("local-wins", "local-delete", ctxBoth)).toBe("upload");
    expect(applyQuickEncounterAction("local-wins", "local-delete", ctxRemoteOnly)).toBe("local-delete"); // 本机删除照常传播
  });

  it("cloud-wins：本地独有 → local-delete（发射侧 = 小记回收站，不是物删）；云端条目回拉", () => {
    expect(applyQuickEncounterAction("cloud-wins", "upload", ctxLocalOnly)).toBe("local-delete");
    expect(applyQuickEncounterAction("cloud-wins", "upload", ctxBoth)).toBe("remote-wins-history");
    expect(applyQuickEncounterAction("cloud-wins", "local-purge", ctxRemoteOnly)).toBe("download");
    expect(applyQuickEncounterAction("cloud-wins", "local-delete", ctxRemoteOnly)).toBe("download");
  });
});

describe("合并层接线（planLakeMerge / planQuickNotesMerge 消费映射）", () => {
  it("cloud-wins 下本地独有文档判成「云端已删·仅本地」回收站，而不是上传", async () => {
    const { planLakeMerge } = await import("./s3v3Merge.js");
    const now = "2026-11-23T00:00:00.000Z";
    const local = { v: 3 as const, space: "lake" as const, notes: [{ id: "n1", title: "L", parentId: null, sortOrder: 0, updatedAt: now, contentHash: "a".repeat(64), assetsHash: "" }], folders: [] };
    const empty = { v: 3 as const, space: "lake" as const, notes: [], folders: [] };
    const plan = planLakeMerge(null, local, empty, { restorePending: new Set(), purgeIntents: new Set(), folderPurgeIntents: new Set(), encounter: "cloud-wins", trashNow: now });
    expect(plan.notes.map((n) => n.kind)).toEqual(["remote-purged-trash"]);
  });

  it("local-wins 下远端独有文档带 trashOverride 落回收站（发布为 trashed）", async () => {
    const { planLakeMerge } = await import("./s3v3Merge.js");
    const now = "2026-11-23T00:00:00.000Z";
    const empty = { v: 3 as const, space: "lake" as const, notes: [], folders: [] };
    const remote = { v: 3 as const, space: "lake" as const, notes: [{ id: "r1", title: "R", parentId: null, sortOrder: 0, updatedAt: now, contentHash: "b".repeat(64), assetsHash: "" }], folders: [] };
    const plan = planLakeMerge(null, empty, remote, { restorePending: new Set(), purgeIntents: new Set(), folderPurgeIntents: new Set(), encounter: "local-wins", trashNow: now });
    expect(plan.notes[0].kind).toBe("download");
    expect(plan.notes[0].trashOverride?.trashedAt).toBe(now);
  });

  it("additive 下「基线有+远端缺席」不再判删除（重传），小记同口径", async () => {
    const { planLakeMerge, planQuickNotesMerge } = await import("./s3v3Merge.js");
    const now = "2026-11-23T00:00:00.000Z";
    const h = (c: string) => c.repeat(64);
    const base = { v: 3 as const, space: "lake" as const, notes: [{ id: "n1", title: "B", parentId: null, sortOrder: 0, updatedAt: now, contentHash: h("a"), assetsHash: "" }], folders: [] };
    const local = { ...base, notes: [{ ...base.notes[0] }] };
    const empty = { v: 3 as const, space: "lake" as const, notes: [], folders: [] };
    const plan = planLakeMerge(base, local, empty, { restorePending: new Set(), purgeIntents: new Set(), folderPurgeIntents: new Set(), encounter: "additive", trashNow: now });
    expect(plan.notes.map((n) => n.kind)).toEqual(["upload"]);
    const qbase = { v: 3 as const, space: "quickNotes" as const, items: [{ id: "q1", contentHash: h("c"), createdAt: now, updatedAt: now, assetsHash: "" }], purged: [] };
    const qplan = planQuickNotesMerge(qbase, { ...qbase }, { v: 3 as const, space: "quickNotes" as const, items: [], purged: [] }, new Set(), new Set(), new Set(), new Set(), "additive", now);
    expect(qplan.items.map((i) => i.kind)).toEqual(["upload"]);
  });
});
describe("配置探测（功能一）：变更即重探判定 + 三态探测", () => {
  const t = (prefix: string) => ({ endpoint: "https://s3.example.com", region: "r", bucket: "b", prefix });
  it("s3SettingsChanged：endpoint/region/bucket/prefix 任一变化 ⇒ 重探；全同或首次保存的口径", () => {
    expect(s3SettingsChanged(null, t("x"))).toBe(true); // 首次保存（此前无配置）⇒ 探
    expect(s3SettingsChanged(t("x"), t("x"))).toBe(false);
    expect(s3SettingsChanged(t("x"), t("/x/"))).toBe(false); // 前缀斜杠归一
    expect(s3SettingsChanged(t("x"), t("y"))).toBe(true);
    expect(s3SettingsChanged({ ...t("x"), bucket: "b2" }, t("x"))).toBe(true);
    expect(s3SettingsChanged({ ...t("x"), region: "r2" }, t("x"))).toBe(true);
    expect(s3SettingsChanged({ ...t("x"), endpoint: "https://other" }, t("x"))).toBe(true);
  });
  it("probeCloudTarget：有 pointer 标记 = ours；无标记有对象 = foreign；空 = empty", async () => {
    const mk = (keys: string[]) => ({
      list: async () => keys.map((key) => ({ key })),
      get: async (k: string) => (keys.includes(k) ? new Uint8Array([1]) : null),
    });
    expect((await probeCloudTarget(mk([]))).kind).toBe("empty");
    expect((await probeCloudTarget(mk(["meta/pointer.json", "objects/a-1.lake"]))).kind).toBe("ours");
    const foreign = await probeCloudTarget(mk(["other/file.txt"]));
    expect(foreign.kind).toBe("foreign");
    expect(foreign.hint?.tone).toBe("warn");
  });
});

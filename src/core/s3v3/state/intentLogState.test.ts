/**
 * E3-1 phase2a：v3 类型化 IntentLog 信封（records 判别联合）单测。
 * 覆盖：每类 record round-trip、v2→v3 / v1→v3 逐字段等价、时间戳/顺序保真、未知 kind 丢弃+warning、损坏→null、版本门。
 */
import { describe, expect, it } from "vitest";
import type { DeviceState } from "../../s3v3DeviceStore.js";
import { DEVICE_STATE_VERSION, fromPersistedState, mergeSyncMarkers, migratePersisted, toPersistedState, type DeviceLedger, type IntentLogStateV3 } from "./intentLogState.js";

const H = (c: string): string => c.repeat(64);

function deviceState(over: Partial<DeviceState> = {}): DeviceState {
  return {
    lake: {
      v: 3, space: "lake",
      notes: [{ id: "n1", title: "Doc", parentId: null, sortOrder: 0, updatedAt: "T0", contentHash: H("a"), assetsHash: H("b") }],
      folders: [],
    },
    quickNotes: {
      v: 3, space: "quickNotes",
      items: [{ id: "q1", createdAt: "T0", updatedAt: "T0", contentHash: H("c"), assetsHash: H("d") }],
      tags: [],
    },
    folders: [],
    intents: [{ noteId: "n1", targetEpoch: "e1", targetGeneration: 2, purgedAt: "2026-10-02T00:00:00.000Z" }],
    pending: [{ kind: "body", key: "objects/n1-x.lake", noteId: "n1", targetEpoch: "e1", targetGeneration: 2, targetCommit: "c1", createdAt: "T1" } as never],
    remotePurged: ["n2"],
    restorePending: ["n3"],
    quickDeletes: ["q2"],
    quickPurges: ["q3"],
    quickPurgeTimes: { q3: "2026-10-03T00:00:00.000Z" },
    bodyRecoveryPending: ["n4"],
    pendingAssets: [{ space: "lake", id: "n1", filename: "a.png", size: 3, hash: H("e"), attempts: 2 }],
    ...over,
  } as DeviceState;
}

describe("toPersistedState（摊平 9 字段 → records）", () => {
  it("每条 9 字段都成为对应 kind 的 record，时间戳/顺序/资产投影保留", () => {
    const v3 = toPersistedState(deviceState());
    expect(v3.version).toBe(DEVICE_STATE_VERSION);
    expect(v3.version).toBe(3);
    const kinds = v3.records.map((r) => r.kind);
    expect(kinds).toEqual(["delete-intent", "pending-delete", "quick-delete", "quick-purge", "cloud-deleted", "restore", "body-recovery", "asset-retry"]);
    expect(v3.records[0]).toMatchObject({ noteId: "n1", targetEpoch: "e1", targetGeneration: 2, purgedAt: "2026-10-02T00:00:00.000Z" });
    expect(v3.records[3]).toEqual({ kind: "quick-purge", id: "q3", at: "2026-10-03T00:00:00.000Z" });
    expect(v3.records[7]).toMatchObject({ kind: "asset-retry", payload: { id: "n1", attempts: 2 } });
    expect(v3.assets).toEqual({ lake: { n1: H("b") }, quickNotes: { q1: H("d") } });
    expect(v3).not.toHaveProperty("lake");
    expect(v3).not.toHaveProperty("intents");
    expect(v3).not.toHaveProperty("quick");
  });

  it("空 DeviceState → 空 records（版本门仍是 3）", () => {
    const empty = deviceState({
      intents: [], pending: [], remotePurged: [], restorePending: [], quickDeletes: [], quickPurges: [],
      quickPurgeTimes: {}, bodyRecoveryPending: [], pendingAssets: [],
      lake: { v: 3, space: "lake", notes: [], folders: [] },
      quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
    });
    expect(toPersistedState(empty).records).toEqual([]);
  });
});

describe("fromPersistedState（投影回 9 字段）", () => {
  it("v3 round-trip：records → 9 字段逐字段无损（含 pending payload / 时间戳）", () => {
    const state = deviceState();
    const restored = fromPersistedState(JSON.parse(JSON.stringify(toPersistedState(state))));
    expect(restored?.migrated).toBe(false);
    expect(restored?.state).toEqual({
      intents: state.intents,
      pending: state.pending,
      remotePurged: ["n2"],
      restorePending: ["n3"],
      quickDeletes: ["q2"],
      quickPurges: ["q3"],
      quickPurgeTimes: { q3: "2026-10-03T00:00:00.000Z" },
      bodyRecoveryPending: ["n4"],
      pendingAssets: state.pendingAssets,
    });
  });
});

const emptyLedger = (): DeviceLedger => ({
  intents: [], pending: [], remotePurged: [], restorePending: [], quickDeletes: [], quickPurges: [], quickPurgeTimes: {},
  bodyRecoveryPending: [], pendingAssets: [],
});

/** 每个账本字段一份非空样本。`{[K in keyof Required<DeviceLedger>]: …}` 是**编译期**穷尽性约束：
 *  DeviceState 新增/改名账本字段却没同步这里 ⇒ tsc 失败 —— 而不是等到线上「同步标记每轮重置」才发现。 */
const LEDGER_SAMPLES: { [K in keyof Required<DeviceLedger>]: Required<DeviceLedger>[K] } = {
  intents: [{ noteId: "n1", targetEpoch: "e1", targetGeneration: 2, purgedAt: "2026-10-02T00:00:00.000Z" }],
  pending: [{ kind: "body", key: "objects/n1-x.lake", noteId: "n1", targetEpoch: "e1", targetGeneration: 2, targetCommit: "c1", createdAt: "T1" } as never],
  remotePurged: ["n2"],
  restorePending: ["n3"],
  quickDeletes: ["q2"],
  quickPurges: ["q3"],
  quickPurgeTimes: { q3: "2026-10-03T00:00:00.000Z" },
  bodyRecoveryPending: ["n4"],
  pendingAssets: [{ space: "lake", id: "n1", filename: "a.png", size: 3, hash: H("e"), attempts: 2 }],
};

describe("账本⇄records 穷尽性（新增 DeviceState 账本字段必须能落盘）", () => {
  it("每个账本字段单独 save→load 无损（漏映射 = 同步标记每轮重置，且没有任何测试会红）", () => {
    for (const key of Object.keys(LEDGER_SAMPLES) as Array<keyof DeviceLedger>) {
      const state = { ...deviceState(emptyLedger()), [key]: LEDGER_SAMPLES[key] } as DeviceState;
      const restored = fromPersistedState(JSON.parse(JSON.stringify(toPersistedState(state))));
      expect(restored, key).not.toBeNull();
      // 字段本身必须原样回来（时间戳/顺序/嵌套 payload 都算）
      expect(restored!.state[key], key).toEqual(LEDGER_SAMPLES[key]);
      expect(restored!.migrated, key).toBe(false);
      // 且必须真的**写进了**信封（不是被默认值兜住）
      expect(toPersistedState(state).records.length, key).toBeGreaterThan(0);
    }
  });

  it("quickPurgeTimes 没有对应 id 时也落盘（旧信封只有时间表；丢了 ⇒ 与他端恢复比较时误判）", () => {
    const state = { ...deviceState(emptyLedger()), quickPurgeTimes: { q9: "2026-10-04T00:00:00.000Z" } } as DeviceState;
    const v3 = toPersistedState(state);
    expect(v3.records).toEqual([{ kind: "quick-purge", id: "q9", at: "2026-10-04T00:00:00.000Z" }]);
    expect(fromPersistedState(JSON.parse(JSON.stringify(v3)))!.state.quickPurgeTimes).toEqual({ q9: "2026-10-04T00:00:00.000Z" });
  });
});

describe("迁移（v2/v1 → v3 单向）", () => {
  const v2 = {
    version: 2,
    intents: [{ noteId: "n1", targetEpoch: "e1", targetGeneration: 2, purgedAt: "T9" }],
    pending: [{ kind: "body", key: "k", noteId: "n1" }],
    quick: { deletes: ["q2"], purges: ["q3"], purgeTimes: { q3: "2026-10-03T00:00:00.000Z" } },
    restore: { pending: ["n3"] },
    cloudDeleted: { ids: ["n2"] },
    recovery: { bodyPending: ["n4"], assetRetries: [{ space: "lake", id: "n1", filename: "a.png", size: 3, hash: H("e"), attempts: 1 }] },
    assets: { lake: { n1: H("b") }, quickNotes: { q1: H("d") } },
    hashCache: { n1: { mtimeMs: 1, size: 2, hash: H("a") } },
  };

  it("v2 信封 → v3 records：9 字段逐字段等价 + assets/hashCache 保留 + migrated=true", () => {
    const migrated = migratePersisted(v2);
    expect(migrated?.version).toBe(3);
    expect(migrated?.records.map((r) => r.kind)).toEqual(["delete-intent", "pending-delete", "quick-delete", "quick-purge", "cloud-deleted", "restore", "body-recovery", "asset-retry"]);
    expect(migrated?.records[3]).toEqual({ kind: "quick-purge", id: "q3", at: "2026-10-03T00:00:00.000Z" });
    expect(migrated?.assets).toEqual(v2.assets);
    expect(migrated?.hashCache).toEqual(v2.hashCache);
    const projected = fromPersistedState(v2);
    expect(projected?.migrated).toBe(true);
    expect(projected?.state.remotePurged).toEqual(["n2"]);
    expect(projected?.state.quickPurgeTimes).toEqual({ q3: "2026-10-03T00:00:00.000Z" });
    expect(projected?.state.pendingAssets).toHaveLength(1);
  });

  it("v1 旧格式（无 version，桌面 sidecar）→ v3：字段逐项落位，migrated=true", () => {
    const legacy = {
      intents: [], pending: [], quickPurgeTimes: { q3: "T9" },
      remotePurged: ["n2"], restorePending: ["n3"],
      pendingAssets: [{ space: "lake", id: "n1", filename: "a.png", size: 3, hash: H("e"), attempts: 1 }],
      assetsHash: { n1: H("b") }, quickAssetsHash: { q1: H("d") },
      hashCache: { n1: { mtimeMs: 1, size: 2, hash: H("a") } },
    };
    const migrated = migratePersisted(legacy);
    expect(migrated?.records).toContainEqual({ kind: "cloud-deleted", id: "n2" });
    expect(migrated?.records).toContainEqual({ kind: "restore", noteId: "n3" });
    expect(migrated?.records).toContainEqual({ kind: "quick-purge", id: "q3", at: "T9" });
    expect(migrated?.assets).toEqual({ lake: { n1: H("b") }, quickNotes: { q1: H("d") } });
    expect(fromPersistedState(legacy)?.migrated).toBe(true);
  });

  it("v1 旧移动格式（合并 assetsHash + baseline 同 JSON，baseline 不属于信封）", () => {
    const migrated = migratePersisted({
      baseline: { epoch: "e1" }, intents: [], pending: [], remotePurged: [], restorePending: [],
      assetsHash: { n1: H("b"), q1: H("d") }, quickPurgeTimes: {}, pendingAssets: [],
    });
    expect(migrated?.assets.lake).toEqual({ n1: H("b"), q1: H("d") });
    expect(migrated?.assets.quickNotes).toEqual({});
  });
});

describe("断代门 / 容错", () => {
  it("v3 客户端只读 v3：未知版本（含未来 4）→ null，不做降级", () => {
    expect(migratePersisted({ version: 4, records: [] })).toBeNull();
    expect(migratePersisted({ version: 1, records: [] })).toBeNull();
  });

  it("未知 record kind 丢弃并收集 warning，合法记录保留（不崩）", () => {
    const warnings: string[] = [];
    const migrated = migratePersisted({
      version: 3,
      records: [
        { kind: "cloud-deleted", id: "n1" },
        { kind: "future-kind", id: "n2" },
        { kind: "restore", noteId: "n3" },
      ],
      assets: { lake: {}, quickNotes: {} },
    }, (m) => warnings.push(m));
    expect(migrated?.records.map((r) => r.kind)).toEqual(["cloud-deleted", "restore"]);
    expect(warnings.join("\n")).toContain("future-kind");
    expect(fromPersistedState({ version: 3, records: [{ kind: "cloud-deleted", id: "n1" }] })?.state.remotePurged).toEqual(["n1"]);
  });

  it("损坏/空输入 → null（适配器按空账本处理）", () => {
    expect(migratePersisted(null)).toBeNull();
    expect(migratePersisted("oops")).toBeNull();
    expect(migratePersisted([1, 2])).toBeNull();
    expect(migratePersisted({})).toBeNull();
    expect(fromPersistedState({ version: 4 })).toBeNull();
  });

  it("mergeSyncMarkers 在 v3 records 上替换两类标记（其余记录不动）", () => {
    const persisted: IntentLogStateV3 = {
      version: 3,
      records: [
        { kind: "delete-intent", noteId: "n1", targetEpoch: "e1", targetGeneration: 1 },
        { kind: "cloud-deleted", id: "old" },
        { kind: "restore", noteId: "old-r" },
      ],
      assets: { lake: {}, quickNotes: {} },
    };
    const next = mergeSyncMarkers(persisted, { remotePurged: ["n9"], restorePending: ["n10"] });
    expect(next.records).toEqual([
      { kind: "delete-intent", noteId: "n1", targetEpoch: "e1", targetGeneration: 1 },
      { kind: "cloud-deleted", id: "n9" },
      { kind: "restore", noteId: "n10" },
    ]);
  });
});

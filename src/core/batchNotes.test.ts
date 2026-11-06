import { describe, expect, it, vi } from "vitest";
import {
  BATCH_NOTES_ACTIONS,
  BATCH_NOTES_MAX_IDS,
  normalizeBatchNotesIds,
  runBatchNotes,
  type BatchNotesExecutor,
  type BatchNotesItem,
  type BatchNotesNodeInfo,
  type BatchNotesParentStatus,
} from "./batchNotes.js";

/**
 * 批量操作编排（261106）：去重/上限/分类/父级/环/标签参数、**部分不合法整批不执行**、
 * 执行期异常整批失败、结果结构与 summary 契约（移动端同形）。
 * action 集合 = move | trash | tag-add | tag-remove（**没有 restore**，回收站不做多选）。
 */
interface Harness {
  executor: BatchNotesExecutor;
  executed: BatchNotesItem[][];
  nodes: Map<string, BatchNotesNodeInfo>;
  supports: Map<string, true | string>;
  parentStatus: BatchNotesParentStatus;
  cycleIds: Set<string>;
  tags: ReadonlySet<string> | null;
}

function harness(over: Partial<Harness> = {}): Harness {
  const nodes = over.nodes ?? new Map<string, BatchNotesNodeInfo>([
    ["doc-1", { kind: "note", trashed: false }],
    ["doc-2", { kind: "note", trashed: false }],
    ["grp-1", { kind: "folder", trashed: false }],
    ["nb-1", { kind: "notebook", trashed: false }],
    ["trashed-1", { kind: "note", trashed: true }],
  ]);
  const executed: BatchNotesItem[][] = [];
  const h: Harness = {
    nodes,
    executed,
    supports: over.supports ?? new Map(),
    parentStatus: over.parentStatus ?? "ok",
    cycleIds: over.cycleIds ?? new Set(),
    tags: over.tags === undefined ? new Set(["tag-a", "tag-b"]) : over.tags,
    executor: undefined as unknown as BatchNotesExecutor,
  };
  h.executor = {
    describe: (id) => nodes.get(id) ?? null,
    supports: (action, node, space) => (h.supports.get(space + ":" + action + ":" + node.kind) as true | undefined)
      ?? (h.supports.get(action + ":" + node.kind) as true | undefined)
      ?? true,
    describeParent: () => h.parentStatus,
    wouldCreateCycle: (id) => h.cycleIds.has(id),
    activeTagIds: () => (h.tags === null ? null : h.tags),
    execute: (items) => { executed.push([...items]); },
  };
  return h;
}

describe("批量操作：输入清洗", () => {
  it("ids 去重且保持首次出现顺序", () => {
    expect(normalizeBatchNotesIds(["b", "a", "b", " a "])).toEqual({ ids: ["b", "a"], invalid: [] });
    expect(normalizeBatchNotesIds("nope")).toEqual({ ids: [], invalid: [] });
    expect(normalizeBatchNotesIds(["", 3, null])).toEqual({ ids: [], invalid: ["", "3", "null"] });
  });

  it("空列表 ⇒ empty-ids、不执行", () => {
    const h = harness();
    const result = runBatchNotes({ action: "trash", ids: [] }, h.executor);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty-ids");
    expect(result.summary).toEqual({ total: 0, done: 0, failed: 0 });
    expect(h.executed).toEqual([]);
  });

  it("ids 不是数组 / 请求不是对象 ⇒ invalid-input", () => {
    const h = harness();
    expect(runBatchNotes({ action: "trash", ids: "a" }, h.executor).reason).toBe("invalid-input");
    expect(runBatchNotes(null, h.executor).reason).toBe("invalid-input");
    expect(runBatchNotes({ action: "trash", targets: ["a"] }, h.executor).reason).toBe("invalid-input");
  });

  it("超过 500 项 ⇒ too-many-ids、不执行", () => {
    const h = harness();
    const ids = Array.from({ length: BATCH_NOTES_MAX_IDS + 1 }, (_, index) => "doc-" + index);
    const result = runBatchNotes({ action: "trash", ids }, h.executor);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too-many-ids");
    expect(result.message).toContain(String(BATCH_NOTES_MAX_IDS));
    expect(h.executed).toEqual([]);
  });

  it("恰好 500 项允许", () => {
    const h = harness();
    const nodes = new Map<string, BatchNotesNodeInfo>();
    for (let index = 0; index < BATCH_NOTES_MAX_IDS; index += 1) nodes.set("d" + index, { kind: "note", trashed: false });
    const executor: BatchNotesExecutor = { ...h.executor, describe: (id) => nodes.get(id) ?? null };
    const result = runBatchNotes({ action: "trash", ids: [...nodes.keys()] }, executor);
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: BATCH_NOTES_MAX_IDS, done: BATCH_NOTES_MAX_IDS, failed: 0 });
  });

  it("space 缺省 = lake；quickNotes 透传给平台（describe/supports/execute 都带 space）", () => {
    const h = harness();
    const seen: string[] = [];
    const executor: BatchNotesExecutor = {
      ...h.executor,
      describe: (id, space) => { seen.push(space); return h.executor.describe(id, space); },
    };
    const lake = runBatchNotes({ action: "trash", ids: ["doc-1"] }, executor);
    expect(lake.ok).toBe(true);
    expect(seen).toEqual(["lake"]);
    expect(h.executed[0][0].space).toBe("lake");
    const quick = runBatchNotes({ action: "trash", ids: ["doc-1"], space: "quickNotes" }, executor);
    expect(quick.ok).toBe(true);
    expect(seen).toEqual(["lake", "quickNotes"]);
    expect(h.executed[1][0].space).toBe("quickNotes");
  });

  it("space 非法 ⇒ invalid-input", () => {
    const h = harness();
    for (const space of ["history", "", 42]) {
      const result = runBatchNotes({ action: "trash", ids: ["doc-1"], space }, h.executor);
      expect(result.ok, String(space)).toBe(false);
      expect(result.reason).toBe("invalid-input");
    }
    expect(h.executed).toEqual([]);
  });

  it("action 非法 / restore 已下线 / purge 不在契约里 ⇒ invalid-action", () => {
    const h = harness();
    for (const action of ["restore", "purge", "delete", "", undefined, 42]) {
      const result = runBatchNotes({ action, ids: ["doc-1"] }, h.executor);
      expect(result.ok, String(action)).toBe(false);
      expect(result.reason, String(action)).toBe("invalid-action");
    }
    expect(BATCH_NOTES_ACTIONS).toEqual(["move", "trash", "tag-add", "tag-remove"]);
    expect(h.executed).toEqual([]);
  });
});

describe("批量操作：分类与状态校验（部分不合法整批不执行）", () => {
  it("notebook 一律 notebook-not-batchable（防御），且整批不执行", () => {
    const h = harness();
    const result = runBatchNotes({ action: "trash", ids: ["doc-1", "nb-1"] }, h.executor);
    expect(result.ok).toBe(false);
    expect(result.results).toEqual([
      { id: "doc-1", ok: true },
      { id: "nb-1", ok: false, reason: "notebook-not-batchable" },
    ]);
    expect(result.summary).toEqual({ total: 2, done: 1, failed: 1 });
    expect(h.executed).toEqual([]);
  });

  it("不存在的 id ⇒ not-found", () => {
    const h = harness();
    const result = runBatchNotes({ action: "trash", ids: ["ghost"] }, h.executor);
    expect(result.results).toEqual([{ id: "ghost", ok: false, reason: "not-found" }]);
    expect(h.executed).toEqual([]);
  });

  it("已在回收站 ⇒ already-trashed", () => {
    const h = harness();
    const result = runBatchNotes({ action: "trash", ids: ["trashed-1"] }, h.executor);
    expect(result.results[0]).toEqual({ id: "trashed-1", ok: false, reason: "already-trashed" });
    expect(h.executed).toEqual([]);
  });

  it("平台支持面：supports 返回原因即逐条拒绝（如桌面 trash 只收文档）", () => {
    const h = harness({ supports: new Map([["trash:folder", "unsupported"]]) });
    const result = runBatchNotes({ action: "trash", ids: ["doc-1", "grp-1"] }, h.executor);
    expect(result.ok).toBe(false);
    expect(result.results).toEqual([
      { id: "doc-1", ok: true },
      { id: "grp-1", ok: false, reason: "unsupported" },
    ]);
    expect(h.executed).toEqual([]);
  });

  it("无效 id 与合法 id 混排 ⇒ invalid-id，且合法项也不执行", () => {
    const h = harness();
    const result = runBatchNotes({ action: "trash", ids: ["doc-1", "", "doc-2"] }, h.executor);
    expect(result.ok).toBe(false);
    expect(result.results).toContainEqual({ id: "", ok: false, reason: "invalid-id" });
    expect(result.results.filter((item) => item.ok)).toHaveLength(2);
    expect(h.executed).toEqual([]);
  });
});

describe("批量移动：目标父级与环", () => {
  it("合法移动：全部通过后一次性 execute（带 parentId）", () => {
    const h = harness();
    const result = runBatchNotes({ action: "move", ids: ["doc-1", "grp-1"], parentId: "nb-9" }, h.executor);
    expect(result.ok).toBe(true);
    expect(h.executed).toHaveLength(1);
    expect(h.executed[0].map((item) => item.id)).toEqual(["doc-1", "grp-1"]);
    expect(h.executed[0].every((item) => item.parentId === "nb-9")).toBe(true);
  });

  it("省略 parentId ⇒ 根层（null）", () => {
    const h = harness();
    expect(runBatchNotes({ action: "move", ids: ["doc-1"] }, h.executor).ok).toBe(true);
    expect(h.executed[0][0].parentId).toBeNull();
  });

  it("目标父级不存在 / 不是容器 / 在回收站 ⇒ 整批拒绝、不执行", () => {
    for (const [status, reason] of [["not-found", "parent-not-found"], ["not-a-container", "parent-not-a-container"], ["in-trash", "parent-in-trash"]] as const) {
      const h = harness({ parentStatus: status });
      const result = runBatchNotes({ action: "move", ids: ["doc-1", "doc-2"], parentId: "x" }, h.executor);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(reason);
      expect(result.results.every((item) => item.reason === reason)).toBe(true);
      expect(h.executed).toEqual([]);
    }
  });

  it("移动到自身/后代 ⇒ parent-cycle（整批不执行）", () => {
    const h = harness({ cycleIds: new Set(["grp-1"]) });
    const result = runBatchNotes({ action: "move", ids: ["doc-1", "grp-1"], parentId: "grp-1" }, h.executor);
    expect(result.ok).toBe(false);
    expect(result.results).toEqual([
      { id: "doc-1", ok: true },
      { id: "grp-1", ok: false, reason: "parent-cycle" },
    ]);
    expect(h.executed).toEqual([]);
  });
});

describe("批量标签：参数与目录校验", () => {
  it("tag-add 通过后 execute 携带 tagIds（去重）", () => {
    const h = harness();
    const result = runBatchNotes({ action: "tag-add", ids: ["doc-1"], tagIds: ["tag-a", "tag-a", "tag-b"] }, h.executor);
    expect(result.ok).toBe(true);
    expect(h.executed[0][0].tagIds).toEqual(["tag-a", "tag-b"]);
  });

  it("目录不可用 ⇒ tag-unavailable；标签不存在 ⇒ tag-not-found（都不执行）", () => {
    const unavailable = harness({ tags: null });
    expect(runBatchNotes({ action: "tag-remove", ids: ["doc-1"], tagIds: ["tag-a"] }, unavailable.executor).reason).toBe("tag-unavailable");
    expect(unavailable.executed).toEqual([]);
    const h = harness();
    const result = runBatchNotes({ action: "tag-add", ids: ["doc-1"], tagIds: ["tag-ghost"] }, h.executor);
    expect(result.reason).toBe("tag-not-found");
    expect(h.executed).toEqual([]);
  });

  it("tagIds 缺失 / 空 / 含无效值 ⇒ invalid-input", () => {
    const h = harness();
    for (const tagIds of [undefined, [], [""], ["tag-a", 3]]) {
      const result = runBatchNotes({ action: "tag-add", ids: ["doc-1"], tagIds }, h.executor);
      expect(result.ok, JSON.stringify(tagIds)).toBe(false);
      expect(result.reason).toBe("invalid-input");
    }
    expect(h.executed).toEqual([]);
  });
});

describe("执行期异常：整批失败（平台已回滚）", () => {
  it("execute 抛错 ⇒ 每条都 failed、ok:false、summary.failed = 全部", () => {
    const h = harness();
    const failing: BatchNotesExecutor = {
      ...h.executor,
      execute: () => { throw new Error("disk I/O error"); },
    };
    const result = runBatchNotes({ action: "trash", ids: ["doc-1", "doc-2"] }, failing);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("failed");
    expect(result.message).toContain("disk I/O error");
    expect(result.results).toEqual([
      { id: "doc-1", ok: false, reason: "failed" },
      { id: "doc-2", ok: false, reason: "failed" },
    ]);
    expect(result.summary).toEqual({ total: 2, done: 0, failed: 2 });
  });

  it("成功时 execute 只调用一次（整批一次事务，不逐条）", () => {
    const h = harness();
    const spy = vi.fn(h.executor.execute);
    runBatchNotes({ action: "trash", ids: ["doc-1", "doc-2", "grp-1"] }, { ...h.executor, execute: spy });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toHaveLength(3);
  });
});

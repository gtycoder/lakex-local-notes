import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store / QuickNotesStore 模块加载即需要 electron（safeStorage 解密 S3 密钥、net）。
const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "../store.js";
import { QuickNotesStore } from "../quickNotes.js";
import { registerBatchNotesIpc, runDesktopBatchNotes, type BatchNotesIpcDeps } from "./registerBatchNotes.js";
import type { BatchNotesResultShape } from "../../src/lib/types.js";

/**
 * 261106 批量操作（桌面 batch_notes）：**先全部校验 → 单事务执行**、逐条结果、软删可恢复。
 * 硬约束（用户 261106）：
 * - 「删除」一律 = 移入回收站（lake: 软删进回收站；quickNotes: 软删进小记回收站），都可恢复；
 * - 批量通道**不得**调用任何 purge/物理删除方法（本文件用 spy 断言）；
 * - 笔记本不能多选（notebook-not-batchable）；部分不合法 ⇒ 整批不执行。
 */
let root: string;
let store: Store;
let quickNotes: QuickNotesStore;

function deps(over: Partial<BatchNotesIpcDeps> = {}): BatchNotesIpcDeps {
  return {
    store,
    getQuickNotes: () => quickNotes,
    activeTagIds: () => new Set(quickNotes.tagService.list().map((tag) => tag.id)),
    ...over,
  };
}

const run = (payload: unknown, over: Partial<BatchNotesIpcDeps> = {}): BatchNotesResultShape => runDesktopBatchNotes(payload, deps(over));

function fresh() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-batch-notes-"));
  store = new Store(root);
  store.bootstrap();
  quickNotes = new QuickNotesStore(root);
  const notebook = store.createNotebook("笔记本");
  return { notebook };
}

beforeEach(() => { fresh(); });
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  fs.rmSync(root, { recursive: true, force: true });
});

type Handler = (...args: unknown[]) => unknown;
function registerHarness(over: Partial<BatchNotesIpcDeps> = {}) {
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    registry: new Map(),
  };
  registerBatchNotesIpc(ipc as unknown as Parameters<typeof registerBatchNotesIpc>[0], deps(over));
  return { channels: () => [...handlers.keys()], call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) };
}

describe("batch_notes：通道与契约形状", () => {
  it("只注册 batch_notes 一个通道；结果结构 = { ok, results, summary, reason?, message? }", () => {
    const h = registerHarness();
    expect(h.channels()).toEqual(["batch_notes"]);
    const notebook = store.createNotebook("N2");
    const doc = store.createNoteIn(notebook.id, "文档");
    const result = h.call("batch_notes", { action: "trash", ids: [doc.id] }) as BatchNotesResultShape;
    expect(result).toEqual({
      ok: true,
      results: [{ id: doc.id, ok: true }],
      summary: { total: 1, done: 1, failed: 0 },
    });
  });

  it("restore / purge 都不在契约里 ⇒ invalid-action（整批不执行）", () => {
    const notebook = store.createNotebook("N3");
    const doc = store.createNoteIn(notebook.id, "文档");
    for (const action of ["restore", "purge", "empty-trash", "delete"]) {
      const result = run({ action, ids: [doc.id] });
      expect(result.ok, action).toBe(false);
      expect(result.reason, action).toBe("invalid-action");
    }
    expect(store.listTrash()).toEqual([]);
  });
});

describe("batch_notes：move（文档/分组，目标父级）", () => {
  it("两个文档移入分组：父级变化 + 追加到末尾 + 受影响行标 dirty", () => {
    const notebook = store.createNotebook("目标");
    const group = store.createGroup(notebook.id, "分组");
    const a = store.createNoteIn(notebook.id, "A");
    const b = store.createNoteIn(notebook.id, "B");
    const result = run({ action: "move", ids: [a.id, b.id], parentId: group.id });
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 2, done: 2, failed: 0 });
    const nodes = store.listTreeNodes();
    const moved = nodes.filter((node) => node.id === a.id || node.id === b.id);
    expect(moved.every((node) => node.parentId === group.id)).toBe(true);
    expect(moved.every((node) => node.isDirty === true)).toBe(true);
    // 追加语义：两条依次排在该分组下（sortOrder 递增，不重叠）
    const orders = moved.map((node) => node.sortOrder).sort((x, y) => x - y);
    expect(new Set(orders).size).toBe(2);
    // 文档行也同步了父级（notes.parent_id）
    expect(store.getNoteInfo(a.id).parents.map((parent) => parent.id)).toContain(group.id);
  });

  it("移动到自身后代 ⇒ parent-cycle，整批不执行", () => {
    const notebook = store.createNotebook("环");
    const parent = store.createGroup(notebook.id, "父");
    const child = store.createGroup(parent.id, "子");
    const doc = store.createNoteIn(parent.id, "文档");
    const result = run({ action: "move", ids: [doc.id, parent.id], parentId: child.id });
    expect(result.ok).toBe(false);
    expect(result.results).toEqual([
      { id: doc.id, ok: true },
      { id: parent.id, ok: false, reason: "parent-cycle" },
    ]);
    // 整批不执行：doc 仍在 parent 下
    expect(store.listTreeNodes().find((node) => node.id === doc.id)?.parentId).toBe(parent.id);
  });

  it("目标父级是文档 ⇒ parent-not-a-container；不存在 ⇒ parent-not-found", () => {
    const notebook = store.createNotebook("父级");
    const doc = store.createNoteIn(notebook.id, "文档");
    // 文档不能当容器（自身也同理）：请求级拒绝，不给逐条 cycle 机会
    expect(run({ action: "move", ids: [doc.id], parentId: doc.id }).reason).toBe("parent-not-a-container");
    const another = store.createNoteIn(notebook.id, "另一篇");
    expect(run({ action: "move", ids: [another.id], parentId: doc.id }).reason).toBe("parent-not-a-container");
    expect(run({ action: "move", ids: [another.id], parentId: "ghost-parent" }).reason).toBe("parent-not-found");
  });
});

describe("batch_notes：trash = 移入回收站（软删，可恢复；无 purge）", () => {
  it("文档进回收站并可恢复；正文文件没被删（不是物理删除）", () => {
    const notebook = store.createNotebook("回收站");
    const a = store.createNoteIn(notebook.id, "A");
    const b = store.createNoteIn(notebook.id, "B");
    const purge = vi.spyOn(store, "purgeTrashItem");
    const empty = vi.spyOn(store, "emptyTrash");
    const result = run({ action: "trash", ids: [a.id, b.id] });
    expect(result.ok).toBe(true);
    expect(store.listTrash().map((item) => item.id).sort()).toEqual([a.id, b.id].sort());
    expect(purge).not.toHaveBeenCalled();
    expect(empty).not.toHaveBeenCalled();
    // 软删保留正文：仍可读出内容，且回收站恢复能把它们放回原位置
    expect(store.readNote(a.id).bodyMissing).toBeFalsy();
    store.restoreTrashItem(a.id);
    expect(store.listTreeNodes().some((node) => node.id === a.id)).toBe(true);
    expect(store.listTrash().map((item) => item.id)).toEqual([b.id]);
  });

  it("分组不能批量删除（trash 只接受文档）⇒ unsupported，整批不执行", () => {
    const notebook = store.createNotebook("分组");
    const group = store.createGroup(notebook.id, "分组");
    const doc = store.createNoteIn(notebook.id, "文档");
    const result = run({ action: "trash", ids: [doc.id, group.id] });
    expect(result.ok).toBe(false);
    expect(result.results).toEqual([
      { id: doc.id, ok: true },
      { id: group.id, ok: false, reason: "unsupported" },
    ]);
    expect(store.listTrash()).toEqual([]);
  });

  it("笔记本一律 notebook-not-batchable（防御）", () => {
    const notebook = store.createNotebook("笔记本");
    const doc = store.createNoteIn(notebook.id, "文档");
    const result = run({ action: "trash", ids: [doc.id, notebook.id] });
    expect(result.ok).toBe(false);
    expect(result.results[1]).toEqual({ id: notebook.id, ok: false, reason: "notebook-not-batchable" });
    expect(store.listTrash()).toEqual([]);
  });

  it("部分不合法 ⇒ 整批不执行（合法项也不落地）", () => {
    const notebook = store.createNotebook("混合");
    const doc = store.createNoteIn(notebook.id, "文档");
    const result = run({ action: "trash", ids: [doc.id, "ghost-id"] });
    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({ total: 2, done: 1, failed: 1 });
    expect(store.listTrash()).toEqual([]);
  });

  it("space=quickNotes：小记进小记回收站并可恢复；内容文件保留、不调用 purge", () => {
    const q1 = quickNotes.createQuickNote({ text: "小记一", draftId: "d-batch-1", stagedImageIds: [] });
    const q2 = quickNotes.createQuickNote({ text: "小记二", draftId: "d-batch-2", stagedImageIds: [] });
    const purge = vi.spyOn(quickNotes, "purgeQuickNote");
    const purgeMissing = vi.spyOn(quickNotes, "purgeMissingQuickNote");
    const result = run({ action: "trash", ids: [q1.id, q2.id], space: "quickNotes" });
    expect(result.ok).toBe(true);
    expect(result.results.every((item) => item.ok)).toBe(true);
    expect(quickNotes.listQuickNoteTrash().map((item) => item.id).sort()).toEqual([q1.id, q2.id].sort());
    expect(purge).not.toHaveBeenCalled();
    expect(purgeMissing).not.toHaveBeenCalled();
    // 软删保留内容文件：恢复后能读回原文（= 进的是回收站，不是物理删除）
    expect(fs.existsSync(quickNotes.quickNotePathFor(q1.id))).toBe(true);
    const restored = quickNotes.restoreQuickNote(q1.id);
    expect(restored.content.text).toContain("小记一");
    expect(quickNotes.listQuickNoteTrash().map((item) => item.id)).toEqual([q2.id]);
  });

  it("小记空间降级（getQuickNotes=null）⇒ not-found，不落地", () => {
    const q = quickNotes.createQuickNote({ text: "小记", draftId: "d-batch-4", stagedImageIds: [] });
    const result = run({ action: "trash", ids: [q.id], space: "quickNotes" }, { getQuickNotes: () => null });
    expect(result.ok).toBe(false);
    expect(result.results[0]).toEqual({ id: q.id, ok: false, reason: "not-found" });
    expect(quickNotes.listQuickNoteTrash()).toEqual([]);
  });
});

describe("batch_notes：批量打标只追加（桌面契约）", () => {
  it("tag-add 保留已有顺序、只补缺的标签", () => {
    const notebook = store.createNotebook("标签");
    const doc = store.createNoteIn(notebook.id, "文档");
    const tagA = quickNotes.tagService.create("A");
    const tagB = quickNotes.tagService.create("B");
    store.documentTags.setNoteTags(doc.id, [tagB.id]);
    expect(run({ action: "tag-add", ids: [doc.id], tagIds: [tagA.id, tagB.id] }).ok).toBe(true);
    expect(store.documentTags.getDocumentTagIds(doc.id)).toEqual([tagB.id, tagA.id]);
  });

  it("标签不存在 ⇒ tag-not-found，关系不变", () => {
    const notebook = store.createNotebook("标签2");
    const doc = store.createNoteIn(notebook.id, "文档");
    const tagB = quickNotes.tagService.create("B");
    store.documentTags.setNoteTags(doc.id, [tagB.id]);
    const result = run({ action: "tag-add", ids: [doc.id], tagIds: ["tag-ghost"] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tag-not-found");
    expect(store.documentTags.getDocumentTagIds(doc.id)).toEqual([tagB.id]);
  });

  it("activeTagIds=null ⇒ tag-unavailable", () => {
    const notebook = store.createNotebook("标签3");
    const doc = store.createNoteIn(notebook.id, "文档");
    const result = run({ action: "tag-add", ids: [doc.id], tagIds: ["t"] }, { activeTagIds: () => null });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tag-unavailable");
  });

  it("tag-remove 在桌面契约中不支持（仍然是移动端自己的入口）", () => {
    const notebook = store.createNotebook("标签4");
    const doc = store.createNoteIn(notebook.id, "文档");
    const tag = quickNotes.tagService.create("A");
    store.documentTags.setNoteTags(doc.id, [tag.id]);
    const result = run({ action: "tag-remove", ids: [doc.id], tagIds: [tag.id] });
    expect(result.results[0]).toEqual({ id: doc.id, ok: false, reason: "unsupported" });
  });
});

describe("batch_notes：执行期异常 ⇒ 整批回滚（不产生半批）", () => {
  it("第 2 条落地抛错 ⇒ 第 1 条也回滚、逐条 failed", () => {
    const notebook = store.createNotebook("回滚");
    const a = store.createNoteIn(notebook.id, "A");
    const b = store.createNoteIn(notebook.id, "B");
    const realTrash = (id: string) => { store.deleteTreeNode(id); };
    let calls = 0;
    const result = run({ action: "trash", ids: [a.id, b.id] }, {
      apply: {
        trashNode: (id) => {
          calls += 1;
          if (calls === 2) throw new Error("disk I/O error");
          realTrash(id);
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("failed");
    expect(result.message).toContain("disk I/O error");
    expect(result.results).toEqual([
      { id: a.id, ok: false, reason: "failed" },
      { id: b.id, ok: false, reason: "failed" },
    ]);
    // 事务回滚：第一条的软删也没有留下
    expect(store.listTrash()).toEqual([]);
  });
});

describe("batch_notes：接线与硬红线（静态守卫）", () => {
  // 261112 R2：registerIpc 已从 main.ts 拆到 boot/ipcWiring.ts ⇒ 静态守卫按「入口 + 接线」聚合读。
  const mainSource = fs.readFileSync(new URL("../main.ts", import.meta.url), "utf8")
    + "\n" + fs.readFileSync(new URL("../boot/ipcWiring.ts", import.meta.url), "utf8");
  const handlerSource = fs.readFileSync(new URL("./registerBatchNotes.ts", import.meta.url), "utf8");

  it("main 注册 batch_notes 且把它列进 TREE_CHANGING_CHANNELS（整批只广播一次，不逐条）", () => {
    expect(mainSource).toContain("registerBatchNotesIpc(ipc, {");
    // 目录树变更集合里必须有它 —— 否则其它窗口/浏览器端看不到批量结果
    const block = /const TREE_CHANGING_CHANNELS = new Set<string>\(\[([\s\S]*?)\]\);/.exec(mainSource);
    expect(block, "找不到 TREE_CHANGING_CHANNELS 定义").not.toBeNull();
    expect(block![1]).toContain('"batch_notes"');
  });

  it("批量通道里没有任何 purge / 物理删除调用（删除只能是移入回收站）", () => {
    // 红线：purgeTrashItem / emptyTrash / purgeQuickNote / 任何 purge* 调用都不许出现在批量实现里
    expect(handlerSource).not.toMatch(/\.(purge[A-Za-z]*|emptyTrash)\s*\(/);
    // 软删才是唯一删除路径
    expect(handlerSource).toContain("store.deleteTreeNode("); // lake：移入回收站
    expect(handlerSource).toContain("deleteQuickNote("); // quickNotes：移入小记回收站
  });
});
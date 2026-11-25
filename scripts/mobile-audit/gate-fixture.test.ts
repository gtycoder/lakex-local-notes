/**
 * gate-fixture.mjs 的语义护栏（261125 门禁重建）。
 *
 * 背景：夹具在设备 WebView 里以表达式求值（cdp-eval @file），没有模块面可直接 import ——
 * 这里把整份源码当表达式跑在假 window.lakeNative 上，把两条会被静默破坏的语义钉死：
 *  1. 笔记本判据必须认 `nodeType`（TreeNode.type 已改名 nodeType，认旧字段会静默回落失败）；
 *  2. 默认笔记本**不假设固定 id 一定存在**（真实库/便携导入没有 notebook-personal，261125 现场 78 文档库里直接报「没有可用笔记本」）：
 *     优先种子 notebook-personal，缺失时回落「书架第一本普通笔记本」——口径与
 *     src/mobile/notebook/libraryNotebooks.ts 同源（notebook 且非日记本 space==='diary' 且非回收站 notebook-trash），
 *     home-doc 态点的就是书架第一张卡，回落错本 ⇒ 门禁假红。
 *  3. 既有语义不回退：固定夹具 = 默认笔记本下 5 篇文档 + 4 条小记、按标题幂等、欢迎小记（welcome-quick-note）必清。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const source = readFileSync(resolve("scripts/mobile-audit/gate-fixture.mjs"), "utf8");

type Node = { id: string; nodeType: string; title: string; sortOrder: number; space?: string | null };
type Init = { treeNodes: Node[]; notes?: Array<{ id: string; title: string }>; quickItems?: Array<{ id: string; previewText?: string }> };

function makeLakeNative(init: Init) {
  const state = {
    treeNodes: init.treeNodes.map((n) => ({ ...n })),
    notes: (init.notes ?? []).map((n) => ({ ...n })),
    quickItems: (init.quickItems ?? []).map((q) => ({ ...q })),
  };
  const created: Array<{ title: string; parentId: string }> = [];
  const quickCreated: string[] = [];
  const purged: string[] = [];
  let nextId = 0;
  const api = {
    async getHomeSnapshot() {
      return { treeNodes: state.treeNodes.map((n) => ({ ...n })), notes: state.notes.map((n) => ({ ...n })) };
    },
    async getQuickNotePage() {
      return { items: state.quickItems.map((q) => ({ ...q })) };
    },
    async createNote(title: string, parentId: string | null) {
      created.push({ title, parentId: String(parentId) });
      const note = { id: `note-${++nextId}`, title };
      state.notes.push(note);
      return note;
    },
    async createQuickNote(text: string) {
      quickCreated.push(text);
      const item = { id: `qn-${++nextId}`, previewText: text };
      state.quickItems.push(item);
      return item;
    },
    async purgeQuickNote(id: string) {
      purged.push(id);
      state.quickItems = state.quickItems.filter((q) => q.id !== id);
    },
  };
  return { api, created, quickCreated, purged };
}

async function runFixture(init: Init) {
  const mock = makeLakeNative(init);
  // 夹具是表达式（async IIFE）：包一层函数体求值，行为与 cdp-eval @file 一致。
  const run = new Function("window", `"use strict"; return (${source}\n);`) as (w: unknown) => Promise<Record<string, unknown>>;
  const result = await run({ lakeNative: mock.api });
  return { result, ...mock };
}

const nb = (id: string, extra: Partial<Node> = {}): Node => ({ id, nodeType: "notebook", title: id, sortOrder: 0, space: null, ...extra });

it("全新库：5 篇文档落在种子默认笔记本 notebook-personal，4 条小记 + 欢迎小记清掉", async () => {
  const { result, created, quickCreated, purged } = await runFixture({
    treeNodes: [nb("notebook-personal", { title: "个人笔记" })],
    quickItems: [{ id: "welcome-quick-note", previewText: "欢迎使用" }],
  });
  expect(result.error).toBeUndefined();
  expect(result.notebook).toMatchObject({ id: "notebook-personal" });
  expect(created).toHaveLength(5);
  expect(created.every((c) => c.parentId === "notebook-personal")).toBe(true);
  expect(quickCreated).toHaveLength(4);
  expect(purged).toEqual(["welcome-quick-note"]);
  expect(result.docsCreated).toBe(5);
  expect(result.quickCreated).toBe(4);
  expect(result.welcomeRemoved).toBe(true);
});

it("没有 notebook-personal 的库（真实个人库）：回落书架第一本普通笔记本，不再报「没有可用笔记本」", async () => {
  const { result, created } = await runFixture({
    treeNodes: [nb("nb-aaa", { sortOrder: 0 }), nb("nb-bbb", { sortOrder: 1 })],
  });
  expect(result.error).toBeUndefined();
  expect(result.notebook).toMatchObject({ id: "nb-aaa" });
  expect(created).toHaveLength(5);
  expect(created.every((c) => c.parentId === "nb-aaa")).toBe(true);
});

it("回落跳过回收站与日记本（与 libraryNotebooks 同口径），只认 nodeType 不认旧 type 字段", async () => {
  const { result, created } = await runFixture({
    treeNodes: [
      nb("notebook-trash", { title: "回收站", sortOrder: 0 }),
      nb("diary-nb", { title: "日记", sortOrder: 1, space: "diary" }),
      nb("notebook-real", { title: "普通本", sortOrder: 2 }),
    ],
  });
  expect(result.error).toBeUndefined();
  expect(result.notebook).toMatchObject({ id: "notebook-real" });
  expect(created.every((c) => c.parentId === "notebook-real")).toBe(true);
});

it("幂等：夹具标题/小记已存在时不重建，欢迎小记仍清", async () => {
  const docs = [1, 2, 3, 4, 5].map((i) => ({ id: `d${i}`, title: `夹具文档 ${i}` }));
  const quicks = [1, 2, 3, 4].map((i) => ({ id: `q${i}`, previewText: `夹具小记 ${i}` }));
  const { result, created, quickCreated, purged } = await runFixture({
    treeNodes: [nb("notebook-personal")],
    notes: docs,
    quickItems: [...quicks, { id: "welcome-quick-note", previewText: "欢迎使用" }],
  });
  expect(created).toHaveLength(0);
  expect(quickCreated).toHaveLength(0);
  expect(purged).toEqual(["welcome-quick-note"]);
  expect(result.docsCreated).toBe(0);
  expect(result.quickCreated).toBe(0);
  expect(result.docsTotal).toBe(5);
  expect(result.quickTotal).toBe(4);
  expect(result.welcomeRemoved).toBe(true);
});

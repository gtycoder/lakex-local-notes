/**
 * 首页「知识库」卡片文档计数的聚合护栏（261119 用户点单）：
 * 卡片要显示**整棵子树的文档总数**（任意深度分组/嵌套文档），不是只数根目录直属文档
 * （现场：库里 4 个分组、分组里有文档，卡片却显示「0 篇」）。
 *
 * 口径逐条钉住：多级分组 4 层、note 作父的嵌套文档、回收站/purge/trashed 墓碑不计、
 * 悬空/成环不计、空库 0；接线断言保证 MobileApp 的 docCounts 真的走这个函数。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRASH_NOTEBOOK_ID } from "../../core/syncDecisions.js";
import {
  notebookSubtreeDocCounts,
  type DocCountFolderLike,
  type DocCountNoteLike,
} from "./notebookDocCounts";

const folder = (id: string, parentId: string | null): DocCountFolderLike => ({ id, parentId });
const note = (id: string, parentId: string | null, over: Partial<DocCountNoteLike> = {}): DocCountNoteLike =>
  ({ id, parentId, ...over });

describe("notebookSubtreeDocCounts（笔记本子树文档总数）", () => {
  it("4 层分组：任意深度分组内的文档都算进笔记本（不是只数根目录直属）", () => {
    // nb → g1 → g2 → g3 → n4；每层各挂一篇直属文档。
    const folders = [
      folder("nb", null),
      folder("g1", "nb"), folder("g2", "g1"), folder("g3", "g2"),
    ];
    const notes = [
      note("n0", "nb"),   // 根目录直属（旧实现只数得到它）
      note("n1", "g1"),
      note("n2", "g2"),
      note("n3", "g3"),
      note("n4", "n3"),   // 嵌套文档（note 也可作父节点）
    ];
    expect(notebookSubtreeDocCounts(folders, notes)).toEqual({ nb: 5 });
  });

  it("现场场景：文档全在分组里 ⇒ 卡片是总数而不是 0 篇", () => {
    const folders = [
      folder("nb", null),
      folder("g1", "nb"), folder("g2", "nb"), folder("g3", "nb"), folder("g4", "nb"),
    ];
    const notes = [
      note("n1", "g1"), note("n2", "g2"), note("n3", "g3"), note("n4", "g4"),
    ];
    // 旧实现（只按 parentId 归组）在这里给出 { g1: 1, g2: 1, g3: 1, g4: 1 } ⇒ nb 卡片 0 篇。
    expect(notebookSubtreeDocCounts(folders, notes)).toEqual({ nb: 4 });
  });

  it("多个笔记本各自独立计数；根级节点外的悬空归属不串台", () => {
    const folders = [folder("nb-a", null), folder("nb-b", null), folder("ga", "nb-a"), folder("gb", "nb-b")];
    const notes = [note("a1", "nb-a"), note("a2", "ga"), note("b1", "gb"), note("x", null)];
    expect(notebookSubtreeDocCounts(folders, notes)).toEqual({ "nb-a": 2, "nb-b": 1, x: 1 });
  });

  it("回收站不计：parentId 指向回收站、回收站子树后代、trashed 墓碑（级联只标 trashed_at）", () => {
    const folders = [
      folder("nb", null), folder("g-live", "nb"),
      folder(TRASH_NOTEBOOK_ID, null), folder("g-trash", TRASH_NOTEBOOK_ID),
    ];
    const notes = [
      note("live", "g-live"),
      note("in-trash", TRASH_NOTEBOOK_ID),                 // 直接挂回收站（isGoneNote）
      note("under-trash-group", "g-trash"),                // 回收站子树后代
      note("tombstoned", "g-live", { trashedAt: "2026-11-01T00:00:00.000Z" }), // 级联墓碑（parent_id 不变）
    ];
    expect(notebookSubtreeDocCounts(folders, notes)).toEqual({ nb: 1 });
  });

  it("trashed 父节点的子文档不计（树可见性：活跃链断了就整支不可见）", () => {
    const folders = [folder("nb", null), folder("g", "nb")];
    const notes = [
      note("parent-doc", "g", { trashedAt: "2026-11-01T00:00:00.000Z" }),
      note("child-doc", "parent-doc"), // 自己没标 trashed，但父已进回收站 ⇒ 树里看不见，不计
      note("ok", "g"),
    ];
    expect(notebookSubtreeDocCounts(folders, notes)).toEqual({ nb: 1 });
  });

  it("purge 不计：is_purged 标记行与 syncState=purged 都按 core.isGoneNote 剔除", () => {
    const folders = [folder("nb", null)];
    const notes = [
      note("ok", "nb"),
      note("purged-flag", "nb", { isPurged: true }),
      note("purged-state", "nb", { syncState: "purged" }),
    ];
    expect(notebookSubtreeDocCounts(folders, notes)).toEqual({ nb: 1 });
  });

  it("悬空（父不在位）与坏库成环不计，且有限时间返回", () => {
    const folders = [folder("nb", null)];
    const notes = [
      note("ok", "nb"),
      note("dangling", "missing-parent"),
      note("c1", "c2"), note("c2", "c1"), // 环
      note("self", "self"),               // 自环
    ];
    expect(notebookSubtreeDocCounts(folders, notes)).toEqual({ nb: 1 });
  });

  it("空库 / 空笔记本给 0（卡片照常显示「0 篇」）", () => {
    expect(notebookSubtreeDocCounts([], [])).toEqual({});
    expect(notebookSubtreeDocCounts([folder("nb", null)], [])).toEqual({});
  });

  it("memo 语义：同一棵树多篇文档共享根解析结果，结果不随调用顺序漂移", () => {
    const folders = [folder("nb", null), folder("g1", "nb"), folder("g2", "g1"), folder("g3", "g2")];
    const notes = [note("n1", "g3"), note("n2", "g3"), note("n3", "g1"), note("n4", "nb")];
    expect(notebookSubtreeDocCounts(folders, notes)).toEqual({ nb: 4 });
    // 反序输入给出同一答案（链 memo 不依赖遍历顺序）。
    expect(notebookSubtreeDocCounts(folders, [...notes].reverse())).toEqual({ nb: 4 });
  });

  it("接线：MobileApp 的 docCounts 必须走 notebookSubtreeDocCounts（不在组件里重写计数判据）", () => {
    const app = readFileSync(path.join(process.cwd(), "src/mobile/MobileApp.tsx"), "utf8");
    // 判据写成纯字符串（别在这里写正则：引号串里的反斜杠会被 JS 吃掉，见 AGENTS §7#21）。
    expect(app).toContain("const docCounts = useMemo(() => notebookSubtreeDocCounts(treeNodes, notes), [treeNodes, notes]);");
  });
});

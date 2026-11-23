import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { createLocalSecretCipher } from "./secretCipher.js";

/**
 * 261117 用户点单「新建文档位置」的行为护栏：
 * 顶部新增 / 末尾追加不仅要写进设置，还要真的改变**同级插入顺序**，且**子级同样生效**；
 * 覆盖文档（doc/usheet/bitable/board/ink）、分组、笔记本，以及「缺省/非法值 = 末尾」的向后兼容。
 *
 * 排序单一实现 = electron/treeSort.ts（文档两表同事务、目录只有 tree_nodes）；这里从行为面钉住。
 */
const secrets = new Map<string, string>();
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); secrets.set(id, value); return Buffer.from(id); },
    decryptString: (buf: Buffer) => secrets.get(buf.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

let dir: string;
let store: Store;
/** 专用笔记本（避开 bootstrap 的欢迎笔记，排序断言才干净）。 */
let notebookId: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-position-test-"));
  secrets.clear();
  store = new Store(dir, createLocalSecretCipher(dir));
  store.bootstrap();
  notebookId = store.createNotebook("测试本").id;
});

/** 某父节点下同级节点标题（按 sort_order 升序）。 */
function orderOf(parentId: string | null): string[] {
  return store.listTreeNodes()
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((node) => node.title);
}

/** 文档的 notes 行与 tree_nodes 行排序必须一致（两表都有一份 sort_order）。 */
function noteOrderOf(parentId: string): string[] {
  return store.listNoteSummaries()
    .filter((note) => note.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((note) => note.title);
}

describe("新建文档位置：顶部新增 / 末尾追加", () => {
  it("文档：缺省（旧调用点）= 末尾；top = 同级第一个；子级同样生效", () => {
    store.createNoteIn(notebookId, "A");
    store.createNoteIn(notebookId, "B");
    expect(orderOf(notebookId)).toEqual(["A", "B"]);

    store.createNoteIn(notebookId, "顶部文档", "top");
    expect(orderOf(notebookId)).toEqual(["顶部文档", "A", "B"]);
    expect(noteOrderOf(notebookId)).toEqual(["顶部文档", "A", "B"]);

    // 子级：分组下新建（parentId 指向分组）同样按 top 落位
    const group = store.createGroup(notebookId, "分组1");
    store.createNoteIn(group.id, "子1");
    store.createNoteIn(group.id, "子顶部", "top");
    expect(orderOf(group.id)).toEqual(["子顶部", "子1"]);

    // 非法值归一为末尾（向后兼容 + 手改存档不炸）；分组也是同级节点，按排序参与
    store.createNoteIn(notebookId, "非法值", "whatever" as "top");
    expect(orderOf(notebookId)).toEqual(["顶部文档", "A", "B", "分组1", "非法值"]);
  });

  it("表格 / 多维表 / 画板 / 手写板：都跟随设置", () => {
    store.createUsheetIn(notebookId, "表格");
    store.createBitableIn(notebookId, "多维表");
    store.createBoardIn(notebookId, "画板");
    store.createInkIn(notebookId, "手写板");
    store.createUsheetIn(notebookId, "顶部表格", "top");
    store.createBitableIn(notebookId, "顶部多维表", "top");
    store.createBoardIn(notebookId, "顶部画板", "top");
    store.createInkIn(notebookId, "顶部手写板", "top");
    // 每次 top 插到最前 ⇒ 后插的排前面，四者都在底部创建的四个之前
    expect(orderOf(notebookId).slice(0, 4)).toEqual(["顶部手写板", "顶部画板", "顶部多维表", "顶部表格"]);
    expect(orderOf(notebookId).slice(4)).toEqual(["表格", "多维表", "画板", "手写板"]);
  });

  it("分组：top 插到同级最前，子级同样生效", () => {
    const g1 = store.createGroup(notebookId, "g1");
    store.createGroup(notebookId, "g2");
    store.createGroup(notebookId, "gTop", "top");
    expect(orderOf(notebookId)).toEqual(["gTop", "g1", "g2"]);

    const g2 = store.listTreeNodes().find((node) => node.title === "g2")!;
    store.createGroup(g2.id, "子g1");
    store.createGroup(g2.id, "子gTop", "top");
    expect(orderOf(g2.id)).toEqual(["子gTop", "子g1"]);
    expect(g1.id).toBeTruthy();
  });

  it("笔记本（根层）：top 插到最前、末尾追加排最后", () => {
    expect(orderOf(null)).toEqual(["个人笔记", "测试本"]);

    store.createNotebook("新末尾笔记本");
    expect(orderOf(null)).toEqual(["个人笔记", "测试本", "新末尾笔记本"]);

    store.createNotebook("新顶部笔记本", null, undefined, "top");
    expect(orderOf(null)).toEqual(["新顶部笔记本", "个人笔记", "测试本", "新末尾笔记本"]);
  });

  it("顶部新增不改已有条目内容/标题，只挪 sort_order（两表一致）", () => {
    const a = store.createNoteIn(notebookId, "A");
    const b = store.createNoteIn(notebookId, "B");
    store.createNoteIn(notebookId, "C", "top");
    expect(store.readNote(a.id).title).toBe("A");
    expect(store.readNote(b.id).title).toBe("B");
    // 两表排序完全一致（防止只挪一张表导致目录/文档列表错位）
    expect(noteOrderOf(notebookId)).toEqual(orderOf(notebookId));
  });
});

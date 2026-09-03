import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { Store, AppError, selectHistoryDrops, isoWeekKey } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";

// ===== electron mock（Store 模块加载即需要；DB 用例只用 safeStorage 的 S3 密钥加解密） =====
const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  let encryptionAvailable = true;
  return {
    secrets,
    setEncryptionAvailable(v: boolean) { encryptionAvailable = v; },
    getEncryptionAvailable() { return encryptionAvailable; },
  };
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => electronMock.getEncryptionAvailable(),
    encryptString: (value: string) => {
      const id = crypto.randomUUID();
      electronMock.secrets.set(id, value);
      return Buffer.from(id);
    },
    decryptString: (buf: Buffer) => electronMock.secrets.get(buf.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

// ===== 工具 =====
let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-store-test-"));
  electronMock.secrets.clear();
  electronMock.setEncryptionAvailable(true);
  store = new Store(dir, createSafeStorageSecretCipher());
});

/** 另开连接直读 Store 的 SQLite（验证落盘内容，如 S3 密钥是否加密） */
function rawDbValue(sql: string): string | undefined {
  const db = new Database(path.join(dir, "metadata.sqlite3"), { readonly: true });
  try {
    const row = db.prepare(sql).get() as { value?: string } | undefined;
    return row?.value;
  } finally {
    db.close();
  }
}

function makeNote(): { id: string; title: string } {
  const note = store.createNote("测试笔记");
  return { id: note.id, title: note.title };
}

// 构造可被 referencedFilenames 识别的资源文件名
function assetFilename(): string {
  return `${Date.now()}_${crypto.randomBytes(4).toString("hex")}.png`;
}

// ===== 测试 =====

describe("Store 完整性检查", () => {
  it("returns healthy for a newly initialized database", () => {
    expect(store.checkIntegrity()).toEqual({ ok: true, integrity: "ok", foreignKeyErrors: 0 });
  });
});

describe("Store 初始化 / bootstrap", () => {
  it("初始化后种子数据：个人笔记本 + 欢迎笔记", () => {
    const boot = store.bootstrap();
    const notebooks = store.listTreeNodes().filter((n) => n.nodeType === "notebook");
    expect(notebooks.length).toBe(1);
    expect(notebooks[0].title).toBe("个人笔记");
    expect(boot.notes.some((n) => n.id === "welcome-note")).toBe(true);
    expect(boot.lastOpenedNoteId).toBeNull();
  });

  it("同目录重复初始化不产生重复种子", () => {
    const store2 = new Store(dir);
    const notebooks = store2.listTreeNodes().filter((n) => n.nodeType === "notebook");
    expect(notebooks.length).toBe(1);
  });
});

describe("笔记创建 / 读取 / 保存", () => {
  it("createNote 写入 .lake 文件 + DB + 树节点", () => {
    const note = store.createNote("标题A");
    expect(note.parentId).toBe("notebook-personal");
    expect(note.syncState).toBe("local");
    expect(fs.existsSync(path.join(dir, "notes", `${note.id}.lake`))).toBe(true);
    const tree = store.listTreeNodes().find((n) => n.id === note.id);
    expect(tree?.nodeType).toBe("note");
    expect(tree?.noteFileId).toBe(note.id);
  });

  it("readNote 内容一致，并记录 last_opened_note_id", () => {
    const { id } = makeNote();
    const read = store.readNote(id);
    expect(read.content).toContain("ne-p");
    expect(store.bootstrap().lastOpenedNoteId).toBe(id);
  });

  it("readNote 不存在抛 NotFound", () => {
    expect(() => store.readNote("missing")).toThrowError(AppError);
    expect(() => store.readNote("missing")).toThrowError(/不存在/);
  });

  it("getNoteDigest 返回轻量状态：title/updatedAt 随保存变化，软删除后 deleted=true，purge 后返回 null", () => {
    const { id } = makeNote();
    const d1 = store.getNoteDigest(id);
    expect(d1).not.toBeNull();
    expect(d1!.id).toBe(id);
    expect(d1!.deleted).toBe(false);
    expect(d1!.title).toBe("测试笔记");

    // 保存后 updatedAt/title 变化（正文变化不读文件也能感知）
    const saved = store.saveNote(id, "改名", "<p>新内容</p>");
    const d2 = store.getNoteDigest(id);
    expect(d2!.title).toBe("改名");
    expect(d2!.updatedAt).toBe(saved.updatedAt);

    // 软删除 → deleted=true（正文/元数据仍在，仅标记）
    store.deleteTreeNode(id);
    const d3 = store.getNoteDigest(id);
    expect(d3!.deleted).toBe(true);

    // purge 彻底删除 → 返回 null
    store.purgeTrashItem(id);
    expect(store.getNoteDigest(id)).toBeNull();
  });

  it("getNoteDigest 不存在的笔记返回 null", () => {
    expect(store.getNoteDigest("missing")).toBeNull();
  });

  it("saveNote 更新标题与内容（DB + 文件）", () => {
    const { id } = makeNote();
    const content = "<h1 id='x'>新内容</h1>";
    const saved = store.saveNote(id, "新标题", content);
    expect(saved.title).toBe("新标题");
    expect(fs.readFileSync(path.join(dir, "notes", `${id}.lake`), "utf8")).toBe(content);
    const read = store.readNote(id);
    expect(read.title).toBe("新标题");
  });

  it("saveNote 不存在的笔记抛 NotFound", () => {
    expect(() => store.saveNote("missing", "t", "<p></p>")).toThrowError(/不存在/);
  });
});

describe("目录树操作", () => {
  it("createNotebook / createGroup / renameTreeNode", () => {
    const nb = store.createNotebook("工作");
    expect(nb.nodeType).toBe("notebook");
    const group = store.createGroup(nb.id, "项目A");
    expect(group.nodeType).toBe("group");
    const renamed = store.renameTreeNode(group.id, "项目B");
    expect(renamed.title).toBe("项目B");
    // 树节点 + 同名笔记联动
    const note = store.createNoteIn(group.id, "n1");
    store.renameTreeNode(note.id, "n1改");
    expect(store.readNote(note.id).title).toBe("n1改");
  });

  it("renameTreeNode 空标题抛 InvalidInput，不存在抛 NotFound", () => {
    expect(() => store.renameTreeNode("x", "  ")).toThrowError(/不能为空/);
    expect(() => store.renameTreeNode("missing", "合法")).toThrowError(/不存在/);
  });

  it("moveTreeNode 常规移动 + 自移/移入子孙报错", () => {
    const nb1 = store.createNotebook("本1");
    const nb2 = store.createNotebook("本2");
    const note = store.createNoteIn(nb1.id, "移动我");
    const moved = store.moveTreeNode(note.id, nb2.id, 0);
    expect(moved.parentId).toBe(nb2.id);

    expect(() => store.moveTreeNode(note.id, note.id, 0)).toThrowError(/自身/);
    // 建层级：A -> B -> C，把 A 移到 C 下应报错
    const a = store.createGroup(nb1.id, "A");
    const b = store.createGroup(a.id, "B");
    const c = store.createGroup(b.id, "C");
    expect(() => store.moveTreeNode(a.id, c.id, 0)).toThrowError(/子节点/);
  });

  it("reorderTreeNodes 更新顺序（须包含全部子节点）", () => {
    const n1 = store.createNote("一");
    const n2 = store.createNote("二");
    // 完整列表（notebook 下还有 welcome-note）：逆序
    const allIds = store.listTreeNodes().filter((n) => n.parentId === "notebook-personal").map((n) => n.id);
    const reversed = [n2.id, n1.id, ...allIds.filter((id) => id !== n1.id && id !== n2.id)];
    store.reorderTreeNodes("notebook-personal", reversed);
    const rows = store.listTreeNodes().filter((n) => n.nodeType === "note");
    expect(rows.findIndex((r) => r.id === n2.id)).toBeLessThan(rows.findIndex((r) => r.id === n1.id));
  });

  it("reorderTreeNodes 校验：重复/外部节点/遗漏都拒绝（审计#9）", () => {
    const n1 = store.createNote("一");
    const n2 = store.createNote("二");
    const allIds = store.listTreeNodes().filter((n) => n.parentId === "notebook-personal").map((n) => n.id);
    expect(() => store.reorderTreeNodes("notebook-personal", [n1.id, n1.id, ...allIds.filter((id) => id !== n1.id)])).toThrowError(/重复/);
    const external = store.createNoteIn(store.createNotebook("另册").id, "外部").id;
    const withExternal = [...allIds.filter((id) => id !== n2.id), external];
    expect(() => store.reorderTreeNodes("notebook-personal", withExternal)).toThrowError(/不属于该父节点/);
    expect(() => store.reorderTreeNodes("notebook-personal", [n1.id, n2.id])).toThrowError(/全部子节点/);
  });

  it("moveTreeNode/建组/建笔记支持多层嵌套，notebook 仍只能位于根层", () => {
    const note = store.createNote("文档");
    // 文档可套分组/文档（多层嵌套）
    const group = store.createGroup(note.id, "文档下的分组");
    const childNote = store.createNoteIn(note.id, "文档下的文档");
    expect(store.listTreeNodes().find((n) => n.id === group.id)?.parentId).toBe(note.id);
    expect(store.listTreeNodes().find((n) => n.id === childNote.id)?.parentId).toBe(note.id);
    // 分组可套文档/分组
    const groupChild = store.createNoteIn(group.id, "分组下的文档");
    const group2 = store.createGroup(group.id, "分组下的分组");
    expect(store.listTreeNodes().find((n) => n.id === groupChild.id)?.parentId).toBe(group.id);
    expect(store.listTreeNodes().find((n) => n.id === group2.id)?.parentId).toBe(group.id);
    // notebook 只能位于根层
    const nb = store.createNotebook("根本");
    const nb2 = store.createNotebook("根本2");
    expect(() => store.moveTreeNode(nb.id, note.id, 0)).toThrowError(/笔记本只能位于根层/);
    expect(() => store.moveTreeNode(nb.id, nb2.id, 0)).toThrowError(/笔记本只能位于根层/);
    // note/group 不能位于根层
    const group3 = store.createGroup(nb2.id, "组");
    expect(() => store.moveTreeNode(note.id, null, 0)).toThrowError(/必须位于目录节点下/);
    expect(() => store.moveTreeNode(group3.id, null, 0)).toThrowError(/必须位于目录节点下/);
  });

  it("重复保存同一正文只更新派生缓存，不产生新的同步修改", () => {
    const note = store.createNote("幂等保存");
    const first = store.saveNote(note.id, "幂等保存", "<p>same</p>", { markdown: "same", plain: "same" });
    expect(store.readNote(note.id).syncState).toBe("local");
    // 先模拟已经同步，第二次相同保存不应重新标记 local 或更新时间。
    (store as any).db.prepare("UPDATE notes SET sync_state='synced' WHERE id=?").run(note.id);
    (store as any).db.prepare("UPDATE tree_nodes SET sync_state='synced' WHERE note_file_id=?").run(note.id);
    const before = store.readNote(note.id);
    const second = store.saveNote(note.id, "幂等保存", "<p>same</p>", { markdown: "same", plain: "same" });
    expect(second.updatedAt).toBe(before.updatedAt);
    expect(store.readNote(note.id).syncState).toBe("synced");
    expect(first.content).toBe(second.content);
  });

  it("saveNote 写入文本缓存，updateNoteCaches/readNoteCaches 可单独读写", () => {
    const note = store.createNote("缓存测试");
    const saved = store.saveNote(note.id, "缓存测试", "<p>hello</p>", { markdown: "# hello\n", plain: "hello" });
    expect(saved).toBeTruthy();
    const caches = store.readNoteCaches(note.id);
    expect(caches.markdown).toBe("# hello\n");
    expect(caches.plain).toBe("hello");
    // 不带缓存保存时不应清空已有缓存（老调用兼容）
    store.saveNote(note.id, "缓存测试2", "<p>hi</p>");
    expect(store.readNoteCaches(note.id).markdown).toBe("# hello\n");
    // 单独更新缓存
    store.updateNoteCaches(note.id, "# hi", "hi");
    const c2 = store.readNoteCaches(note.id);
    expect(c2.markdown).toBe("# hi");
    expect(c2.plain).toBe("hi");
  });

  it("ensureNoteCaches：缓存缺失时从 .lake 磁盘兜底生成，已有缓存不覆盖", () => {
    const note = store.createNote("锁定缓存");
    // 初始无缓存（createNote 不写缓存）
    expect(store.readNoteCaches(note.id).markdown).toBeNull();
    // 写入 .lake 正文（模拟锁定前从未编辑保存，只有持久化正文）
    const lakeHtml = '<p><span>锁定正文</span><a href="https://x.com">链接</a></p>';
    fs.writeFileSync((store as any).notePath(note.id), lakeHtml, "utf8");
    expect(store.ensureNoteCaches(note.id)).toBe(true);
    const caches = store.readNoteCaches(note.id);
    expect(caches.markdown).toBe("锁定正文链接");
    expect(caches.plain).toBe("锁定正文链接");
    // 已有缓存时不再覆盖（保持既有高质量缓存）
    store.updateNoteCaches(note.id, "# 已有缓存", "已有缓存");
    fs.writeFileSync((store as any).notePath(note.id), '<p>新正文</p>', "utf8");
    expect(store.ensureNoteCaches(note.id)).toBe(false);
    expect(store.readNoteCaches(note.id).markdown).toBe("# 已有缓存");
    // 显式传 lakeContent 时用传入内容（不读盘）
    store.updateNoteCaches(note.id, null, null);
    expect(store.ensureNoteCaches(note.id, "<p>传入内容</p>")).toBe(true);
    expect(store.readNoteCaches(note.id).plain).toBe("传入内容");
  });

  it("exportNotePackage 导出 Markdown + 复制图片 + 改写相对引用（缺失图跳过）", () => {
    const note = store.createNote("资料包导出测试");
    // 造一个真实图片文件到 note-assets/{noteId}/
    const assetsDir = (store as any).noteAssetsDirFor(note.id);
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "test.png"), Buffer.from([1, 2, 3, 4]));
    const md = `# 标题\n\n![](http://127.0.0.1:19876/${note.id}/test.png)\n\n![](http://127.0.0.1:19876/${note.id}/missing.png)\n\n正文`;
    store.saveNote(note.id, "资料包导出测试", "<p>正文</p>", { markdown: md, plain: "正文" });
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "lake-pkg-"));
    const result = store.exportNotePackage(note.id, base);
    expect(result.imageCount).toBe(1);
    expect(result.skipped).toBe(1);
    const index = fs.readFileSync(path.join(result.exportDir, "index.md"), "utf8");
    expect(index).toContain("![](images/test.png)");
    // 已复制图片改写为相对引用；缺失图片保留原 URL（v1 设计：不删除原引用）
    expect(fs.existsSync(path.join(result.exportDir, "images", "test.png"))).toBe(true);
    expect(fs.existsSync(path.join(result.exportDir, "images", "missing.png"))).toBe(false);
    // 清理
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  it("exportNativeLake 把本地图片 src 内嵌为 base64，其余结构保留", () => {
    const note = store.createNote("原生 Lake 导出");
    const assetsDir = (store as any).noteAssetsDirFor(note.id);
    fs.mkdirSync(assetsDir, { recursive: true });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    fs.writeFileSync(path.join(assetsDir, "a.png"), png);
    // 构造含图片 card 的 lake 内容（value = "data:" + encodeURIComponent(JSON)）
    const cardValue = { src: `http://127.0.0.1:19876/${note.id}/a.png`, taskId: "t1", width: 100, height: 50 };
    const encoded = "data:" + encodeURIComponent(JSON.stringify(cardValue));
    const lake = `<h1>标题</h1><p>正文</p><card type="inline" name="image" value="${encoded}"></card>`;
    store.saveNote(note.id, "原生 Lake 导出", lake);
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "lake-nl-"));
    const result = store.exportNativeLake(note.id, base);
    expect(result.imageCount).toBe(1);
    expect(result.skipped).toBe(0);
    const out = fs.readFileSync(result.exportPath, "utf8");
    expect(out).toContain(`src%22%3A%22data%3Aimage%2Fpng%3Bbase64%2C`); // src 已内嵌 base64
    expect(out).not.toContain("127.0.0.1:19876");
    expect(out).toContain("<h1>标题</h1>"); // 其余结构保留
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  it("exportHtmlNote 导出 HTML + 复制图片 + 改写相对引用", () => {
    const note = store.createNote("HTML 导出测试");
    const assetsDir = (store as any).noteAssetsDirFor(note.id);
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "pic.png"), Buffer.from([1, 2, 3]));
    const md = `# 标题\n\n![](http://127.0.0.1:19876/${note.id}/pic.png)\n\n正文`;
    store.saveNote(note.id, "HTML 导出测试", "<p>正文</p>", { markdown: md, plain: "正文" });
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "lake-html-"));
    const result = store.exportHtmlNote(note.id, base);
    expect(result.imageCount).toBe(1);
    const html = fs.readFileSync(result.exportPath, "utf8");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("src=\"images/pic.png\"");
    expect(html).not.toContain("127.0.0.1:19876");
    expect(fs.existsSync(path.join(path.dirname(result.exportPath), "images", "pic.png"))).toBe(true);
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  it("全文搜索：正文 trigram 命中 + 高亮，标题 LIKE 回退，删除后消失", () => {
    const note = store.createNote("搜索引擎笔记");
    store.saveNote(note.id, "搜索引擎笔记", "<p>全文搜索与回收站方案</p>", { markdown: "# 搜索引擎笔记\n\n全文搜索与回收站方案", plain: "搜索引擎笔记\n全文搜索与回收站方案" });
    // ≥3 字：trigram 命中正文
    let r = store.searchNotes("回收站");
    expect(r.some((x) => x.id === note.id)).toBe(true);
    const hit = r.find((x) => x.id === note.id)!;
    expect(hit.snippet).toContain("<mark>回收站</mark>");
    // 标题命中
    r = store.searchNotes("搜索引擎");
    expect(r.some((x) => x.id === note.id)).toBe(true);
    // 短查询（2 字）回退标题 LIKE
    const n2 = store.createNote("快照测试文档");
    r = store.searchNotes("快照");
    expect(r.some((x) => x.id === n2.id)).toBe(true);
    // 删除后不再命中
    store.deleteTreeNode(n2.id);
    r = store.searchNotes("快照");
    expect(r.some((x) => x.id === n2.id)).toBe(false);
  });

  it("deleteTreeNode 软删除 = 移入回收站笔记本：树隐藏、文件保留、不写墓碑、进同步列表", () => {
    const nb = store.createNotebook("待删");
    const group = store.createGroup(nb.id, "组");
    const note = store.createNoteIn(group.id, "子笔记");
    const assetDir = path.join(dir, "note-assets", note.id);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "unused.png"), "x");
    store.saveNote(note.id, "子笔记", "<p>无引用</p>");
    const lakePath = path.join(dir, "notes", `${note.id}.lake`);
    expect(fs.existsSync(lakePath)).toBe(true);

    store.deleteTreeNode(nb.id);
    // 树不再显示（trash 子树从侧栏排除）
    expect(store.listTreeNodes().some((n) => n.id === nb.id)).toBe(false);
    expect(store.listTreeNodes().some((n) => n.id === note.id)).toBe(false);
    // 文件保留（可恢复）
    expect(fs.existsSync(lakePath)).toBe(true);
    expect(fs.existsSync(assetDir)).toBe(true);
    // 软删不写墓碑（回收站条目是普通条目，移动即同步传播）
    expect(store.listDeletedNotesForSync().some((d) => d.id === note.id)).toBe(false);
    // 回收站树：列出 trash 笔记本下的完整子树（根 + 连带子笔记，含 parentId 供组树）
    const trash = store.listTrash();
    expect(trash.some((t) => t.id === nb.id && t.nodeType === "notebook")).toBe(true);
    const trashNote = trash.find((t) => t.id === note.id);
    expect(trashNote).toBeTruthy();
    expect(trashNote!.parentId).toBe(group.id); // 子笔记挂在被删分组下（连带整棵，非独立条目）
    expect(trash.find((t) => t.id === group.id)!.parentId).toBe(nb.id); // 分组挂在被删根下
    // 软删后仍进同步列表（回收站上云）：文件夹本身 parentId=trash + trashedAt
    const syncNb = store.listNotesForSync(); // 文件夹不进 notes；断言子笔记仍在同步列表
    const syncFolder = store.listFoldersForSync().find((f) => f.id === nb.id);
    expect(syncFolder).toBeTruthy();
    expect(syncFolder!.parentId).toBe("notebook-trash");
    expect(syncFolder!.trashedAt).toBeTruthy();
    // 子笔记在回收站内（传递），仍进同步列表
    expect(syncNb.some((n) => n.id === note.id)).toBe(true);
    // 回收站条目不出现在搜索
    expect(store.searchNotes("无引用").some((x) => x.id === note.id)).toBe(false);
  });

  it("审计（编辑即恢复）：编辑 purged 条目 = 隐式恢复（移出回收站 + restore_pending + 可上传）", () => {
    const nb = store.createNotebook("目标册");
    const note = store.createNoteIn(nb.id, "待编辑");
    store.saveNote(note.id, "待编辑", "<p>v1</p>");
    store.deleteTreeNode(note.id); // 进回收站
    // 模拟"他端已 purge、本端保留"：标 purged（applyRemotePurge 的等价状态）
    (store as any).db.prepare("UPDATE notes SET sync_state='purged' WHERE id=?").run(note.id);
    (store as any).db.prepare("UPDATE tree_nodes SET sync_state='purged' WHERE id=?").run(note.id);
    // 编辑 = 隐式恢复：移出回收站 + restore_pending + 内容落盘
    store.saveNote(note.id, "待编辑", "<p>恢复后编辑版</p>");
    const row = store.listNotesForSync().find((n) => n.id === note.id)!;
    expect(row.parentId).toBe(nb.id); // 不在回收站
    expect(row.trashedAt).toBeNull();
    expect(row.deletedFromParentId).toBeNull();
    expect(row.syncState).toBe("local");
    expect((store as any).isRestorePending(note.id)).toBe(true);
    expect(store.readNote(note.id).content).toContain("恢复后编辑版");
  });

  it("审计（W-4）：恢复后未同步再删除 → restore_pending_at 无残留，删除以软删语义传播", () => {
    const nb = store.createNotebook("恢复后再删");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>v1</p>");

    store.deleteTreeNode(note.id);
    store.restoreTrashItem(note.id);
    expect((store as any).isRestorePending(note.id)).toBe(true);

    // 恢复后未同步，再次删除：标记必须清除——残留会让上传方向以"恢复语义"（trashedAt:null）
    // 发布 active 条目 → 本地删除不传播、云端复活。
    store.deleteTreeNode(note.id);
    expect((store as any).isRestorePending(note.id)).toBe(false);
    const row = store.listNotesForSync().find((n) => n.id === note.id)!;
    expect(row.parentId).toBe("notebook-trash");
    expect(row.trashedAt).not.toBeNull();
    expect(row.syncState).toBe("local");
  });

  it("审计（W-4 级联）：整树移入回收站时子树笔记的 restore_pending_at 一并清除", () => {
    const nb = store.createNotebook("级联清理");
    const group = store.createGroup(nb.id, "分组");
    const note = store.createNoteIn(group.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>v1</p>");

    store.deleteTreeNode(note.id);
    store.restoreTrashItem(note.id);
    expect((store as any).isRestorePending(note.id)).toBe(true);

    // 删分组 → 子笔记级联进回收站，标记必须一并清（同一残留问题）
    store.deleteTreeNode(group.id);
    expect((store as any).isRestorePending(note.id)).toBe(false);
    const row = store.listNotesForSync().find((n) => n.id === note.id)!;
    expect(row.trashedAt).not.toBeNull();
  });

  it("审计（W-4 对齐）：applyRemotePurge 清除 restore_pending_at（与移动端端口口径一致）", () => {
    const nb = store.createNotebook("purge对齐");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>v1</p>");
    store.deleteTreeNode(note.id);
    store.restoreTrashItem(note.id);
    expect((store as any).isRestorePending(note.id)).toBe(true);

    store.applyRemotePurge(note.id);
    expect((store as any).isRestorePending(note.id)).toBe(false);
    const row = store.listNotesForSync().find((n) => n.id === note.id)!;
    expect(row.syncState).toBe("purged");
  });

  it("回收站：恢复节点（移回原位置，清回收站字段，重新可同步）", () => {
    const nb = store.createNotebook("待恢复");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>内容</p>");
    const lakePath = path.join(dir, "notes", `${note.id}.lake`);

    store.deleteTreeNode(nb.id);
    // 软删：在回收站，且仍在同步列表（回收站条目上云）
    expect(store.listTrash().some((t) => t.id === nb.id)).toBe(true);
    expect(store.listNotesForSync().some((n) => n.id === note.id)).toBe(true);

    // 恢复目录（子笔记一起恢复）
    store.restoreTrashItem(nb.id);
    expect(store.listTreeNodes().some((n) => n.id === nb.id)).toBe(true);
    expect(store.listTreeNodes().some((n) => n.id === note.id)).toBe(true);
    expect(fs.existsSync(lakePath)).toBe(true);
    // 恢复后回收站字段清空，trashed_at 移除
    const syncNote = store.listNotesForSync().find((n) => n.id === note.id)!;
    expect(syncNote.parentId).toBe(nb.id);
    expect(syncNote.trashedAt).toBeNull();
    expect(syncNote.syncState).toBe("local");
    // 回收站已空
    expect(store.listTrash().some((t) => t.id === nb.id)).toBe(false);
  });

  it("回收站：彻底删除（purge）删文件 + DB，墓碑保留", () => {
    const nb = store.createNotebook("待彻底删");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>内容</p>");
    const assetDir = path.join(dir, "note-assets", note.id);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "a.png"), "x");
    const lakePath = path.join(dir, "notes", `${note.id}.lake`);

    store.deleteTreeNode(nb.id);
    // 彻底删除目录（含子笔记）
    store.purgeTrashItem(nb.id);
    expect(store.listTrash().some((t) => t.id === nb.id)).toBe(false);
    expect(store.listTrash().some((t) => t.id === note.id)).toBe(false);
    expect(fs.existsSync(lakePath)).toBe(false);
    expect(fs.existsSync(assetDir)).toBe(false);
    // 墓碑保留（远端不复活）
    expect(store.listDeletedNotesForSync().some((d) => d.id === note.id)).toBe(true);
  });

  it("purge 彻底删除文档时清空 note_history 行 + 磁盘 gzip 目录（表不膨胀）", () => {
    const nb = store.createNotebook("待彻底删-带历史");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>v1</p>");
    store.createHistorySnapshot(note.id); // 版本1 快照
    store.saveNote(note.id, "子笔记", "<p>v2</p>");
    store.createHistorySnapshot(note.id); // 版本2 快照
    expect(store.listNoteHistory(note.id).length).toBe(2);
    const histDir = path.join(dir, "history", note.id);
    expect(fs.existsSync(histDir)).toBe(true);

    store.deleteTreeNode(nb.id);
    store.purgeTrashItem(nb.id);

    // DB 行清空（避免 note_history 表随删除累积膨胀）
    expect(store.listNoteHistory(note.id).length).toBe(0);
    // 磁盘 gzip 目录一并物理删除
    expect(fs.existsSync(histDir)).toBe(false);
    // 其他文档的历史不受影响
    const other = store.createNote("不受影响");
    store.saveNote(other.id, "不受影响", "<p>keep</p>");
    store.createHistorySnapshot(other.id);
    expect(store.listNoteHistory(other.id).length).toBe(1);
  });

  it("moveTreeNode 同步更新 notes 表（同步源一致性，移动才能跨端传播）", () => {
    const nb = store.createNotebook("移动目标");
    const note = store.createNoteIn(nb.id, "移动前");
    store.saveNote(note.id, "移动前", "<p>x</p>");
    const nb2 = store.createNotebook("移动后");
    store.moveTreeNode(note.id, nb2.id, 0);
    const sync = store.listNotesForSync().find((n) => n.id === note.id)!;
    expect(sync.parentId).toBe(nb2.id);   // notes.parent_id 已更新
    expect(sync.sortOrder).toBe(0);
    expect(sync.syncState).toBe("local"); // 待上传
    // tree_nodes 同步
    expect(store.listTreeNodes().find((t) => t.id === note.id)?.parentId).toBe(nb2.id);
  });

  it("setNodeIcon 标记 notes 为 local（下载 meta 对账不会回滚图标）", () => {
    const note = store.createNote("图标");
    store.saveNote(note.id, "图标", "<p>x</p>");
    store.setNodeIcon(note.id, "📌");
    const sync = store.listNotesForSync().find((n) => n.id === note.id)!;
    expect(sync.syncState).toBe("local");
    expect(sync.icon).toBe("📌");
    // 下载对账路径（sync_state='synced' 的笔记才应用远端元数据）
    store.markSynced(note.id);
    expect(store.listNotesForSync().find((n) => n.id === note.id)?.syncState).toBe("synced");
  });

  it("验收#1：默认个人笔记本图标进入 folder 同步（LWW 跨端传播）", () => {
    const before = store.listFoldersForSync().find((f) => f.id === "notebook-personal");
    expect(before).toBeTruthy();
    expect(before!.icon).toBeNull();
    store.setNodeIcon("notebook-personal", "🎯");
    const syncFolder = store.listFoldersForSync().find((f) => f.id === "notebook-personal");
    expect(syncFolder).toBeTruthy();
    expect(syncFolder!.icon).toBe("🎯");
    // 回收站笔记本仍排除（本地初始化，不同步）
    expect(store.listFoldersForSync().some((f) => f.id === "notebook-trash")).toBe(false);
  });

  it("回收站自动过期：trashed_at 超期条目自动 purge（默认 60 天可配）", () => {
    const nb = store.createNotebook("待过期");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>内容</p>");
    store.deleteTreeNode(nb.id);
    // 人为把 trashed_at 改为 61 天前
    const old = new Date(Date.now() - 61 * 24 * 3600 * 1000).toISOString();
    (store as any).db.prepare("UPDATE tree_nodes SET trashed_at=? WHERE id=?").run(old, nb.id);
    const purged = store.autoPurgeExpiredTrash(60);
    expect(purged).toBe(1);
    expect(store.listTrash().length).toBe(0);
    // purge 后写墓碑（防复活 + M4 删云端前缀）
    expect(store.listDeletedNotesForSync().some((d) => d.id === note.id)).toBe(true);
    // 未超期（59 天）不 purge
    const nb2 = store.createNotebook("未过期");
    const note2 = store.createNoteIn(nb2.id, "n2");
    store.saveNote(note2.id, "n2", "<p>x</p>");
    store.deleteTreeNode(nb2.id);
    const recent = new Date(Date.now() - 59 * 24 * 3600 * 1000).toISOString();
    (store as any).db.prepare("UPDATE tree_nodes SET trashed_at=? WHERE id=?").run(recent, nb2.id);
    expect(store.autoPurgeExpiredTrash(60)).toBe(0);
    // 未过期根 + 其子笔记（树形回收站列出整棵子树）
    expect(store.listTrash().length).toBe(2);
  });

  it("回收站：清空 emptyTrash 全部彻底删除", () => {
    const nb1 = store.createNotebook("待清空1");
    const n1 = store.createNoteIn(nb1.id, "n1");
    const nb2 = store.createNotebook("待清空2");
    const n2 = store.createNoteIn(nb2.id, "n2");
    store.deleteTreeNode(nb1.id);
    store.deleteTreeNode(nb2.id);
    // 树形回收站：两个根各连带一个子笔记
    expect(store.listTrash().length).toBe(4);
    store.emptyTrash();
    expect(store.listTrash().length).toBe(0);
    // purge 后写墓碑（防复活 + M4 删云端前缀）
    expect(store.listDeletedNotesForSync().some((d) => d.id === n1.id)).toBe(true);
    expect(store.listDeletedNotesForSync().some((d) => d.id === n2.id)).toBe(true);
    expect(store.listPurgedNotesForSync().some((d) => d.id === n1.id)).toBe(true);
  });
});


describe("文档历史（快照，纯本地）", () => {
  it("createHistorySnapshot 创建 gzip 快照 + refs_json + hash 去重", () => {
    const { id } = makeNote();
    // 写入正文（含图片引用）
    const content = '<p><span>正文</span><img src="http://127.0.0.1:19876/' + id + '/1786123456789_abc12345.png"></p>';
    store.saveNote(id, "历史测试", content);
    const sid = store.createHistorySnapshot(id);
    expect(sid).toBeTruthy();
    const list = store.listNoteHistory(id);
    expect(list.length).toBe(1);
    expect(list[0].refCount).toBe(1);
    // refs_json 记录图片
    expect(JSON.parse((store as any).db.prepare("SELECT refs_json FROM note_history WHERE id=?").get(list[0].id).refs_json)).toContain("1786123456789_abc12345.png");
    // 同内容再快照 → 24h 防抖跳过
    expect(store.createHistorySnapshot(id)).toBeNull();
    // 不同内容 → 新快照
    store.saveNote(id, "历史测试", "<p>新内容</p>");
    expect(store.createHistorySnapshot(id)).toBeTruthy();
    expect(store.listNoteHistory(id).length).toBe(2);
  });

  it("系统自动留档去重：24h 内同内容已有快照时，覆盖/恢复前留档不重复写；手动创建仍强制写", () => {
    const { id } = makeNote();
    store.saveNote(id, "历史测试", "<p>X</p>");
    // 自动快照 X（force=false）
    expect(store.createHistorySnapshot(id)).toBeTruthy();
    expect(store.listNoteHistory(id).length).toBe(1);
    // 云端覆盖留档（sync 现在用 force=false）：同 hash 24h 内已有 → 跳过，不产生第二份
    expect(store.createHistorySnapshot(id, undefined, false)).toBeNull();
    expect(store.listNoteHistory(id).length).toBe(1);
    // 手动创建快照（HistoryPanel 传 force=true）：用户显式意图，同 hash 也写
    expect(store.createHistorySnapshot(id, undefined, true)).toBeTruthy();
    expect(store.listNoteHistory(id).length).toBe(2);
  });

  it("恢复前留档去重：当前内容 24h 内已有快照时恢复不新增重复", () => {
    const { id } = makeNote();
    store.saveNote(id, "历史测试", "<p>版本1</p>");
    store.createHistorySnapshot(id); // 版本1 快照
    store.saveNote(id, "历史测试", "<p>版本2</p>");
    store.createHistorySnapshot(id); // 版本2 快照
    const hist = store.listNoteHistory(id);
    const v1 = hist[hist.length - 1]; // 最旧 = 版本1
    store.restoreHistory(v1.id);
    // 恢复前留档当前（版本2）：24h 内已有版本2 快照 → 去重，历史仍只有 2 份
    expect(store.listNoteHistory(id).length).toBe(2);
  });

  it("restoreHistory 恢复正文 + 更新缓存/FTS + 重置 sync_base（P0-1）", () => {
    const { id } = makeNote();
    store.saveNote(id, "历史测试", "<p>版本1 含独特词：北斗七星</p>");
    store.createHistorySnapshot(id);
    store.saveNote(id, "历史测试", "<p>版本2</p>");
    store.createHistorySnapshot(id);
    // 恢复版本1
    const hist = store.listNoteHistory(id);
    const v1 = hist[hist.length - 1]; // 最旧
    store.restoreHistory(v1.id);
    // 正文回滚
    expect(store.readNote(id).content).toContain("版本1 含独特词：北斗七星");
    // 缓存更新（可搜索）
    expect(store.searchNotes("北斗七星").some((h) => h.id === id)).toBe(true);
    // P0-1（S3-GC v4 §5.2）：恢复后保持恢复前 base，仅标 local 待上传
    expect(store.readNote(id).syncState).toBe("local");
    // 恢复前留档：版本2 已在历史（去重后不新增重复快照，但版本2 快照本身可反悔）
    const after = store.listNoteHistory(id);
    expect(after.some((h) => h.contentHash !== v1.contentHash)).toBe(true);
  });

  it("restoreHistory 后 last_uploaded_hash 重置为恢复版 hash（P0-1 语义）", () => {
    const { id } = makeNote();
    store.saveNote(id, "历史测试", "<p>版本1</p>");
    store.createHistorySnapshot(id);
    store.saveNote(id, "历史测试", "<p>版本2</p>");
    const v2hash = store.contentHash(id);
    // 模拟本机上传过版本2
    store.setBaseHash(id, v2hash);
    store.setLastUploadedHash(id, v2hash);
    // 恢复版本1
    const hist = store.listNoteHistory(id);
    const v1 = hist[hist.length - 1];
    store.restoreHistory(v1.id);
    // P0-1（S3-GC v4 §5.2）：恢复后保持恢复前 base/lastUploaded，仅标 local 待上传
    expect(store.baseHash(id)).toBe(v2hash);
    expect(store.lastUploadedHash(id)).toBe(v2hash);
    expect(store.readNote(id).syncState).toBe("local");
  });

  it("deleteHistory 删除快照文件 + DB 记录", () => {
    const { id } = makeNote();
    store.saveNote(id, "历史测试", "<p>a</p>");
    store.createHistorySnapshot(id);
    store.saveNote(id, "历史测试", "<p>b</p>");
    store.createHistorySnapshot(id);
    const before = store.listNoteHistory(id);
    expect(before.length).toBe(2);
    store.deleteHistory(before[0].id); // 删最新
    expect(store.listNoteHistory(id).length).toBe(1);
    // 文件也删了
    expect(fs.existsSync(path.join(dir, before[0].filePath))).toBe(false);
  });

  it("cleanupHistory 保留策略：超 100 份删最旧 / 30 天删", () => {
    const { id } = makeNote();
    store.saveNote(id, "历史测试", "<p>base</p>");
    // 造 105 份快照（内容不同避免去重）
    for (let i = 0; i < 105; i++) {
      store.saveNote(id, "历史测试", `<p>内容${i}</p>`);
      store.createHistorySnapshot(id);
    }
    expect(store.listNoteHistory(id).length).toBe(105);
    store.cleanupHistory();
    expect(store.listNoteHistory(id).length).toBeLessThanOrEqual(100);
    // 30 天兜底：造一条旧快照
    const oldContent = "<p>旧版本</p>";
    const oldHash = crypto.createHash("sha256").update(oldContent).digest("hex");
    const gz = (store as any).gzipContent(oldContent);
    const oldPath = `history/${id}/2020-01-01-00-00-00-${oldHash.slice(0, 16)}.lake.gz`;
    fs.mkdirSync(path.dirname(path.join(dir, oldPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, oldPath), gz);
    (store as any).db.prepare("INSERT INTO note_history(note_id,file_path,content_hash,created_at,size,refs_json,ref_count) VALUES(?,?,?,?,?,?,?)")
      .run(id, oldPath, oldHash, "2020-01-01T00:00:00.000Z", gz.length, "[]", 0);
    store.cleanupHistory();
    expect(store.listNoteHistory(id).some((h) => h.contentHash === oldHash)).toBe(false);
  });

  it("B3：冲突归档快照（protectedUntil）不被自动清理，到期自动解除保护，手动删除随时可用", () => {
    const { id } = makeNote();
    store.saveNote(id, "B3", "<p>base</p>");
    // 收紧保留策略：仅保留 1 份 → 未保护的旧快照会被清，受保护的不清
    store.saveHistorySettings({ maxSnapshots: 1, retentionDays: 0, cleanupIntervalHours: 0, snapshotIntervalMinutes: 0 });
    // 普通快照 v1
    store.saveNote(id, "B3", "<p>v1</p>");
    store.createHistorySnapshot(id);
    // 冲突归档快照 v2（protectedDays=30）
    store.saveNote(id, "B3", "<p>v2-superseded</p>");
    const protectedId = store.createHistorySnapshot(id, undefined, false, 30);
    expect(protectedId).not.toBeNull();
    const rows = store.listNoteHistory(id);
    expect(rows.length).toBe(2);
    const protectedRow = rows.find((h) => h.id === protectedId);
    expect(protectedRow).toBeTruthy();
    expect(protectedRow!.protectedUntil).not.toBeNull();
    expect(Date.parse(protectedRow!.protectedUntil as string) > Date.now()).toBe(true);
    // cleanup：maxSnapshots=1 → 普通快照被删，受保护的保留
    store.cleanupHistory();
    let after = store.listNoteHistory(id);
    expect(after.some((h) => h.id === protectedId)).toBe(true);
    // 到期解除：把 protected_until 拨回过去，再造一条更新快照 v3（无保护）——v2 不再是“最新保留”，
    // cleanup 应幂等清除其保护并删除（maxSnapshots=1 只留最新）。
    (store as any).db.prepare("UPDATE note_history SET protected_until=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), protectedId);
    store.saveNote(id, "B3", "<p>v3-newer</p>");
    const newerId = store.createHistorySnapshot(id) as number;
    store.cleanupHistory();
    after = store.listNoteHistory(id);
    expect(after.some((h) => h.id === protectedId)).toBe(false);
    expect(after.some((h) => h.id === newerId)).toBe(true);
    // 幂等性：再次 cleanup 无异常
    expect(() => store.cleanupHistory()).not.toThrow();
    // 手动删除任何时候允许（另造一条受保护的验证）
    store.saveNote(id, "B3", "<p>v3</p>");
    const pid = store.createHistorySnapshot(id, undefined, false, 30) as number;
    expect(() => store.deleteHistory(pid)).not.toThrow();
    expect(store.listNoteHistory(id).some((h) => h.id === pid)).toBe(false);
  });


  it("listNoteOrphans / cleanNoteOrphans：被历史引用保护，未引用可清", () => {
    const { id } = makeNote();
    const assetsDir = path.join(dir, "note-assets", id);
    fs.mkdirSync(assetsDir, { recursive: true });
    // 被历史引用的资源 + 未引用资源
    const refName = "1786123456789_abc12345.png";
    const orphanName = "1786123456789_def67890.png";
    fs.writeFileSync(path.join(assetsDir, refName), "refdata");
    fs.writeFileSync(path.join(assetsDir, orphanName), "orphandata");
    // 正文只引用 refName，并做历史快照
    store.saveNote(id, "历史测试", `<p><img src="http://127.0.0.1:19876/${id}/${refName}"></p>`);
    store.createHistorySnapshot(id);
    // 删除引用（正文不再引用 refName，但历史还引用）
    store.saveNote(id, "历史测试", "<p>无图</p>");
    const orphans = store.listNoteOrphans(id);
    const refOrphan = orphans.find((o) => o.filename === refName);
    const plainOrphan = orphans.find((o) => o.filename === orphanName);
    expect(refOrphan?.protectedByHistory).toBe(true);   // 被历史保护
    expect(plainOrphan?.protectedByHistory).toBe(false); // 未引用可清
    // 清理未引用的
    const r = store.cleanNoteOrphans(id, [orphanName]);
    expect(r.count).toBe(1);
    expect(fs.existsSync(path.join(assetsDir, orphanName))).toBe(false);
    expect(fs.existsSync(path.join(assetsDir, refName))).toBe(true); // 历史保护保留
    // 删历史后 refName 变未保护可清
    const hist = store.listNoteHistory(id);
    for (const h of hist) store.deleteHistory(h.id);
    expect(store.listNoteOrphans(id).find((o) => o.filename === refName)?.protectedByHistory).toBe(false);
  });

  it("listRemovedAssets：聚合未引用(可删) + 历史保护(只读)；readAssetPreview 按路径预览", () => {
    const { id } = makeNote();
    const assetsDir = path.join(dir, "note-assets", id);
    fs.mkdirSync(assetsDir, { recursive: true });
    const refName = "1786123456789_ab12cd34.png";   // 名字需符合资源命名（13 位时间戳 + hex），extractAssetRefs 才识别
    const orphanName = "1786123456789_ef345678.png";
    fs.writeFileSync(path.join(assetsDir, refName), "refdata");
    fs.writeFileSync(path.join(assetsDir, orphanName), "orphandata");
    // 正文只引用 refName 并显式打历史快照（force + 显式正文，避免依赖自动快照时序）；
    // 随后删引用 → refName 归入“历史保护”，orphanName 归入“未引用”
    const refContent = `<p><img src="http://127.0.0.1:19876/${id}/${refName}"></p>`;
    store.saveNote(id, "历史测试", refContent);
    store.createHistorySnapshot(id, refContent, true);
    store.saveNote(id, "历史测试", "<p>无图</p>");
    const all = store.listRemovedAssets();
    const hist = all.find((e) => e.filename === refName);
    const plain = all.find((e) => e.filename === orphanName);
    expect(hist?.status).toBe("history");          // 受历史引用保护
    expect(hist?.orphanId).toBeUndefined();         // 不可删
    expect(hist?.noteTitle).toBe("历史测试");
    expect(plain?.status).toBe("orphan");           // 未引用可删
    expect(plain?.orphanId).toBeGreaterThan(0);
    // 预览按 noteId+filename（历史保护文件也能看）
    const pv = store.readAssetPreview(id, refName);
    expect(pv.supported).toBe(true);
    expect(pv.dataUrl).toContain("base64,");
    // 单条删除只作用于 orphan
    const del = store.deleteOrphanAsset(plain!.orphanId!);
    expect(del.deleted).toBe(true);
    expect(fs.existsSync(path.join(assetsDir, orphanName))).toBe(false);
    expect(fs.existsSync(path.join(assetsDir, refName))).toBe(true); // 历史保护未动
    expect(store.listRemovedAssets().some((e) => e.filename === orphanName)).toBe(false);
  });
  it("U1：saveNote 标记 dirty，flushHistorySnapshots 只快照 dirty 文档且清空", () => {
    const { id } = makeNote();
    const { id: id2 } = makeNote();
    // 初始无快照
    expect(store.listNoteHistory(id).length).toBe(0);
    // saveNote 落盘后 dirty；flush 产生快照
    store.saveNote(id, "历史测试", "<p>dirty 文档</p>");
    expect(store.flushHistorySnapshots()).toBe(1);
    expect(store.listNoteHistory(id).length).toBe(1);
    // flush 后清空：无新保存则不再产生
    expect(store.flushHistorySnapshots()).toBe(0);
    expect(store.listNoteHistory(id).length).toBe(1);
    // 两个文档都 dirty → flush 各快照一次
    store.saveNote(id2, "历史测试", "<p>dirty2</p>");
    store.saveNote(id, "历史测试", "<p>dirty1 again</p>");
    expect(store.flushHistorySnapshots()).toBe(2);
  });

  it("U1：flushHistorySnapshots 对无 .lake 的文档安全跳过（不抛）", () => {
    // 用 createNote 但立即删文件模拟异常
    const note = store.createNote("无文件笔记");
    fs.rmSync(path.join(dir, "notes", `${note.id}.lake`), { force: true });
    store.markHistoryDirty(note.id);
    expect(() => store.flushHistorySnapshots()).not.toThrow();
  });

  it("P2：detectOrphans 登记孤儿时并入历史 refs（被历史引用不登记孤儿）", () => {
    const { id } = makeNote();
    const assetsDir = path.join(dir, "note-assets", id);
    fs.mkdirSync(assetsDir, { recursive: true });
    const refName = "1786123456789_abc12345.png";
    const orphanName = "1786123456789_def67890.png";
    fs.writeFileSync(path.join(assetsDir, refName), "refdata");
    fs.writeFileSync(path.join(assetsDir, orphanName), "orphandata");
    // 正文引用 refName + 快照（历史引用 refName）
    store.saveNote(id, "历史测试", `<p><img src="http://127.0.0.1:19876/${id}/${refName}"></p>`);
    store.createHistorySnapshot(id);
    // 删除正文对 refName 的引用并保存 → detectOrphans 执行
    store.saveNote(id, "历史测试", "<p>无图</p>");
    // refName 被历史引用 → 不登记孤儿；orphanName 未被引用 → 登记孤儿
    const orphanRows = (store as any).db.prepare("SELECT filename FROM orphan_assets WHERE note_id=?").all(id) as Array<{ filename: string }>;
    const filenames = orphanRows.map((r) => r.filename);
    expect(filenames).not.toContain(refName);
    expect(filenames).toContain(orphanName);
    // 全局清理不误删被历史引用的资源
    const before = fs.existsSync(path.join(assetsDir, refName));
    store.cleanOrphanAssets();
    expect(fs.existsSync(path.join(assetsDir, refName))).toBe(before);
    expect(fs.existsSync(path.join(assetsDir, orphanName))).toBe(false);
  });

  it("P5：HistorySettings 读写 + cleanupHistory 用配置 + getHistoryStats", () => {
    // 默认值
    expect(store.getHistorySettings()).toEqual({ maxSnapshots: 100, retentionDays: 30, cleanupIntervalHours: 24, snapshotIntervalMinutes: 15 });
    // 保存自定义
    store.saveHistorySettings({ maxSnapshots: 3, retentionDays: 365, cleanupIntervalHours: 0, snapshotIntervalMinutes: 30 });
    expect(store.getHistorySettings()).toEqual({ maxSnapshots: 3, retentionDays: 365, cleanupIntervalHours: 0, snapshotIntervalMinutes: 30 });
    // 造 5 份快照 → cleanup 按 maxSnapshots=3 裁剪
    const { id } = makeNote();
    for (let i = 0; i < 5; i++) {
      store.saveNote(id, "历史测试", `<p>c${i}</p>`);
      store.createHistorySnapshot(id);
    }
    expect(store.listNoteHistory(id).length).toBe(5);
    const r = store.cleanupHistory();
    expect(r.deletedSnapshots).toBeGreaterThan(0);
    expect(store.listNoteHistory(id).length).toBeLessThanOrEqual(3);
    // 统计
    const stats = store.getHistoryStats();
    expect(stats.snapshotCount).toBe(store.listNoteHistory(id).length);
    expect(stats.totalBytes).toBeGreaterThan(0);
    // 清理结果记录
    store.recordHistoryCleanup({ deletedSnapshots: 2, freedBytes: 10 });
    const last = store.getLastHistoryCleanup();
    expect(last?.deletedSnapshots).toBe(2);
    expect(last?.freedBytes).toBe(10);
  });

  it("previewHistorySnapshot 解压快照返回纯文本；不存在的快照返回 null", () => {
    const { id } = makeNote();
    store.saveNote(id, "历史测试", "<p>预览内容 独特词预览AAA</p>");
    const sid = store.createHistorySnapshot(id);
    expect(sid).toBeTruthy();
    const r = store.previewHistorySnapshot(sid!);
    expect(r).toBeTruthy();
    expect(r!.plain).toContain("预览内容 独特词预览AAA");
    expect(r!.createdAt).toBeTruthy();
    expect(store.previewHistorySnapshot(999999)).toBeNull();
  });

  it("previewNoteOrphan 图片返回 data URL，文本返回内容", () => {
    const { id } = makeNote();
    const assetsDir = path.join(dir, "note-assets", id);
    fs.mkdirSync(assetsDir, { recursive: true });
    const imgName = "1786123456789_abc12345.png";
    const txtName = "1786123456789_def67890.txt";
    fs.writeFileSync(path.join(assetsDir, imgName), Buffer.from("89504e470d0a1a0a", "hex"));
    fs.writeFileSync(path.join(assetsDir, txtName), "hello text content");
    const img = store.previewNoteOrphan(id, imgName);
    expect(img?.kind).toBe("image");
    expect(img?.data.startsWith("data:image/png;base64,")).toBe(true);
    const txt = store.previewNoteOrphan(id, txtName);
    expect(txt?.kind).toBe("text");
    expect(txt?.data).toContain("hello text content");
    // 不存在的返回 null
    expect(store.previewNoteOrphan(id, "nope.png")).toBeNull();
  });

  it("purgeTrashItem 彻底删除连历史快照一起物理删", () => {
    const nb = store.createNotebook("待彻底删");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>内容</p>");
    store.createHistorySnapshot(note.id);
    expect(store.listNoteHistory(note.id).length).toBe(1);
    store.deleteTreeNode(nb.id); // 软删除
    expect(store.listNoteHistory(note.id).length).toBe(1); // 软删除保留历史
    store.purgeTrashItem(nb.id); // 彻底删除
    expect(store.listNoteHistory(note.id).length).toBe(0); // 历史也删了
    expect(fs.existsSync(path.join(dir, "history", note.id))).toBe(false);
  });
});

describe("孤儿资源", () => {
  it("未被引用的资源被登记，引用后撤销，清理时删除文件", () => {
    const { id } = makeNote();
    const name = assetFilename();
    const dir2 = path.join(dir, "note-assets", id);
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, name), "blob-data");
    expect(fs.statSync(path.join(dir2, name)).size).toBe(9);

    // 1) 未引用 → 登记孤儿
    store.saveNote(id, "t", "<p>不引用</p>");
    let orphans = store.listOrphanAssets();
    expect(orphans.some((o) => o.noteId === id && o.filename === name)).toBe(true);

    // 2) 引用 → 撤销孤儿
    const url = `http://127.0.0.1:19876/${id}/${name}`;
    store.saveNote(id, "t", `<img src="${url}">`);
    orphans = store.listOrphanAssets();
    expect(orphans.some((o) => o.noteId === id && o.filename === name)).toBe(false);

    // 3) 再成孤儿 → cleanOrphanAssets 删除文件与记录
    store.saveNote(id, "t", "<p>不引用</p>");
    const cleaned = store.cleanOrphanAssets();
    expect(cleaned.count).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dir2, name))).toBe(false);
    expect(store.listOrphanAssets().length).toBe(0);
  });
});

describe("S3 配置（safeStorage 加密落盘）", () => {
  const settings = {
    endpoint: "https://s3.cn-north-1.qiniucs.com",
    region: "cn-north-1",
    bucket: "local-lake-hebei",
    prefix: "lake-notes",
    accessKeyId: "ak",
    secretAccessKey: "sk-secret",
    forcePathStyle: true,
  };

  it("save/get 往返：密钥加密存储、解密还原", () => {
    store.saveS3Settings(settings);
    const got = store.getS3Settings();
    expect(got).not.toBeNull();
    expect(got!.secretAccessKey).toBe("sk-secret");
    expect(got!.forcePathStyle).toBe(true);
    // 落盘值必须是 enc:v1: 前缀（已加密）
    const raw = rawDbValue("SELECT value FROM settings WHERE key='s3_settings'");
    expect(raw ?? "").toContain("enc:v1:");
  });

  it("safeStorage 不可用时退回明文", () => {
    electronMock.setEncryptionAvailable(false);
    store.saveS3Settings(settings);
    const raw = rawDbValue("SELECT value FROM settings WHERE key='s3_settings'");
    expect(raw ?? "").toContain("sk-secret");
    expect(raw ?? "").not.toContain("enc:v1:");
    expect(store.getS3Settings()?.secretAccessKey).toBe("sk-secret");
  });

  it("未配置时返回 null，损坏数据返回 null", () => {
    expect(store.getS3Settings()).toBeNull();
    new Database(path.join(dir, "metadata.sqlite3")).prepare("INSERT INTO settings(key,value) VALUES(?,?)").run("s3_settings", "not-json").changes || undefined;
    expect(store.getS3Settings()).toBeNull();
  });
});

describe("同步状态 / 导入", () => {
  it("contentHash 稳定、baseHash 读写", () => {
    const { id } = makeNote();
    const h1 = store.contentHash(id);
    const h2 = store.contentHash(id);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(store.baseHash(id)).toBeNull();
    store.setBaseHash(id, h1);
    expect(store.baseHash(id)).toBe(h1);
  });

  it("markSynced / markSyncComplete / recordSyncResult / getSyncStatus", () => {
    const { id } = makeNote();
    store.markSynced(id);
    store.markSyncComplete("2026-08-02T10:00:00.000Z");
    store.recordSyncResult(JSON.stringify({ uploaded: 1 }));
    const status = store.getSyncStatus();
    expect(status.lastSyncedAt).toBe("2026-08-02T10:00:00.000Z");
    expect(status.lastResult).toEqual({ uploaded: 1 });
  });

  it("pruneTombstones 剪除墓碑（墓碑仅 purge 产生；软删 = 移动无墓碑）", () => {
    const { id } = makeNote();
    // 软删不写墓碑
    store.deleteNote(id);
    expect(store.listDeletedNotesForSync().some((d) => d.id === id)).toBe(false);
    // purge 写墓碑 → 可剪除
    store.purgeTrashItem(id);
    expect(store.listDeletedNotesForSync().some((d) => d.id === id)).toBe(true);
    store.pruneTombstones([id]);
    expect(store.listDeletedNotesForSync().some((d) => d.id === id)).toBe(false);
    store.pruneTombstones([]); // 空数组安全
  });

  it("purge 墓碑带 node_type：文档=note（发布方向），笔记本/分组=folder（仅本地下载过滤）", () => {
    const nb = store.createNotebook("待彻底删-类型");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>内容</p>");
    store.deleteTreeNode(nb.id);
    store.purgeTrashItem(nb.id); // 笔记本 + 子笔记都 purge
    const tombstones = store.listDeletedNotesForSync();
    expect(tombstones.find((d) => d.id === note.id)?.nodeType).toBe("note");
    expect(tombstones.find((d) => d.id === nb.id)?.nodeType).toBe("folder");
  });

  it("markTombstonesPublished + getSyncPendingSummary：未发布 note 墓碑计入待上传，已发布/文件夹墓碑不计", () => {
    // 基线（含 welcome-note 等本地待上传）；folder 墓碑永不计数
    const base = store.getSyncPendingSummary().documents;
    const nb = store.createNotebook("待彻底删-计数");
    const note = store.createNoteIn(nb.id, "子笔记");
    store.saveNote(note.id, "子笔记", "<p>内容</p>");
    store.deleteTreeNode(nb.id);
    store.purgeTrashItem(nb.id);
    // 未发布 note 墓碑 → +1（folder 墓碑不计入）
    expect(store.getSyncPendingSummary().documents).toBe(base + 1);
    // 发布 note 墓碑 → 回到基线（folder 墓碑仍不计）
    store.markTombstonesPublished([note.id]);
    expect(store.getSyncPendingSummary().documents).toBe(base);
  });

  it("listNotesForSync 返回未删除笔记（含回收站条目，它们上云）", () => {
    const { id } = makeNote();
    expect(store.listNotesForSync().some((n) => n.id === id)).toBe(true);
    store.deleteNote(id);
    // 软删 = 移入回收站：仍在同步列表（parentId=notebook-trash）
    const n = store.listNotesForSync().find((x) => x.id === id);
    expect(n).toBeTruthy();
    expect(n!.parentId).toBe("notebook-trash");
    // purge 后从同步列表消失
    store.purgeTrashItem(id);
    expect(store.listNotesForSync().some((x) => x.id === id)).toBe(false);
  });

  it("importRemoteNote 写入文件 + 资源 + upsert（幂等）", () => {
    const note = { id: "remote-1", title: "远程笔记", parentId: "notebook-personal", sortOrder: 5, updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false };
    const assetName = "1234567890123_deadbeef.png";
    store.importRemoteNote(note, Buffer.from("<p>远程内容</p>"), [{ filename: assetName, bytes: Buffer.from("img") }]);
    expect(fs.readFileSync(path.join(dir, "notes", "remote-1.lake"), "utf8")).toBe("<p>远程内容</p>");
    expect(fs.readFileSync(path.join(dir, "note-assets", "remote-1", assetName), "utf8")).toBe("img");
    expect(store.listNotesForSync().some((n) => n.id === "remote-1" && n.isConflict === false)).toBe(true);
    // 再导入一次（冲突副本场景）不报错
    store.importRemoteNote({ ...note, isConflict: true }, Buffer.from("<p>远程内容2</p>"), []);
    expect(store.listNotesForSync().find((n) => n.id === "remote-1")?.isConflict).toBe(true);
  });

  it("故障注入：远程导入 DB transaction 失败时清理正文和资源 staging", () => {
    const note = { id: "remote-db-failure", title: "远程 DB 失败", parentId: "notebook-personal", sortOrder: 8, updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false };
    const assetName = "1234567890123_deadbeef.png";
    const db = (store as any).db;
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(() => {
      throw new Error("injected DB transaction failure");
    });
    try {
      expect(() => store.importRemoteNote(note, Buffer.from("<p>DB 失败</p>"), [{ filename: assetName, bytes: Buffer.from("asset") }]))
        .toThrow("injected DB transaction failure");
      expect(fs.existsSync(path.join(dir, "notes", `${note.id}.lake`))).toBe(false);
      expect(fs.existsSync(path.join(dir, "note-assets", note.id))).toBe(false);
      expect(store.listNotesForSync().some((item) => item.id === note.id)).toBe(false);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it("故障注入：远程正文 rename 失败时不应留下已同步但无文件的 DB 记录", () => {
    const note = { id: "remote-rename-failure", title: "远程失败", parentId: "notebook-personal", sortOrder: 7, updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false };
    const originalRename = fs.renameSync;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from).includes("remote-rename-failure.lake.tmp-")) throw new Error("injected rename failure");
      return originalRename(from, to);
    }) as typeof fs.renameSync);
    try {
      expect(() => store.importRemoteNote(note, Buffer.from("<p>失败注入</p>"), [])).toThrow("injected rename failure");
      expect(() => store.readNote(note.id)).toThrow(/不存在/);
      expect(store.listNotesForSync().some((item) => item.id === note.id)).toBe(false);
      expect(fs.existsSync(path.join(dir, "notes", `${note.id}.lake`))).toBe(false);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("importRemoteNote 同步下载后即生成缓存+FTS（锁定+从未编辑的新设备也能搜到正文）", () => {
    // 模拟新设备同步到一篇"锁定且从未编辑"的文档（同步带 isLocked，正文为 .lake）
    const note = {
      id: "remote-locked-1", title: "远程锁定文档", parentId: "notebook-personal", sortOrder: 6,
      updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false,
      isLocked: true, lockedAt: "2026-08-02T00:00:00.000Z",
    };
    const lakeHtml = '<p><span>这篇文档的正文里有一个独特关键词：北斗七星阵</span></p>';
    store.importRemoteNote(note, Buffer.from(lakeHtml), []);
    // 1) 缓存已生成（无需打开/编辑）
    const caches = store.readNoteCaches("remote-locked-1");
    expect(caches.markdown).toBe("这篇文档的正文里有一个独特关键词：北斗七星阵");
    expect(caches.plain).toBe("这篇文档的正文里有一个独特关键词：北斗七星阵");
    // 2) 全文搜索直接命中正文（此前 body 为 null 会搜不到）
    const hits = store.searchNotes("北斗七星阵");
    expect(hits.some((h) => h.id === "remote-locked-1")).toBe(true);
    // 3) 锁状态正确带下来
    expect(store.listNotesForSync().find((n) => n.id === "remote-locked-1")?.isLocked).toBe(true);
  });

  it("rebuildSearchIndex 对无缓存文档从磁盘兜底生成缓存并重建 FTS", () => {
    const { id } = makeNote();
    // 模拟锁定态文档：只有 .lake 正文，无缓存（直接写文件，绕过 saveNote）
    const lakeHtml = '<p><span>锁定正文兜底索引测试词汇：量子纠缠</span></p>';
    fs.writeFileSync((store as any).notePath(id), lakeHtml, "utf8");
    expect(store.readNoteCaches(id).plain).toBeNull();
    store.rebuildSearchIndex();
    // 兜底生成了缓存
    expect(store.readNoteCaches(id).plain).toContain("量子纠缠");
    // FTS 可搜到正文
    expect(store.searchNotes("量子纠缠").some((h) => h.id === id)).toBe(true);
  });

  it("uploadResource 写入资源文件并返回 URL", async () => {
    const { id } = makeNote();
    // 1x1 透明 PNG（sniffImageFormat 校验魔数）
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const out = await store.uploadResource({ bytes: new Uint8Array(png), filename: "hello.png" }, id);
    expect(out.url).toContain(`127.0.0.1:19876/${id}/`);
    expect(fs.existsSync(path.join(dir, "note-assets", id, out.filename))).toBe(true);
  });

  it("审计：uploadResource 拒绝解码后超 50MP 的图片（防解压炸弹）", async () => {
    const { id } = makeNote();
    // 构造合法 PNG：IHDR 声明 100000x100000（文件本身只有几十字节，带正确 CRC）
    const crc32 = (buf: Buffer): number => zlib.crc32(buf) >>> 0;
    const chunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
      const typeBuf = Buffer.from(type, "ascii");
      const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
      return Buffer.concat([len, typeBuf, data, crcBuf]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(100000, 0); ihdr.writeUInt32BE(100000, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
    const bomb = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", ihdr),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    await expect(store.uploadResource({ bytes: new Uint8Array(bomb), filename: "bomb.png" }, id)).rejects.toThrow(/尺寸过大/);
  });
});

describe("审计修复回归（#2/#3/#12/#17/#18）", () => {
  it("moveTreeNodeOrdered 单次原子移动+重排（#18）", () => {
    const nb = store.createNotebook("目标册");
    const n1 = store.createNoteIn(nb.id, "一");
    const n2 = store.createNoteIn(nb.id, "二");
    const n3 = store.createNoteIn(nb.id, "三");
    const orderedIds = [n3.id, n1.id, n2.id];
    const moved = store.moveTreeNodeOrdered(n2.id, nb.id, orderedIds);
    expect(moved.parentId).toBe(nb.id);
    const rows = store.listTreeNodes().filter((n) => n.parentId === nb.id).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(rows.map((r) => r.id)).toEqual(orderedIds);
  });

  it("moveTreeNodeOrdered 复用树不变量校验（#9/#18）", () => {
    const note = store.createNote("叶子");
    const nb = store.createNotebook("册");
    const other = store.createNotebook("另册");
    const otherGroup = store.createGroup(other.id, "组");
    // 笔记本移入 group → 笔记本只能位于根层（且 group 非其子孙，先过自身/子孙检查）
    expect(() => store.moveTreeNodeOrdered(nb.id, otherGroup.id, [])).toThrowError(/笔记本只能位于根层/);
    expect(() => store.moveTreeNodeOrdered(note.id, note.id, [note.id])).toThrowError(/不能移动到自身/);
  });

  it("moveTreeNodeOrdered 跨父移动：orderedIds 含被移动 id（目标父现有子节点 + 插入 id）→ 校验通过（2026-08-22 修复）", () => {
    const nb1 = store.createNotebook("源册");
    const nb2 = store.createNotebook("目标册");
    const n1 = store.createNoteIn(nb2.id, "目标一");
    const n2 = store.createNoteIn(nb2.id, "目标二");
    const moving = store.createNoteIn(nb1.id, "移动中");
    // 前端构造：目标父现有子节点（排除移动 id，本就无）+ 插入位置的移动 id
    const orderedIds = [moving.id, n1.id, n2.id];
    const moved = store.moveTreeNodeOrdered(moving.id, nb2.id, orderedIds);
    expect(moved.parentId).toBe(nb2.id);
    const rows = store.listTreeNodes().filter((n) => n.parentId === nb2.id).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(rows.map((r) => r.id)).toEqual(orderedIds);
    // 反向：移动 id 未包含在 orderedIds → 仍报缺子节点
    expect(() => store.moveTreeNodeOrdered(n1.id, nb2.id, [n1.id, n2.id])).toThrowError(/全部子节点/);
  });

  it("cleanOrphanAssets：删除失败保留记录与计数（#12）", () => {
    const note = store.createNote("孤儿");
    const filename = assetFilename();
    const assetDir = path.join(dir, "note-assets", note.id);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, filename), "data");
    store.saveNote(note.id, "孤儿", "<p>无引用</p>");
    expect(store.listOrphanAssets().length).toBe(1);
    // 把文件替换成目录 → unlinkSync 抛错 → 记录必须保留可重试
    fs.rmSync(path.join(assetDir, filename));
    fs.mkdirSync(path.join(assetDir, filename));
    const r1 = store.cleanOrphanAssets();
    expect(r1.count).toBe(0);
    expect(store.listOrphanAssets().length).toBe(1);
    // 恢复为可删文件 → 清理成功
    fs.rmdirSync(path.join(assetDir, filename));
    fs.writeFileSync(path.join(assetDir, filename), "data");
    const r2 = store.cleanOrphanAssets();
    expect(r2.count).toBe(1);
    expect(store.listOrphanAssets().length).toBe(0);
  });

  it("importRemoteNote 拒绝恶意 note.id / asset.filename 且不写半成品（#3/#17）", () => {
    const badNote = { id: "../../escape", title: "x", parentId: null, sortOrder: 0, updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false };
    expect(() => store.importRemoteNote(badNote, Buffer.from("<p>x</p>"), [])).toThrowError(/无效的笔记 ID/);
    const goodNote = { id: "remote-ok", title: "x", parentId: null, sortOrder: 0, updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false };
    expect(() => store.importRemoteNote(goodNote, Buffer.from("<p>x</p>"), [{ filename: "../escape.png", bytes: Buffer.from("x") }])).toThrowError(/无效的资源文件名/);
    expect(fs.existsSync(path.join(dir, "notes", "remote-ok.lake"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "note-assets", "remote-ok"))).toBe(false);
    // 正常导入（staging 路径）仍可用
    store.importRemoteNote(goodNote, Buffer.from("<p>x</p>"), [{ filename: "1234567890123_deadbeef.png", bytes: Buffer.from("x") }]);
    expect(fs.existsSync(path.join(dir, "notes", "remote-ok.lake"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "note-assets", "remote-ok", "1234567890123_deadbeef.png"), "utf8")).toBe("x");
  });

  it("rememberDeleted 学习远端删除（#2）", () => {
    store.rememberDeleted({ id: "remote-gone", title: "远端已删", parentId: null, sortOrder: 0, updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false }, "2026-08-02T01:00:00.000Z");
    const list = store.listDeletedNotesForSync();
    expect(list.some((d) => d.id === "remote-gone")).toBe(true);
    expect(list.find((d) => d.id === "remote-gone")?.deletedAt).toBe("2026-08-02T01:00:00.000Z");
  });

  it("saveNote 对非法 id 拒绝（#17：notePath 校验下沉）", () => {
    // saveNote 直接构造路径 → 命中 notePath 校验
    expect(() => store.saveNote("../../evil", "t", "<p>x</p>")).toThrowError(/无效的笔记 ID/);
    // readNote 先查 DB：不存在的 id 报 NotFound（不触发路径构造），不构成穿越
    expect(() => store.readNote("../x")).toThrowError(/笔记不存在/);
  });
});

describe("孤儿登记对账（写时登记/保存对账 + 导入对账）", () => {
  it("uploadResource 写盘即登记孤儿；保存引用后撤销，不再引用重新登记", async () => {
    const { id } = makeNote();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const out = await store.uploadResource({ bytes: new Uint8Array(png), filename: "hello.png" }, id);
    // 写盘瞬间已登记孤儿（正文尚未引用）——杜绝未登记就被同步上传的窄窗口
    expect(store.listOrphanAssets().some((o) => o.noteId === id && o.filename === out.filename)).toBe(true);
    // 保存时正文引用 → 撤销孤儿
    store.saveNote(id, "t", `<p>引用 <img src="${out.url}"></p>`);
    expect(store.listOrphanAssets().some((o) => o.noteId === id && o.filename === out.filename)).toBe(false);
    // 不再引用 → 重新登记（回收站语义）
    store.saveNote(id, "t", "<p>不再引用</p>");
    expect(store.listOrphanAssets().some((o) => o.noteId === id && o.filename === out.filename)).toBe(true);
  });

  it("importRemoteNote 导入后按正文对账：远端已无的旧文件标记孤儿、被引用的撤销（#11）", () => {
    const id = "import-reconcile";
    const assetsDir = path.join(dir, "note-assets", id);
    fs.mkdirSync(assetsDir, { recursive: true });
    const keepName = "1785730251600_80768773.png";  // 匹配 referencedFilenames 模式
    const staleName = "1785730251601_aaaa1111.png";
    fs.writeFileSync(path.join(assetsDir, keepName), "keep");
    fs.writeFileSync(path.join(assetsDir, staleName), "stale");
    // 第一次导入：正文引用 keepName → keep 正常、stale 标记孤儿（远端已无）
    store.importRemoteNote(
      { id, title: "远端", parentId: null, sortOrder: 0, updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false },
      Buffer.from(`<p>引用 ${keepName}</p>`),
      [{ filename: keepName, bytes: Buffer.from("keep") }]
    );
    let orphans = store.listOrphanAssets().filter((o) => o.noteId === id);
    expect(orphans.some((o) => o.filename === staleName)).toBe(true);
    expect(orphans.some((o) => o.filename === keepName)).toBe(false);
    // 第二次导入：正文不再引用 keepName（远端集合缩小）→ keepName 也变孤儿
    store.importRemoteNote(
      { id, title: "远端2", parentId: null, sortOrder: 0, updatedAt: "2026-08-02T00:00:00.000Z", isConflict: false },
      Buffer.from("<p>都不引用了</p>"),
      []
    );
    orphans = store.listOrphanAssets().filter((o) => o.noteId === id);
    expect(orphans.some((o) => o.filename === keepName)).toBe(true);
    expect(orphans.some((o) => o.filename === staleName)).toBe(true);
    // 文件仍在磁盘（回收站语义，不硬删）
    expect(fs.existsSync(path.join(assetsDir, keepName))).toBe(true);
    expect(fs.existsSync(path.join(assetsDir, staleName))).toBe(true);
  });
});

describe("顶部插入底层能力", () => {
  it("createNoteInAtTopWithContent 将新文档插入同级顶部，并保持 notes/tree_nodes 排序一致", () => {
    const notebook = store.createNotebook("顶部排序测试");
    const first = store.createNoteIn(notebook.id, "原第一篇");
    const second = store.createNoteIn(notebook.id, "原第二篇");
    const top = store.createNoteInAtTopWithContent(notebook.id, "新顶部", "<p class=\"ne-p\">top</p>", []);

    const tree = store.listTreeNodes().filter((node) => node.parentId === notebook.id && node.nodeType === "note").sort((a, b) => a.sortOrder - b.sortOrder);
    expect(tree.map((node) => node.id)).toEqual([top.id, first.id, second.id]);
    expect(tree.map((node) => node.sortOrder)).toEqual([0, 1, 2]);
    expect(store.readNote(top.id).content).toContain("top");

    const db = new Database(path.join(dir, "metadata.sqlite3"), { readonly: true });
    try {
      const rows = db.prepare("SELECT id, sort_order FROM notes WHERE parent_id=? AND deleted_at IS NULL ORDER BY sort_order").all(notebook.id) as Array<{ id: string; sort_order: number }>;
      expect(rows.map((row) => row.id)).toEqual([top.id, first.id, second.id]);
      expect(rows.map((row) => row.sort_order)).toEqual([0, 1, 2]);
    } finally { db.close(); }
  });
});

describe("M8 历史分层保留判定", () => {
  it("isoWeekKey 使用 ISO 周年（周一起始），跨年/跨月不漂移", () => {
    expect(isoWeekKey(Date.parse("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekKey(Date.parse("2025-12-29T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekKey(Date.parse("2026-01-05T00:00:00Z"))).toBe("2026-W02");
    expect(isoWeekKey(Date.parse("2026-08-13T00:00:00Z"))).toBe("2026-W33");
  });

  it("近 24h 全留；硬上限 maxSnapshots 生效", () => {
    const now = Date.now();
    const ts = (ageMs: number) => new Date(now - ageMs).toISOString();
    const list = [ts(0), ts(1000), ts(2 * 3600 * 1000), ts(26 * 3600 * 1000), ts(2 * 24 * 3600 * 1000)];
    const drops = selectHistoryDrops(list, { maxSnapshots: 2, retentionDays: 30 });
    expect(drops.size).toBe(3);
  });

  it("超过 retentionDays 的旧快照必删", () => {
    const now = Date.now();
    const old = new Date(now - 40 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(now - 1000).toISOString();
    const drops = selectHistoryDrops([old, recent], { maxSnapshots: 100, retentionDays: 30 });
    expect(drops.has(old)).toBe(true);
    expect(drops.has(recent)).toBe(false);
  });
});

// ===== W-3：资产 URL 提取正则工厂（端口跟随 ASSET_PORT） =====
describe("localAsset*Re 正则工厂", () => {
  it("默认端口 19876 匹配 lake src / html img / markdown img", async () => {
    const { localAssetLakeSrcRe, localAssetHtmlImgRe, localAssetMdImgRe } = await import("./store.js");
    expect(localAssetLakeSrcRe(19876).exec("http://127.0.0.1:19876/n1/a.png")?.[2]).toBe("a.png");
    expect(localAssetHtmlImgRe(19876).exec('<img src="http://127.0.0.1:19876/n1/a.png">')?.[2]).toBe("n1");
    expect(localAssetMdImgRe(19876).exec("![](http://127.0.0.1:19876/n1/a.png)")?.[3]).toBe("a.png");
  });

  it("自定义端口（LAKE_ASSET_PORT 覆盖场景）也能匹配，不再静默丢图", async () => {
    const { localAssetLakeSrcRe, localAssetMdImgRe } = await import("./store.js");
    expect(localAssetLakeSrcRe(19877).exec("http://127.0.0.1:19877/n1/a.png")?.[1]).toBe("n1");
    expect(localAssetMdImgRe(19877).exec("![](http://127.0.0.1:19877/n1/a.png)")?.[2]).toBe("n1");
    // 默认端口正则不匹配其他端口的 URL（不误吞）
    expect(localAssetLakeSrcRe(19876).exec("http://127.0.0.1:19877/n1/a.png")).toBeNull();
  });

  it("远程 URL 不匹配（保持原样）", async () => {
    const { localAssetLakeSrcRe } = await import("./store.js");
    expect(localAssetLakeSrcRe(19876).exec("https://example.com/n1/a.png")).toBeNull();
  });
});

describe("同步待处理摘要", () => {
  it("counts only syncable notes and does not treat every referenced asset as pending", () => {
    const note = store.createNote("待同步摘要");
    const filename = assetFilename();
    const content = `<p><img src="http://127.0.0.1:19876/${note.id}/${filename}"></p>`;
    store.saveNote(note.id, note.title, content, { plain: "摘要", markdown: content });
    const summary = store.getSyncPendingSummary();
    expect(summary.documents).toBeGreaterThanOrEqual(1);
    expect(summary.resources).toBe(0);
    expect(summary.generatedAt).toMatch(/T/);
  });

  it("counts pending folder metadata separately", () => {
    for (const n of store.listNotesForSync()) store.markSynced(n.id);
    for (const f of store.listFoldersForSync()) store.markFolderSynced(f.id, f.updatedAt);
    const nb = store.listTreeNodes().find((n) => n.nodeType === "notebook")!;
    const group = store.createGroup(nb.id, "待同步目录");
    const summary = store.getSyncPendingSummary();
    expect(summary.folders).toBeGreaterThanOrEqual(1);
    expect(summary.documents).toBe(0);
    store.setNodeIcon(group.id, "star");
    expect(store.getSyncPendingSummary().folders).toBeGreaterThanOrEqual(1);
  });

  it("counts a trashed folder as pending (aligns with listFoldersForSync)", () => {
    for (const n of store.listNotesForSync()) store.markSynced(n.id);
    for (const f of store.listFoldersForSync()) store.markFolderSynced(f.id, f.updatedAt);
    const nb = store.listTreeNodes().find((n) => n.nodeType === "notebook")!;
    const group = store.createGroup(nb.id, "被回收目录");
    store.markFolderSynced(group.id, group.updatedAt);
    expect(store.getSyncPendingSummary().folders).toBe(0);
    // 移入回收站 = 移动即同步传播；发布后 markFolderSynced 才会归位，故入回收站后应计入待同步目录。
    store.deleteTreeNode(group.id);
    expect(store.listFoldersForSync().some((f) => f.id === group.id)).toBe(true);
    expect(store.getSyncPendingSummary().folders).toBeGreaterThanOrEqual(1);
  });

  it("counts a local delete tombstone as one pending document", () => {
    const note = store.createNote("待删除摘要");
    store.markSynced(note.id);
    const beforeDelete = store.getSyncPendingSummary().documents;
    store.deleteTreeNode(note.id);
    // 删除会把已同步文档替换成墓碑；数量至少不应静默减少。
    expect(store.getSyncPendingSummary().documents).toBeGreaterThanOrEqual(beforeDelete);
  });
});

// ===== 种子笔记本普通化：系统里没有"默认/不可删除"的笔记本（2026-08-27） =====
describe("种子笔记本普通化（无默认/不可删笔记本）", () => {
  it("种子笔记本（个人笔记）可删除：deleteTreeNode 不再抛错，移入回收站；回收站容器仍不可删", () => {
    expect(store.listTreeNodes().some((n) => n.id === "notebook-personal")).toBe(true);
    expect(() => store.deleteTreeNode("notebook-personal")).not.toThrow();
    const trash = store.listTrash();
    expect(trash.some((t) => t.id === "notebook-personal")).toBe(true);
    // 回收站是机制容器（有笔记本行为的容器，非普通笔记本），仍不可删
    expect(() => store.deleteTreeNode("notebook-trash")).toThrow(/不能删除回收站笔记本/);
  });

  it("purge 种子笔记本后重新初始化不复活（seed_initialized 标记）", () => {
    store.deleteTreeNode("notebook-personal");
    store.purgeTrashItem("notebook-personal");
    // 重新打开同一库（模拟重启/下次启动）
    store = new Store(dir, createSafeStorageSecretCipher());
    const notebooks = store.listTreeNodes().filter((n) => n.nodeType === "notebook");
    expect(notebooks.some((n) => n.id === "notebook-personal")).toBe(false);
  });

  it("无任何笔记本时 createNote 自动创建普通笔记本'未分类'（图标 X）", () => {
    store.deleteTreeNode("notebook-personal");
    store.purgeTrashItem("notebook-personal");
    expect(store.listTreeNodes().filter((n) => n.nodeType === "notebook")).toHaveLength(0);
    const note = store.createNote("新笔记");
    const notebooks = store.listTreeNodes().filter((n) => n.nodeType === "notebook");
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0].title).toBe("未分类");
    expect(notebooks[0].icon).toBe("X");
    expect(note.parentId).toBe(notebooks[0].id);
  });

  it("createNoteIn(parentId=null) 落到存在的笔记本（sortOrder 最小），不自动建'未分类'", () => {
    const nb = store.createNotebook("我的库"); // sortOrder 1
    const note = store.createNoteIn(null, "无父笔记");
    // 种子（个人笔记）sortOrder 0 → 兜底优先它；不会新建"未分类"
    expect(note.parentId).toBe("notebook-personal");
    expect(store.listTreeNodes().filter((n) => n.nodeType === "notebook")).toHaveLength(2);
  });
});
// ===== R1/R2 红测试（V5 §4，Phase -1 测试护栏；修复前应失败） =====

describe("R1：零变更早退 group-only 判定（红测试：现状 hasLocalPendingNotes 只查 notes，漏检 group）", () => {
  /** 基线：把全部笔记与目录置 synced，模拟「已同步完成」状态。
   * 注意：个人笔记本初始化就是 local（store.ts:335），新 group 查询会命中它——
   * 这恰好证明 markFolderSynced 归位是必配项；基线用 listFoldersForSync + markFolderSynced 归位。 */
  function syncedBaseline() {
    for (const n of store.listNotesForSync()) store.markSynced(n.id);
    for (const f of store.listFoldersForSync()) store.markFolderSynced(f.id, f.updatedAt);
    expect(store.hasLocalPendingNotes()).toBe(false); // 基线确认
  }

  it("纯 group 改名后 hasLocalPendingNotes() 应为 true（现状返回 false → 漏检）", () => {
    syncedBaseline();
    const nb = store.listTreeNodes().find((n) => n.nodeType === "notebook")!;
    const group = store.createGroup(nb.id, "项目A");
    // 纯目录改动：renameTreeNode 只写 tree_nodes.sync_state='local'，notes 侧是空更新（group 无 note_file_id）
    store.renameTreeNode(group.id, "项目B");
    expect(store.hasLocalPendingNotes()).toBe(true);
  });

  it("纯 group 图标变化后 hasLocalPendingNotes() 应为 true（现状返回 false → 漏检）", () => {
    syncedBaseline();
    const nb = store.listTreeNodes().find((n) => n.nodeType === "notebook")!;
    const group = store.createGroup(nb.id, "项目A");
    store.setNodeIcon(group.id, "🚀");
    expect(store.hasLocalPendingNotes()).toBe(true);
  });
});

describe("R2：本地同步快照保护（V5 §5.2，markSyncedIfUnchanged）", () => {
  function snapshotOf(noteId: string): {
    contentHash: string; updatedAt: string; title: string; parentId: string | null;
    sortOrder: number; isLocked: boolean; lockedAt: string | null; icon: string | null;
  } {
    const n = store.listNotesForSync().find((x) => x.id === noteId)!;
    return {
      contentHash: store.contentHash(noteId), updatedAt: n.updatedAt, title: n.title,
      parentId: n.parentId, sortOrder: n.sortOrder, isLocked: !!n.isLocked,
      lockedAt: n.lockedAt ?? null, icon: n.icon ?? null,
    };
  }

  it("上传期间编辑正文 → 不标 synced、保持 local 下轮重传", async () => {
    const note = store.createNote("竞态笔记");
    store.saveNote(note.id, "竞态笔记", "<p>v1</p>");
    const snapshot = snapshotOf(note.id); // 同步开始快照
    await new Promise((r) => setTimeout(r, 5)); // 推进时间避免同毫秒 updated_at 撞车
    store.saveNote(note.id, "竞态笔记改", "<p>v2</p>"); // 上传期间编辑
    const ok = store.markSyncedIfUnchanged(note.id, snapshot);
    expect(ok).toBe(false);
    expect(store.listNotesForSync().find((n) => n.id === note.id)!.syncState).toBe("local");
  });

  it("上传期间改标题 → 不标 synced", async () => {
    const note = store.createNote("标题竞态");
    store.saveNote(note.id, "标题竞态", "<p>v1</p>");
    const snapshot = snapshotOf(note.id);
    await new Promise((r) => setTimeout(r, 5));
    store.renameTreeNode(note.id, "标题改了"); // meta 编辑
    expect(store.markSyncedIfUnchanged(note.id, snapshot)).toBe(false);
    expect(store.listNotesForSync().find((n) => n.id === note.id)!.syncState).toBe("local");
  });

  it("未编辑 → 标 synced 并归位 tree_nodes", () => {
    const note = store.createNote("正常笔记");
    store.saveNote(note.id, "正常笔记", "<p>v1</p>");
    const snapshot = snapshotOf(note.id);
    expect(store.markSyncedIfUnchanged(note.id, snapshot)).toBe(true);
    expect(store.listNotesForSync().find((n) => n.id === note.id)!.syncState).toBe("synced");
  });
});


describe("A 方案 declared_assets（桌面 store）", () => {
  it("recordDeclaredAssets 写入并 upsert；listDeclaredAssets 按 note 返回", () => {
    const note = store.createNote("资源笔记");
    store.recordDeclaredAssets(note.id, [
      { filename: "1234567890123_a1b2c3d4.png", size: 200, hash: "ab".repeat(32) },
      { filename: "1234567890124_b2c3d4e5.pdf", size: 99, hash: "cd".repeat(32) },
    ]);
    expect(store.listDeclaredAssets(note.id)).toEqual([
      { filename: "1234567890123_a1b2c3d4.png", size: 200, hash: "ab".repeat(32) },
      { filename: "1234567890124_b2c3d4e5.pdf", size: 99, hash: "cd".repeat(32) },
    ]);
    // upsert：同名更新 size/hash，不新增行
    store.recordDeclaredAssets(note.id, [{ filename: "1234567890123_a1b2c3d4.png", size: 300, hash: "ef".repeat(32) }]);
    const listed = store.listDeclaredAssets(note.id);
    expect(listed).toHaveLength(2);
    expect(listed.find((x) => x.filename === "1234567890123_a1b2c3d4.png")).toEqual({ filename: "1234567890123_a1b2c3d4.png", size: 300, hash: "ef".repeat(32) });
  });

  it("不同笔记的 declared_assets 互不串（按 note_id 隔离）", () => {
    const a = store.createNote("A 笔记");
    const b = store.createNote("B 笔记");
    store.recordDeclaredAssets(a.id, [{ filename: "1234567890123_a1b2c3d4.png", size: 1, hash: "ab".repeat(32) }]);
    store.recordDeclaredAssets(b.id, [{ filename: "1234567890124_b2c3d4e5.pdf", size: 2, hash: "cd".repeat(32) }]);
    expect(store.listDeclaredAssets(a.id)).toHaveLength(1);
    expect(store.listDeclaredAssets(b.id)).toHaveLength(1);
  });
});

describe("A3 数据体检（runDataHealthCheck，只读）", () => {
  it("健康库：无缺失无漂移，计数正确", () => {
    const note = store.createNote("体检正常");
    store.saveNote(note.id, "体检正常", "<p>hello</p>");
    store.createHistorySnapshot(note.id);
    const r = store.runDataHealthCheck();
    expect(r.notesChecked).toBeGreaterThanOrEqual(1);
    expect(r.notesMissingFile).toEqual([]);
    expect(r.notesHashMismatch).toEqual([]);
    expect(r.historyMissingFile).toBe(0);
    expect(r.orphanRowsFileMissing).toEqual([]);
    expect(r.checkedAt).toBeTruthy();
  });

  it("正文文件缺失/哈希不符被识别", () => {
    const note = store.createNote("体检缺失");
    store.saveNote(note.id, "体检缺失", "<p>v1</p>");
    // 建立基线（setBaseHash 模拟已同步），然后删 .lake → 缺失
    const lakePath = (store as any).notePath(note.id);
    const hash1 = crypto.createHash("sha256").update(fs.readFileSync(lakePath)).digest("hex");
    store.setBaseHash(note.id, hash1);
    // 用脏内容覆盖 .lake → hash 不符
    fs.writeFileSync(lakePath, "<p>corrupted</p>");
    let r = store.runDataHealthCheck();
    expect(r.notesHashMismatch.some((x) => x.id === note.id)).toBe(true);
    // 直接删文件 → 缺失
    fs.rmSync(lakePath, { force: true });
    r = store.runDataHealthCheck();
    expect(r.notesMissingFile.some((x) => x.id === note.id)).toBe(true);
  });

  it("历史快照文件缺失被识别", () => {
    const note = store.createNote("快照缺失");
    store.saveNote(note.id, "快照缺失", "<p>v1</p>");
    const sid = store.createHistorySnapshot(note.id) as number;
    const rows = (store as any).db.prepare("SELECT file_path FROM note_history WHERE id=?").get(sid) as { file_path: string };
    fs.rmSync(path.join(dir, rows.file_path), { force: true });
    const r = store.runDataHealthCheck();
    expect(r.historyMissingFile).toBeGreaterThanOrEqual(1);
    expect(r.historyMissingSample.some((h) => h.id === sid)).toBe(true);
  });

  it("孤儿登记漂移（登记文件缺失）被识别", () => {
    // 直接插一条指向不存在文件的孤儿登记（绕过 registerOrphan 的写盘）
    const note = store.createNote("孤儿漂移");
    const fakePath = `note-assets/${note.id}/1786123456789_deadbeef.png`;
    (store as any).db.prepare("INSERT INTO orphan_assets(note_id,filename,file_path,size,mime_type) VALUES(?,?,?,?,?)")
      .run(note.id, "1786123456789_deadbeef.png", fakePath, 5, "image/png");
    const r = store.runDataHealthCheck();
    expect(r.orphanRowsFileMissing.some((o) => o.noteId === note.id)).toBe(true);
  });
});

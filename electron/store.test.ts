import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { Store, AppError } from "./store.js";

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
  store = new Store(dir);
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

  it("deleteTreeNode 递归删除 + 墓碑 + 清孤儿/资源目录", () => {
    const nb = store.createNotebook("待删");
    const group = store.createGroup(nb.id, "组");
    const note = store.createNoteIn(group.id, "子笔记");
    const assetDir = path.join(dir, "note-assets", note.id);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "unused.png"), "x");
    // 触发一次 saveNote 以登记孤儿
    store.saveNote(note.id, "子笔记", "<p>无引用</p>");

    store.deleteTreeNode(nb.id);
    expect(store.listTreeNodes().some((n) => n.id === nb.id)).toBe(false);
    expect(fs.existsSync(path.join(dir, "notes", `${note.id}.lake`))).toBe(false);
    expect(fs.existsSync(assetDir)).toBe(false);
    expect(store.listDeletedNotesForSync().some((d) => d.id === note.id)).toBe(true);
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

  it("pruneTombstones 剪除墓碑", () => {
    const { id } = makeNote();
    store.deleteNote(id);
    expect(store.listDeletedNotesForSync().some((d) => d.id === id)).toBe(true);
    store.pruneTombstones([id]);
    expect(store.listDeletedNotesForSync().some((d) => d.id === id)).toBe(false);
    store.pruneTombstones([]); // 空数组安全
  });

  it("listNotesForSync 只返回未删除笔记", () => {
    const { id } = makeNote();
    expect(store.listNotesForSync().some((n) => n.id === id)).toBe(true);
    store.deleteNote(id);
    expect(store.listNotesForSync().some((n) => n.id === id)).toBe(false);
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

  it("uploadResource 写入资源文件并返回 URL", () => {
    const { id } = makeNote();
    // 1x1 透明 PNG（sniffImageFormat 校验魔数）
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const out = store.uploadResource({ bytes: [...png], filename: "hello.png" }, id);
    expect(out.url).toContain(`127.0.0.1:19876/${id}/`);
    expect(fs.existsSync(path.join(dir, "note-assets", id, out.filename))).toBe(true);
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
  it("uploadResource 写盘即登记孤儿；保存引用后撤销，不再引用重新登记", () => {
    const { id } = makeNote();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const out = store.uploadResource({ bytes: [...png], filename: "hello.png" }, id);
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

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

  it("reorderTreeNodes 更新顺序", () => {
    const n1 = store.createNote("一");
    const n2 = store.createNote("二");
    store.reorderTreeNodes("notebook-personal", [n2.id, n1.id]);
    const rows = store.listTreeNodes().filter((n) => n.nodeType === "note");
    expect(rows.findIndex((r) => r.id === n2.id)).toBeLessThan(rows.findIndex((r) => r.id === n1.id));
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

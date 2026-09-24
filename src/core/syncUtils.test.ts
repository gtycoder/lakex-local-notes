/**
 * Step A 等价测试（H2/H3）：extnameLikeNode vs node:path.extname；parseLakeManifest
 * TextDecoder vs Buffer.toString；validateManifest 抛错行为。
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { extnameLikeNode, isNoSuchKey, mimeTypeFor, parseLakeManifest, validateManifest, objectKey } from "./syncUtils.js";

// ---- H2: extnameLikeNode 与 node:path.extname 等价 ----
const extnameCases = [
  "a.png", "a.b.c.jpg", ".gitignore", "a.", "noext", "中文名.png",
  "dir/a.jpg", "dir/sub/a.b.c.jpeg", "dir/.hidden", "a b c.webp",
  "x.tar.gz", "..double", "a..", "a.b.c.d", "123.456",
];

describe("extnameLikeNode 与 node:path.extname 等价", () => {
  for (const name of extnameCases) {
    it(`extname(${JSON.stringify(name)})`, () => {
      expect(extnameLikeNode(name)).toBe(path.extname(name));
    });
  }
});

describe("mimeTypeFor 行为保持", () => {
  it("常见类型映射不变", () => {
    expect(mimeTypeFor("x.png")).toBe("image/png");
    expect(mimeTypeFor("x.JPG")).toBe("image/jpeg");
    expect(mimeTypeFor("x.webp")).toBe("image/webp");
    expect(mimeTypeFor("x.svg")).toBe("image/svg+xml");
  });
  it("未知类型回落 octet-stream", () => {
    expect(mimeTypeFor("x.txt")).toBe("application/octet-stream");
    expect(mimeTypeFor("noext")).toBe("application/octet-stream");
  });
});

// ---- H3: parseLakeManifest（Uint8Array + TextDecoder）行为保持 ----
function makeValidManifest(): object {
  return {
    version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null,
    createdAt: "2026-08-22T00:00:00Z",
    notes: [{ id: "n1", title: "t", parentId: null, sortOrder: 0, updatedAt: "2026-08-22T00:00:00Z", contentHash: "a".repeat(64), isConflict: false, assets: [] }],
    folders: [],
  };
}

describe("parseLakeManifest（Uint8Array 版）", () => {
  it("合法清单解析（含中文标题）", () => {
    const m = makeValidManifest() as { notes: Array<{ title: string }> };
    m.notes[0].title = "中文标题测试";
    const bytes = new TextEncoder().encode(JSON.stringify(m));
    const parsed = parseLakeManifest(bytes);
    expect(parsed.notes[0].title).toBe("中文标题测试");
    expect(parsed.notes[0].id).toBe("n1");
  });

  it("非法 JSON 抛错：同步清单不是合法 JSON", () => {
    expect(() => parseLakeManifest(new TextEncoder().encode("{not json"))).toThrow("同步清单不是合法 JSON");
  });

  it("超字节上限抛错", () => {
    const big = new Uint8Array(21 * 1024 * 1024);
    expect(() => parseLakeManifest(big, { maxBytes: 20 * 1024 * 1024 })).toThrow("清单过大");
  });

  it("默认上限 = 20MB（不传 limits）", () => {
    expect(() => parseLakeManifest(new Uint8Array(20 * 1024 * 1024 + 1))).toThrow("清单过大");
  });
});

// ---- validateManifest 抛错行为保持（桌面 sync.ts 同消息） ----
describe("validateManifest 抛错行为", () => {
  it("版本不兼容", () => {
    const m = makeValidManifest() as { version: number };
    m.version = 3;
    expect(() => validateManifest(m, { maxNotes: 100, maxFolders: 100 })).toThrow("清单版本不兼容");
  });
  it("notes 非数组", () => {
    const m = makeValidManifest() as { notes: unknown };
    m.notes = "bad";
    expect(() => validateManifest(m, { maxNotes: 100, maxFolders: 100 })).toThrow("notes 不是数组");
  });
  it("条目超上限", () => {
    const m = makeValidManifest() as { notes: Array<unknown> };
    m.notes = new Array(101).fill({});
    expect(() => validateManifest(m, { maxNotes: 100, maxFolders: 100 })).toThrow("清单条目过多");
  });
  it("active 笔记 contentHash 非法（非 64 hex）", () => {
    const m = makeValidManifest() as { notes: Array<{ contentHash: string }> };
    m.notes[0].contentHash = "not-a-hash";
    expect(() => validateManifest(m, { maxNotes: 100, maxFolders: 100 })).toThrow("contentHash 非法");
  });
  it("deleted 墓碑占位 contentHash 放行", () => {
    const m = makeValidManifest() as { notes: Array<{ deleted?: boolean; contentHash: string }> };
    m.notes[0].deleted = true;
    m.notes[0].contentHash = "placeholder-id"; // 占位符（= note id）
    expect(() => validateManifest(m, { maxNotes: 100, maxFolders: 100 })).not.toThrow();
  });
  it("folders 非数组抛错", () => {
    const m = makeValidManifest() as { folders: unknown };
    m.folders = null;
    expect(() => validateManifest(m, { maxNotes: 100, maxFolders: 100 })).toThrow("folders 非数组");
  });
  // 260925：v7 新增 board 时硬编码白名单漏更新 ⇒ 含画板清单读不回。这里卡住所有已知 kind。
  it("已知 kind（doc/sheet/bitable/board）放行", () => {
    for (const kind of ["doc", "sheet", "bitable", "board"] as const) {
      const m = makeValidManifest() as { notes: Array<Record<string, unknown>> };
      m.notes[0].kind = kind;
      expect(() => validateManifest(m, { maxNotes: 100, maxFolders: 100 }), kind).not.toThrow();
    }
  });
  it("未知 kind 显式拒绝（不静默当 doc）", () => {
    const m = makeValidManifest() as { notes: Array<Record<string, unknown>> };
    m.notes[0].kind = "future-kind";
    expect(() => validateManifest(m, { maxNotes: 100, maxFolders: 100 })).toThrow("kind 非法");
  });
});

// ---- objectKey 行为保持 ----
describe("objectKey", () => {
  it("格式不变", () => {
    expect(objectKey("n1", "abc")).toBe("objects/n1-abc.lake");
  });
});

// ---- isNoSuchKey：GetObject(NoSuchKey) 与 HeadObject(NotFound) 的 404 都判缺失 ----
describe("isNoSuchKey", () => {
  it("recognizes GetObject missing (NoSuchKey)", () => {
    const e = new Error("The specified key does not exist.");
    e.name = "NoSuchKey";
    expect(isNoSuchKey(e)).toBe(true);
  });

  it("recognizes HeadObject missing (NotFound name, UnknownError message)", () => {
    // 七牛 Kodo HeadObject 缺失：name=NotFound、message=UnknownError（实测）
    const e = new Error("UnknownError");
    e.name = "NotFound";
    expect(isNoSuchKey(e)).toBe(true);
  });

  it("rejects real errors", () => {
    const e = new Error("network timeout");
    e.name = "TimeoutError";
    expect(isNoSuchKey(e)).toBe(false);
    expect(isNoSuchKey(new Error("AccessDenied: denied"))).toBe(false);
  });
});

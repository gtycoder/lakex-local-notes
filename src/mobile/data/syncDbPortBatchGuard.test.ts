/**
 * 批窗口守卫（I2 的下载方向）：beginNoteBatch→flushNoteBatch 之间**跨网络取内容**，
 * 本机编辑可以插进来。flush 时必须"未变才应用"，否则远端版本会静默盖掉用户刚写的正文。
 */
import { describe, expect, it } from "vitest";
import { createMobileSyncDbPort } from "./syncDbPort";
import type { MobileDb } from "./sqliteDb.js";
import { readNoteBody } from "./noteBodies.js";

interface Row { content: string; content_hash: string; is_dirty: number }

/** 最小假库：只实现本测试用到的 SELECT id, content_hash 与 executeSet。 */
function fakeDb(rows: Map<string, Row>) {
  const executed: Array<{ statement: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        async all() {
          if (/SELECT id, content_hash FROM notes/.test(sql)) {
            return [...rows.entries()].map(([id, r]) => ({ id, content_hash: r.content_hash }));
          }
          return [];
        },
        async get() { return undefined; },
        async run() { return undefined; },
      };
    },
    async executeSet(items: Array<{ statement: string; values: unknown[] }>) { executed.push(...items); },
    async transaction<T>(fn: () => Promise<T>) { return await fn(); },
  };
  return { db: db as unknown as MobileDb, executed };
}

const assetFs = {
  assets: new Map<string, Uint8Array>(),
  saveAssetFile: async () => {},
  loadAssetFile: async () => null,
  removeAssetFile: async () => {},
  listNoteAssetKeys: async () => [] as string[],
};

function remoteNote(id: string, contentHash: string) {
  return {
    id, title: "远端标题", parentId: "nb", sortOrder: 0, updatedAt: "2026-10-10T00:00:00.000Z",
    contentHash, isConflict: false, isEditLocked: false, editLockedAt: null, icon: null,
    trashedAt: null, deletedFromParentId: null, kind: "doc", assets: [],
  } as unknown as Parameters<ReturnType<typeof createMobileSyncDbPort>["applyRemoteNote"]>[0];
}

describe("批窗口守卫：本机编辑不被远端静默覆盖", () => {
  it("批窗口内笔记被本机编辑 ⇒ 该条远端应用被推迟", async () => {
    const rows = new Map<string, Row>([["n1", { content: "本机旧", content_hash: "h-old", is_dirty: 0 }]]);
    const { db, executed } = fakeDb(rows);
    const port = createMobileSyncDbPort(() => db, assetFs);

    await port.beginNoteBatch!();
    await port.applyRemoteNote(remoteNote("n1", "h-remote"), "远端新");
    // 引擎在 apply 之后会立刻把该条基线记账塞进同一批；推迟时必须一起丢弃
    // （否则"正文没应用、基线却被推到远端 hash"，下一轮本机编辑会被误判成已同步）。
    await port.setSyncBase("n1", "h-remote", "2026-10-10T00:00:00.000Z", null);
    // 批窗口内用户写了新内容（saveNote 会同时更新 content_hash 与 is_dirty）
    rows.set("n1", { content: "本机新", content_hash: "h-local-new", is_dirty: 1 });
    await port.flushNoteBatch!();

    expect(executed).toHaveLength(0);
  });

  it("批窗口内没被动过 ⇒ 正常应用远端版本", async () => {
    const rows = new Map<string, Row>([["n1", { content: "本机旧", content_hash: "h-old", is_dirty: 0 }]]);
    const { db, executed } = fakeDb(rows);
    const port = createMobileSyncDbPort(() => db, assetFs);

    await port.beginNoteBatch!();
    await port.applyRemoteNote(remoteNote("n1", "h-remote"), "远端新");
    await port.flushNoteBatch!();

    expect(executed).toHaveLength(1);
    expect(String(executed[0].values[0])).toBe("n1");
    expect(await readNoteBody("doc", "n1"), "flush 必须把批内暂存的正文先落文件，不能只写 DB 行").toBe("远端新");
  });

  it("远端正文先落文件（doc），元数据只写 hash/缓存（261019 文件化）", async () => {
    const rows = new Map<string, Row>([["n1", { content: "", content_hash: "h-old", is_dirty: 0 }]]);
    const { db } = fakeDb(rows);
    const port = createMobileSyncDbPort(() => db, assetFs);

    await port.applyRemoteNote(remoteNote("n1", "h-remote"), "<p>远端正文FILE</p>");

    expect(await readNoteBody("doc", "n1")).toBe("<p>远端正文FILE</p>");
  });

  it("远端墓碑按 kind 落文件（bitable），不走 doc 路径", async () => {
    const rows = new Map<string, Row>();
    const { db } = fakeDb(rows);
    const port = createMobileSyncDbPort(() => db, assetFs);
    const body = JSON.stringify({ kind: "bitable", version: 1, activeTableId: "t1", tables: [] });

    await port.applyRemoteTrash("b1", body, "多维表", "2026-10-10T00:00:00.000Z", null, "trash", 0, "bitable");

    expect(await readNoteBody("bitable", "b1")).toBe(body);
    expect(await readNoteBody("doc", "b1")).toBeNull();
  });

  it("仅推迟被改动的那条，同批其它笔记照常应用", async () => {
    const rows = new Map<string, Row>([
      ["n1", { content: "a", content_hash: "h1", is_dirty: 0 }],
      ["n2", { content: "b", content_hash: "h2", is_dirty: 0 }],
    ]);
    const { db, executed } = fakeDb(rows);
    const port = createMobileSyncDbPort(() => db, assetFs);

    await port.beginNoteBatch!();
    await port.applyRemoteNote(remoteNote("n1", "r1"), "远端1");
    await port.applyRemoteNote(remoteNote("n2", "r2"), "远端2");
    rows.set("n1", { content: "a2", content_hash: "h1-new", is_dirty: 1 });
    await port.flushNoteBatch!();

    expect(executed.map((e) => String(e.values[0]))).toEqual(["n2"]);
  });
});

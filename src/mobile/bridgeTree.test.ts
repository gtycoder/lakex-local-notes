import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import type { Database } from "sql.js";

// sqliteDb.js 依赖 Vite ?url wasm import，vitest 下解析失败 → mock 为真实 sql.js（同 bridgePurge.test.ts）
vi.mock("./sqliteDb.js", async () => {
  const initSqlJs = (await import("sql.js")).default;
  let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
  const getSql = async () => {
    if (!SQL) SQL = await initSqlJs({ locateFile: () => path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") });
    return SQL;
  };
  class FakeStmt {
    private stmt: any;
    constructor(db: Database, sql: string) { this.stmt = db.prepare(sql); }
    get(...params: unknown[]) { this.stmt.reset(); if (params.length) this.stmt.bind(params as never); return this.stmt.step() ? this.stmt.getAsObject() as Record<string, unknown> : undefined; }
    all(...params: unknown[]) { this.stmt.reset(); if (params.length) this.stmt.bind(params as never); const out: Record<string, unknown>[] = []; while (this.stmt.step()) out.push(this.stmt.getAsObject() as Record<string, unknown>); return out; }
    run(...params: unknown[]) { this.stmt.reset(); if (params.length) this.stmt.bind(params as never); this.stmt.step(); return { changes: 0, lastInsertRowid: 0 }; }
  }
  return {
    SqlJsDb: class {
      private db: Database;
      private constructor(db: Database) { this.db = db; }
      static async open(): Promise<any> { const S = await getSql(); return new (this as any)(new S.Database()); }
      static async openFrom(bytes: Uint8Array): Promise<any> { const S = await getSql(); return new (this as any)(new S.Database(bytes)); }
      prepare(sql: string) { return new FakeStmt(this.db, sql); }
      transaction<T extends (...args: never[]) => unknown>(fn: T): T {
        const wrapped = ((...args: unknown[]) => { this.db.run("BEGIN"); try { const r = fn(...(args as never[])); this.db.run("COMMIT"); return r; } catch (e) { this.db.run("ROLLBACK"); throw e; } }) as unknown as T;
        return wrapped;
      }
      pragma(source: string) { return this.db.exec(source); }
      exec(sql: string) { this.db.exec(sql); }
      close() { this.db.close(); }
      exportBytes(): Uint8Array { return this.db.export(); }
    },
  };
});

vi.mock("./persistence", () => ({
  saveSnapshot: vi.fn(async () => {}),
  loadSnapshot: vi.fn(async () => null),
  listAssetKeys: vi.fn(async () => []),
  loadAssetBytes: vi.fn(async () => null),
}));
vi.mock("./assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
}));

import { bridge } from "./bridge.js";

/** 移动端目录树：文档套文档（note 作父）在树中可见（回归：listNotebookTree 此前只显示 folder 直属 note）。 */
describe("mobile 目录树（文档套文档）", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("listNotebookTree 返回嵌套文档：group > 父文档 > 子文档", async () => {
    const nb = await bridge.createNotebook({ title: "嵌套测试本", icon: null });
    const group = await bridge.createGroup(nb.id, "子分组");
    // 父文档（挂在 group 下）+ 子文档（挂在父文档下）+ 孙文档（挂在子文档下，验证任意层级）
    await bridge.saveNote("parent-1", "父文档", "<p>x</p>", group.id);
    await bridge.saveNote("child-1", "子文档", "<p>x</p>", "parent-1");
    await bridge.saveNote("grand-1", "孙文档", "<p>x</p>", "child-1");
    // 根层文档（直接挂 notebook）
    await bridge.saveNote("root-1", "根层文档", "<p>x</p>", nb.id);

    const tree = await bridge.listNotebookTree(nb.id);
    const byId = new Map(tree.map((t) => [t.id, t]));
    expect(byId.get("parent-1")?.parentId).toBe(group.id);   // 父文档在 group 下
    expect(byId.get("child-1")?.parentId).toBe("parent-1");  // 子文档在父文档下（此前被过滤）
    expect(byId.get("grand-1")?.parentId).toBe("child-1");   // 孙文档任意层级
    expect(byId.get("root-1")?.parentId).toBe(nb.id);        // 根层文档
    expect(byId.size).toBe(5);                               // group + 4 note 全在树里
  });

  it("listNotebookTree 返回节点 icon（notebook/group 自定义图标；note 图标由同步导入 notes.icon）", async () => {
    const nb = await bridge.createNotebook({ title: "图标测试本", icon: "📁" });
    const group = await bridge.createGroup(nb.id, "图标分组");
    await bridge.setNodeIcon(group.id, "🗂️");

    const tree = await bridge.listNotebookTree(nb.id);
    expect(tree.find((t) => t.id === group.id)?.icon).toBe("🗂️");  // group 图标
    // notebook 本身不在 listNotebookTree（树从 notebook 根展开，不含根自身）；listTreeNodes 验证
    const nodes = await bridge.listTreeNodes();
    expect(nodes.find((n) => n.id === nb.id)?.icon).toBe("📁");      // notebook 图标
  });
});

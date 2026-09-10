import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import type { Database } from "sql.js";

vi.mock("./sqliteDb.js", async () => {
  const initSqlJs = (await import("sql.js")).default;
  let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
  const getSql = async () => {
    if (!SQL)
      SQL = await initSqlJs({
        locateFile: () =>
          path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
      });
    return SQL;
  };
  class FakeStmt {
    private stmt: any;
    private db: Database;
    constructor(db: Database, sql: string) {
      this.db = db;
      this.stmt = db.prepare(sql);
    }
    get(...params: unknown[]) {
      this.stmt.reset();
      if (params.length) this.stmt.bind(params as never);
      return this.stmt.step()
        ? (this.stmt.getAsObject() as Record<string, unknown>)
        : undefined;
    }
    all(...params: unknown[]) {
      this.stmt.reset();
      if (params.length) this.stmt.bind(params as never);
      const out: Record<string, unknown>[] = [];
      while (this.stmt.step())
        out.push(this.stmt.getAsObject() as Record<string, unknown>);
      return out;
    }
    run(...params: unknown[]) {
      this.stmt.reset();
      if (params.length) this.stmt.bind(params as never);
      this.stmt.step();
      const changes = this.db.getRowsModified();
      const rowid = this.db.exec("SELECT last_insert_rowid() AS rowid")[0]?.values[0]?.[0] ?? 0;
      return { changes, lastInsertRowid: typeof rowid === "bigint" ? rowid : Number(rowid) };
    }
  }
  return {
    SqlJsDb: class {
      private db: Database;
      private constructor(db: Database) {
        this.db = db;
      }
      static async open(): Promise<any> {
        const S = await getSql();
        return new (this as any)(new S.Database());
      }
      static async openFrom(bytes: Uint8Array): Promise<any> {
        const S = await getSql();
        return new (this as any)(new S.Database(bytes));
      }
      prepare(sql: string) {
        return new FakeStmt(this.db, sql);
      }
      transaction<T extends (...args: never[]) => unknown>(fn: T): T {
        const wrapped = ((...args: unknown[]) => {
          this.db.run("BEGIN");
          try {
            const r = fn(...(args as never[]));
            this.db.run("COMMIT");
            return r;
          } catch (e) {
            this.db.run("ROLLBACK");
            throw e;
          }
        }) as unknown as T;
        return wrapped;
      }
      pragma(source: string) {
        return this.db.exec(source);
      }
      exec(sql: string) {
        this.db.exec(sql);
      }
      close() {
        this.db.close();
      }
      exportBytes() {
        return this.db.export();
      }
      databaseSizeBytes() {
        const value = (name: "page_count" | "page_size") =>
          Number(this.db.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0] ?? 0);
        return value("page_count") * value("page_size");
      }
    },
    SqlJsAsyncDb: class {
      private db: any;
      constructor(db: any) {
        this.db = db;
      }
      prepare(sql: string) {
        const statement = this.db.prepare(sql);
        return {
          async get(...params: unknown[]) {
            return statement.get(...params);
          },
          async all(...params: unknown[]) {
            return statement.all(...params);
          },
          async run(...params: unknown[]) {
            return statement.run(...params);
          },
        };
      }
      async transaction<T extends (...args: never[]) => Promise<unknown>>(
        fn: T,
      ): Promise<unknown> {
        this.db.exec("BEGIN");
        try {
          const result = await fn();
          this.db.exec("COMMIT");
          return result;
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      }
      async pragma(source: string) {
        return this.db.pragma(source);
      }
      async exec(sql: string) {
        this.db.exec(sql);
      }
      async databaseSizeBytes(): Promise<number> {
        const value = (name: "page_count" | "page_size") =>
          Number(this.db.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0] ?? 0);
        return value("page_count") * value("page_size");
      }
      async close() {
        this.db.close();
      }
    },
  };
});

const {
  loadAssetBytesFs,
  listAssetKeysFs,
  listNoteAssetKeysFs,
  removeAssetBytesFs,
} = vi.hoisted(() => ({
  loadAssetBytesFs: vi.fn(async () => new Uint8Array([1, 2, 3])),
  listAssetKeysFs: vi.fn(async () => ["note-1/image.png"]),
  listNoteAssetKeysFs: vi.fn(async (noteId: string) => [`${noteId}/image.png`]),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

vi.mock("./persistence", () => ({
  loadSnapshot: vi.fn(async () => null),
}));

vi.mock("./nativeSqliteMigration", () => ({
  migrateSnapshotToNativeSqlite: vi.fn(async () => ({
    status: "no-snapshot",
    databaseName: "lake-notes-mobile",
  })),
}));

vi.mock("./nativeSqliteDb", async () => {
  const { SqlJsDb, SqlJsAsyncDb } = await import("./sqliteDb.js");
  return {
    NativeSqliteDb: class {
      static async open() {
        return new SqlJsAsyncDb(await SqlJsDb.open());
      }
    },
  };
});
vi.mock("./assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs,
  listAssetKeysFs,
  listNoteAssetKeysFs,
  removeAssetBytesFs,
}));

import { bridge } from "./bridge.js";

describe("mobile startup performance contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listNotes returns metadata without loading every document body", async () => {
    await bridge.saveNote(
      "startup-note",
      "启动测试",
      "<p>large body</p>",
      null,
    );
    expect(listNoteAssetKeysFs).toHaveBeenCalledWith("startup-note");
    expect(listAssetKeysFs).not.toHaveBeenCalled();

    const notes = await bridge.listNotes();

    expect(notes).toEqual([
      {
        id: "startup-note",
        title: "启动测试",
        updatedAt: expect.any(String),
        parentId: null,
      },
    ]);
    expect("content" in notes[0]).toBe(false);
  });

  it("repeatedly saving the same note does not advance its sync timestamp", async () => {
    await bridge.saveNote("mobile-idempotent", "幂等保存", "<p>same</p>", null);
    const first = await bridge.readNote("mobile-idempotent");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await bridge.saveNote("mobile-idempotent", "幂等保存", "<p>same</p>", null);
    const second = await bridge.readNote("mobile-idempotent");
    expect(second?.updatedAt).toBe(first?.updatedAt);
  });

  it("init does not load assets into the JS heap (assets are served from Filesystem by AssetServer)", async () => {
    await bridge.init();

    expect(listAssetKeysFs).not.toHaveBeenCalled();
    expect(loadAssetBytesFs).not.toHaveBeenCalled();

    // 旧迁移（migrateAssetsToFilesystem）已删：init 完全不做资产预加载/迁移，
    // 资产由 AssetServer 直接读 Filesystem 文件（含小记 quick-notes/）。
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listAssetKeysFs).not.toHaveBeenCalled();
    expect(loadAssetBytesFs).not.toHaveBeenCalled();
  });

  it("concurrent startup calls initialize the native database once", async () => {
    vi.resetModules();
    const { migrateSnapshotToNativeSqlite } = await import("./nativeSqliteMigration");
    const { bridge: freshBridge } = await import("./bridge.js");
    vi.mocked(migrateSnapshotToNativeSqlite).mockClear();

    await Promise.all([
      freshBridge.init(),
      freshBridge.init(),
      freshBridge.listNotes(),
    ]);

    expect(migrateSnapshotToNativeSqlite).toHaveBeenCalledTimes(1);
  });
});

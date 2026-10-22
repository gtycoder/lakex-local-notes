import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listNotebookTree } from "./notebookTreeRepository";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

describe("listNotebookTree", () => {
  it("递归 CTE 只返回当前笔记本子树，并支持 note 作为父节点", async () => {
    const raw = await SqlJsDb.open();
    raw.exec(`
      CREATE TABLE folders (id TEXT PRIMARY KEY, title TEXT, parent_id TEXT, sort_order INTEGER, node_type TEXT, icon TEXT, trashed_at TEXT);
      CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, parent_id TEXT, sort_order INTEGER, icon TEXT, trashed_at TEXT);
      INSERT INTO folders VALUES ('nb1','笔记本',NULL,0,'notebook',NULL,NULL);
      INSERT INTO folders VALUES ('g1','分组','nb1',1,'group',NULL,NULL);
      INSERT INTO folders VALUES ('nb2','其他笔记本',NULL,0,'notebook',NULL,NULL);
      INSERT INTO notes VALUES ('n1','父文档','nb1',2,NULL,NULL);
      INSERT INTO notes VALUES ('n2','子文档','n1',1,NULL,NULL);
      INSERT INTO notes VALUES ('outside','外部文档','nb2',1,NULL,NULL);
    `);

    const items = await listNotebookTree(new SqlJsAsyncDb(raw), "nb1");

    expect(items.map((item) => item.id).sort()).toEqual(["g1", "n1", "n2"]);
    expect(items.find((item) => item.id === "n2")?.parentId).toBe("n1");
  });
});

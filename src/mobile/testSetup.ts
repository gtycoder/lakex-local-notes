import path from "node:path";
import { beforeEach, vi } from "vitest";
import { resetMemoryBodyStore } from "./native/bodyStore";

// sql.js uses Vite's ?url suffix for its WASM asset. Vitest resolves it as a
// regular specifier, so point it back at the package artifact for real SQL.js.
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

// jsdom 没有 Path2D，但 @univerjs/sheets-filter-ui 在**模块作用域**就构造 Path2D（筛选面板图标路径）
// ⇒ 任何 import 到表格筛选插件的用例都会在收集阶段直接炸（ReferenceError: Path2D is not defined）。
// 测试只验宿主层行为、不画 canvas，给一个最小空壳即可。
if (typeof (globalThis as { Path2D?: unknown }).Path2D === "undefined") {
  class Path2DStub {
    constructor(_path?: unknown) { /* no-op */ }
  }
  (globalThis as { Path2D?: unknown }).Path2D = Path2DStub;
}

// 正文文件后端在测试里是模块级内存 Map：每个用例前清空，避免跨用例串正文。
beforeEach(() => {
  resetMemoryBodyStore();
});

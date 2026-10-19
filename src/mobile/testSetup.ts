import path from "node:path";
import { beforeEach, vi } from "vitest";
import { resetMemoryBodyStore } from "./native/bodyStore";

// sql.js uses Vite's ?url suffix for its WASM asset. Vitest resolves it as a
// regular specifier, so point it back at the package artifact for real SQL.js.
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

// 正文文件后端在测试里是模块级内存 Map：每个用例前清空，避免跨用例串正文。
beforeEach(() => {
  resetMemoryBodyStore();
});

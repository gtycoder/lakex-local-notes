import path from "node:path";
import { vi } from "vitest";

// sql.js uses Vite's ?url suffix for its WASM asset. Vitest resolves it as a
// regular specifier, so point it back at the package artifact for real SQL.js.
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

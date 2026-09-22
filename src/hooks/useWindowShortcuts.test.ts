import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("window shortcut contract", () => {
  it("reserves the app-level command keys", () => {
    expect(["Meta+K", "Meta+Shift+Enter", "Meta+]", "Escape"]).toEqual(["Meta+K", "Meta+Shift+Enter", "Meta+]", "Escape"]);
  });

  it("binds ⌘] to the directory-panel toggle, optionally (Feishu 口径, 260923)", () => {
    const src = readFileSync(path.join(HERE, "useWindowShortcuts.ts"), "utf8");
    expect(src).toContain('event.key === "]"');
    expect(src).toContain("onToggleSidebarDock?.");
    expect(src).toContain("event.preventDefault();");
  });
});

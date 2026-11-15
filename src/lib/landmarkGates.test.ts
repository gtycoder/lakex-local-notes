import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 地标契约（261115，MODERN-WEB-AUDIT A29）。
 *
 * 读屏用户靠地标（main / search）跳转。桌面工作区原本就是 <main>，移动壳没有；
 * 两个搜索面也没有 <search>（只能靠输入框猜）。这里把三处钉住，防回退。
 */
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(HERE, "..");
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");

describe("地标契约（A29）", () => {
  it("桌面工作区是 <main>", () => {
    expect(read("App.tsx")).toContain('<main className="workspace"');
  });

  it("移动壳有 main 地标（role=main；不改标签，避免连带改溢出/定位选择器）", () => {
    expect(read("mobile/MobileApp.tsx")).toContain('role="main"');
  });

  it("两端搜索面是 role=search 地标（不用 <search>：React 18 不认识该标签且无隐式角色）", () => {
    expect(read("components/app/SearchPanel.tsx")).toContain('className="search-panel-input-row" role="search"');
    expect(read("mobile/settings/SearchSheet.tsx")).toContain('className="mobile-search-input-row" role="search"');
    for (const rel of ["components/app/SearchPanel.tsx", "mobile/settings/SearchSheet.tsx"]) {
      expect(read(rel)).not.toContain("<search");
    }
  });
});

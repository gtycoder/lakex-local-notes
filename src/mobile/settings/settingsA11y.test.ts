/**
 * 移动端设置页可访问性护栏（261110）：
 * 页面标题必须是 h1、分组标题必须是 h2（此前标题是 div + h4 ⇒ 读屏跳级/无页面标题）；
 * 设置页返回/关闭按钮触达区 44×44（左右槽同步加宽，标题保持居中）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const DRAWER = read("src/mobile/settings/SettingsDrawer.tsx");
const PRIMITIVES = read("src/mobile/ui/settingsPrimitives.tsx");
const CSS = read("src/mobile/mobile.css");

describe("移动端设置页可访问性", () => {
  it("页面标题是 h1，分组标题是 h2（不跳级）", () => {
    expect(DRAWER).toContain('<h1 className="mobile-settings-title">');
    expect(PRIMITIVES).toContain('<h2 className="mb-set-title">');
  });

  it("设置页返回/关闭按钮与左右槽都是 44×44 触达", () => {
    expect(CSS).toMatch(/\.mobile-settings-close \{[^}]*width: 44px; height: 44px;/);
    expect(CSS).toMatch(/\.mobile-settings-spacer \{ flex: 0 0 auto; width: 44px; \}/);
  });
});

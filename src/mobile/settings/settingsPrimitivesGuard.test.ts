/**
 * 移动端设置页结构护栏（261110 P0）：
 * 设置子页只允许 Group/Section/Item/Field/Block 原语，禁止再手写 mb-set-group/mb-set-items，
 * 否则同一设置页会再次出现多套间距/白卡/标题样式。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");

const PAGE_FILES = [
  "src/mobile/settings/SettingsDrawer.tsx",
  "src/mobile/settings/BasicSettingsSections.tsx",
];

describe("移动端设置页版式单一来源", () => {
  it("设置页不直接手写分组容器（必须走 Group/Section 原语）", () => {
    for (const file of PAGE_FILES) {
      const source = read(file);
      expect(source, file).not.toContain('className="mb-set-group"');
      expect(source, file).not.toContain('className="mb-set-items"');
    }
  });
});

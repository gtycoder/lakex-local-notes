import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 焦点环契约（261115，MODERN-WEB-AUDIT A24）。
 *
 * 判据不是「有没有 outline:none」（那本可以有替代），而是**每个裸输入框都得有可见焦点信号**：
 * 要么自身 :focus-visible 画环，要么外层 :focus-within 画环（边框/柔光环）。
 * 这份清单只钉「输入框自身 outline:0 且没有自己的 focus 规则」的家族——它们的环必须在 wrapper 上。
 */
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(HERE, "..");
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");

/** 文件 → 必须存在的「焦点可见」规则片段 */
const RULES: Array<{ file: string; needle: string; why: string }> = [
  { file: "styles/app/shell.css", needle: ".dock-filter-row__inner:focus-within", why: "目录筛选输入框（自身 outline:0）" },
  { file: "styles/kit.css", needle: ".ln-input:focus-within", why: "统一输入原语的 wrapper 环（单一来源在 kit.css）" },
  { file: "styles/components.css", needle: ".settings-nav-search:focus-within", why: "设置页导航搜索" },
  { file: "mobile/mobile.css", needle: ".toolbar__title:focus-visible", why: "移动端文档标题输入框（自身 outline:none）" },
  { file: "mobile/kit.css", needle: ".mb-input:focus-within", why: "移动端输入原语 wrapper" },
];

describe("焦点环契约（A24）", () => {
  it("裸输入框的焦点信号都在（自身或 wrapper）", () => {
    const missing = RULES.filter((r) => !read(r.file).includes(r.needle)).map((r) => r.file + " 缺 " + r.needle + "（" + r.why + "）");
    expect(missing).toEqual([]);
  });
});

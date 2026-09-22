/**
 * 外壳层序护栏（260923 W3）。
 * 背景：面板遮挡关系（块手柄 → 目录栏触发热区 → 侧栏 → 大纲 → 顶栏）原先散落在
 * chrome.css / compat.css / app/shell.css / document-status.css / features/outline/outline.css
 * 的字面量里，改一处要满仓找。现在收进 themes/base.css 的 --lake-z-* 令牌，
 * 由本用例断言「定义唯一 + 相对顺序稳定 + 消费者引用令牌」，防止有人把某个数改大改小后顺序悄悄反转。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

const SHELL_TOKENS = [
  "lake-z-block-handle",
  "lake-z-edge-hotzone",
  "lake-z-editor-sticky",
  "lake-z-statusbar",
  "lake-z-statusbar-popover",
  "lake-z-sidebar",
  "lake-z-outline",
  "lake-z-activity-rail",
  "lake-z-topbar",
];

/** [消费者文件, 令牌引用, 被替换掉的字面量] —— 这些文件的对应规则必须已令牌化。 */
const CONSUMERS: [string, string, string][] = [
  ["chrome.css", "var(--lake-z-edge-hotzone)", "110"],
  ["compat.css", "var(--lake-z-topbar)", "400"],
  ["app/shell.css", "var(--lake-z-editor-sticky)", "150"],
  ["app/shell.css", "var(--lake-z-sidebar)", "250"],
  ["app/shell.css", "var(--lake-z-activity-rail)", "270"],
  ["document-status.css", "var(--lake-z-statusbar)", "180"],
  ["document-status.css", "var(--lake-z-statusbar-popover)", "190"],
  ["../features/outline/outline.css", "var(--lake-z-outline)", "260"],
];

/** 顺序契约：左必须严格小于右（对应真实遮挡：右盖左）。 */
const ORDER: [string, string][] = [
  ["lake-z-block-handle", "lake-z-edge-hotzone"], // 热区须盖住内核块手柄
  ["lake-z-edge-hotzone", "lake-z-sidebar"], // 目录浮层一出现就压住热区
  ["lake-z-editor-sticky", "lake-z-statusbar"],
  ["lake-z-statusbar", "lake-z-statusbar-popover"],
  ["lake-z-statusbar-popover", "lake-z-sidebar"],
  ["lake-z-sidebar", "lake-z-outline"], // 大纲浮层盖目录
  ["lake-z-outline", "lake-z-activity-rail"],
  ["lake-z-activity-rail", "lake-z-topbar"], // 顶栏最高，外壳始终可见
];

const defRe = (name: string) => new RegExp("--" + name + "(?![\\w-])\\s*:\\s*(-?\\d+)", "g");

describe("外壳层序（--lake-z-*）", () => {
  const tokensCss = read("themes/base.css");

  it("每个外壳令牌在 themes/base.css 恰好定义一次", () => {
    const bad: string[] = [];
    for (const t of SHELL_TOKENS) {
      const n = [...tokensCss.matchAll(defRe(t))].length;
      if (n !== 1) bad.push("--" + t + ": " + n + " 次");
    }
    expect(bad).toEqual([]);
  });

  it("遮挡顺序稳定：手柄 < 热区 < 侧栏 < 大纲 < 顶栏", () => {
    const value = (t: string): number => {
      const all = [...tokensCss.matchAll(defRe(t))].map((m) => Number(m[1]));
      expect(all.length, "--" + t + " 未唯一定义").toBe(1);
      return all[0];
    };
    const broken = ORDER.filter(([a, b]) => !(value(a) < value(b))).map(
      ([a, b]) => "--" + a + "(" + value(a) + ") 应 < --" + b + "(" + value(b) + ")",
    );
    expect(broken).toEqual([]);
  });

  it("外壳消费者引用令牌，不再写字面量", () => {
    const bad: string[] = [];
    for (const [file, ref, literal] of CONSUMERS) {
      const css = read(file);
      if (!css.includes(ref)) bad.push(file + ": 缺 " + ref);
      if (new RegExp("z-index:\\s*" + literal + "\\b").test(css)) bad.push(file + ": 仍有 z-index: " + literal);
    }
    expect(bad).toEqual([]);
  });
});

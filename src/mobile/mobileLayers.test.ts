/**
 * 移动端 CSS 层基线围栏（P0 · 261012 立项）
 *
 * 与桌面 src/styles/cssLayers.test.ts 同构、**两端各自一份**（移动端样式不许共享桌面设计系统）：
 *   · 每个移动端 CSS 文件的「声明数 / 重复(选择器,属性)组数」都不得**超过**基线；
 *   · 减少（清理）随时允许 —— 那正是重构的方向；
 *   · 新文件必须登记进 FILES + BASELINE，否则测试直接失败（防止"漏 import / 野样式文件"）。
 *
 * 基线数字 = 261012 P0 用本文件 scan() 的实测值。改完样式跑一次：
 *   MOBILE_LAYERS_REPORT=1 npx vitest run src/mobile/mobileLayers.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const REPORT = !!process.env.MOBILE_LAYERS_REPORT;

/** 移动端自有样式文件（P0 起必须全部登记；新增文件同步登记）。 */
const FILES = [
  // P1（261012）：移动端自有令牌/皮肤层（入口 index.css 只做层序声明 + @import，0 声明）
  "mobile/theme/index.css",
  "mobile/theme/base.css", // 非令牌基础规则（关键帧 / 阅读态字号 / 焦点环）
  "mobile/theme/tokens.css", // 主题无关令牌（几何/动效/层级/字体 + 移动端自有度量）
  "mobile/theme/light.css", // 浅色取值
  "mobile/theme/dark.css", // 深色取值
  "mobile/kit.css", // P2：移动端自有原语库 mb-*（唯一来源）
  "mobile/floating.css", // P3：浮层原语 mb-sheet / mb-actionsheet / mb-toast / mb-menusheet（P3 接线）
  "mobile/mobile.css", // 外壳（首页/工作区/设置/抽屉/toast/小记）
  "mobile/mobile-kit.css", // 桌面 kit 之上的密度覆盖层 —— P2 目标：整份消灭（改用 mb-*）
  "mobile/editor-dark.css", // 编辑器深色组件边界修复（取值 P1 起归 theme/dark.css）
  "mobile/editor/editor-dock.css", // 底部 dock + 面板
];

/** 基线（只允许变小）。261012 P0 实测。 */
const BASELINE: Record<string, { decls: number; dupGroups: number }> = {
  "mobile/theme/index.css": { decls: 0, dupGroups: 0 },
  "mobile/theme/base.css": { decls: 3, dupGroups: 0 },
  "mobile/theme/tokens.css": { decls: 167, dupGroups: 0 }, // P2：+11 = 移动端几何槽（触达/内距/圆角）
  "mobile/theme/light.css": { decls: 83, dupGroups: 0 },
  "mobile/theme/dark.css": { decls: 134, dupGroups: 0 }, // +41 = 编辑器深色桥整块自 editor-dark.css 迁入（值未改）
  "mobile/kit.css": { decls: 248, dupGroups: 0 }, // P2：mb-* 原语库首批（btn/iconbtn/row/list/input/select/tag/segment/card/树/工具类）
  "mobile/floating.css": { decls: 256, dupGroups: 0 }, // P3：浮层原语（sheet/actionsheet/toast/menusheet + 两种遮罩进场）
  "mobile/mobile.css": { decls: 1343, dupGroups: 2 }, // P1：-39=令牌块迁出；P2：+4=首页 tab 点按目标 ≥44（B5）
  "mobile/mobile-kit.css": { decls: 177, dupGroups: 0 }, // P2 目标：整份消灭
  "mobile/editor-dark.css": { decls: 13, dupGroups: 0 }, // P1：取值迁 theme/dark.css（54 → 13，只留组件级边界修）
  "mobile/editor/editor-dock.css": { decls: 241, dupGroups: 0 },
};

/** 扫描 src/mobile 下所有 CSS，确保没有「未登记的野样式文件」。 */
function listMobileCss(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listMobileCss(p, out);
    else if (e.name.endsWith(".css")) out.push(path.relative(SRC, p).split(path.sep).join("/"));
  }
  return out.sort();
}

/** 极简 CSS 扫描器（与桌面 cssLayers 同一口径，两端各自持有一份）。 */
function scan(css: string): { decls: number; dupGroups: number; emptyRules: number; emptyAtRules: number } {
  const props = new Map<string, number>();
  let decls = 0;
  let emptyRules = 0;
  let emptyAtRules = 0;
  const n = css.length;
  const skipWs = (j: number) => {
    while (j < n && /\s/.test(css[j])) j++;
    return j;
  };
  const findBlockEnd = (braceIdx: number) => {
    let depth = 0;
    let j = braceIdx;
    for (; j < n; j++) {
      const c = css[j];
      if (c === "/" && css[j + 1] === "*") {
        j = css.indexOf("*/", j + 2);
        if (j < 0) return n;
        j++;
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c;
        j++;
        while (j < n && css[j] !== q) {
          if (css[j] === "\\") j++;
          j++;
        }
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return j;
      }
    }
    return n;
  };
  const walk = (from: number, to: number) => {
    let j = skipWs(from);
    while (j < to && j < n) {
      if (css[j] === "/" && css[j + 1] === "*") {
        j = skipWs(css.indexOf("*/", j + 2) + 2);
        continue;
      }
      const brace = css.indexOf("{", j);
      if (brace < 0 || brace > to) break;
      const head = css.slice(j, brace).trim();
      const end = findBlockEnd(brace);
      if (head.startsWith("@")) {
        if (!/^@(keyframes|-webkit-keyframes|font-face|page|property|charset|import|namespace|layer)\b/i.test(head)) {
          const body = css.slice(brace + 1, end);
          if (/^@(media|supports|starting-style|container|layer)\b/i.test(head) && !body.includes("{") && !body.includes(":") && !body.includes("/*")) emptyAtRules++;
          walk(brace + 1, end);
        }
      } else {
        const body = css.slice(brace + 1, end);
        let declarationsInRule = 0;
        for (const raw of body.split(";")) {
          const line = raw.trim();
          const k = line.indexOf(":");
          if (k <= 0 || line.startsWith("@") || line.includes("{")) continue;
          const prop = line.slice(0, k).trim();
          if (!prop || prop.startsWith("//")) continue;
          decls++;
          declarationsInRule++;
          const key = head.replace(/\s+/g, " ") + "||" + prop;
          props.set(key, (props.get(key) || 0) + 1);
        }
        if (!declarationsInRule && !body.includes("{")) emptyRules++;
      }
      j = skipWs(end + 1);
    }
  };
  walk(0, n);
  let dupGroups = 0;
  for (const count of props.values()) if (count > 1) dupGroups++;
  return { decls, dupGroups, emptyRules, emptyAtRules };
}

describe("移动端 CSS 层围栏（P0）", () => {
  it("每个移动端样式文件的声明数与重复(选择器,属性)组数都不超过基线", () => {
    const grew: string[] = [];
    for (const rel of FILES) {
      const got = scan(readFileSync(path.join(SRC, rel), "utf8"));
      const base = BASELINE[rel] ?? { decls: 0, dupGroups: 0 };
      if (got.decls > base.decls) grew.push(rel + ": 声明数 " + base.decls + " -> " + got.decls);
      if (got.dupGroups > base.dupGroups) grew.push(rel + ": 重复组 " + base.dupGroups + " -> " + got.dupGroups);
    }
    if (REPORT) {
      for (const rel of FILES) console.log(rel, JSON.stringify(scan(readFileSync(path.join(SRC, rel), "utf8"))));
    }
    expect(
      grew,
      "以下移动端样式文件新增了「多层覆盖」或未登记的新文件（请收敛到一处来源，或把基线调小）：\n  " +
        grew.join("\n  ")
    ).toEqual([]);
  });

  it("每个文件都必须登记进 FILES + BASELINE（防止野样式文件漏 import）", () => {
    const missing = FILES.filter((rel) => !(rel in BASELINE));
    expect(missing, "以下文件没有基线：\n  " + missing.join("\n  ")).toEqual([]);
    const unregistered = listMobileCss(path.join(SRC, "mobile")).filter((rel) => !FILES.includes(rel));
    expect(
      unregistered,
      "src/mobile 下有未登记的样式文件（新文件必须登记 FILES + BASELINE，且必须由使用它的组件 import）：\n  " +
        unregistered.join("\n  ")
    ).toEqual([]);
  });

  it("没有留下「空壳规则」（选择器 { }）——清完声明必须连壳一起删", () => {
    const shells: string[] = [];
    for (const rel of FILES) {
      const { emptyRules, emptyAtRules } = scan(readFileSync(path.join(SRC, rel), "utf8"));
      if (emptyRules) shells.push(rel + ": 空规则 " + emptyRules + " 条");
      if (emptyAtRules) shells.push(rel + ": 空 @media/@supports 块 " + emptyAtRules + " 个");
    }
    expect(shells, "以下文件留下空壳规则：\n  " + shells.join("\n  ")).toEqual([]);
  });
});
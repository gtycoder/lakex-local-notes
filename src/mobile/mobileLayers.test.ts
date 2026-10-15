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
  "mobile/features.css", // P6：图片 Lightbox / 附件预览的移动端外观（结构类名共享）
  "mobile/quick-notes.css", // P6b：小记编辑器宿主与预览（自桌面 quick-notes.css 抽取移动端子集）
  "mobile/mobile.css", // 外壳（首页/工作区/设置/抽屉/toast/小记）
  "mobile/editor-dark.css", // 编辑器深色组件边界修复（取值 P1 起归 theme/dark.css）
  "mobile/editor/editor-dock.css", // 底部 dock + 面板
  "mobile/editor/edit-surface-kernel.css", // 261014 P2：编辑面里「内核按视口/按桌面写死的几何」的唯一收口（doc/note 共用）
];

/** 基线（只允许变小）。261012 P0 实测。 */
const BASELINE: Record<string, { decls: number; dupGroups: number }> = {
  "mobile/theme/index.css": { decls: 0, dupGroups: 0 },
  "mobile/theme/base.css": { decls: 3, dupGroups: 0 },
  "mobile/theme/tokens.css": { decls: 171, dupGroups: 0 }, // 261014：+1 = --mb-emoji-cat-h（分类条末尾加动作键 ⇒ 10 格，行高按要求压到 36；命中区由触达补足注册表补到 --mb-tap-min） // 261013：+2 = 表情面板（微信样式）两档字号令牌 --mb-emoji-cat-size / --mb-emoji-glyph-size（避免在 CSS 里写 px 字面量，移动端字号字面量基线只许降） // P2：+11 = 移动端几何槽（触达/内距/圆角）→ 261013 A 批 +1（--mobile-bottom-bar-slot：胶囊加高后宽度上限不能再由高度推导）
  "mobile/theme/light.css": { decls: 61, dupGroups: 0 }, // P7b：-22 = 删掉已无人消费的 --b3-* 过渡桥接（261013 中途为"复用内核表情面板"加过 3 条内核 token 桥，用户改为**微信样式**后已撤回）
  "mobile/theme/dark.css": { decls: 112, dupGroups: 0 }, // +41 编辑器深色桥迁入 → P7b -22 删 --b3-* 过渡桥接
  "mobile/kit.css": { decls: 511, dupGroups: 0 }, // 261014：+2 = 表情面板分类条改「一屏 8 格 + 横滑」（用户二次定稿）：新增 .mb-emoji-cats__track（overflow/overscroll/隐藏滚动条）+ .mb-emoji-cat 固定 --mb-tap-min 宽；同时删掉 .mb-emoji-cell--clear（首格清除格撤掉） // P2 248 → P4 +113 → P5 +48（勾选）→ P6c +6（内核宿主）→ P7 +17（选择器 PickerSheet）→ 261013 +9（缩进 ×4 + .mb-input 内层 input ×3 + .mb-empty--inset ×1 + .mb-set-section 细线 ×1）→ 261013 +68（选图标面板最终形态 = **微信样式**：顶部分类条 + 大格子正文 + 清除行；中途"复用内核表情面板"那一版已按用户要求废弃，配套的移动端内核 token 桥也从 theme/light.css 撤回；属移动端自有视觉，非覆盖叠层）；
  // 最后一条 = 浅色窗底转白后，白卡落在白底上会消失 ⇒ 分组边界改由 1px 细线承担（见 MOBILE-DESIGN「The White Rule」）。
  "mobile/floating.css": { decls: 284, dupGroups: 0 }, // 261014：+34 = 首页「＋」的新建面板 .mb-create*（组标题 + 4 列图标格子；表面仍用 .mb-sheet，不新造弹层） // P3 建库 → 收尾 -1（删掉未使用的 .mb-sheet--tall）→ 261013 A -5（.mb-sheet__empty 并入 .mb-empty--inset）
  "mobile/features.css": { decls: 142, dupGroups: 0 }, // P6：图片 Lightbox（57→触屏版）+ 附件预览（82→触屏版）
  "mobile/quick-notes.css": { decls: 144, dupGroups: 0 }, // 261014 查漏补缺：−9 = 删掉移动端永不命中的桌面外壳规则 `.quick-note-composer .quick-note-editor`（含 `.lake-editor-mount` 那条） // 261014：+1 = 内核 note 版式 `min-height:40vh` 收口；+7 = 把内核按**视口**定高的容器链钉在宿主高度上（`.lake-editor-mount/.ne-editor/.ne-editor-body/.ne-editor-wrap/.ne-editor-wrap-content`）+ 解除内核按视口写的 `max-height`（详见 LAKEX-CONTRACT §5.37②） // 261013：+55 = 自带表情选择器改**微信样式**的移动端那份（顶部分类条 / 浅灰底大格子 / 搜索行 / 空态；触屏尺寸走 --mb-tap-min）  // P6b：自桌面 quick-notes.css 抽取的移动端子集（22 条规则）→ 261013 校准到实测值 98
  "mobile/mobile.css": { decls: 1235, dupGroups: 3 }, // 261014：+1 = 抽屉工具栏图标左内距（笔记本行图标太贴边）；此前 +1 = 首页胶囊收窄变体 .mobile-bottom-bar--home（只剩 3 项 ⇒ 上限 6 槽 288 → 4 槽 ≈192，对齐语雀紧凑度；工作区那条 4 项不动） // 261014：整块触发改版净 **-19**（删掉「气泡族」.mobile-create-press/.mobile-create-quick，换成整块层 .mobile-block-quick + 胶囊本体的 touch-action/user-select + 条目过渡补 opacity）；基线随之**调小**（只许降） // P1 -39 / P2 +4 / P5 +6 → 收尾 -83 → 261013 必要项 -33 → A -13 → 6.3/6.9 +20（冷启动骨架 mb-skel ×5 + 关键帧；引擎几何压回只改既有声明的值）
  // dupGroups 2 → 3：新增的 .mb-skel 在 prefers-reduced-motion 名单里关掉 animation，与主块同名同属性成一组 ——
  // 这是本文件既有的无障碍登记模式（.mobile-htab 等同样处理），不是多层覆盖。
  "mobile/editor-dark.css": { decls: 13, dupGroups: 0 }, // P1：取值迁 theme/dark.css（54 → 13，只留组件级边界修）
  "mobile/editor/editor-dock.css": { decls: 228, dupGroups: 0 }, // 261015：「＋/更多」= 方块网格（两组 8+10 × 4 列、组间 16、方块 52、浅灰底）；「Aa」面板压缩上下间距（行距 8→6、卡内距 3→2、条目 44→40 走注册表补足、色板 37→34、内距 12/14→6/6）+ 图标 17→20、文字/图标色 text-2→text-1（+1 = font-weight 500）
  "mobile/editor/edit-surface-kernel.css": { decls: 24, dupGroups: 0 }, // 261014 P2：把散在 mobile.css（doc 侧）/ quick-notes.css（note 侧）的内核几何收口**合成一份**（doc/note 共用 data-mb-edit-host 契约） // 261013：+1 = 表情面板分类条在 dock 里拉满面板边（当时口径：9 个分类 ≈45.8px、一屏放得下不横滚；261014 已改「一屏 8 格 + 横滑 + 钉住的动作键」，见 kit.css）
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

  it("移动端 CSS 不得再出现会作用于 JSX 的桌面类名选择器（ln-/b3-/fn__/config-）", () => {
    // 261013 立的护栏：P2–P5 把 JSX 迁到 mb-* 之后，mobile.css 里还留着一批挂在 .ln-row 上的规则
    // （拖拽落点线 / 真机 touch-action / 标签页卡片）——它们**永不命中**，缺陷就是这么静默丢的。
    // 口径：只查**选择器里**出现这四类前缀；注释与变量名不算（--ln-indent 已删）。
    const bad: string[] = [];
    for (const rel of FILES) {
      const css = readFileSync(path.join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of css.split("}")) {
        const brace = rule.indexOf("{");
        if (brace < 0) continue;
        const head = rule.slice(0, brace);
        if (/(^|[\s,>+~(])\.(?:ln-|b3-|fn__|config-)/.test(head)) bad.push(rel + " :: " + head.trim().replace(/\s+/g, " ").slice(0, 90));
      }
    }
    expect(bad, "以下选择器挂在桌面类名上，而移动端 JSX 只用 mb-* ⇒ 永不命中（要么删掉，要么回接到 mb-*）：\n  " + bad.join("\n  ")).toEqual([]);
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
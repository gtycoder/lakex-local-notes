/**
 * 壳层 CSS「多层覆盖」防回归围栏（260915）。
 *
 * 背景：这个项目的样式是分层加载的（基础骨架 → 思源主题/组件 → 壳层打磨层），
 * 同一个 (选择器, 属性) 经常被写 2~8 次，谁赢取决于加载顺序 + !important：
 * 改一处要同时改几个文件，跨宽度/跨主题还会"另一边没跟上"（用户报过多次）。
 * §2.40/§2.41 已把这类重复清过一轮，这条用例负责**不让它再长回来**：
 *   · 每个文件的声明总数、以及「同一 (选择器, 属性) 被写≥2 次」的组数，都不得**超过**记录值；
 *   · 减少（清理）随时允许 —— 那正是我们想要的方向。
 * 基线数字来自 260915 清理后的实测值；清理得更多时，顺手把基线调小即可。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

/** 我们自己的样式文件（不含 vendor：src/b3/siyuan/** 与 lakex 包内样式）。 */
const FILES = [
  "styles.css",
  "b3/animations.css", "b3/base.css", "b3/components.css", "b3/dark.css", "b3/layout.css",
  "b3/theme-daylight.css", "b3/theme-midnight.css",
  "features/attachment/attachment-preview.css", "features/editor/image-lightbox.css", "features/outline/outline.css",
  "features/sheet/sheetEditor.css",
  "styles/dialog.css", "styles/document-status.css", "styles/editor.css",
  "styles/motion.css", "styles/components.css", "styles/quick-notes.css", "styles/shell.css",
  "styles/tokens.css", "styles/settings.css",
  // 基础层（260916 第二档 S3：原 styles.css 拆成入口 + 10 个域文件；入口只剩 @import 编排，不再计声明）
  "styles/app/base.css", "styles/app/dialogs.css", "styles/app/editor.css",
  "styles/app/misc.css", "styles/app/panels.css", "styles/app/quick-notes.css", "styles/app/settings.css",
  "styles/app/shell.css", "styles/app/tabs.css", "styles/app/vendor-board.css",
];

/** 基线（按本文件的 scan() 实测）。只允许变小 —— 唯一例外是「按职责归并」（HANDOFF §2.48 的 S2/S3）：
 * 把规则从一个文件搬到另一个文件会合法地抬高接收方的计数：此时同步抬高该文件基线，
 * 并在同一批把来源文件的基线调小（搬走多少、留下多少要对得上，让总量保持可见）。 */
const BASELINE: Record<string, { decls: number; dupGroups: number }> = {
  "styles.css": { decls: 0, dupGroups: 0 },   // 260917 校正：S3 拆分后入口只剩 @import（实测 0 声明），旧基线 1778/33 是没同步下调的虚高余量
  "b3/animations.css": { decls: 5, dupGroups: 0 },
  "b3/base.css": { decls: 16, dupGroups: 0 },
  "b3/components.css": { decls: 148, dupGroups: 0 },
  "b3/dark.css": { decls: 54, dupGroups: 0 },   // 260920：删掉已废弃的 .quick-note-image-grid / .quick-note-saved-images 深色覆盖（卡片预览改自研渲染）
  "b3/layout.css": { decls: 187, dupGroups: 0 },
  "b3/theme-daylight.css": { decls: 163, dupGroups: 0 },
  "b3/theme-midnight.css": { decls: 148, dupGroups: 0 },
  "features/attachment/attachment-preview.css": { decls: 78, dupGroups: 0 },
  "features/editor/image-lightbox.css": { decls: 57, dupGroups: 0 },
  "features/outline/outline.css": { decls: 244, dupGroups: 0 },
  // 260919：换成 FortuneSheet；容器尺寸 + 工具栏紧凑 + 无样式输入框补边框（标签样式已按用户要求回滚）
  "features/sheet/sheetEditor.css": { decls: 24, dupGroups: 0 },
  "styles/dialog.css": { decls: 234, dupGroups: 8 },   // +7 = .note-info-history-viewer 容器（260916 W-10：历史内联预览改只读 viewer，替代裸 dangerouslySetInnerHTML；合法新增非覆盖回涨）
  "styles/document-status.css": { decls: 106, dupGroups: 2 },
  "styles/editor.css": { decls: 14, dupGroups: 0 },   // +2 = 自 ui-polish.css 并入的编辑器正文覆盖（S2）
  "styles/motion.css": { decls: 10, dupGroups: 0 },   // +7 = 自 ui-polish.css 并入的 4 个 reduced-motion 契约块（S4；矩阵补了媒体偏好态后才可验证）
  "styles/components.css": { decls: 444, dupGroups: 1 },   // 260916 S4：原 overlays.css 改名 + 并入 @keyframes lake-pop-in（+1 声明，位置不变）
  "styles/quick-notes.css": { decls: 12, dupGroups: 0 },   // +2 = 自 ui-polish.css 并入的小记入口（S2）；+1 = 编辑态卡片禁止按压缩放（transform 会成为展开层定位基准，260920）
  "styles/shell.css": { decls: 199, dupGroups: 0 },   // +5 = 原 layout-contract 的壳层度量令牌（S1）；+143 = 自 ui-polish 并入的目录栏/页签/dock 头部（S2）；+4 = 顶栏文档下拉「标签+快捷键一行」与导出二级行（260916，合法新增非覆盖回涨）
  "styles/tokens.css": { decls: 83, dupGroups: 0 },
  "styles/settings.css": { decls: 7, dupGroups: 0 },   // 260916 S4 建立：吸收原 ui-polish.css 的设置/历史/回收站细滚动条
  // 基础层域文件（260916 S3：原 styles.css 拆成入口 + 10 个域文件；数字 = 拆分当批实测，只允许变小）
  "styles/app/base.css": { decls: 36, dupGroups: 0 },
  "styles/app/dialogs.css": { decls: 152, dupGroups: 7 },   // +2 = 二级子菜单高度兜底（max-height + overflow-y，260916 修「导出选项被窗口底边裁掉」；与定位上移配套，合法新增非覆盖回涨）
  "styles/app/editor.css": { decls: 55, dupGroups: 0 },   // +5 = maxView 适配；+4 = 锁定/解锁延迟销毁的旧实例层 .is-outgoing；+3 = 阅读态大纲只调位置（top/right）与「pinned 展开时正文让位」——阅读大纲改回内核自己挂载，官方 getContainer 自建宿主那套已删（260916）
  "styles/app/misc.css": { decls: 293, dupGroups: 0 },
  "styles/app/panels.css": { decls: 99, dupGroups: 0 },
  "styles/app/quick-notes.css": { decls: 507, dupGroups: 7 },   // +24 列表版式、+30 媒体按类型、+49 卡片预览、+8 展开层限定、+19 卡片收起/展开、+98 列表页对齐云端（标签行/批量条/行⋯菜单/新建按钮）；+15 = 动作行改版（去掉两角布局的空占位，换成 --inline 靠右下 + 「取消」次级描边 + 卡片页脚内边距 + 展开态浮层）；260920：-48 = 删掉随「卡片预览改自研渲染」废弃的 .quick-note-image-grid / .quick-note-saved-images / .quick-note-saved-media 三套遗留规则；+1 = 分块视图卡片展开时退出定位上下文（展开层/页脚落到小记面板）；+8 = 展开态把保存失败/提示条抬到展开层之上（贴面板左下角的浮层）
  "styles/app/settings.css": { decls: 116, dupGroups: 0 },
  "styles/app/shell.css": { decls: 316, dupGroups: 9 },   // 260917：另收掉 quick-notes 与基础层逐字重复的 margin 覆盖
  "styles/app/tabs.css": { decls: 200, dupGroups: 0 },
  "styles/app/vendor-board.css": { decls: 7, dupGroups: 0 },   // 260916：84 条与 vendor/drawnix-react-text.css 逐字节相同的规则已删（改为直接 import vendor 文件），余下是我们自己的 board-card 包装层
};

/** 极简 CSS 扫描器：只取「叶子样式规则」的声明，跳过注释/字符串/声明型 at-rule。 */
function scan(css: string): { decls: number; dupGroups: number; emptyRules: number; emptyAtRules: number } {
  const props = new Map<string, number>();   // `${selector}||${prop}` → 出现次数
  let decls = 0;
  let emptyRules = 0;
  let emptyAtRules = 0;
  let i = 0;
  const n = css.length;
  const skipWs = (j: number) => { while (j < n && /\s/.test(css[j])) j++; return j; };
  const findBlockEnd = (braceIdx: number) => {
    let depth = 0;
    let j = braceIdx;
    for (; j < n; j++) {
      const c = css[j];
      if (c === "/" && css[j + 1] === "*") { j = css.indexOf("*/", j + 2); if (j < 0) return n; j++; continue; }
      if (c === '"' || c === "'") { const q = c; j++; while (j < n && css[j] !== q) { if (css[j] === "\\") j++; j++; } continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return j; }
    }
    return n;
  };
  const walk = (from: number, to: number) => {
    let j = skipWs(from);
    while (j < to && j < n) {
      if (css[j] === "/" && css[j + 1] === "*") { j = skipWs(css.indexOf("*/", j + 2) + 2); continue; }
      const brace = css.indexOf("{", j);
      if (brace < 0 || brace > to) break;
      const head = css.slice(j, brace).trim();
      const end = findBlockEnd(brace);
      if (head.startsWith("@")) {
        if (!/^@(keyframes|-webkit-keyframes|font-face|page|property|charset|import|namespace|layer)\b/i.test(head)) {
          // 空的 @media/@supports 块同样是"清完声明没删壳"的残骸（留了占位注释的除外）。
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
          const key = `${head.replace(/\s+/g, " ")}||${prop}`;
          props.set(key, (props.get(key) || 0) + 1);
        }
        // 空壳规则（`选择器 { }`）：清完重复声明后留下的残骸，白占解析与维护成本。
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

describe("CSS 多层覆盖围栏", () => {
  it("每个样式文件的声明数与重复(选择器,属性)组数都不超过基线", () => {
    const grew: string[] = [];
    for (const rel of FILES) {
      const css = readFileSync(path.join(SRC, rel), "utf8");
      const got = scan(css);
      const base = BASELINE[rel] ?? { decls: 0, dupGroups: 0 };
      if (got.decls > base.decls) grew.push(`${rel}: 声明数 ${base.decls} → ${got.decls}`);
      if (got.dupGroups > base.dupGroups) grew.push(`${rel}: 重复组 ${base.dupGroups} → ${got.dupGroups}`);
    }
    expect(grew, `以下文件新增了"多层覆盖"，请收敛到一处来源（见 HANDOFF §2.40/§2.41）：\n  ${grew.join("\n  ")}`).toEqual([]);
  });

  it("没有留下「空壳规则」（选择器 { }）——清完重复声明必须连壳一起删", () => {
    const shells: string[] = [];
    for (const rel of FILES) {
      const css = readFileSync(path.join(SRC, rel), "utf8");
      const { emptyRules, emptyAtRules } = scan(css);
      if (emptyRules) shells.push(`${rel}: 空规则 ${emptyRules} 条`);
      if (emptyAtRules) shells.push(`${rel}: 空 @media/@supports 块 ${emptyAtRules} 个`);
    }
    expect(shells, `以下文件留下空壳规则（260915 清理时留过一次，260916 已清除）：\n  ${shells.join("\n  ")}`).toEqual([]);
  });
});

/**
 * 小记预览的**内核兜底**护栏（261010 用户定稿方向）。
 *
 * 背景（一次真实的错误结论）：移动端小记看不到「日期/表情」，我先判成"内核没有这个能力"，
 * 真因是**我们自己的**插入面板白名单把内核条目裁掉了（内核有 /rq 日期、/bq 表情、/rl 日历）。
 * 由此确立口径：**预览对内核格式必须是全量的** —— 内核每加一种卡，不能让我们再欠一笔"预览没实现"的债。
 *
 * 做法：自研解析器只当**快路径**（纯文字小记零内核实例、移动端冷开不受影响），
 * 一旦出现它还原不了的块（`unsupported` 节点），整条卡片改由**内核只读视图**渲染。
 * 判据取解析器自己的输出 —— 不另立第二份卡片清单（两份必然漂移）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasUnsupportedNodes, parseQuickNotePreview } from "./quickNotePreviewParser";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const PREVIEW_SRC = read("./QuickNotePreview.tsx");
const KERNEL_SRC = read("./QuickNoteKernelPreview.tsx");

/** 内核真实产出的日期卡（value 是 urlencode 过的 JSON）。 */
const DATE_CARD = '<card type="inline" name="dateCard" value="data:%7B%22date%22%3A%221789123456000%22%7D"></card>';
const EMOJI_CARD = '<card type="inline" name="unicodeEmoji" value="data:%7B%22emoji%22%3A%22%F0%9F%98%80%22%7D"></card>';

describe("小记预览：快路径 + 内核只读兜底", () => {
  /**
   * 261014 冷启动修复的**回归护栏**：内核兜底必须保持**懒加载**。
   *
   * 事故链：HomePage → QuickNotePreview → QuickNoteKernelPreview → lakeRuntime 是**静态** import 链，
   * 而 lakeRuntime 是 6.1MB 的内核 chunk ⇒ 构建会给入口挂 40+ 条 modulepreload，冷启动先拉+解析整个内核。
   * 设备实测（AVD）：DCL 3943ms / 一个 1821ms 长任务 / 真首页 **6123ms**；改成 lazy 后 DCL 202ms / 真首页 **1447ms**。
   * 所以：**只要有人把这条 import 改回静态，冷启动就会雪崩** —— 这里钉死。
   */
  it("内核只读兜底必须懒加载（静态 import 会把 6.1MB 内核拉进冷启动）", () => {
    expect(PREVIEW_SRC).toMatch(/const QuickNoteKernelPreview = lazy\(\(\) => import\("\.\/QuickNoteKernelPreview"\)/);
    expect(PREVIEW_SRC, "不许出现静态 import（那会让入口预载整个内核）").not.toMatch(/^import \{ QuickNoteKernelPreview \}/m);
    // ⚠️ 反向护栏（261021 事故）：桌面**不许**由懒入口自带内核 CSS。
    // 桌面入口 styles/index.css 已 `@import … layer(legacy)`；JS import 无法分层 ⇒ 未分层样式会压过
    // 全部 @layer 规则（实测：antd base 把设置面板 × 的 margin-left:auto 归零、全站字体变系统栈）。
    // 单源校验在 src/styles/cssLayers.test.ts；产物侧在 scripts/css-audit/audit-vendor-css.mjs。
    expect(
      KERNEL_SRC,
      "不要 JS import 内核样式（未分层会压过整个 @layer 设计系统）",
    ).not.toMatch(/^\s*import\s+["']@dlient\/lakex-doc-react\/style\.css["']/m);
  });

  it("快路径还原不了的块（日期卡/表情卡/表格）→ 触发内核兜底", () => {
    expect(hasUnsupportedNodes(parseQuickNotePreview(`<p><span>今天</span>${DATE_CARD}</p>`))).toBe(true);
    expect(hasUnsupportedNodes(parseQuickNotePreview(`<p>${EMOJI_CARD}</p>`))).toBe(true);
    expect(hasUnsupportedNodes(parseQuickNotePreview("<table><tr><td>单元格</td></tr></table>"))).toBe(true);
  });

  it("快路径能完整还原的正文 → 不挂内核实例（普通小记的代价不变）", () => {
    const body = [
      '<h1 data-lake-id="a"><span>标题</span></h1>',
      '<p><span>纯文字 </span><strong>加粗</strong></p>',
      '<ul list="u1" class="lake-list"><li fid="1" class="lake-list-node lake-list-task"><card type="inline" name="checkbox" value="data:false"></card><span>待办</span></li></ul>',
      '<blockquote data-lake-id="b"><p><span>引用</span></p></blockquote>',
      '<card type="block" name="hr" value="data:%7B%22id%22%3A%22c%22%7D"></card>',
    ].join("");
    expect(hasUnsupportedNodes(parseQuickNotePreview(body))).toBe(false);
  });

  it("引用块内部的卡也要被看见（递归判定，否则漏兜底）", () => {
    expect(hasUnsupportedNodes(parseQuickNotePreview(`<blockquote>${DATE_CARD}</blockquote>`))).toBe(true);
  });

  it("切换渲染器只用解析器自己的判据（不另立卡片白名单）", () => {
    expect(PREVIEW_SRC).toMatch(/const kernelFallback = useMemo\(\(\) => hasUnsupportedNodes\(nodes\), \[nodes\]\)/);
    expect(PREVIEW_SRC).toMatch(/kernelFallback && noteId/);
    // 兜底渲染必须带小记 id（内核解析卡片资源要用）
    expect(PREVIEW_SRC).toMatch(/noteId\?: string/);
  });

  it("兜底 = 内核**只读**视图（不是第二套渲染器），只给视口内的卡片挂实例", () => {
    expect(KERNEL_SRC).toMatch(/createLakeDocument\(host, "viewer"/);
    expect(KERNEL_SRC).toMatch(/addAssetAccessToken\(body\)/);
    expect(KERNEL_SRC).toMatch(/destroyLakeEditor\(editor\)/);
    // 布局代价：实例数 = 屏幕内条数，与库里小记总数无关
    expect(KERNEL_SRC).toMatch(/IntersectionObserver/);
    expect(KERNEL_SRC).toMatch(/rootMargin/);
  });
});

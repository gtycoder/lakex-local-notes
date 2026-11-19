/**
 * 移动端底部安全区契约护栏（topChrome 契约的 bottom 侧镜像 · 261119 按钮边界审计）。
 *
 * 顶部有 topChromeContract.test.ts 钉「谁消费 --mobile-top-safe-area」；底部此前**没有对账** ⇒
 * 一批贴屏底表面各写各的账：Sheet footer 槽 0 安全区（B-1/B-2）、body/foot 双叠（B-3）、
 * drawer foot 缺 safe（B-5）、第三套 .ai-sheet__foot（B-6）、编辑 dock 不吃 safe（B-12 登记）。
 *
 * 口径（允许清单只减不增）：
 *   任何声明 `bottom:` 的规则（fixed/absolute 底锚及其覆盖式修改规则）必须在规则内消费
 *   `--mobile-bottom-safe-area`；不能直接消费的（全高表面由内容层消费 / 内部装饰 / 待实测登记项）
 *   逐条进 BOTTOM_SAFE_ALLOWLIST 并写明理由与消费方。新贴屏底表面要么自己吃 safe，要么评审后登记。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE); // src/mobile

/** 只认**声明级** bottom:（padding-bottom / margin-bottom / inset 不算；bottom: auto = 显式不锚底，跳过）。 */
function anchorsBottom(body: string): boolean {
  const re = /(^|[;{])\s*bottom\s*:\s*([^;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) if (!/^auto\b/.test(m[2].trim())) return true;
  return false;
}
const SAFE = "--mobile-bottom-safe-area";

type Rule = { file: string; head: string; body: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** 极简 CSS 切分（与 mobileLayers.scan 同一口径）：@media/@supports/@layer/@starting-style 递归，其余记规则。 */
function parseRules(css: string, file: string, out: Rule[] = []): Rule[] {
  const n = css.length;
  const skipWs = (j: number) => { while (j < n && /\s/.test(css[j])) j++; return j; };
  const findBlockEnd = (braceIdx: number) => {
    let depth = 0;
    for (let j = braceIdx; j < n; j++) {
      const c = css[j];
      if (c === "/" && css[j + 1] === "*") { j = css.indexOf("*/", j + 2); if (j < 0) return n; continue; }
      if (c === '"' || c === "'") { const q = c; j++; while (j < n && css[j] !== q) { if (css[j] === "\\") j++; j++; } continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return j; }
    }
    return n;
  };
  const walkBlock = (from: number, to: number) => {
    let j = skipWs(from);
    while (j < to && j < n) {
      if (css[j] === "/" && css[j + 1] === "*") { j = skipWs(css.indexOf("*/", j + 2) + 2); continue; }
      const brace = css.indexOf("{", j);
      if (brace < 0 || brace > to) break;
      const head = css.slice(j, brace).trim();
      const end = findBlockEnd(brace);
      if (head.startsWith("@")) {
        if (/^@(media|supports|layer|starting-style)\b/i.test(head)) walkBlock(brace + 1, end);
      } else {
        out.push({ file, head: head.replace(/\s+/g, " "), body: css.slice(brace + 1, end) });
      }
      j = skipWs(end + 1);
    }
  };
  walkBlock(0, n);
  return out;
}

const rules: Rule[] = [];
for (const f of walk(SRC)) parseRules(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), path.relative(SRC, f).split(path.sep).join("/"), rules);
const bottomRules = rules.filter((r) => anchorsBottom(r.body));

/** 不能在规则内直接消费安全区的 bottom 规则（只减不增；每条写明理由与实际消费方）。 */
const BOTTOM_SAFE_ALLOWLIST: { file: string; selectorIncludes: string; why: string }[] = [
  // ── 底栏/滚动容器由**子节点**消费（一个表面只算一份账）──
  { file: "floating.css", selectorIncludes: ".mb-sheet", why: "Sheet 本体 bottom:0；安全区由底栏 .mb-sheet__foot 消费一次（B-3 后 body 不再叠）" },
  { file: "floating.css", selectorIncludes: ".mb-menusheet", why: "菜单 Sheet 本体 bottom:0；安全区由 .mb-menusheet__items 消费（8+safe）" },
  { file: "floating.css", selectorIncludes: ".mb-menusheet__submenu", why: "整屏子菜单 top:0/bottom:0 跨屏；底部由内部 .mb-menusheet__items 消费（F-G 只修了顶部）" },
  { file: "bitable/mobileBitable.css", selectorIncludes: ".mbt-drawer", why: "全高数据表抽屉（top:0 跨屏）；安全区由底栏 .mbt-drawer__foot 消费（261119 B-5 补齐）" },
  { file: "mobile.css", selectorIncludes: ".side-panel", why: "全高侧栏抽屉（top:0 跨屏）；安全区由 .side-panel-body 消费（8/24+safe）" },
  { file: "mobile.css", selectorIncludes: ".mobile-settings-page", why: "全高设置抽屉（top:0 跨屏）；安全区由设置内容/根列表消费（mobile.css 内容层 16/24+safe）" },
  { file: "mobile.css", selectorIncludes: ".mb-home-dockwrap", why: "首页 Dock 容器；Dock 高度内含安全区（同文件 Dock 高度公式）" },
  { file: "pad/pad.css", selectorIncludes: ".pad-tree", why: "平板全高目录侧栏（top:0 跨屏）；安全区由面板内容层消费" },
  { file: "pad/pad.css", selectorIncludes: ".pad-outline", why: "平板全高大纲侧栏（top:0 跨屏）；安全区由面板内容层消费" },
  // ── 不贴屏底（相对上级表面定位）──
  { file: "mobile.css", selectorIncludes: ".mb-home-fab", why: "悬浮＋锚在 Dock 容器内、位于 Dock 上方（bottom 以 100% 起算），不贴屏底" },
  { file: "mobile.css", selectorIncludes: ".mb-home-fab__tip", why: "＋长按提示气泡锚在 FAB 上方" },
  { file: "mobile.css", selectorIncludes: ".mb-skel--fab", why: "＋骨架占位锚在 Dock 上方" },
  { file: "mobile.css", selectorIncludes: ".nb-sel-cb", why: "知识库卡勾选占位（行内定位、pointer-events:none），不贴屏底" },
  { file: "mobile.css", selectorIncludes: ".doc-card__lines", why: "文档卡装饰线（卡片内部四边定位）" },
  { file: "ui/monthCalendar.css", selectorIncludes: ".mb-calendar-day__dot", why: "月历格内打点（格内定位）" },
  { file: "ink/inkPad.shared.css", selectorIncludes: ".ink-page-thumb__index", why: "页签条缩略图角标（缩略图内部定位）" },
  { file: "bitable/mobileBitable.css", selectorIncludes: ".mbt-vcfg-tab.is-on::after", why: "视图页签选中指示线（tab 内部定位）" },
  { file: "usheet/usheet-chrome.css", selectorIncludes: ".mb-usheet-topbar__tab.is-active::after", why: "工作表页签选中指示线（tab 内部定位）" },
  { file: "usheet/usheet-chrome.css", selectorIncludes: "formula-bar", why: "公式栏装饰伪元素（贴 formula-bar 内部）" },
  { file: "usheet/usheet-chrome.css", selectorIncludes: ".mb-usheet-panel::after", why: "面板渐隐提示（面板内部定位）" },
  // ── 底部工具坞族内部的命中盒/浮层（工具坞自身已消费 safe）──
  { file: "ink/inkPad.mobile.css", selectorIncludes: ".ink-backgrounds", why: "手写板工具坞内部命中盒（工具坞 bottom 8+safe 已消费）" },
  { file: "ink/inkPad.mobile.css", selectorIncludes: "data-overlay=\"palette\"", why: "手写板工具坞上方色板/笔宽浮层（锚定坞内，不贴屏底）" },
  // ── 内部装饰/卡内定位（非屏底表面）──
  { file: "bitable/mobileBitable.css", selectorIncludes: ".mbt-viewrow.is-drop-after::after", why: "拖拽落点线（行内装饰伪元素）" },
  // （261119 移动端禁拖拽缩放：把手族规则整族删除 ⇒ 对应 2 条允许条目按「只减不增」摘除。）
  // ── 待设备实测登记（审计 B-12/B-13，报告 mobile-button-boundary-audit-261119）──
  { file: "editor/editor-dock.css", selectorIncludes: ".mobile-editor-dock", why: "B-12 登记：编辑 dock 族不消费底部安全区，需手势条 AVD 实测定级后统一修" },
  { file: "editor/editor-dock.css", selectorIncludes: ".med-toolbar", why: "B-12 登记：编辑 dock 底条（bottom 只吃 --kb-offset、无 safe）" },
  { file: "editor/editor-dock.css", selectorIncludes: ".med-panel", why: "B-12 登记：dock 二级面板（同 --kb-offset 族）" },
  { file: "usheet/usheet-chrome.css", selectorIncludes: ".mb-usheet-fbar", why: "B-12 登记：表格公式栏（--mb-usheet-kb-offset 族，无 safe）" },
  { file: "usheet/usheet-chrome.css", selectorIncludes: ".mb-usheet-dock", why: "B-12 登记：表格底部 dock（同族）" },
  { file: "usheet/usheet-chrome.css", selectorIncludes: ".mb-usheet-panel", why: "B-12 登记：表格 dock 二级面板（同族）" },
  { file: "mobile.css", selectorIncludes: ".mobile-bottom-bar--above-dock", why: "B-13 登记：编辑态胶囊让位公式丢 --mobile-bottom-safe-area 项（随 B-12 一起实测修）" },
];

describe("mobile bottom safe-area contract（topChrome 的 bottom 侧镜像）", () => {
  it("声明 bottom: 的规则必须消费 --mobile-bottom-safe-area（或进允许清单，只减不增）", () => {
    const violations: string[] = [];
    for (const rule of bottomRules) {
      if (rule.body.includes(SAFE)) continue;
      const allowed = BOTTOM_SAFE_ALLOWLIST.find((a) => a.file === rule.file && rule.head.includes(a.selectorIncludes));
      if (allowed) continue;
      violations.push(rule.file + " :: " + rule.head.slice(0, 90) + " —— 未消费 " + SAFE + " 且未登记");
    }
    expect(
      violations,
      "以下 bottom 锚定规则不消费底部安全区（贴屏底表面会被手势条压住；修复或评审后进 BOTTOM_SAFE_ALLOWLIST 并写理由）：\n  " +
        violations.join("\n  "),
    ).toEqual([]);
  });

  it("允许清单每条都必须真实命中（防死条目；清单只减不增）", () => {
    const stale = BOTTOM_SAFE_ALLOWLIST.filter(
      (a) => !bottomRules.some((r) => r.file === a.file && r.head.includes(a.selectorIncludes)),
    ).map((a) => a.file + " :: " + a.selectorIncludes);
    expect(stale, "以下允许清单条目已无对应规则（请删除——清单只减不增）：\n  " + stale.join("\n  ")).toEqual([]);
  });

  it("扫描器自证：已知合规样本与已知登记样本都会被扫到（不能只看结果是 0）", () => {
    // 已知合规：.mb-actionsheet 自己消费安全区（8+safe）。
    const actionsheet = bottomRules.find((r) => r.file === "floating.css" && r.head.includes(".mb-actionsheet") && !r.head.includes("::"));
    expect(actionsheet, "已知会命中的样本 .mb-actionsheet 不见了（扫描器失效？）").toBeTruthy();
    expect(actionsheet!.body).toContain(SAFE);
    // 已知登记：.mb-sheet 由 .mb-sheet__foot 消费。
    expect(bottomRules.some((r) => r.file === "floating.css" && r.head === ".mb-sheet")).toBe(true);
    // 规模自证：bottom 规则总量级与审计「30+ 处」一致，防止解析器静默漏扫。
    expect(bottomRules.length).toBeGreaterThan(20);
  });
});

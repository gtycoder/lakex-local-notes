/**
 * 原语变体门禁（261107；261125 审计 M-02 宇宙扩面）：feature / app CSS 不得从外面叠加覆盖 kit 原语（`.ln-*` / `.mb-*`）。
 *
 * 判据：从原语文件提取全部原语类名（261125 M-02 起含 components/dialog/compat 里的 ln-* 家族——
 * ln-list-item / ln-label 住 compat.css、ln-dialog* 住 dialog.css，此前它们大半裸奔）；
 * 扫描其它自有 CSS 的每条规则，**主语位**（最后一个组合器之后的复合选择器）里出现原语类 ⇒ 记为「跨所有权覆盖」。
 * 主语位口径（261125 M-02）：原语当**祖先**是域作用域收窄（`.trash-tree-node .ln-list-item .badge` 改的是 badge）、
 * `:not()` 里的类是排除项 —— 两者都不算「从外面覆盖原语」；改到原语（或其 __ 子元素）头上才算。
 * 基数 **0**，只许降：要改原语表现请在原语文件加变体（ln-btn--compact 等）、在原语根上设 CSS 变量，
 * 或把域上下文几何**收编进原语文件**（上下文变体，261125 M-02 起 compat.css 的「ln-* 上下文变体」块）；
 * 别写 `.feature .ln-x__inner`。契约型例外走 EXEMPT_RULES 逐条登记（与 IMPORTANT_ALLOWLIST 同款：清单外新增直接失败）。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
/** 原语类名的提取面（文件即原语家；文件内的域上下文变体是原语自己的账，不算跨所有权）。 */
const PRIMITIVE_FILES = [
  "styles/kit.css",
  "styles/overlay.css",
  "styles/components.css",   // 261125 M-02：ln-empty* 时代遗留 + ln-* 域上下文变体的既有住所
  "styles/dialog.css",       // 261125 M-02：ln-dialog* 家族
  "styles/compat.css",       // 261125 M-02：ln-list-item / ln-label / ln-* 工具类（S-06 实锤漏检的来源）
  "mobile/kit.css",
  "mobile/floating.css",
];
/** 契约型例外（按规则豁免，261125 M-02：原 EXEMPT_FILES 整文件豁免太粗）：清单外的跨所有权覆盖直接失败。 */
const EXEMPT_RULES: { file: string; sel: string; why: string }[] = [
  // 内核 button/chip/check 语义色的未分层补钉（AGENTS §3#14：内核/antd 未分层 button{color:inherit} 会吃掉语义文字色，
  // 按未分层补回；取值由 kernelButtonColorPins.test 钉死，动值不动形态）
  { file: "styles/kernel-theme.css", sel: "button.ln-btn", why: "内核未分层补钉（AGENTS §3#14）：button 继承链上的语义文字色" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--primary", why: "同上" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--secondary", why: "同上" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--ghost", why: "同上" },
  { file: "styles/kernel-theme.css", sel: "button.ln-chip", why: "同上：小记标签按钮" },
  { file: "styles/kernel-theme.css", sel: "button.ln-chip--add", why: "同上" },
  { file: "styles/kernel-theme.css", sel: "button.ln-check", why: "同上：勾选框字形色" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--outlined", why: "同上：button 继承链上的主题色字" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--link", why: "同上" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--danger", why: "同上：danger 语义色" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--danger-text", why: "同上" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--primary.ln-btn--danger", why: "同上：primary+danger 实心危险组合（261125 用户裁决 7）" },
  { file: "styles/kernel-theme.css", sel: "button.ln-btn--primary.ln-btn--danger:active:not(:disabled)", why: "同上（按下翻转态）" },
  { file: "styles/kernel-theme.css", sel: "button.ln-chip.is-selected", why: "同上：chip 选中态字色" },
  { file: "styles/kernel-theme.css", sel: "button.ln-chip--danger.is-selected", why: "同上" },
  // 平板外壳的开/关态归属（padCssOwnership 已钉死：平板几何/状态单一归属 pad.css，不属于 feature 覆盖）
  { file: "mobile/pad/pad.css", sel: ".pad-tree__head .mb-iconbtn.is-on", why: "平板外壳状态单一归属（padCssOwnership）" },
  { file: "mobile/pad/pad.css", sel: ".pad-outline__head .mb-iconbtn.is-on", why: "同上" },
];
const CROSS_OWNERSHIP_BASELINE = 0;
/** 开态原语（261125 D-03）的跨域挂载点类：三件套视觉归 kit.css，但类名与其余几何归 usheet 域文件
 *  （基座 flex/尺寸都在 usheet-chrome.css）⇒ 适配规则只是借用它们当挂载点，不算原语类、不入原语宇宙。 */
const ADAPTER_HOST_CLASSES = new Set(["mb-usheet-dock__btn", "mb-usheet-fbtn"]);

function primitiveClasses(): Set<string> {
  const names = new Set<string>();
  for (const rel of PRIMITIVE_FILES) {
    const css = readFileSync(path.join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/\.([a-z][\w-]*)/g)) {
      if (/^(ln|mb)-/.test(match[1]) && !ADAPTER_HOST_CLASSES.has(match[1])) names.add(match[1]);
    }
  }
  return names;
}

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      cssFiles(full, out);
    } else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

/** 主语位复合选择器 = 最后一个组合器（后代/子代/兄弟）之后；:not() 内是排除项，不算命中。 */
function subjectClasses(single: string): string[] {
  const subject = single.trim().split(/\s*[>+~]\s*|\s+/).pop() ?? "";
  const cleaned = subject.replace(/:not\([^)]*\)/g, "");
  return [...cleaned.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]);
}

describe("原语变体门禁", () => {
  it("feature/app CSS 对 kit 原语的跨所有权覆盖只许降", () => {
    const primitives = primitiveClasses();
    const exempt = new Set(EXEMPT_RULES.map((r) => r.file + " :: " + r.sel));
    const offenders: string[] = [];
    for (const file of cssFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (PRIMITIVE_FILES.includes(rel)) continue;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of css.matchAll(/([^{}]+)\{/g)) {
        const selector = rule[1].trim().replace(/\s+/g, " ");
        if (!selector || selector.startsWith("@")) continue;
        for (const single of selector.split(",")) {
          const trimmed = single.trim();
          if (!trimmed) continue;
          if (!subjectClasses(trimmed).some((name) => primitives.has(name))) continue;
          if (exempt.has(rel + " :: " + trimmed)) continue;
          offenders.push(rel + " :: " + trimmed.slice(0, 120));
        }
      }
    }
    // 豁免清单里找不到的条目也要提醒（契约改完记得出表，别让清单变死账）
    const seen = new Set<string>();
    for (const file of cssFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of css.matchAll(/([^{}]+)\{/g)) {
        for (const single of rule[1].split(",")) {
          const key = rel + " :: " + single.trim().replace(/\s+/g, " ");
          if (exempt.has(key)) seen.add(key);
        }
      }
    }
    const stale = [...exempt].filter((k) => !seen.has(k));
    expect(
      offenders.length,
      "原语跨所有权覆盖新增了（只许降；请在原语文件加变体/变量，或把域上下文几何收编进原语文件）：\n  " + offenders.slice(0, 10).join("\n  "),
    ).toBeLessThanOrEqual(CROSS_OWNERSHIP_BASELINE);
    expect(stale, "EXEMPT_RULES 里已找不到的豁免条目（请同步出表）：\n  " + stale.join("\n  ")).toEqual([]);
  });
});

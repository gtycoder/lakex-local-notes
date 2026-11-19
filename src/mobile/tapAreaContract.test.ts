/**
 * 44 触控档对账护栏（261119 按钮边界审计 B-7/B-8 收口；照设备走查 smallTap 的口径做静态对账）。
 *
 * MOBILE-DESIGN「The 44 Rule」：有效命中区 ≥44×44；视觉被刻意压住的类用 ::after / .mb-tap 补足，
 * 视觉盒子不变。此前文档指向的「mobile.css 触达补足注册表」并不存在（审计指出）⇒ 实现是
 * kit.css 类内 ::after（.mb-chip / .mb-switch / .mb-btn--sm / .mb-iconbtn--compact）+ .mb-tap 散点挂载，
 * 于是 36 紧凑档（.mb-btn--sm / .mb-iconbtn--compact）长期裸奔、28–40px 散点漏补。本护栏双向对账：
 *   ① 视觉<44 的可点类 ⇒ 必须有扩区（类内 ::after 或使用处挂 .mb-tap），否则进 TAP_REVIEWED 登记（只减不增）；
 *   ② 有扩区的类 ⇒ 视觉必须仍 <44（不许「既调大又补足」两套并存）。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE); // src/mobile

type Rule = { file: string; head: string; body: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

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

const cssFiles = walk(SRC).filter((p) => p.endsWith(".css"));
const tsxText = walk(SRC)
  .filter((p) => /\.tsx?$/.test(p) && !p.includes(".test."))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

/** 取值解析：var(--x) 从 tokens.css 取（几何令牌唯一来源）。 */
const vars: Record<string, string> = {};
for (const m of readFileSync(path.join(SRC, "theme/tokens.css"), "utf8").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  vars[m[1]] = m[2].trim();
}
const resolveValue = (v: string): string => {
  const mm = /^var\((--[a-z0-9-]+)\)$/.exec(v.trim());
  return mm && vars[mm[1]] ? resolveValue(vars[mm[1]]) : v.trim();
};

const rules: Rule[] = [];
for (const f of cssFiles) parseRules(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), f, rules);

/** 按类名 token 聚合：交互（cursor:pointer / :active，含 --修饰名继承基类）、视觉尺寸、扩区证据。 */
type Tok = { interactive: boolean; small: string[]; after: boolean };
const toks = new Map<string, Tok>();
const rec = (t: string): Tok => {
  if (!toks.has(t)) toks.set(t, { interactive: false, small: [], after: false });
  return toks.get(t)!;
};
for (const r of rules) {
  const selectors = r.head.split(",").map((s) => s.trim());
  const ruleInteractive = /cursor\s*:\s*pointer/.test(r.body) || selectors.some((s) => /:active/.test(s));
  // 扩区证据 = ::after 命中盒：负 inset（.mb-chip / .mb-switch 先例）或直接用 --mb-tap-min；
  // 装饰性 ::after（inset:0 遮罩、箭头、渐变）不算。
  const ruleAfter = selectors.some((s) => s.includes("::after")) && (/inset\s*:\s*-/.test(r.body) || /--mb-tap-min/.test(r.body));
  for (const s of selectors) {
    const pseudo = /::(after|before)/.test(s);
    const last = s.split(/\s+/).pop() ?? "";
    for (const m of s.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
      const e = rec(m[1]);
      if (ruleInteractive) e.interactive = true;
      if (ruleAfter && pseudo) e.after = true;
      // 视觉盒子尺寸：只取「本类自己」的盒子规则（非伪元素、选择器末段就是该类），排除 > svg 之类的子元素尺寸。
      if (!pseudo && last.includes("." + m[1])) {
        for (const d of r.body.matchAll(/(min-height|height|min-width|width)\s*:\s*([^;]+)/g)) {
          const px = /^(\d+(?:\.\d+)?)px$/.exec(resolveValue(d[2]));
          if (px && Number(px[1]) < 44) e.small.push(d[1] + ":" + px[1] + "px");
        }
      }
    }
  }
}
// --修饰名的交互语义继承基类（.mb-btn--sm 之于 .mb-btn：cursor 在基类规则上）。
for (const [t, e] of [...toks]) {
  const base = t.split("--")[0];
  if (base !== t && toks.get(base)?.interactive) e.interactive = true;
}
/** className 字符串按**整类名**共现判定（防止 mbt-drawer 借 mbt-drawer__more mb-tap 误命中）。 */
const classLists: string[][] = [...tsxText.matchAll(/className=\{?"([^"]*)"/g)].map((m) => m[1].split(/\s+/));
// 证据归属：同串里出现 t--* 修饰名时算修饰名的（mb-iconbtn--compact 才是 36 那个），不算基类的。
const hasTapUse = (t: string): boolean =>
  classLists.some((list) => list.includes(t) && list.includes("mb-tap") && !list.some((c) => c.startsWith(t + "--")));

/** 视觉<44 但不补扩区的登记表（只减不增；每条写明理由）。261119 首批 = 审计两类范围外的既有小目标。 */
const TAP_REVIEWED: { token: string; why: string }[] = [
  { token: "bt-keep-native", why: "启发式误收：自绘 checkbox/radio 的 :not() 豁免标记，本身不是点按目标（15px 视觉属 input[type=checkbox] 本体，其命中区缺口登记为遗留点，见审计报告回报）" },
  { token: "mb-segment__item", why: "B-7 同型（36 紧凑档、类内扩区缺失）——审计范围只收 .mb-btn--sm/.mb-iconbtn--compact；登记待下批一次收口" },
  { token: "med-f-btn", why: "MOBILE-DESIGN 261015 回例声称 ::after 补足但实现缺失（40 高）；编辑 dock「Aa/更多」面板，登记待修" },
  { token: "med-f-sw", why: "编辑 dock 色板/笔宽视觉件（34×34）；审计范围外，登记待 smallTap 走查定级" },
  { token: "mbt-add-row__btn", why: "多维表「添加行」（36）——审计范围外，登记待走查定级" },
  { token: "mbt-load-more", why: "多维表「加载更多」（36）——审计范围外，登记待走查定级" },
  { token: "mbt-cell-btn", why: "多维表网格行内按钮（min-height 24）——审计范围外，登记待走查定级" },
  { token: "mbt-stepper__btn", why: "记录页步进器按钮（34×34）——审计范围外，登记待走查定级" },
  { token: "mobile-bottom-bar__item", why: "胶囊栏条目（min-width 40、高 56）——横向 40 档，登记待走查定级" },
  { token: "toolbar__icon", why: "表格（Univer chrome）40px 工具条内图标（40×40 受工具条高约束）——登记待走查定级" },
  { token: "mb-usheet-bar__cell", why: "表格底栏格（40 高）——登记待走查定级" },
  { token: "mb-usheet-ccolor", why: "表格色板视觉件（40×40）——登记待走查定级" },
  { token: "mb-usheet-fbtn", why: "表格公式栏按钮（40 高）——登记待走查定级" },
  { token: "mb-usheet-icons__btn", why: "表格图标面板按钮（36×32）——登记待走查定级" },
  { token: "mb-usheet-popcard__row", why: "表格锚定卡行（34 高）——登记待走查定级" },
  { token: "mb-usheet-topbar__btn", why: "表格顶栏按钮（36 高）——登记待走查定级" },
  { token: "pad-tab-add", why: "平板页签「＋」（30×30）——MOBILE-DESIGN 已登记的唯一残留小目标，登记待走查定级" },
  { token: "ai-hint", why: "AI 页提示条（min-height 24）——审计范围外，登记待走查定级" },
  { token: "ink-color", why: "手写板笔迹色板视觉内圆（20×20；命中盒 = 44 色板格，MOBILE-DESIGN 色板条款）——登记待走查复核" },
  { token: "ink-image-remove", why: "手写板 v4 贴图删除（22×20）——审计范围外，登记待走查定级" },
  { token: "ink-text-size", why: "手写板 v4 文字块字号（22×20）——审计范围外，登记待走查定级" },
  { token: "ink-text-remove", why: "手写板 v4 文字块删除（22×20）——审计范围外，登记待走查定级" },
  { token: "ink-page-strip__add", why: "手写板页签条新建（34×34）——审计范围外，登记待走查定级" },
  { token: "ink-page-strip__close", why: "手写板页签条关闭（34×34）——审计范围外，登记待走查定级" },
];

/** 扩区机制自身（.mb-tap 命中盒 44×44），不参与「视觉<44」双向对账。 */
const EVIDENCE_EXEMPT = ["mb-tap"];

describe("44 触控档对账（261119 B-7/B-8）", () => {
  it("视觉<44 的可点类必须有扩区（类内 ::after 或使用处挂 .mb-tap），否则登记 TAP_REVIEWED（只减不增）", () => {
    const offenders: string[] = [];
    for (const [t, e] of [...toks].sort()) {
      if (!e.interactive || e.small.length === 0) continue;
      if (e.after || hasTapUse(t)) continue;
      if (TAP_REVIEWED.some((x) => x.token === t)) continue;
      offenders.push(t + " [" + [...new Set(e.small)].join(", ") + "]");
    }
    expect(
      offenders,
      "以下视觉<44 的可点类没有扩区（类内 ::after 纵向扩到 44，或使用处挂 .mb-tap；确不能补的才登记 TAP_REVIEWED 并写理由）：\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("有扩区的类视觉必须仍 <44（不许「既调大又补足」两套并存）", () => {
    // 只查**类内 ::after** 扩区（类级账：该类视觉必须 <44）。.mb-tap 是使用处按需挂载 ——
    // 同一类在不同使用处视觉可不同（.mb-iconbtn 44 / 被 .mbt-header__btn 压到 36 后挂 .mb-tap），
    // 类级反查会误报，交给正查 + 设备 smallTap 走查。
    const offenders: string[] = [];
    for (const [t, e] of [...toks].sort()) {
      if (!e.interactive) continue;
      if (!e.after) continue;
      if (EVIDENCE_EXEMPT.includes(t)) continue;
      if (e.small.length === 0) offenders.push(t);
    }
    expect(
      offenders,
      "以下类已有扩区但视觉已 ≥44（应移除扩区或从机制里摘掉）：\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("TAP_REVIEWED 每条都必须真实命中（防死条目；清单只减不增）", () => {
    const stale = TAP_REVIEWED.filter((x) => !toks.has(x.token)).map((x) => x.token);
    expect(stale, "以下登记条目已不存在（请删除——清单只减不增）：\n  " + stale.join("\n  ")).toEqual([]);
  });

  it("对账自证：B-7/B-8 收口的类被扫到且带扩区证据（不能只看结果是 0）", () => {
    // B-7：36 紧凑档此前裸奔，现在类内 ::after。
    for (const t of ["mb-btn--sm", "mb-iconbtn--compact"]) {
      const e = toks.get(t);
      expect(e, "已知会命中的样本 " + t + " 不见了（扫描器失效？）").toBeTruthy();
      expect(e!.small, t + " 必须被识别为视觉<44").not.toEqual([]);
      expect(e!.after, t + " 必须有类内 ::after 扩区").toBe(true);
    }
    // B-8：三处散点挂 .mb-tap。
    for (const t of ["mobile-icon-btn", "mbt-drawer__more", "mb-toast__close"]) {
      expect(hasTapUse(t), t + " 必须在使用处挂 .mb-tap").toBe(true);
    }
    // 先例不回归。
    expect(toks.get("mb-switch")!.after).toBe(true);
    expect(toks.get("mb-chip")!.after).toBe(true);
  });
});

// 文本级 A/B：把"改后的整份 CSS 文本"注入到原样式表之后并禁用原表，
// 同一 DOM/同一状态下比对逐元素计算值。自检模式注入"未改动副本"，噪声必须为 0。
import fs from "node:fs";
import postcss from "postcss";
import { STATES, setupState } from "./stylesnap.mjs";
import { execSync } from "node:child_process";

import { REPO, data } from "./paths.mjs";
const FILES = (process.env.FILES || "src/styles.css,src/b3/layout.css,src/features/outline/outline.css,src/styles/dialog.css,src/styles/document-status.css,src/styles/overlays.css,src/styles/ui-polish.css").split(",");
// 注意：必须包含 SVG 的 stroke/fill 系列 —— 图标是 <svg>，它们的着色走 stroke/fill，
// 不在清单里的话"改了图标描边"这类改动会被误判成 0 差异（260916 第七轮就漏过一次）。
const PROPS = ["display","position","top","right","bottom","left","zIndex","width","height","minWidth","minHeight","maxWidth","margin","padding","gap","flex","flexDirection","alignItems","justifyContent","gridTemplateColumns","color","backgroundColor","backgroundImage","border","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","borderTopLeftRadius","borderRadius","boxShadow","opacity","visibility","transform","transformOrigin","transition","overflow","pointerEvents","cursor","fontSize","lineHeight","letterSpacing","fontWeight","textAlign","backdropFilter","filter","mixBlendMode","accentColor","willChange","contentVisibility","position","stroke","strokeWidth","strokeLinecap","strokeLinejoin","strokeDasharray","strokeOpacity","fill","fillOpacity","paintOrder"];
const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();

const SNAP = `(() => {
  const PROPS = ${JSON.stringify(PROPS)};
  const FULL = ${process.env.FULL === "1"};   // 全属性模式：枚举 CSSStyleDeclaration 里的每一个长属性
  const HASH = ${process.env.HASH === "1"};   // 哈希模式：全属性在页内折叠成指纹，只把指纹传出来
  const dump = (cs) => {
    const names = [];
    for (let i = 0; i < cs.length; i++) names.push(cs[i]);
    names.sort();
    const out = [];
    for (const n of names) out.push(n + "=" + cs.getPropertyValue(n) + "!" + cs.getPropertyPriority(n));
    return out;
  };
  const els = [document.documentElement, ...document.querySelectorAll("body *")];
  const out = [];
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (HASH) {
      const s = dump(cs).join("\\u0002");
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
      out.push(h.toString(36));
      continue;
    }
    const parts = [];
    if (FULL) parts.push(...dump(cs));
    else for (const p of PROPS) parts.push(cs[p]);
    const r = el.getBoundingClientRect();
    parts.push(Math.round(r.x*2), Math.round(r.y*2), Math.round(r.width*2), Math.round(r.height*2));
    for (const pe of ["::before","::after"]) {
      const pcs = getComputedStyle(el, pe); if (!pcs) continue;
      const c = pcs.content; if (!c || c === "none" || c === "normal") continue;
      parts.push(pe, c);
      if (FULL) parts.push(...dump(pcs));
      else for (const p of ["display","position","top","left","right","bottom","width","height","backgroundColor","backgroundImage","border","borderRadius","boxShadow","transform","opacity","visibility","zIndex","pointerEvents","mixBlendMode","backdropFilter","transition","color","fontSize","fontWeight"]) parts.push(pcs[p]);
    }
    out.push(parts.join("\\u0001"));
  }
  return out;
})()`;

const injectExpr = (spec) => `(() => {
  const spec = ${JSON.stringify(spec)};
  const sheets = [...document.styleSheets];
  const made = [];
  for (const ss of sheets) {
    const node = ss.ownerNode;
    const id = node && node.getAttribute ? node.getAttribute("data-vite-dev-id") : null;
    if (!id) continue;
    const hit = spec.find((s) => id === s.file || id.endsWith("/" + s.file));
    if (!hit) continue;
    const st = document.createElement("style");
    st.setAttribute("data-ab-clone", hit.file);
    st.textContent = hit.text;
    node.after(st);
    ss.disabled = true;
    made.push({ file: hit.file, chars: hit.text.length });
  }
  document.body.offsetHeight;
  return { made, missing: spec.filter((s) => !made.some((m) => m.file === s.file)).map((s) => s.file) };
})()`;

// 按计划对某文件文本做删除（与 dedupe3 同判据，直接来自 plan-applied.json）
const applyPlanToText = (rel, entries) => {
  const file = REPO + rel;
  const text = fs.readFileSync(file, "utf8");
  if (!entries.length) return text;
  const root = postcss.parse(text, { from: file });
  const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
  const leaves = [];
  root.walkRules((r) => { if (!inKf(r)) leaves.push({ rule: r, sel: norm(r.selector), occ: 0, decls: [] }); });
  { const bySel = new Map(); for (const l of leaves) { const n = bySel.get(l.sel) || 0; l.occ = n; bySel.set(l.sel, n + 1); } }
  const byKey = new Map(leaves.map((l) => [l.sel + "@@" + l.occ, l]));
  let done = 0; const missed = [];
  for (const e of entries) {
    const leaf = byKey.get(norm(e.selector) + "@@" + e.occ);
    if (!leaf) { missed.push(e.line + " " + e.prop + " no-rule"); continue; }
    let hit = null;
    leaf.rule.walkDecls((d) => { if (hit) return; if (d.prop.toLowerCase() === e.prop.toLowerCase() && norm(d.value) === norm(e.value) && !!d.important === !!e.important) hit = d; });
    if (!hit) { missed.push(e.line + " " + e.prop + " no-decl"); continue; }
    if (e.dropImportant) { hit.important = false; } else { hit.remove(); }
    done++;
  }
  root.walkRules((r) => { const ds = (r.nodes || []).filter((n) => n.type === "decl"); const subs = (r.nodes || []).filter((n) => n.type === "rule" || n.type === "atrule"); if (!ds.length && !subs.length) r.remove(); });
  return { text: root.toString(), done, missed };
};


// ---- 规格构造：把"待验证的另一种 CSS 文本"算出来 ----
const buildSpec = (kind) => {
  const spec = [];
  if (kind === "spec") {
    // 由 SPEC=<json> 指定"另一份样式文本"（每项 {file, text}；text 为空串表示"该表当时不存在"）。
    // 用于重命名/新建文件这类 HEAD 路径对不上的改动。
    const rows = JSON.parse(fs.readFileSync(process.env.SPEC, "utf8"));
    console.log(`  [spec] 注入指定样式文本：${rows.length} 张表`);
    return rows;
  }
  if (kind === "head") {
    // 与"上一个提交"对照：把 git HEAD 版本的文件文本注入回去。改完盘之后跑这个，
    // 差异必须为 0 —— 这是"落盘改动 == 原行为"的证明。
    for (const rel of FILES) {
      const text = execSync(`git show HEAD:${rel}`, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString();
      spec.push({ file: rel, text });
    }
    console.log(`  [head] 注入 HEAD 版本：${spec.length} 个文件`);
    return spec;
  }
  if (kind === "restore") {
    // 还原式审计：把历史上被清空的规则壳填回它们曾有过的声明
    const hist = JSON.parse(fs.readFileSync(data("shell-history.json"), "utf8"));
    for (const rel of FILES) {
      const text = fs.readFileSync(REPO + rel, "utf8");
      const rows = hist[rel] || [];
      if (!rows.length) { spec.push({ file: rel, text }); continue; }
      const root = postcss.parse(text, { from: rel });
      const leaves = [];
      root.walkRules((r) => leaves.push({ rule: r, sel: norm(r.selector), occ: 0 }));
      const bySel = new Map();
      for (const l of leaves) { const n = bySel.get(l.sel) || 0; l.occ = n; bySel.set(l.sel, n + 1); }
      let filled = 0;
      for (const row of rows) {
        const leaf = leaves.find((l) => l.sel === row.sel && l.occ === row.occ);
        if (!leaf || !row.former.length) continue;
        for (const d of row.former) { leaf.rule.append({ prop: d.prop, value: d.value, important: d.important }); filled++; }
      }
      console.log(`  [restore] ${rel}: 填回 ${filled} 条声明`);
      spec.push({ file: rel, text: root.toString() });
    }
    return spec;
  }
  if (kind === "empty") {
    for (const rel of FILES) {
      const text = fs.readFileSync(REPO + rel, "utf8");
      const root = postcss.parse(text, { from: rel });
      let n = 0;
      root.walkRules((r) => { const ds = (r.nodes || []).filter((x) => x.type === "decl"); const sb = (r.nodes || []).filter((x) => x.type === "rule" || x.type === "atrule"); if (!ds.length && !sb.length) { r.remove(); n++; } });
      console.log(`  [empty] ${rel}: 删空壳 ${n} 条`);
      spec.push({ file: rel, text: root.toString().replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") });
    }
    return spec;
  }
  const planFile = kind === "control" ? data("plan-control.json") : (process.env.PLAN_FILE || data("plan-applied.json"));
  const planAll = kind === "self" ? [] : JSON.parse(fs.readFileSync(planFile, "utf8"));
  const stat = { done: 0, missed: [] };
  for (const rel of FILES) {
    const entries = planAll.filter((e) => e.file === rel);
    if (!entries.length) { spec.push({ file: rel, text: fs.readFileSync(REPO + rel, "utf8") }); continue; }
    const r = applyPlanToText(rel, entries);
    stat.done += r.done; stat.missed.push(...r.missed);
    spec.push({ file: rel, text: r.text });
  }
  console.log(`[build] ${kind}: 应用 ${stat.done}/${planAll.length} 条${stat.missed.length ? ` | 未命中 ${stat.missed.length}: ${stat.missed.slice(0, 5).join(" ; ")}` : ""}`);
  return spec;
};

export default async ({ page, args }) => {
  const only = args[0] ? args[0].split(",") : null;
  const mode = args[1] || "self";   // self | plan | control
  const spec = buildSpec(mode);
  const report = { mode, states: {} };
  let noiseTotal = 0, changeTotal = 0;
  for (const st of STATES) {
    if (only && !only.includes(st.name)) continue;
    await setupState(page, st);
    const A1 = await page.evaluate(SNAP);
    await page.sleep(500);
    const A2 = await page.evaluate(SNAP);
    const inj = await page.evaluate(injectExpr(spec));
    await page.sleep(500);
    const B = await page.evaluate(SNAP);
    const dp = (X, Y) => { const out = []; for (let i = 0; i < X.length; i++) if (X[i] !== Y[i]) out.push(i); return out; };
    const noise = dp(A1, A2), change = dp(A2, B);
    if (change.length && process.env.DETAIL === "1") {
      const els = await page.evaluate(`[document.documentElement, ...document.querySelectorAll("body *")].map((e) => e.tagName.toLowerCase() + (e.id ? "$" + e.id : "") + "." + [...e.classList].slice(0, 5).join("."))`);
      // 哈希模式下没有属性值可比，改用"定点全属性"再问一次：先在注入态读，再切回原态读，逐属性列差异
      if (process.env.HASH === "1") {
        for (const i of change.slice(0, 5)) {
          const pick = `(() => {
            const els = [document.documentElement, ...document.querySelectorAll("body *")];
            const el = els[${i}]; if (!el) return null;
            const cs = getComputedStyle(el);
            const names = []; for (let k = 0; k < cs.length; k++) names.push(cs[k]);
            names.sort();
            const props = {};
            for (const n of names) props[n] = cs.getPropertyValue(n) + (cs.getPropertyPriority(n) ? " !important" : "");
            const r = el.getBoundingClientRect();
            return { cls: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + [...el.classList].slice(0, 6).join("."), rect: [Math.round(r.x*10)/10, Math.round(r.y*10)/10, Math.round(r.width*10)/10, Math.round(r.height*10)/10], props };
          })()`;
          const inB = await page.evaluate(pick);
          await page.evaluate(`(() => {
            for (const node of [...document.querySelectorAll("style[data-ab-clone]")]) node.remove();
            for (const ss of [...document.styleSheets]) { const n = ss.ownerNode; if (n && n.getAttribute && n.getAttribute("data-vite-dev-id")) ss.disabled = false; }
            document.body.offsetHeight;
          })()`);
          await page.sleep(400);
          const inA = await page.evaluate(pick);
          const diffs = [];
          for (const n of Object.keys(inA.props)) if (inA.props[n] !== (inB.props[n] ?? "")) diffs.push(`${n}: ${inB.props[n]} → ${inA.props[n]}`);
          console.log(`      #${i} ${inA.cls} [${inA.rect.join(", ")}]  差异属性 ${diffs.length}`);
          for (const d of diffs.slice(0, 12)) console.log("          " + d);
          // 重新注入，保持循环里后续状态判定的一致性
          await page.evaluate(injectExpr(spec));
          await page.sleep(300);
        }
      } else {
      for (const i of change.slice(0, 6)) {
        const a = String(A2[i]).split("\u0001"), b = String(B[i]).split("\u0001");
        const props = [];
        for (let j = 0; j < Math.max(a.length, b.length); j++) if (a[j] !== b[j]) props.push(`${PROPS[j] || "extra" + j}: ${String(a[j]).slice(0, 40)} -> ${String(b[j]).slice(0, 40)}`);
        console.log(`      #${i} ${els[i]}\n        ${props.join("\n        ")}`);
      }
      }
    }
    noiseTotal += noise.length; changeTotal += change.length;
    report.states[st.name] = { n: A1.length, noise: noise.length, change: change.length, missing: inj.missing };
    console.log(`  [ab2] ${st.name}: els ${A1.length} | 噪声 ${noise.length} | 改后差异 ${change.length}`);
  }
  fs.mkdirSync(data("snap"), { recursive: true });
  fs.writeFileSync(data(`snap/ab2-${mode}.json`), JSON.stringify(report, null, 2));
  console.log(`\n${mode}: 噪声合计 ${noiseTotal} | 改后差异合计 ${changeTotal}`);
  return { mode, noiseTotal, changeTotal };
};

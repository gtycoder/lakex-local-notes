// 定点全属性探针：把某个状态钉死，对"某个元素（选择器或坐标）"枚举浏览器报告的**每一个**计算属性，
// 再注入 HEAD 版本样式，同样枚举一次，逐属性列出差异。
// 用途：当像素批次报出差异、但常规属性清单看不出时，用它一次问到底（SVG 的 stroke/fill、
// 建立合成层的 filter/isolation/contain 这类"不会改变几何但会改变栅格化"的属性都在这条路上现形）。
// 用法：node scripts/css-audit/drive.mjs 9222 scripts/css-audit/probe-allprops.mjs <状态名> <选择器或 "x,y">
import fs from "node:fs";
import { execSync } from "node:child_process";
import { STATES, setupState } from "./stylesnap.mjs";
import { REPO } from "./paths.mjs";

// 默认比对清单 = **当前实际加载顺序**（.css-audit/loadorder.json，由 loadorder.mjs 采）。
// 260916 教训：以前把文件清单写死在这里，第二档重组（改名/拆分）之后立刻失效、probe 直接报错。
const FILES = (() => {
  if (process.env.FILES) return process.env.FILES.split(",");
  try { return JSON.parse(fs.readFileSync(data("loadorder.json"), "utf8")); } catch (e) { return ["src/styles.css"]; }
})();

const DUMP = (target) => `(() => {
  const t = ${JSON.stringify(target)};
  let el = null;
  if (/^#?\\d+$/.test(t)) {
    // 纯数字 = 按 body 下的元素序号定位（与快照里的 key#n 的 n 同一套枚举口径）
    const els = [document.documentElement, ...document.querySelectorAll("body *")];
    el = els[Number(t.replace("#", ""))] || null;
  } else if (/\\w\\.\\w*#\\d+$/.test(t) || /^\\w[\\w.-]*#\\d+$/.test(t)) {
    // 形如 div.tree-item#131 / svg.lucide.lucide-book#7：复刻快照的 key 口径
    const [head, nStr] = [t.slice(0, t.lastIndexOf("#")), Number(t.slice(t.lastIndexOf("#") + 1))];
    let n = 0;
    for (const e of document.querySelectorAll("body *")) {
      const key = e.tagName.toLowerCase() + (e.id ? "$" + e.id : "") + ([...e.classList].sort().join(".") ? "." + [...e.classList].sort().join(".") : "");
      if (key !== head) continue;
      if (n === nStr) { el = e; break; }
      n++;
    }
  } else if (/^-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?$/.test(t)) { const [x, y] = t.split(",").map(Number); el = document.elementFromPoint(x, y); }
  else el = document.querySelector(t);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const names = []; for (let i = 0; i < cs.length; i++) names.push(cs[i]);
  names.sort();
  const props = {};
  for (const n of names) props[n] = cs.getPropertyValue(n) + (cs.getPropertyPriority(n) ? " !important" : "");
  const r = el.getBoundingClientRect();
  return { sel: t, tag: el.tagName.toLowerCase(), cls: (el.getAttribute("class") || ""), rect: [r.x, r.y, r.width, r.height], props };
})()`;

export default async ({ page, args }) => {
  const stateName = args[0];
  const target = args[1];
  const st = STATES.find((s) => s.name === stateName);
  if (!st) throw new Error(`没有状态 ${stateName}；可选：${STATES.map((s) => s.name).join(", ")}`);
  await setupState(page, st);

  const after = await page.evaluate(DUMP(target));
  if (!after) return { error: `没找到元素：${target}` };
  // DUMP=1：只把目标元素的全属性原样打出来（不做 HEAD 注入对照），用于"两次运行之间"比对一个元素
  if (process.env.DUMP === "1") {
    console.log(JSON.stringify({ sel: target, tag: after.tag, cls: after.cls, rect: after.rect, props: after.props }));
    return { dumped: true };
  }

  // SPEC=<json 文件> 时用指定的"另一份样式文本"对照（用于重命名/搬家这类 HEAD 路径已不存在的改动）；
  // 否则默认注入 git HEAD 版本。
  const spec = process.env.SPEC
    ? JSON.parse(fs.readFileSync(process.env.SPEC, "utf8"))
    : FILES.map((rel) => {
        try { return { file: rel, text: execSync(`git show HEAD:${rel}`, { cwd: REPO, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).toString() }; }
        catch (e) { return null; }   // HEAD 里没有这张表（新增文件）⇒ 跳过
      }).filter(Boolean);
  await page.evaluate(`(() => {
    const spec = ${JSON.stringify(spec)};
    for (const ss of [...document.styleSheets]) {
      const node = ss.ownerNode; const id = node && node.getAttribute ? node.getAttribute("data-vite-dev-id") : null;
      if (!id) continue;
      const hit = spec.find((s) => id === s.file || id.endsWith("/" + s.file));
      if (!hit) continue;
      const st = document.createElement("style"); st.setAttribute("data-ab-clone", hit.file); st.textContent = hit.text;
      node.after(st); ss.disabled = true;
    }
    document.body.offsetHeight;
  })()`);
  await page.sleep(500);
  const before = await page.evaluate(DUMP(target));

  const diffs = [];
  for (const n of Object.keys(after.props)) if (after.props[n] !== (before.props[n] ?? "")) diffs.push(`${n}: ${before.props[n]}  →  ${after.props[n]}`);
  // 几何用 3 位小数：亚像素位移（0.25px 级）是 SVG 抗锯齿差异的常见来源，压到 0.5px 就看不见了
  const fmt = (r) => `[${r.map((v) => Math.round(v * 1000) / 1000).join(", ")}]`;
  console.log(`元素 ${after.tag}.${after.cls}  矩形 ${fmt(after.rect)}`);
  console.log(`属性数 ${Object.keys(after.props).length}；差异 ${diffs.length} 条`);
  for (const d of diffs) console.log("  " + d);
  return { diffs: diffs.length, list: diffs };
};

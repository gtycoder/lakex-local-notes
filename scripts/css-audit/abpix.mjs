// 注入式像素 A/B：把某个状态钉死，同一页面会话内"截图 → 注入另一份 CSS 文本 → 再截图"，
// 用于把像素差异**快速二分**到具体哪几条声明（整批截图对照一轮要 3 分钟，这个一轮 ~20 秒）。
// 注意：只用于定位，最终判定仍以"真改文件 + 整批同序重跑"为准。
// 用法：node scripts/css-audit/drive.mjs 9222 scripts/css-audit/abpix.mjs <状态名> <head|plan> [计划文件]
import fs from "node:fs";
import postcss from "postcss";
import { execSync } from "node:child_process";
import { STATES, setupState } from "./stylesnap.mjs";
import { REPO, data } from "./paths.mjs";

const FILES = (process.env.FILES || "src/styles.css,src/b3/layout.css,src/b3/components.css,src/b3/animations.css,src/features/outline/outline.css,src/styles/shell.css,src/styles/editor-bridge.css,src/styles/motion-contract.css,src/styles/ui-polish.css").split(",");
const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();

const buildSpec = (kind, planFile) => {
  if (kind === "head") return FILES.map((rel) => ({ file: rel, text: execSync(`git show HEAD:${rel}`, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString() }));
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  return FILES.map((rel) => {
    const entries = plan.filter((e) => e.file === rel);
    if (!entries.length) return { file: rel, text: fs.readFileSync(REPO + rel, "utf8") };
    const root = postcss.parse(fs.readFileSync(REPO + rel, "utf8"), { from: rel });
    const leaves = [];
    root.walkRules((r) => leaves.push({ rule: r, sel: norm(r.selector) }));
    const bySel = new Map();
    for (const l of leaves) { const n = bySel.get(l.sel) || 0; l.occ = n; bySel.set(l.sel, n + 1); }
    const byKey = new Map(leaves.map((l) => [l.sel + "@@" + l.occ, l]));
    let done = 0;
    for (const e of entries) {
      const leaf = byKey.get(norm(e.selector) + "@@" + e.occ);
      if (!leaf) continue;
      let hit = null;
      leaf.rule.walkDecls((d) => { if (hit) return; if (d.prop.toLowerCase() === e.prop.toLowerCase() && norm(d.value) === norm(e.value) && !!d.important === !!e.important) hit = d; });
      if (!hit) continue;
      if (e.dropImportant) hit.important = false; else hit.remove();
      done++;
    }
    console.log(`  [abpix] ${rel}: 应用 ${done}/${entries.length}`);
    return { file: rel, text: root.toString() };
  });
};

export default async ({ page, args }) => {
  const stateName = args[0];
  const kind = args[1] || "head";
  const st = STATES.find((s) => s.name === stateName);
  if (!st) throw new Error(`没有状态 ${stateName}`);
  const spec = buildSpec(kind, args[2] || data("plan-applied.json"));

  await setupState(page, st);
  await page.send("Emulation.setDeviceMetricsOverride", { width: st.w, height: 868, deviceScaleFactor: 2, mobile: false });
  await page.sleep(600);
  const a = data(`shotset/abpix-${kind}-A.png`);
  await page.shot(a);

  await page.evaluate(`(() => {
    const spec = ${JSON.stringify(spec)};
    for (const ss of [...document.styleSheets]) {
      const node = ss.ownerNode; const id = node && node.getAttribute ? node.getAttribute("data-vite-dev-id") : null;
      if (!id) continue;
      const hit = spec.find((s) => id === s.file || id.endsWith("/" + s.file));
      if (!hit) continue;
      const el = document.createElement("style"); el.setAttribute("data-ab-clone", hit.file); el.textContent = hit.text;
      node.after(el); ss.disabled = true;
    }
    document.body.offsetHeight;
  })()`);
  await page.sleep(600);
  const b = data(`shotset/abpix-${kind}-B.png`);
  await page.shot(b);
  await page.send("Emulation.clearDeviceMetricsOverride");
  console.log(`${a}\n${b}`);
  return { a, b };
};

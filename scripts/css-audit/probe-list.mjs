// 列出某个选择器**全部匹配元素**的 标签/类名/几何（按 DOM 顺序）。用于排查"按坐标点不到"这类问题：
// 批次脚本里写死的坐标一旦过期，点击会落空或点到别的元素，截图就会落到别的视图 —— 表现为大面积假差异（260916 踩到）。
// 用法：node scripts/css-audit/drive.mjs 9222 scripts/css-audit/probe-list.mjs "<选择器>" [状态名]
import { STATES, setupState } from "./stylesnap.mjs";

export default async ({ page, args }) => {
  const sel = args[0];
  if (!sel) throw new Error("用法: ... probe-list.mjs <选择器> [状态名]");
  if (args[1]) {
    const st = STATES.find((s) => s.name === args[1]);
    if (!st) throw new Error(`没有状态 ${args[1]}`);
    await setupState(page, st);
  }
  const rows = await page.evaluate(`(() => {
    const out = [];
    for (const el of document.querySelectorAll(${JSON.stringify(sel)})) {
      const r = el.getBoundingClientRect();
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") || "").slice(0, 60),
        text: (el.textContent || "").trim().slice(0, 20),
        rect: [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
      });
    }
    return out;
  })()`);
  rows.forEach((r, i) => console.log(`  #${i} ${r.tag}.${r.cls}  rect[${r.rect.join(", ")}]  "${r.text}"`));
  return { sel, n: rows.length, rows };
};

// 移动端整页计算值快照（口径与桌面 stylesnap 完全一致：复用同一份 SNAP_EXPR，避免两套装置漂移）。
// 用法：node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/mobile-snap.mjs <tag> [only]
// 前置（见 scripts/mobile-audit/README.md）：emu-up → android-build --sync --install → emu-cdp（CDP 9335）。
import fs from "node:fs";
import { data } from "../css-audit/paths.mjs";
import { snapExpr } from "../css-audit/stylesnap.mjs";
// 移动端内核实例发的 u<hex> id 只有 4 位（桌面 ≥6）⇒ 这里把忽略阈值调到 4，否则 home-quicknotes 态每条
// 内核兜底预览都会带一个不稳定的 id 前缀（实测"元素数相同、指纹不同"，装置噪声）。表达式仍是同一份。
const SNAP_EXPR = snapExpr(4);

const waitHome = async (page, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let ok = false;
    try { ok = await page.evaluate("!!document.querySelector('.mobile-htab')"); } catch (e) { ok = false; }
    if (ok) return true;
    await page.sleep(250);
  }
  return false;
};

// 等 DOM 静默（元素数 + 高度和稳定）—— 对齐桌面 stylesnap 的 settle（避免拿到中间态）
// 261012（P2 实测）：首页态会因**启动后的自动同步**在 1~2s 内再渲染一次（实测 home-library 连拍两份
// 1784 / 1755 元素，差 29 ≈ 三个文档卡）⇒ 判据从「3 次稳定 × 200ms」收紧到「6 次稳定 × 300ms」
// 并额外要求「没有瞬时提示条」——提示条出现过就说明还有异步动作在跑。
const settle = async (page) => {
  let lastN = -1, lastH = -1, stable = 0;
  for (let i = 0; i < 30; i++) {
    const r = await page.evaluate("(function(){var els=document.querySelectorAll('body *');var s=0;for(var i=0;i<els.length;i++)s+=Math.round(els[i].getBoundingClientRect().height);var t=document.querySelector('.mb-toast,.mobile-toast');return [els.length,s,t?1:0];})()");
    const n = r[0], h = r[1], toast = r[2];
    if (n === lastN && h === lastH && !toast) { if (++stable >= 6) break; } else { stable = 0; lastN = n; lastH = h; }
    await page.sleep(300);
  }
};

const clickText = async (page, sel, text) => page.evaluate(
  "(function(){var el=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(function(e){return ((e.getAttribute('aria-label')||e.title||e.textContent||'')).indexOf(" + JSON.stringify(text) + ")>=0 && e.getBoundingClientRect().width>0;});if(!el)return false;el.click();return true;})()"
);

// 每态都从"冷启动首页"开始：reload → 等 .mobile-htab → 导航 → 等静默
const reload = async (page) => {
  await page.send("Page.reload", { ignoreCache: false });
  await page.sleep(1200);
  await waitHome(page);
  await settle(page);
};

export const STATES = [
  { name: "home-library", nav: async () => {} },
  { name: "home-quicknotes", nav: async (page) => { await clickText(page, ".mobile-htab", "小记"); } },
  { name: "home-library-list", nav: async (page) => { await clickText(page, ".mobile-htab", "知识库"); await clickText(page, ".toolbar__button", "切换到列表"); } },
  { name: "home-doc", nav: async (page) => { await page.evaluate("(function(){var el=document.querySelector('.doc-card');if(el)el.click();return true;})()"); await page.sleep(1500); } },
  { name: "settings", nav: async (page) => { await clickText(page, ".toolbar__button", "设置"); await page.sleep(600); } },
  { name: "settings-appearance", nav: async (page) => { await clickText(page, ".toolbar__button", "设置"); await page.sleep(600); await clickText(page, ".mobile-settings-list .b3-list-item", "外观"); await page.sleep(600); } },
];

export default async ({ page, args }) => {
  const tag = args[0] || "run";
  const only = args[1] ? args[1].split(",") : null;
  const out = { tag, states: {} };
  // 预热：刚连上 CDP 后的第一次 reload 常拿到"半渲染"首页（实测首态 210 els vs 完整 238）⇒ 先空跑一次 reload。
  await reload(page);
  for (const st of STATES) {
    if (only && !only.includes(st.name)) continue;
    await reload(page);
    await st.nav(page);
    await settle(page);
    const snap = await page.evaluate(SNAP_EXPR);
    out.states[st.name] = snap;
    console.log("  [msnap] " + st.name + ": " + snap.n + " els");
  }
  fs.mkdirSync(data("snap"), { recursive: true });
  fs.writeFileSync(data("snap/" + tag + ".json"), JSON.stringify(out));
  return { tag, states: Object.keys(out.states).length, file: data("snap/" + tag + ".json") };
};

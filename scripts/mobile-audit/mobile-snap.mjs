// 移动端整页计算值快照（口径与桌面 stylesnap 完全一致：复用同一份 SNAP_EXPR，避免两套装置漂移）。
// 用法：node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/mobile-snap.mjs <tag> [only]
// 前置（见 scripts/mobile-audit/README.md）：emu-up → android-build --sync --install → emu-cdp（CDP 9335）。
import fs from "node:fs";
import { data } from "../css-audit/paths.mjs";
import { SNAP_EXPR } from "../css-audit/stylesnap.mjs";

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
const settle = async (page) => {
  let lastN = -1, lastH = -1, stable = 0;
  for (let i = 0; i < 24; i++) {
    const r = await page.evaluate("(function(){var els=document.querySelectorAll('body *');var s=0;for(var i=0;i<els.length;i++)s+=Math.round(els[i].getBoundingClientRect().height);return [els.length,s];})()");
    const n = r[0], h = r[1];
    if (n === lastN && h === lastH) { if (++stable >= 3) break; } else { stable = 0; lastN = n; lastH = h; }
    await page.sleep(200);
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

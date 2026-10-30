// 移动端整页计算值快照（口径与桌面 stylesnap 完全一致：复用同一份 SNAP_EXPR，避免两套装置漂移）。
// 用法：node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/mobile-snap.mjs <tag> [only]
// 前置（见 scripts/mobile-audit/README.md）：emu-up → android-build --sync --install → emu-cdp（CDP 9335）。
import fs from "node:fs";
import { data } from "../css-audit/paths.mjs";
import { snapExpr } from "../css-audit/stylesnap.mjs";
// 移动端内核实例发的 u<hex> id 只有 4 位（桌面 ≥6）⇒ 这里把忽略阈值调到 4，否则 home-quicknotes 态每条
// 内核兜底预览都会带一个不稳定的 id 前缀（实测"元素数相同、指纹不同"，装置噪声）。表达式仍是同一份。
const SNAP_EXPR = snapExpr(4);

import { waitHome, settle, clickText, setLibraryView, clearTabs, reload, tapSel, tapByLabel, expectOn } from "./snap-lib.mjs";

export const STATES = [
  // 261013：每态**钉住视图 + 自断言**。此前 6 态里只有 3 态有效：
  //   home-library-list 与 home-library 同一个态（按钮文案随视图变，clickText 找不到"切换到列表"）；
  //   home-doc 从未离开首页（el.click() 在 WebView 里不触发导航）；settings-appearance 一直停在设置根页。
  // 现在各自到达不同屏，且到不了就抛错 —— 装置宁可红，也不要静默地少测 3 个屏。
  // 261014：默认 tab 改成「小记」⇒ 这两个知识库态必须**自己切回知识库**（此前靠默认 tab 恰好是知识库）。
  { name: "home-library", view: "shelf", nav: async (page) => {
    await clickText(page, ".mobile-htab", "知识库");
    await expectOn(page, "!!document.querySelector('.nb-shelf')", "知识库 · 书架视图");
  } },
  { name: "home-quicknotes", nav: async (page) => { await clickText(page, ".mobile-htab", "小记"); await expectOn(page, "(function(){var e=document.querySelector('.mobile-htab.active');return !!e && e.textContent.indexOf('小记')>=0;})()", "首页 · 小记 tab"); } },
  { name: "home-library-list", view: "shelf", nav: async (page) => {
    await clickText(page, ".mobile-htab", "知识库");
    if (!(await tapByLabel(page, ".toolbar__button", "切换到列表", 800))) throw new Error("home-library-list: 顶栏右上角没有「切换到列表」按钮");
    await expectOn(page, "!!document.querySelector('.nb-list')", "知识库 · 列表视图");
  } },
  { name: "home-doc", view: "shelf", nav: async (page) => {
    await clickText(page, ".mobile-htab", "知识库");   // 261014：默认 tab = 小记 ⇒ 知识库卡片要自己切过去

    // 261013：「最近文档」卡片这条路在开发库上不可用 —— 实测 6 张全是 parent_id 为空的探针文档，
    // 点开只弹「未找到该文档所属笔记本」（HANDOFF §0 记过这批脏数据）。改走走查装置里已验证的路径：
    // 笔记本卡片 → 工作区 → （必要时）底栏「文档树」→ 点第一行文档。
    // 261014 装置加固：书架卡偶发"点了但工作区没挂上"（1600ms 不够）⇒ 最多点两次、放宽到 2600ms，仍不行才抛错。
    let opened = false;
    for (let i = 0; i < 2 && !opened; i++) {
      if (!(await tapSel(page, ".nb-shelf-card", 2600)) && !(await tapSel(page, ".nb-row", 2600))) {
        throw new Error("home-doc: 首页没有笔记本入口（.nb-shelf-card / .nb-row 都没有）");
      }
      opened = await page.evaluate("Boolean(document.querySelector('.mobile-workspace'))");
    }
    await expectOn(page, "!!document.querySelector('.mobile-workspace')", "第二层工作区");
    const rowsOpen = "!!document.querySelector('.side-panel--left.on .mb-row')";
    if (!(await page.evaluate(rowsOpen))) {
      if (!(await tapByLabel(page, ".mobile-bottom-bar__item", "文档树", 1200))) throw new Error("home-doc: 底栏找不到「文档树」入口");
    }
    if (!(await tapSel(page, ".side-panel--left.on .mb-row", 2400))) throw new Error("home-doc: 目录抽屉里没有可点的文档行");
    // 261013：断言必须落在**活动** pane 上 —— 只查 '.mobile-doc-body' 会被 keep-alive 的隐藏 pane 蒙混过关
    // （App 会恢复 8 个隐藏标签页，它们照样在 DOM 里）。同时要求活动 pane 真的渲染出内核视图/编辑引擎。
    await expectOn(
      page,
      "(function(){var p=document.querySelector('.doc-pane.active');if(!p)return false;return !!(p.querySelector('.ne-viewer')||p.querySelector('.ne-engine'));})()",
      "活动 pane 的文档内容（.ne-viewer / .ne-engine）",
    );
  } },
  { name: "settings", nav: async (page) => { await clickText(page, ".toolbar__button", "设置"); await page.sleep(600); await expectOn(page, "!!document.querySelector('.mobile-settings-list')", "设置抽屉根页"); } },
  { name: "settings-appearance", nav: async (page) => { await clickText(page, ".toolbar__button", "设置"); await page.sleep(600); await clickText(page, ".mobile-settings-row", "外观"); await page.sleep(600); await expectOn(page, "!!document.querySelector('.mobile-settings-page--full')", "设置 · 外观子页"); } },
];

export default async ({ page, args }) => {
  const tag = args[0] || "run";
  const only = args[1] ? args[1].split(",") : null;
  const out = { tag, states: {} };
  // 预热：刚连上 CDP 后的第一次 reload 常拿到"半渲染"首页（实测首态 210 els vs 完整 238）⇒ 先空跑一次 reload。
  await reload(page, "shelf");
  for (const st of STATES) {
    if (only && !only.includes(st.name)) continue;
    await reload(page, st.view);
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

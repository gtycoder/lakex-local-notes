// 移动端顶部 Chrome 几何探针（方案 §8.4 · docs/MOBILE-TOP-CHROME-REFACTOR.md）
// 用法：node scripts/css-audit/drive.mjs 9336 scripts/mobile-audit/top-chrome-geometry.mjs
//   （端口 = 目标实例的 CDP：9335 开发 lake_mobile / 9336 门禁 lake_gate）
//
// 做什么：在 0 / 24 / 32 / 48px 四档**注入顶部安全区**下走一批页面，测量每个 [data-mb-topbar] 表面，
// 断言 Top Chrome 契约（topChrome.css）的三条不变量：
//   A. nested / sheet：--mb-chrome-inset-top 恒 0px，且 rect.top / height 跨档位**不变**（不响应安全区）。
//      261117 内嵌 AI 副栏「重复结算安全区」正是这类违反（嵌套表面响应了 inset）。
//   B1. viewport / overlay：内容盒顶部（top + padding-top）≥ inset − 过冲（不潜入状态栏超过登记过冲）。
//      261107 多选顶栏「漏消费安全区」正是这类违反（内容盒顶部恒 0 < inset − 过冲）。
//   B2. viewport / overlay：--mb-chrome-inset-top 恰等于注入值（契约层恰好消费一次）；footprint（高度 +
//      上外边距）跨档增量 ∈ [Δinset − 过冲, Δinset]（过冲 = --mb-chrome-inset-overhang，B3 归一化项）。
//
// 注入方式 = 直接写 --mobile-top-safe-area（喂值通道的契约值）：与「iOS/Android 换喂值后端」同一条链路
// （消费方只经 topChrome.css 的 --mb-chrome-inset-top 反应），且不受 env()/ROM 实际值干扰、可精确到 0。
// 输出：逐页逐表面四档几何表 + 违规清单；有违规（或页面导航失败）抛错 ⇒ 驱动器 exit 非 0。
import { waitHome, settle, clickText, tapSel, tapByLabel, expectOn, reload } from "./snap-lib.mjs";

const INSETS = [0, 24, 32, 48];

const MEASURE =
  "(function(){var out=[];var els=document.querySelectorAll('[data-mb-topbar]');" +
  "for(var i=0;i<els.length;i++){var el=els[i];var r=el.getBoundingClientRect();" +
  "if(r.width<=0&&r.height<=0)continue;var cs=getComputedStyle(el);" +
  "out.push({key:el.tagName.toLowerCase()+'.'+String(el.className||'')," +
  "edge:el.getAttribute('data-edge')||'',size:el.getAttribute('data-size')||''," +
  "top:Math.round(r.top*2)/2,height:Math.round(r.height*2)/2," +
  "padTop:parseFloat(cs.paddingTop)||0,marginTop:parseFloat(cs.marginTop)||0," +
  "inset:String(cs.getPropertyValue('--mb-chrome-inset-top')||'').trim()," +
  "overhang:parseFloat(cs.getPropertyValue('--mb-chrome-inset-overhang'))||0});}return out;})()";

const setInset = (s) => "document.documentElement.style.setProperty('--mobile-top-safe-area','" + s + "px')";
const CLEAR_INSET = "document.documentElement.style.removeProperty('--mobile-top-safe-area')";

const near = (a, b, eps = 0.6) => Math.abs(a - b) <= eps;

/** 一个页面的四档测量 → 违规清单（A / B1 / B2）。 */
function checkPage(pageName, byInset, violations) {
  // 按 key + 出现序号对齐四档（每档独立计数；DOM 在扫档期间不变）
  const perInset = new Map();
  for (const s of INSETS) {
    const counts = new Map();
    const map = new Map();
    for (const row of byInset[s] || []) {
      const i = counts.get(row.key) || 0;
      counts.set(row.key, i + 1);
      map.set(row.key + "#" + i, row);
    }
    perInset.set(s, map);
  }
  const keys = [...perInset.get(INSETS[0]).keys()];
  for (const k of keys) {
    const rows = INSETS.map((s) => perInset.get(s).get(k) || null);
    if (rows.some((r) => !r)) { violations.push(pageName + " :: " + k + " 四档里有缺失（元素随注入值消失？）"); continue; }
    const [r0, r24, r32, r48] = rows;
    const edge = r0.edge;
    const overhang = r0.overhang;
    const name = pageName + " :: " + k + " [edge=" + edge + "]";
    if (edge === "nested" || edge === "sheet") {
      // A：零响应 —— inset 变量恒 0，**高度与上内距**不随注入变（261117 内嵌副栏的 bug = 高度吃进 inset）。
      // 顶部位置（top）不断言：嵌套表面在父级顶栏之下，父级高度合法增长时它会被推下去 —— 那不是消费 inset。
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].inset !== "0px") violations.push(name + " 嵌套/Sheet 表面 inset 应恒 0px，实测 " + rows[i].inset + "（@" + INSETS[i] + "）");
      }
      for (const r of [r24, r32, r48]) {
        if (!near(r.height, r0.height)) {
          violations.push(name + " 嵌套/Sheet 表面高度响应了安全区（height " + r0.height + "→" + r.height + "）");
        }
        if (!near(r.padTop, r0.padTop)) {
          violations.push(name + " 嵌套/Sheet 表面上内距响应了安全区（padding-top " + r0.padTop + "→" + r.padTop + "）");
        }
      }
    } else if (edge === "viewport" || edge === "overlay") {
      // B1 / B2
      for (let i = 0; i < INSETS.length; i++) {
        const s = INSETS[i], r = rows[i];
        if (r.inset !== s + "px") violations.push(name + " 契约 inset 应恰为 " + s + "px（恰好消费一次），实测 " + r.inset);
        const contentTop = r.top + r.padTop;
        if (contentTop + 0.5 < s - overhang) {
          violations.push(name + " 内容盒顶部 " + contentTop + " 潜入状态栏（注入 " + s + "，下限 " + (s - overhang) + "）");
        }
      }
      for (let i = 1; i < INSETS.length; i++) {
        const dS = INSETS[i] - INSETS[i - 1];
        const fp0 = rows[i - 1].height + rows[i - 1].marginTop;
        const fp1 = rows[i].height + rows[i].marginTop;
        const d = fp1 - fp0;
        if (d > dS + 0.5) violations.push(name + " footprint 增量 " + d + " > Δinset " + dS + "（安全区被消费多于一次）");
        if (d + 0.5 < dS - overhang) violations.push(name + " footprint 增量 " + d + " < Δinset−过冲 " + (dS - overhang) + "（安全区没被消费）");
      }
    } else {
      violations.push(name + " data-edge 缺失或非法");
    }
  }
}

export default async ({ page, args }) => {
  const pages = [];
  const violations = [];
  const navErrors = [];

  const sweep = async (pageName, nav) => {
    const byInset = {};
    try {
      await reload(page, "shelf");
      await waitHome(page);
      await nav(page);
      await settle(page);
    } catch (e) {
      navErrors.push(pageName + ": " + e.message);
      pages.push({ page: pageName, nav: "failed", error: String(e.message) });
      return;
    }
    for (const s of INSETS) {
      await page.evaluate(setInset(s));
      await page.sleep(260);
      byInset[s] = await page.evaluate(MEASURE);
    }
    await page.evaluate(CLEAR_INSET);
    checkPage(pageName, byInset, violations);
    pages.push({ page: pageName, nav: "ok", surfaces: INSETS.map((s) => (byInset[s] || []).length).join("/") });
    for (const row of byInset[0] || []) {
      const same = INSETS.map((s) => (byInset[s] || []).find((r) => r.key === row.key) || null);
      console.log("  [tgeom] " + pageName + " | " + row.key.slice(0, 60) + " | " + row.edge + "/" + row.size +
        " | top " + same.map((r) => (r ? r.top : "-")).join("/") +
        " | h " + same.map((r) => (r ? r.height : "-")).join("/"));
    }
  };

  await sweep("home-library", async (p) => {
    await clickText(p, ".mb-home-dock__item", "知识库");
    await settle(p);
  });
  await sweep("home-quicknotes", async (p) => {
    await clickText(p, ".mb-home-dock__item", "小记");
    await settle(p);
  });
  await sweep("home-create-sheet", async (p) => {
    await clickText(p, ".mb-home-dock__item", "小记");
    await p.sleep(700);
    if (!(await tapSel(p, ".mb-home-fab", 900))) throw new Error("首页 ＋（.mb-home-fab）找不到");
    await p.sleep(600);
    await expectOn(p, "!!document.querySelector('.mb-sheet')", "底部 Sheet（.mb-sheet）");
  });
  await sweep("home-doc", async (p) => {
    await clickText(p, ".mb-home-dock__item", "知识库");
    if (!(await tapSel(p, ".nb-shelf-card", 2600)) && !(await tapSel(p, ".nb-row", 2600))) throw new Error("首页没有笔记本入口");
    if (!(await p.evaluate("Boolean(document.querySelector('.mobile-workspace'))"))) throw new Error("工作区未挂载");
  });
  await sweep("workspace-drawer", async (p) => {
    await clickText(p, ".mb-home-dock__item", "知识库");
    if (!(await tapSel(p, ".nb-shelf-card", 2600)) && !(await tapSel(p, ".nb-row", 2600))) throw new Error("首页没有笔记本入口");
    if (!(await p.evaluate("!!document.querySelector('.side-panel--left.on .mb-row')"))) {
      if (!(await tapByLabel(p, ".mobile-bottom-bar__item", "文档树", 1200))) throw new Error("底栏找不到「文档树」入口");
    }
    if (!(await p.evaluate("!!document.querySelector('.side-panel--left.on')"))) throw new Error("目录抽屉未打开");
  });
  await sweep("ai-embedded", async (p) => {
    await clickText(p, ".mb-home-dock__item", "AI");
    await settle(p);
    if (!(await p.evaluate("!!document.querySelector('.mobile-ai-page--embedded')"))) throw new Error("AI 内嵌页未挂载");
  });
  await sweep("settings", async (p) => {
    await clickText(p, ".toolbar__button", "设置");
    await p.sleep(800);
    if (!(await p.evaluate("!!document.querySelector('.mobile-settings-list')"))) throw new Error("设置抽屉根页未打开");
  });
  await sweep("settings-subpage", async (p) => {
    // 设置行可能在折叠线下 ⇒ 滚入视口再点（与 mobile-snap 的 openSettingsItem 同口径）
    if (!(await p.evaluate("!!document.querySelector('.mobile-settings-list')"))) {
      await clickText(p, ".toolbar__button", "设置");
      await p.sleep(800);
    }
    const clicked = await p.evaluate("(function(){var rows=[...document.querySelectorAll('.mobile-settings-row')];var e=rows.find(function(x){return ((x.textContent||'')).indexOf('关于')>=0;});if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true;})()");
    if (!clicked) throw new Error("设置菜单找不到「关于」");
    await p.sleep(900);
    if (!(await p.evaluate("!!document.querySelector('.mobile-settings-page--full')"))) throw new Error("设置子页未打开");
  });

  console.log("  [tgeom] 页面覆盖：" + pages.map((p) => p.page + "(" + (p.nav === "ok" ? p.surfaces + " 表面" : "NAV-FAIL") + ")").join(" · "));
  if (navErrors.length) throw new Error("top-chrome-geometry：导航失败 " + navErrors.join("；"));
  if (violations.length) {
    console.error("  [tgeom] 违规 " + violations.length + " 条：");
    for (const v of violations) console.error("    ✗ " + v);
    throw new Error("top-chrome-geometry：契约不变量违反 " + violations.length + " 条");
  }
  return { pages: pages.length, insets: INSETS.join("/"), violations: 0 };
};

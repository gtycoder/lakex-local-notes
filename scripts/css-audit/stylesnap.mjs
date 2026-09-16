// 整页计算值快照：状态钉死后，把 body 下每个元素 × 一组属性 + 几何 + ::before/::after 打指纹。
// 用于"改动前后必须逐元素 0 差异"的强门禁（像素批次看不见 drag/hover 这类状态）。
import fs from "node:fs";
import { nav, SCREENS } from "./css-audit.mjs";
import { data } from "./paths.mjs";

const PROPS = [
  "display","position","top","right","bottom","left","zIndex","float","clear",
  "width","height","minWidth","minHeight","maxWidth","maxHeight",
  "margin","padding","gap","rowGap","columnGap",
  "flex","flexDirection","flexWrap","flexGrow","flexShrink","flexBasis",
  "alignItems","alignSelf","justifyContent","order",
  "gridTemplateColumns","gridTemplateRows","gridColumn","gridRow",
  "color","backgroundColor","backgroundImage","backgroundClip","backgroundSize","backgroundPosition","backgroundRepeat",
  "border","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","borderColor","borderStyle",
  "borderTopLeftRadius","borderTopRightRadius","borderBottomRightRadius","borderBottomLeftRadius",
  "boxShadow","opacity","visibility","transform","transformOrigin","transition","transitionDuration",
  "overflow","overflowX","overflowY","pointerEvents","cursor","outline","outlineOffset",
  "fontSize","fontWeight","fontFamily","fontStyle","lineHeight","letterSpacing","textAlign","textDecorationLine","textOverflow","whiteSpace","wordBreak",
  "backdropFilter","filter","mixBlendMode","isolation","contain","willChange","contentVisibility","accentColor",
  "paddingInlineStart","marginInlineStart","insetInlineStart","rowGap",
];

const SNAP = `(() => {
  const PROPS = ${JSON.stringify(PROPS)};
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const els = [...document.querySelectorAll("body *")];
  const seen = new Map();
  const rows = [];
  const push = (key, parts) => {
    const n = (seen.get(key) || 0); seen.set(key, n + 1);
    rows.push([key + "#" + n, hash(parts)]);
  };
  for (const el of els) {
    const cls = [...el.classList].sort().join(".");
    const key = el.tagName.toLowerCase() + (el.id ? "$" + el.id : "") + (cls ? "." + cls : "");
    const cs = getComputedStyle(el);
    const parts = [];
    for (const p of PROPS) parts.push(cs[p]);
    const r = el.getBoundingClientRect();
    parts.push(Math.round(r.x * 2), Math.round(r.y * 2), Math.round(r.width * 2), Math.round(r.height * 2));
    // 伪元素：只对真的画出来的（content 不为 none）做指纹
    for (const pe of ["::before", "::after"]) {
      const pcs = getComputedStyle(el, pe);
      if (!pcs) continue;
      const c = pcs.content;
      if (!c || c === "none" || c === "normal") continue;
      parts.push("PE", pe, c);
      for (const p of ["display","position","top","left","right","bottom","width","height","backgroundColor","backgroundImage","border","borderRadius","boxShadow","transform","opacity","visibility","zIndex","pointerEvents","mixBlendMode","backdropFilter","transition","color","fontSize","fontWeight"]) parts.push(pcs[p]);
      const pr = pcs.width, ph = pcs.height;
      parts.push(pr, ph);
    }
    push(key, parts.join("\\u0001"));
  }
  return { n: rows.length, rows };
})()`;

export const injectStates = async (page, kind) => {
  if (kind === "drag") {
    await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll(".tree-row")].filter((e) => e.getBoundingClientRect().width > 0);
      const put = (i, c) => { if (rows[i]) rows[i].classList.add(c); };
      put(0, "dragging"); put(1, "drop-before"); put(2, "drop-after"); put(3, "drop-inside");
      put(4, "drop-line-before"); put(5, "drop-line-after"); put(6, "drop-crossing"); put(7, "drop-parent");
      document.body.classList.add("is-dragging");
      const g = document.createElement("div"); g.setAttribute("data-drag-ghost", ""); g.className = "tree-row dragging";
      g.innerHTML = '<span class="tree-row-label">ghost</span>'; document.body.appendChild(g);
    })()`);
    await page.sleep(500);
  }
};

export const pin = async (page, w, theme, outlineMode) => {
  // 等 .app-shell 真的挂上来再往下走：写死 sleep 在机器忙时（例如同时跑构建/测试）会等到空 DOM
  // 而报 `Cannot read properties of null (reading 'className')`（260916 第七轮踩到）。
  const waitShell = async (ms = 15000) => {
    const t0 = Date.now();
    await page.sleep(1500);   // 刚发出 reload 时页面正在导航，这时候 evaluate 会报 "target navigated or closed"
    while (Date.now() - t0 < ms) {
      let ok = false;
      try { ok = await page.evaluate(`!!document.querySelector(".app-shell")`); } catch (e) { ok = false; }
      if (ok) return true;
      await page.sleep(250);
    }
    return false;
  };
  await page.evaluate(`(() => {
    const k = "lake-notes-v1.settings";
    const s = JSON.parse(localStorage.getItem(k) || "{}");
    s.theme = ${JSON.stringify(theme)}; s.outlineEnhance = false;
    localStorage.setItem(k, JSON.stringify(s));
    localStorage.setItem("lake-notes-v2.sidebar-mode", "docked");
    localStorage.setItem("lake-notes-v2.outline-sidebar-mode", ${JSON.stringify(outlineMode || "collapsed")});
  })()`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 868, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.reload", { ignoreCache: true });
  await waitShell();
  await page.sleep(1200);
  const shellCls = await page.evaluate(`document.querySelector(".app-shell").className`);
  if (!/\bsidebar-docked\b/.test(shellCls)) {
    await page.evaluate(`localStorage.setItem("lake-notes-v2.sidebar-mode","docked")`);
    await page.send("Page.reload", { ignoreCache: true });
    await waitShell();
    await page.sleep(1000);
  }
};

export const STATES = [
    { name: "plain:1315:light", w: 1315, theme: "light" },
    { name: "plain:760:light", w: 760, theme: "light" },
    { name: "plain:1315:dark", w: 1315, theme: "dark" },
    { name: "plain:760:dark", w: 760, theme: "dark" },
    { name: "drag:1315:light", w: 1315, theme: "light", inject: "drag" },
    { name: "drag:1315:dark", w: 1315, theme: "dark", inject: "drag" },
    { name: "outline-docked:760:light", w: 760, theme: "light", outline: "docked" },
    { name: "hover-row:1315:light", w: 1315, theme: "light", hover: ".tree-row" },
    { name: "hover-tab:1315:light", w: 1315, theme: "light", hover: ".tab-item" },
    { name: "hover-rail:760:light", w: 760, theme: "light", hover: ".outline-sidebar" },
    { name: "menus:1315:light", w: 1315, theme: "light", menus: true },
    { name: "note-info:1315:light", w: 1315, theme: "light", noteInfo: true },
    { name: "search:1315:light", w: 1315, theme: "light", search: true },
    { name: "settings:1315:light", w: 1315, theme: "light", settings: true },
    // 260916 扩矩阵：更多面板/交互态（历史·回收站面板靠设置页与右键进入；注入式态见 inject）
    { name: "settings-editor:1315:light", w: 1315, theme: "light", screen: "settings-editor" },
    { name: "settings-data:1315:light", w: 1315, theme: "light", screen: "settings-data" },
    { name: "settings-trash:1315:light", w: 1315, theme: "light", screen: "settings-trash" },
    { name: "settings-assets:1315:light", w: 1315, theme: "light", screen: "settings-assets" },
    { name: "settings-about:1315:light", w: 1315, theme: "light", screen: "settings-about" },
    { name: "search-empty:1315:light", w: 1315, theme: "light", screen: "search-empty" },
    { name: "focus-create:1315:light", w: 1315, theme: "light", screen: "focus-create" },
    { name: "hover-card:1315:light", w: 1315, theme: "light", screen: "hover-card" },
    { name: "outline-open:1315:light", w: 1315, theme: "light", screen: "outline" },
    { name: "quicknotes:1315:light", w: 1315, theme: "light", screen: "quicknotes" },
    { name: "plain:560:light", w: 560, theme: "light" },
    { name: "plain:560:dark", w: 560, theme: "dark" },
    { name: "settings:1315:dark", w: 1315, theme: "dark", screen: "settings-data" },
];

export const setupState = async (page, st) => {
  {
    await pin(page, st.w, st.theme, st.outline);
    // 钉死"当前文档"：打开树里第一篇笔记
    const notePt = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll(".tree-row.type-note")].filter((e) => e.getBoundingClientRect().width > 0);
      const el = rows[0]; if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.x + 140), Math.round(r.y + r.height / 2)];
    })()`);
    if (notePt) { await page.click(notePt[0], notePt[1]); await page.sleep(900); }
    // 收掉可能残留的浮层再开新状态
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.sleep(250);
    if (st.hover) {
      const p = await page.evaluate(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(st.hover)})].filter((e) => e.getBoundingClientRect().width > 0);
        const el = els[1] || els[0]; if (!el) return null;
        const r = el.getBoundingClientRect();
        return [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(12, r.height / 2))];
      })()`);
      if (p) { await page.move(5, 600); await page.sleep(200); await page.move(p[0], p[1]); await page.sleep(650); }
    } else {
      await page.move(2, 862); await page.sleep(250);
    }
    if (st.menus) {
      const p = await page.evaluate(`(() => {
        const el = [...document.querySelectorAll(".tree-row")].filter((e) => e.getBoundingClientRect().width > 0)[1]; if (!el) return null;
        const r = el.getBoundingClientRect(); return [Math.round(r.x + 60), Math.round(r.y + r.height / 2)];
      })()`);
      if (p) {
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "right", clickCount: 1 });
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "right", clickCount: 1 });
        await page.sleep(700);
      }
    }
    if (st.noteInfo) {
      const p = await page.evaluate(`(() => {
        const el = [...document.querySelectorAll(".tree-row")].filter((e) => e.getBoundingClientRect().width > 0)[1]; if (!el) return null;
        const r = el.getBoundingClientRect(); return [Math.round(r.x + 60), Math.round(r.y + r.height / 2)];
      })()`);
      if (p) {
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "right", clickCount: 1 });
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "right", clickCount: 1 });
        await page.sleep(600);
        await page.evaluate(`(() => { const b = [...document.querySelectorAll(".context-menu button, [role=menuitem]")].find((e) => /属性/.test(e.textContent || "")); if (b) b.click(); })()`);
        await page.sleep(900);
      }
    }
    if (st.search) {
      await page.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((e) => /搜索/.test(e.title || e.getAttribute("aria-label") || "") && e.getBoundingClientRect().width > 0); if (b) b.click(); })()`);
      await page.sleep(900);
      await page.evaluate(`(() => { const i = document.querySelector(".search-command-panel input, .search-panel input"); if (!i) return; i.focus(); i.value = "记"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await page.sleep(1300);
    }
    if (st.settings) { await nav.openSettings(page); await nav.settingsNav(page, "外观"); await page.sleep(600); }
    if (st.screen && SCREENS[st.screen]) { await SCREENS[st.screen](page); await page.sleep(500); }
    if (st.inject) await injectStates(page, st.inject);
  }
};

export const SNAP_EXPR = SNAP;

export default async ({ page, args }) => {
  const tag = args[0] || "run";
  const only = args[1] ? args[1].split(",") : null;
  const out = { tag, states: {} };
  for (const st of STATES) {
    if (only && !only.includes(st.name)) continue;
    await setupState(page, st);
    const snap = await page.evaluate(SNAP);
    out.states[st.name] = snap;
    console.log(`  [snap] ${st.name}: ${snap.n} els`);
  }
  fs.mkdirSync(data("snap"), { recursive: true });
  fs.writeFileSync(data(`snap/${tag}.json`), JSON.stringify(out));
  return { tag, states: Object.keys(out.states).length, file: data(`snap/${tag}.json`) };
};

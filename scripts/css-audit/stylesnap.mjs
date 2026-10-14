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

/**
 * 生成整页快照表达式。
 * kernelIdMinLen = 「内核自动发的正文文本节点 id」（形如 u<hex>，**跨 reload 不稳定**）被判为忽略时的最小位数。
 *   桌面观察到 ≥6 位（260923 记录）；移动端内核实例观察到 **4 位**（261012 实测：home-quicknotes 态两条
 *   ne-viewer 的 id 是 u80ff / u0e0b ⇒ 换个 key 前缀就让该态"元素数相同、指纹不同"，噪声淹没真信号）。
 *   同一套内核生成器、位数随实例内节点数变化 ⇒ 参数化，两端**仍共用同一份表达式**（不另写第二套装置）。
 */
export const snapExpr = (kernelIdMinLen = 6) => `(() => {
  const PROPS = ${JSON.stringify(PROPS)};
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const els = [...document.querySelectorAll("body *")];
  const seen = new Map();
  const rows = [];
  // 261013：内核 / plait / drawnix 自动生成的 SVG 图元（**无 id、无 class**）「位置即身份」⇒ 跨轮/跨实例指纹抖动。
  // 实测（5 份完整 42 态快照两两对拍）：翻转恒为同一批 ~314 个这类图元（rect/path/g/circle），**元素数不变**，
  // 只是 index → hash 的对应关系在换 —— 与上面「内核 u<hex> id 不入 key」属同一类噪声。
  // 处理：这类图元**不进 keyed 行**，改为收集 (tag, 自身指纹) 的**多重集**，循环后排序再落地：
  //   位置漂移不再影响结果；图元自身变了（几何/样式）指纹仍会变 ⇒ **信号不丢**（严格优于"整片剔除"）。
  // 判据：同一批 5 份快照里排序多重集 **41/42 态完全一致**（唯一例外 plain:760:dark 属窄窗 UNSTABLE）。
  const RAW_SVG = new Set(["svg","g","rect","path","circle","ellipse","line","polyline","polygon","use","defs","symbol","clippath","mask","filter","stop","lineargradient","radialgradient"]);
  const rawSvg = [];
  const emit = (key, h) => {
    const n = (seen.get(key) || 0); seen.set(key, n + 1);
    rows.push([key + "#" + n, h]);
  };
  const push = (key, sig) => emit(key, hash(sig));
  for (const el of els) {
    const cls = [...el.classList].sort().join(".");
    // 260923：内核给正文文本节点发的 id 形如 u<hex>，**跨 reload 不稳定** ⇒ 不入 key。
    // 不排除的话，同一份代码连拍两份快照会得到"每态恒定 2 条差异 + 2 个新增"，噪声淹没真信号。
    const stableId = /^u[0-9a-f]{${kernelIdMinLen},}$/.test(el.id) ? "" : el.id;
    const isRawSvg = !stableId && !cls && RAW_SVG.has(el.tagName.toLowerCase());
    const key = el.tagName.toLowerCase() + (stableId ? "$" + stableId : "") + (cls ? "." + cls : "");
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
    // 分隔符用 fromCharCode(1) 写出（与原先的字面转义等价，但不经过本模板串的转义层）。
    const sig = parts.join(String.fromCharCode(1));
    if (isRawSvg) rawSvg.push([el.tagName.toLowerCase(), hash(sig)]);
    else push(key, sig);
  }
  // 裸图元按 (tag, 指纹) 排序后落地 ⇒ 与 DOM 顺序无关：同一批图元只是换了位置时，结果逐字节相同。
  rawSvg.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  for (const [tag, h] of rawSvg) emit("svgraw$" + tag, h);
  // 261013：**行序**同样跨实例不可复现（内核图标 sprite 的注入顺序不同，实测 459 个 key 换位、集合完全一样）
  // ⇒ 统一按 key 排序后落地：指纹只回答"有哪些元素、各是什么计算值"，不回答 DOM 顺序
  //（顺序本身不可复现 ⇒ 本来就不能作为基线）。实测：加这一条后跨实例两轮 **42/42 态**逐字节一致。
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { n: rows.length, rows };
})()`;

export const injectStates = async (page, kind) => {
  if (kind === "board") {
    // 画板卡。真实场景里由 vendor 画板卡（React.lazy 懒加载 DrawnixBoardCore）+ @plait 组件渲染出这套 DOM，
    // 这里按同一套类词汇注入一份**代表性子集**，让画板相关规则真的匹配到元素（CSS 不关心 DOM 是谁造的）。
    // 用途：判断"与 vendor/drawnix-react-text.css 逐字节相同的那块内联 CSS"能不能收掉（矩阵原来没有画板态，测不到）。
    await page.evaluate(`(() => {
      const host = document.createElement("div");
      host.id = "matrix-board";
      host.className = "mindmap-interaction-gate";   // 现役：withCanvasWheelGate 包在画板卡编辑器外的那层（board-card-wrapper 已随自研 BoardCard 删除）
      host.style.cssText = "position:fixed;left:40px;top:120px;width:640px;height:420px;z-index:5;background:#fff";
      host.innerHTML = \`
        <div style="width:100%;height:100%">
          <div class="drawnix" style="width:100%;height:100%;position:relative">
            <div class="plait-board-container" style="width:100%;height:100%;position:relative">
              <svg class="board-host-svg" width="100%" height="100%">
                <g class="element-active-host"><rect class="selection-rectangle" width="40" height="20"/></g>
                <g plait-mind="true">
                  <foreignObject class="text" width="120" height="30">
                    <div class="plait-text-container">
                      <div class="slate-editable-container" contenteditable="false">
                        <span data-slate-node="element">画板文本</span>
                      </div>
                    </div>
                  </foreignObject>
                  <circle class="collapse-button animated"/><circle class="add-button"/>
                </g>
              </svg>
              <div class="tool-icon tool-icon--plain"><span class="tool-icon__icon"></span><span class="tool-icon__label">工具</span></div>
              <div class="slider-container slider-container--neutral"><div class="slider-track"><div class="slider-range"></div><div class="slider-thumb"></div></div></div>
              <div class="color-select-item active"><span class="selected-icon"></span></div>
              <div class="dx-SelectTrigger"><span class="dx-SelectTriggerInner">选择</span><span class="dx-SelectIcon"></span></div>
            </div>
            <div class="popup-toolbar">
              <div class="popup-font-size"><input class="popup-font-size__input" value="14" readonly><div class="popup-font-size__stepper"><button class="popup-font-size__stepper-button"><svg class="popup-font-size__stepper-icon"/></button></div></div>
              <div class="property-button"><span class="fill-label"></span><span class="stroke-label"></span></div>
            </div>
            <div class="drawnix-toast-wrapper"><div class="drawnix-toast"><div class="drawnix-toast__message">提示</div><div class="drawnix-toast__description">说明</div></div></div>
            <div class="clean-confirm"><div class="clean-confirm__title">标题</div><p class="clean-confirm__description">描述</p><div class="clean-confirm__actions"><button class="clean-confirm__button clean-confirm__button--cancel">取消</button><button class="clean-confirm__button clean-confirm__button--ok">确定</button></div></div>
            <div class="Dialog-overlay"><div class="Dialog ttd-dialog"><div class="ttd-dialog-tabs-root"><button class="ttd-dialog-tab-trigger" data-state="active">图</button></div><div class="ttd-dialog-content"><textarea class="ttd-dialog-input">test</textarea><div class="ttd-dialog-output-wrapper"><div class="ttd-dialog-output-canvas-container"></div></div></div><div class="ttd-dialog-panels"><div class="ttd-dialog-panel"><div class="ttd-dialog-panel__header"><label>标签</label></div></div></div></div></div>
            <div class="laser-pointer"></div>
          </div>
        </div>\`;
      document.body.appendChild(host);
    })()`);
    await page.sleep(600);
  }
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

export const pin = async (page, w, theme, outlineMode, media) => {
  // 媒体偏好（reduced-motion / reduced-transparency…）：**每个状态都显式设置**（没写 media 的就清空），
  // 否则上一个状态的模拟会泄漏到下一个状态。（CDP 的 emulated media 是会话级、跨 reload 保留的。）
  await page.send("Emulation.setEmulatedMedia", {
    features: Object.entries(media || {}).map(([name, value]) => ({ name, value })),
  });
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
    // ⚠️ 所有状态都钉 outlineEnhance=false ⇒ 增强大纲（.outline-sidebar 等）在本矩阵中**不可达**，
    // L3 的 DOM 零命中对它无效（须叠加代码生产者过滤，见 README §状态矩阵 / l3-plan.mjs）。
    s.theme = ${JSON.stringify(theme)}; s.outlineEnhance = false;
    localStorage.setItem(k, JSON.stringify(s));
    localStorage.setItem("lake-notes-v2.sidebar-mode", "docked");
    localStorage.setItem("lake-notes-v2.outline-sidebar-mode", ${JSON.stringify(outlineMode || "collapsed")});
    // 浮动弹窗（设置/历史/回收站）的位置与尺寸也持久化在 localStorage（useFloatingDialog 的
    // lake-notes-v3.dialog-states）⇒ 夹具副本会带上"上一台机器把设置弹窗拖到哪、拉多大"，
    // 让**所有 settings 态整体位移/缩放**（2026-10-06 实测：settings-* 全态 hash 变、根节点 .settings-panel 起）。
    // 清掉它 = 每个态都按 initialSize 默认居中打开，几何只跟 CSS 与视口走。
    localStorage.removeItem("lake-notes-v3.dialog-states");
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
    { name: "resources:1315:light", w: 1315, theme: "light", screen: "resources" },
    { name: "settings-about:1315:light", w: 1315, theme: "light", screen: "settings-about" },
    { name: "search-empty:1315:light", w: 1315, theme: "light", screen: "search-empty" },
    { name: "focus-create:1315:light", w: 1315, theme: "light", screen: "focus-create" },
    { name: "hover-card:1315:light", w: 1315, theme: "light", screen: "hover-card" },
    { name: "outline-open:1315:light", w: 1315, theme: "light", screen: "outline" },
    { name: "quicknotes:1315:light", w: 1315, theme: "light", screen: "quicknotes" },
    { name: "plain:560:light", w: 560, theme: "light" },
    { name: "plain:560:dark", w: 560, theme: "dark" },
    { name: "settings:1315:dark", w: 1315, theme: "dark", screen: "settings-data" },
  // ── 主题 C（warm）：重设计有三套主题，浅/深之外必须覆盖 warm，否则 warm 下的回归无人看守（260923 W0-a）──
  { name: "plain:1315:warm", w: 1315, theme: "warm" },
  { name: "plain:560:warm", w: 560, theme: "warm" },
  { name: "hover-row:1315:warm", w: 1315, theme: "warm", hover: ".tree-row" },
  { name: "menus:1315:warm", w: 1315, theme: "warm", menus: true },
  { name: "search:1315:warm", w: 1315, theme: "warm", search: true },
  { name: "settings:1315:warm", w: 1315, theme: "warm", screen: "settings-data" },
  { name: "quicknotes:1315:warm", w: 1315, theme: "warm", screen: "quicknotes" },
  { name: "outline-open:1315:warm", w: 1315, theme: "warm", screen: "outline" },
    // 260916 补矩阵：媒体偏好态。这两个条件在原来的 27 个状态里**恒为假**，导致落在对应媒体块里的声明
    // 完全不可验证（§2.47 因此把 11 条 `animation/transition: none !important` 判为"证不了、不动"）。
    // 用 CDP `Emulation.setEmulatedMedia` 把它们变成可观测状态。
    { name: "rm:1315:light", w: 1315, theme: "light", media: { "prefers-reduced-motion": "reduce" } },
    { name: "rm:1315:dark", w: 1315, theme: "dark", media: { "prefers-reduced-motion": "reduce" } },
    { name: "rm:760:light", w: 760, theme: "light", media: { "prefers-reduced-motion": "reduce" } },
    { name: "rm-quicknotes:1315:light", w: 1315, theme: "light", screen: "quicknotes", media: { "prefers-reduced-motion": "reduce" } },
    { name: "rt:1315:light", w: 1315, theme: "light", media: { "prefers-reduced-transparency": "reduce" } },
    // 画板卡态：让画板相关规则（含"与 vendor 逐字节相同的那块内联 CSS"）真的匹配到元素。
    { name: "board:1315:light", w: 1315, theme: "light", inject: "board" },
    { name: "board:1315:dark", w: 1315, theme: "dark", inject: "board" },
];

export const setupState = async (page, st) => {
  // 等 DOM 静默：目录树存在异步挂载（行高随挂载时机变化），固定 sleep 会让两次快照拿到不同中间态 ——
  // 260916 S1 实测：同一份代码连拍两份快照，13 个状态 / 47931 条指纹"不相同"，全部是这套噪声。
  const settle = async () => {
    let lastCount = -1, lastH = -1, stable = 0;
    for (let i = 0; i < 32; i++) {
      const [n, h] = await page.evaluate(`(() => {
        const els = document.querySelectorAll("body *");
        let sum = 0;
        for (const el of els) sum += Math.round(el.getBoundingClientRect().height);
        return [els.length, sum];
      })()`);
      if (n === lastCount && h === lastH) { if (++stable >= 4) break; } else { stable = 0; lastCount = n; lastH = h; }
      await page.sleep(250);
    }
  };
  {
    await pin(page, st.w, st.theme, st.outline, st.media);
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
    // 墙钟文本归一化（2026-10-06）：设置·文档与历史页那行「上次清理 {时间}」的字符串宽度随
    // **最后一次清理时间**变化 ⇒ settings-data / settings:dark / settings:warm 三个态会在不同
    // 实例世代之间产生"元素数相同、只差一个裸 <span>"的假差异（实测连跑两次门禁一次绿一次红）。
    // 这里只改文本、不改结构（span 仍在、样式照测），让指纹只跟 CSS 走。
    await page.evaluate(`(() => {
      for (const s of document.querySelectorAll(".config-stats span")) {
        if ((s.textContent || "").startsWith("上次清理")) s.textContent = "上次清理 —";
      }
    })()`);
    // 归位鼠标并等"块拖动把手"收干净（2026-10-06 实测假差异源）：它带过渡，而 settle() 只等 DOM/几何稳定，
    // 不等过渡结束 ⇒ settings:1315:light 连拍两份会出现"元素数相同、指纹不同"（11 条：把手本体 + 6×circle
    // + tooltip 的透明度/位置）。hover 态故意把鼠标停在目标上，不能归位。
    if (!st.hover) {
      await page.move(2, 866);
      for (let i = 0; i < 10; i++) {
        const shown = await page.evaluate(`(() => {
          const el = document.querySelector(".ne-block-hover-handle");
          if (!el) return false;
          const cs = getComputedStyle(el);
          return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.01;
        })()`);
        if (!shown) break;
        await page.sleep(200);
      }
      await page.sleep(150);
    }
    await settle();
  }
};

export const SNAP_EXPR = snapExpr(6);

export default async ({ page, args }) => {
  const tag = args[0] || "run";
  const only = args[1] ? args[1].split(",") : null;
  const out = { tag, states: {} };
  for (const st of STATES) {
    if (only && !only.includes(st.name)) continue;
    await setupState(page, st);
    const snap = await page.evaluate(SNAP_EXPR);
    out.states[st.name] = snap;
    console.log(`  [snap] ${st.name}: ${snap.n} els`);
    // 每态落盘：采集偶发在收尾卡死（CDP 超时），收尾才写会整轮白跑（2026-10-06 实测一次）。
    fs.mkdirSync(data("snap"), { recursive: true });
    fs.writeFileSync(data(`snap/${tag}.json`), JSON.stringify(out));
  }
  fs.mkdirSync(data("snap"), { recursive: true });
  fs.writeFileSync(data(`snap/${tag}.json`), JSON.stringify(out));
  return { tag, states: Object.keys(out.states).length, file: data(`snap/${tag}.json`) };
};

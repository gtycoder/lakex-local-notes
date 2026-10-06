import { call, classifyImportant, fingerprint, INHERITED_PROPS } from "./inpage.mjs";

const nav = {
  // 260916 修正：原先按写死坐标点击（x=19, y=54/86），但活动栏按钮实际在 y=2/34 —— 点击落空或点错按钮，
  // 截图就会落到别的视图（表现为大面积假差异，曾误报 74%）。改为**按 DOM 取第 i 个按钮的中心**。
  rail: async (page, i) => {
    const p = await page.evaluate(`(() => {
      const els = [...document.querySelectorAll(".activity-button")];
      const el = els[${i}]; if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
    })()`);
    if (p) await page.click(p[0], p[1]);
    await page.sleep(900);
  },
  openSettings: async (page) => {
    for (let a = 0; a < 3; a++) {
      // 261006：原先写死坐标 (178,19)，布局演进后该点落在 DIV.tabbar-leading（容器）上 ⇒ 菜单根本不开。
      // 改为按**可访问名**找工作区触发器（title="空间：资料库"），再点击其中心。
      const trig = await page.evaluate(`(() => {
        const el = document.querySelector('[title^="空间"], [aria-label^="空间"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
      })()`);
      if (!trig) throw new Error("no workspace trigger");
      await page.click(trig[0], trig[1]); await page.sleep(420);
      const s = await page.evaluate(`(() => { const el = [...document.querySelectorAll('button,[role=menuitem]')].find(e => (e.textContent||'').includes('偏好设置')); if(!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x+r.width/2), Math.round(r.y+r.height/2)]; })()`);
      if (s) { await page.click(s[0], s[1]); await page.sleep(650); return; }
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.sleep(600);
    }
    throw new Error("no 偏好设置 menu item");
  },
  settingsNav: async (page, label) => {
    const p = await page.evaluate(`(() => { const el = [...document.querySelectorAll('.settings-nav-item, .settings-nav-hit, .settings-nav button')].find(e => (e.textContent||'').trim().replace(/\\s+/g,'') === ${JSON.stringify(label)} && e.getBoundingClientRect().width > 0); if(!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x+r.width/2), Math.round(r.y+r.height/2)]; })()`);
    if (!p) return false;
    await page.click(p[0], p[1]); await page.sleep(750); return true;
  },
  closeAll: async (page) => {
    for (let i = 0; i < 5; i++) {
      const c = await page.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(e => String(e.className).includes('ln-close') && e.getBoundingClientRect().width > 0); if(!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x+r.width/2), Math.round(r.y+r.height/2)]; })()`);
      if (!c) break;
      await page.click(c[0], c[1]); await page.sleep(400);
    }
  },
  setTheme: async (page, label) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await nav.closeAll(page); } catch (e) { /* ignore */ }
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.sleep(250);
      try { await nav.openSettings(page); break; } catch (e) { if (attempt === 2) throw e; await page.sleep(600); }
    }
    await nav.settingsNav(page, "外观");
    const t = await page.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(e => (e.textContent||'').trim() === ${JSON.stringify(label)}); if(!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x+r.width/2), Math.round(r.y+r.height/2)]; })()`);
    if (t) { await page.click(t[0], t[1]); await page.sleep(700); }
    await nav.closeAll(page);
  },
  // 260917 修正：全文搜索已从左上角下拉搬到**文档页右上角**（见 HANDOFF §0/b695890），
  // 下拉里再没有"全文搜索"菜单项 ⇒ 旧实现直接抛 no 全文搜索。改为按 title/aria 找右上角的搜索按钮。
  search: async (page) => {
    const p = await page.evaluate(`(() => {
      const el = [...document.querySelectorAll('button')].find(e => {
        const t = (e.title || '') + ' ' + (e.getAttribute('aria-label') || '');
        return /搜索/.test(t) && e.getBoundingClientRect().width > 0;
      });
      if (!el) return null; const r = el.getBoundingClientRect();
      return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
    })()`);
    if (!p) throw new Error("no 搜索 button");
    await page.click(p[0], p[1]); await page.sleep(800);
  },
  noteInfo: async (page) => {
    const p = await page.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(e => (e.title||'').includes('文档属性') || (e.getAttribute('aria-label')||'').includes('文档属性')); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x+r.width/2), Math.round(r.y+r.height/2)]; })()`);
    if (!p) return false;
    await page.click(p[0], p[1]); await page.sleep(700); return true;
  },
};

const rectOf = async (page, sel, nth = 0) => page.evaluate(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getBoundingClientRect().width > 0);
  const el = els[${nth}];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
})()`);

// 状态覆盖：hover / focus / 右键菜单 / 文档属性 / 搜索有结果 / 大纲 / 小记编辑态
// 这些状态不是"多开几个页面"，而是让 `:hover`、`.context-menu`、`.note-info-*` 等选择器真的匹配上，
// 否则审计器把它们全判成 dead，!important 也就永远压不掉。
const STATES = {
  "hover-tree": async (page) => {
    await nav.closeAll(page); await nav.rail(page, 0);
    const p = await rectOf(page, ".tree-row", 1);
    if (p) { await page.move(p[0], p[1]); await page.sleep(500); }
  },
  "hover-tab": async (page) => {
    await nav.closeAll(page); await nav.rail(page, 0);
    const p = await rectOf(page, ".tab-item", 0);
    if (p) { await page.move(p[0], p[1]); await page.sleep(500); }
  },
  "hover-card": async (page) => {
    await nav.closeAll(page); await nav.rail(page, 1);
    const p = await rectOf(page, ".quick-note-entry", 0);
    if (p) { await page.move(p[0], p[1]); await page.sleep(600); }
  },
  "search-empty": async (page) => {
    await nav.closeAll(page); await nav.rail(page, 0);
    await nav.search(page);
    await page.evaluate(`(() => { const i = document.querySelector('.search-command-panel input, .search-panel input'); if (!i) return; i.focus(); i.value = 'zzzqqq无此结果'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page.sleep(1200);
  },
  "focus-create": async (page) => {
    await nav.closeAll(page); await nav.rail(page, 0);
    const p = await rectOf(page, '[title="新建"],[aria-label="新建"]');
    if (p) { await page.click(p[0], p[1]); await page.sleep(400); }
    await page.evaluate(`(() => { const i = document.querySelector('.inline-create input, .sidebar input'); if (i) i.focus(); })()`);
    await page.sleep(400);
  },
  "ctx-menu": async (page) => {
    await nav.closeAll(page); await nav.rail(page, 0);
    const p = await rectOf(page, ".tree-row", 1);
    if (!p) return;
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "right", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "right", clickCount: 1 });
    await page.sleep(700);
  },
  "note-info": async (page) => {
    await nav.closeAll(page); await nav.rail(page, 0);
    const p = await rectOf(page, ".tree-row", 1);
    if (!p) return;
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "right", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "right", clickCount: 1 });
    await page.sleep(600);
    await page.evaluate(`(() => { const b = [...document.querySelectorAll('.context-menu button, [role=menuitem]')].find((e) => /属性|文档属性/.test(e.textContent || '')); if (b) b.click(); })()`);
    await page.sleep(900);
  },
  "search-results": async (page) => {
    await nav.closeAll(page); await nav.rail(page, 0);
    await nav.search(page);
    await page.evaluate(`(() => { const i = document.querySelector('.search-command-panel input, .search-panel input'); if (!i) return; i.focus(); i.value = '记'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page.sleep(1200);
  },
  outline: async (page) => {
    await nav.closeAll(page); await nav.rail(page, 0);
    const p = await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((e) => /大纲|目录/.test(e.title || e.getAttribute('aria-label') || '')); if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
    if (p) { await page.click(p[0], p[1]); await page.sleep(900); }
  },
};

const SCREENS = {
  library: async (page) => { await nav.closeAll(page); await nav.rail(page, 0); },
  quicknotes: async (page) => { await nav.closeAll(page); await nav.rail(page, 1); },
  "settings-appearance": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "外观"); },
  "settings-editor": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "编辑器"); },
  "settings-shortcuts": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "快捷键"); },
  "settings-sync": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "云端与同步"); },
  "settings-logs": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "日志"); },
  "settings-data": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "文档与历史"); },
  "settings-trash": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "回收站"); },
  "settings-assets": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "资源"); },
  "settings-about": async (page) => { await nav.closeAll(page); await nav.openSettings(page); await nav.settingsNav(page, "关于"); },
  search: async (page) => { await nav.closeAll(page); await nav.rail(page, 0); await nav.search(page); },
};

for (const [k, v] of Object.entries(STATES)) SCREENS[k] = v;

export { nav, SCREENS, classifyImportant, fingerprint };

export default async ({ page, args }) => {
  const only = args[0] && args[0] !== "-" ? args[0].split(",") : null;
  const mode = process.env.LK_MODE === "fp" ? "fp" : "classify";
  const report = { mode, theme: null, screens: {} };
  if (process.env.LK_SET_THEME) await nav.setTheme(page, process.env.LK_SET_THEME);
  report.theme = await page.evaluate(`document.documentElement.getAttribute("data-theme")`);
  for (const name of Object.keys(SCREENS)) {
    if (only && !only.includes(name)) continue;
    try {
      await SCREENS[name](page);
      await page.sleep(450);
      if (mode === "fp") {
        const fp = await page.evaluate(call(fingerprint, name));
        report.screens[name] = fp;
        if (process.env.LK_FULL === "1") {
          await page.evaluate(`(() => { window.__fpKeep_${name.replace(/-/g, "_")} = window["__fp_" + ${JSON.stringify(name)}]; })()`);
          report.screens[name].lines = await page.evaluate(`window["__fp_" + ${JSON.stringify(name)}]`);
        }
      } else {
        const cls = await page.evaluate(call(classifyImportant, INHERITED_PROPS));
        const byVerdict = {};
        for (const r of cls.results) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
        report.screens[name] = { count: cls.count, byVerdict, results: cls.results };
      }
    } catch (e) {
      report.screens[name] = { error: String(e && e.message).slice(0, 200) };
    }
  }
  await nav.closeAll(page);
  return report;
};

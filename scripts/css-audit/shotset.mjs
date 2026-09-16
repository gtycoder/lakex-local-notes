// 多屏 × 宽度 × 主题 的静态截图集（状态全部钉死，用于改动前后像素对照）
import { nav, SCREENS } from "./css-audit.mjs";
import { data } from "./paths.mjs";
export default async ({ page, args }) => {
  const tag = args[0];
  const specs = (args[1] || "library:1315:light,quicknotes:1315:light,settings-appearance:1315:light,settings-trash:1315:light,search-results:1315:light,hover-tab:1315:light,ctx-menu:1315:light,note-info:1315:light").split(",");
  const light = specs.filter((s) => s.endsWith(":light"));
  const dark = specs.filter((s) => s.endsWith(":dark"));
  const out = [];
  for (const [theme, list] of [["light", light], ["dark", dark]]) {
    if (!list.length) continue;
    await page.evaluate(`(() => {
      const k = "lake-notes-v1.settings";
      const s = JSON.parse(localStorage.getItem(k) || "{}");
      s.theme = ${JSON.stringify(theme)}; s.outlineEnhance = false;
      localStorage.setItem(k, JSON.stringify(s));
      localStorage.setItem("lake-notes-v2.sidebar-mode", "docked");
      localStorage.setItem("lake-notes-v2.outline-sidebar-mode", "collapsed");
    })()`);
    const first = list[0].split(":");
    await page.send("Emulation.setDeviceMetricsOverride", { width: Number(first[1]), height: 868, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.reload", { ignoreCache: false });
    await page.sleep(4000);
    for (const spec of list) {
      const [screen, wArg] = spec.split(":");
      const w = Number(wArg);
      await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 868, deviceScaleFactor: 1, mobile: false });
      await page.sleep(500);
      try { await nav.closeAll(page); } catch (e) { /* ignore */ }
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.sleep(300);
      if (SCREENS[screen]) await SCREENS[screen](page);
      // 校正侧栏状态：`nav.rail(0)` 在"资料库"视图里其实是**切换侧栏**，跨屏会漂移；
      // 状态漂移会把"抽屉开/关"当成巨大像素差异（本轮踩到过 29%）。
      const shellCls = await page.evaluate(`document.querySelector(".app-shell").className`);
      if (!/\bsidebar-docked\b/.test(shellCls)) {
        await page.evaluate(`localStorage.setItem("lake-notes-v2.sidebar-mode","docked")`);
        await page.send("Page.reload", { ignoreCache: false });
        await page.sleep(3400);
        if (SCREENS[screen]) await SCREENS[screen](page);
      }
      // 钉死"当前文档"：点开树里第一行笔记（否则每次重启打开的是"上次打开的文档"，
      // 改动前后截图会变成两篇不同笔记 —— 曾因此误判成 5.9% 的"样式回归"）。
      const notePt = await page.evaluate(`(() => {
        const rows = [...document.querySelectorAll(".tree-row.type-note")].filter((e) => e.getBoundingClientRect().width > 0);
        const el = rows[0];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [Math.round(r.x + 140), Math.round(r.y + r.height / 2)];
      })()`);
      if (notePt && screen !== "quicknotes") { await page.click(notePt[0], notePt[1]); await page.sleep(900); }
      await page.move(400, 600);
      await page.sleep(200);
      await page.move(Math.max(60, Math.round(w / 2)), 700);
      await page.sleep(900);
      const f = data(`shotset/${tag}-${theme}-${screen}-${w}.png`);
      await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 868, deviceScaleFactor: 2, mobile: false });
      await page.sleep(400);
      await page.shot(f);
      await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 868, deviceScaleFactor: 1, mobile: false });
      out.push(f);
    }
  }
  await page.send("Emulation.clearDeviceMetricsOverride");
  return { tag, files: out.length };
};

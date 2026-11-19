import { execSync } from "node:child_process";
const ADB = "adb";
const TITLE = "验收焦点-261119";
const ts = "2026-06-09T02:00:00.000Z";
const BODY = {
  kind: "bitable", version: 1, activeTableId: "tbl-focus",
  tables: [{
    id: "tbl-focus", name: "焦点表", activeViewId: "",
    views: [
      { id: "v-grid", name: "表格", type: "grid", rowHeight: "low" },
      { id: "v-form", name: "表单", type: "form", formFieldIds: ["f-text", "f-prog"], formTitle: "焦点表单", formDescription: "" },
    ],
    fields: [
      { id: "f-text", name: "文本", type: "text" },
      { id: "f-prog", name: "进度", type: "progress" },
    ],
    records: [{ id: "r1", createdAt: ts, updatedAt: ts, values: { "f-text": "初始文本", "f-prog": 40 } }],
  }],
};
const BODY_JSON = JSON.stringify(BODY);
const seed = async (page) => page.evaluate(`(async () => {
  const L = window.lakeNative;
  const purgeByTitle = async function (title) {
    const home0 = await L.getHomeSnapshot();
    for (const stale of home0.notes.filter(function (n) { return n.title === ${JSON.stringify(TITLE)}; })) {
      try { await L.trashNote(stale.id); await L.purgeTreeItem(stale.id, "note"); } catch (e) {}
    }
    try {
      const trash = await L.listTrashed();
      const nodes = Array.isArray(trash) ? trash : (trash && trash.nodes) || [];
      for (const item of nodes) { if (item && item.title === ${JSON.stringify(TITLE)}) { try { await L.purgeTreeItem(item.id, "note"); } catch (e) {} } }
    } catch (e) {}
  };
  await purgeByTitle();
  const home = await L.getHomeSnapshot();
  const nb = home.treeNodes.find(function (n) { return n.type === "notebook"; }) || home.treeNodes[0];
  const note = await L.createBitable(${JSON.stringify(TITLE)}, nb.id);
  await L.saveNote(note.id, ${JSON.stringify(TITLE)}, ${JSON.stringify(BODY_JSON)});
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf("lakex-local-notes-mobile.bitable-layout.") === 0) localStorage.removeItem(k); } } catch (e) {}
  return { noteId: note.id };
})()`);
const cleanup = async (page) => page.evaluate(`(async () => {
  const L = window.lakeNative;
  const home = await L.getHomeSnapshot();
  for (const note of home.notes.filter(function (n) { return n.title === ${JSON.stringify(TITLE)}; })) {
    try { await L.trashNote(note.id); await L.purgeTreeItem(note.id, "note"); } catch (e) {}
  }
  return { done: true };
})()`);
const HIT_JS = `(function (sel, text) {
  var els = [].slice.call(document.querySelectorAll(sel));
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.disabled) continue;
    if (text && ((el.getAttribute("aria-label") || el.title || el.textContent || "")).indexOf(text) < 0) continue;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    var cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    var h = document.elementFromPoint(cx, cy);
    if (!h) continue;
    if (!(h === el || el.contains(h) || h.contains(el))) continue;
    return { ok: true, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  }
  return { ok: false };
})`;
const hit = (page, sel, text) => page.evaluate("(" + HIT_JS + ")(" + JSON.stringify(sel) + "," + JSON.stringify(text ?? null) + ")");
const tapHit = async (page, sel, text, waitMs) => {
  const r = await hit(page, sel, text);
  if (!r.ok) return false;
  const x = r.rect[0] + Math.round(r.rect[2] / 2), y = r.rect[1] + Math.round(r.rect[3] / 2);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await page.sleep(waitMs || 1200);
  return true;
};
const state = async (page) => page.evaluate(`(function () {
  var ae = document.activeElement;
  return {
    ih: innerHeight,
    active: ae ? (ae.tagName + (ae.className ? "." + String(ae.className).split(" ")[0] : "")) : null,
    header: (function () { var h = document.querySelector(".mbt-header"); if (!h) return null; var r = h.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; })(),
    formOpen: !!document.querySelector(".mbt-form-input, .mbt-form-textarea"),
  };
})()`);
export default async ({ page }) => {
  const out = {};
  try {
    out.seed = await seed(page);
    await page.sleep(800);
    // 首页就绪等待（App 恢复后树/书架异步加载，先等再点）
    for (let i = 0; i < 20; i++) {
      const ready = await page.evaluate("!!document.querySelector('.nb-shelf-card, .nb-row')");
      if (ready) break;
      await page.sleep(500);
    }
    await tapHit(page, ".mb-home-dock__item", "知识库", 1500);
    let opened = false;
    for (let i = 0; i < 6 && !opened; i++) {
      opened = (await tapHit(page, ".nb-shelf-card", null, 2600)) || (await tapHit(page, ".nb-row", null, 2600));
      if (!opened) await page.sleep(700);
    }
    if (!opened) throw new Error("找不到笔记本卡");
    await tapHit(page, ".mobile-bottom-bar__item", "文档树", 1400);
    if (!(await tapHit(page, ".side-panel--left.on .mb-row", TITLE, 1600))) throw new Error("找不到夹具文档");
    await page.sleep(1200);
    out.s0 = await state(page);
    await tapHit(page, "button, [role=button]", "表单", 1200);
    out.s1 = await state(page);
    if (!out.s1.formOpen) { await tapHit(page, "button, [role=button]", "表单", 1200); out.s1 = await state(page); }
    // 焦点测试：点文本输入
    if (!(await tapHit(page, ".mbt-form-input, .mbt-form-textarea", null, 900))) throw new Error("找不到表单文本输入");
    out.afterTextTap = await state(page);
    // 点进度滑杆（键盘开着时滑杆可能在视口外 ⇒ 先滚进视口，滚动不得夺焦）
    await page.evaluate("(document.querySelector('input[type=\"range\"]') || {}).scrollIntoView ? document.querySelector('input[type=\"range\"]').scrollIntoView({ block: 'center' }) : null");
    await page.sleep(400);
    const slider = await hit(page, 'input[type="range"]', null);
    out.sliderHit = slider;
    if (slider.ok) {
      const x = slider.rect[0] + Math.round(slider.rect[2] * 0.3), y = slider.rect[1] + Math.round(slider.rect[3] / 2);
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 30, y, button: "left", buttons: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 30, y, button: "left", clickCount: 1 });
      await page.sleep(1000);
    }
    out.afterSlider = await state(page);
    // 切回表格测头部恒定
    await tapHit(page, "button, [role=button]", "表格", 1200);
    out.s2 = await state(page);
    out.verdict = {
      keyboardClosedAfterSlider: out.afterSlider.ih > out.afterTextTap.ih + 100,
      textNotRefocused: out.afterSlider.active !== out.afterTextTap.active,
      headerConstancy: JSON.stringify(out.s0.header) === JSON.stringify(out.s2.header) && JSON.stringify(out.s1.header) === JSON.stringify(out.s0.header),
    };
  } finally {
    out.cleanup = await cleanup(page);
  }
  return out;
};

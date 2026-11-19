const TITLE_RE = /^验收/;
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
const bodyTop = async (page) => page.evaluate("(function(){var b=document.querySelector('.mobile-doc-body'); return b ? Math.round(b.getBoundingClientRect().top) : null;})()");
export default async ({ page }) => {
  const out = {};
  try {
    for (let i = 0; i < 20; i++) {
      if (await page.evaluate("!!document.querySelector('.nb-shelf-card, .nb-row')")) break;
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
    // 找一条非「验收」夹具的文档行打开
    const rows = await page.evaluate(`(function(){
      var els = [].slice.call(document.querySelectorAll('.side-panel--left.on .mb-row'));
      return els.map(function (e) { return (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 12); });
    })()`);
    out.treeRows = rows;
    let docOpen = false;
    for (const label of rows) {
      if (TITLE_RE.test(label)) continue;
      if (await tapHit(page, ".side-panel--left.on .mb-row", label, 1500)) {
        await page.sleep(1200);
        if (await page.evaluate("!!document.querySelector('.mobile-doc-body')")) { docOpen = true; out.docRow = label; break; }
      }
    }
    if (!docOpen) throw new Error("没打开任何文档");
    out.bodyTopBefore = await bodyTop(page);
    if (!(await tapHit(page, 'button[aria-label="在文档中查找"]', null, 700))) throw new Error("找不到查找入口");
    out.findOpen = await page.evaluate("!!document.querySelector('.mb-find')");
    out.bodyTopAfter = await bodyTop(page);
    out.findVerdict = { noShift: out.bodyTopBefore === out.bodyTopAfter, before: out.bodyTopBefore, after: out.bodyTopAfter };
    await tapHit(page, 'button[aria-label="关闭查找"]', null, 500);
    // 进编辑态 → 插入 → 拍照
    await tapHit(page, 'button[aria-label="编辑"], .toolbar__button', "编辑", 1200);
    out.editing = await page.evaluate("!!document.querySelector('[data-mb-edit-host]')");
    if (!(await tapHit(page, 'button[aria-label="插入"]', null, 900))) throw new Error("找不到插入按钮");
    out.cameraTap = await tapHit(page, "button", "拍照", 300);
    await page.sleep(2500);
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  return out;
};

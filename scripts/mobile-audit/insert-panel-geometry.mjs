// 「＋」插入面板几何不变量装置（261015）：把"排布乱"这件事固化成可执行断言。
//
// 用法：node scripts/css-audit/drive.mjs <port> scripts/mobile-audit/insert-panel-geometry.mjs
//   前置：模拟器 + scripts/emu-cdp.sh 转发（见 scripts/mobile-audit/README.md）。面板没开时本装置会
//         **自己进编辑态**（首页 ＋ → 空白小记）并真实点开「＋」。
//
// 形态 = 用户 261015 点单的**方块网格**（4 列 / 图标在上文字在下 / 浅灰底 + 白块）：
//   G1 单一列宽  ：所有方块等宽（旧版有「3 列行 116.1」与「双卡行 84.8」两档 ⇒ 行节奏不齐）
//   G2 每行填满  ：每行 = 列数，**仅末行可不足**（18 项 ÷ 4 列 ⇒ 5 行，末行 2 项）
//   G3 溢出可滚  ：内容超出时面板内部能滚，且**滚到底时末行完整可达**（用户 261015：允许上下滑，
//                  不要求塞进键盘高度；但绝不允许"滚动也够不到 / 末行被裁一半"）
//   G4 零截断    ：没有 label 被省略号截断（3 列时曾差点截断「文档引用」）
//   G5 命中区    ：每块 ≥ 44×44（--mb-tap-min；方块实测 93×52）
//   G6 方块形态  ：图标在上、文字在下、居中、有圆角与底色（图1 样式；不是"图标左文字右"的行）
//   G7 组间分隔  ：行与行的垂直间距里，**最大者 ≥ 最小者的 2 倍**（组间明显大于组内 ⇒ 分组看得出来）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
const failures = [];
const log = [];
const check = (name, ok, detail) => {
  log.push((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failures.push(name + (detail ? "  " + detail : ""));
};
const MEASURE = `(function(){
  var vis = function(e){ return !!e && e.getBoundingClientRect().width > 0; };
  var panel = [].slice.call(document.querySelectorAll(".med-panel")).filter(vis)[0] || null;
  var inner = panel ? panel.querySelector(".med-panel-inner") : null;
  var items = [].slice.call(document.querySelectorAll(".med-ins-item")).filter(vis);
  var labels = [].slice.call(document.querySelectorAll(".med-ins-label")).filter(vis);
  var rows = {};
  items.forEach(function(e){ var r = e.getBoundingClientRect(); var k = Math.round(r.y); rows[k] = (rows[k] || 0) + 1; });
  return {
    panelOpen: panel ? panel.getAttribute("data-open") : null,
    clientH: inner ? inner.clientHeight : -1,
    scrollH: inner ? inner.scrollHeight : -1,
    itemCount: items.length,
    rowCount: Object.keys(rows).length,
    rowSizes: Object.keys(rows).sort(function(a,b){ return a-b; }).map(function(k){ return rows[k]; }),
    groupSizes: [].slice.call(document.querySelectorAll(".med-ins-groups .med-ins-grid")).map(function(g){ return g.querySelectorAll(".med-ins-item").length; }),
    rowGaps: (function(){ var ys = Object.keys(rows).map(Number).sort(function(a,b){ return a-b; });
      var h = items.length ? items[0].getBoundingClientRect().height : 0; var out = [];
      for (var i = 1; i < ys.length; i++) out.push(Math.round(ys[i] - ys[i-1] - h)); return out; })(),
    widths: items.map(function(e){ return Math.round(e.getBoundingClientRect().width); }).filter(function(v,i,a){ return a.indexOf(v) === i; }),
    minW: items.length ? Math.min.apply(null, items.map(function(e){ return Math.round(e.getBoundingClientRect().width); })) : 0,
    minH: items.length ? Math.min.apply(null, items.map(function(e){ return Math.round(e.getBoundingClientRect().height); })) : 0,
    truncated: labels.filter(function(l){ return l.scrollWidth > l.clientWidth + 0.5; }).map(function(l){ return l.textContent; }),
    tiles: items.map(function(e){ var cs = getComputedStyle(e);
      return [cs.flexDirection, cs.justifyContent, cs.alignItems, cs.borderRadius, (cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "TRANSPARENT" : "SOLID")].join("/"); }),
  };
})()`;
const CENTER = (sel, text) => '(function(){var t=' + JSON.stringify(text || "") + ';var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var els=[].slice.call(document.querySelectorAll(' + JSON.stringify(sel) + ')).filter(vis);for(var i=0;i<els.length;i++){if(t&&((els[i].getAttribute("aria-label")||els[i].title||els[i].textContent||"")).indexOf(t)<0)continue;var r=els[i].getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];}return null;})()';
async function realClick(sel, text) {
  const c = await page.evaluate(CENTER(sel, text));
  if (!c) return false;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: c[0], y: c[1], button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c[0], y: c[1], button: "left", clickCount: 1 });
  return true;
}
/** 没在编辑态时自己开一张空白小记（dock 只在编辑态挂载）——真机点按，不用 el.click()。 */
async function openEditor() {
  if (await realClick('button[aria-label="插入"]')) { await sleep(2200); return true; }
  for (let i = 0; i < 12; i++) { if (await realClick('button[aria-label="新建"]')) break; await sleep(1000); }
  await sleep(1200);
  await realClick(".mb-create-item, .mb-create button, button", "空白小记");
  await sleep(3500);
  return await realClick('button[aria-label="插入"]', null) ? (await sleep(2200), true) : false;
}
export default async function run(ctx) {
  page = ctx.page;
  for (let i = 0; i < 30; i++) { if (await page.evaluate("Boolean(window.lakeNative)")) break; await sleep(1000); }
  let m = await page.evaluate(MEASURE);
  if (!m || m.itemCount === 0) {
    const ok = await openEditor();
    if (!ok) { console.log("FAILED: 进不了编辑态（找不到 dock 的「插入」按钮）"); process.exit(2); }
    m = await page.evaluate(MEASURE);
  }
  console.log("== 「＋」插入面板几何 ==");
  console.log("  面板 " + m.clientH + "px / 内容 " + m.scrollH + "px · " + m.itemCount + " 项 · " + m.rowCount + " 行 " + JSON.stringify(m.rowSizes));
  console.log("  方块 " + JSON.stringify(m.widths) + " 宽 · 最小 " + m.minW + "x" + m.minH + " · 形态 " + JSON.stringify(m.tiles[0] || null) + " · 行间距 " + JSON.stringify(m.rowGaps) + " · 每组项数 " + JSON.stringify(m.groupSizes || []));
  check("G1 单一列宽", m.widths.length === 1, "widths=" + JSON.stringify(m.widths));
  const cols = m.rowSizes.length ? Math.max.apply(null, m.rowSizes) : 0;
  const last = m.rowSizes.length ? m.rowSizes[m.rowSizes.length - 1] : 0;
  const filled = cols > 0 && m.rowSizes.slice(0, -1).every((n) => n === cols) && last === (m.itemCount % cols || cols);
  check("G2 每行填满（仅末行可不足）", filled, "rowSizes=" + JSON.stringify(m.rowSizes) + " cols=" + cols);
  const reach = await page.evaluate('(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var panel=[].slice.call(document.querySelectorAll(".med-panel")).filter(vis)[0];var inner=panel.querySelector(".med-panel-inner");var items=[].slice.call(panel.querySelectorAll(".med-ins-item")).filter(vis);var last=items[items.length-1];inner.scrollTop=inner.scrollHeight;var pb=panel.getBoundingClientRect().bottom,lb=last.getBoundingClientRect().bottom;return {ovY:getComputedStyle(inner).overflowY,scrolled:Math.round(inner.scrollTop),over:inner.scrollHeight-inner.clientHeight,lastBottom:Math.round(lb),panelBottom:Math.round(pb),reachable:lb<=pb+1};})()');
  check("G3 溢出可滚 + 末行完整可达", reach.ovY === "auto" && reach.reachable, "overflowY=" + reach.ovY + " 溢出=" + reach.over + "px 滚动后末行底=" + reach.lastBottom + " 面板底=" + reach.panelBottom);
  await page.evaluate('(function(){var p=[].slice.call(document.querySelectorAll(".med-panel")).filter(function(e){return e.getBoundingClientRect().width>0;})[0];if(p)p.querySelector(".med-panel-inner").scrollTop=0;return 1;})()');
  check("G4 零截断", m.truncated.length === 0, m.truncated.join(","));
  check("G5 命中区 ≥44", m.minW >= 44 && m.minH >= 44, "min=" + m.minW + "x" + m.minH);
  const tileOk = m.tiles.length > 0 && m.tiles.every((t) => t.indexOf("column/center/center/") === 0 && t.indexOf("SOLID") > 0 && !t.startsWith("column/center/center/0px"));
  check("G6 方块形态（图标上·文字下·居中·有底色）", tileOk, "tile=" + JSON.stringify(m.tiles[0] || null));
  const gaps = m.rowGaps || [];
  const gmax = gaps.length ? Math.max.apply(null, gaps) : 0;
  const gmin = gaps.length ? Math.min.apply(null, gaps) : 0;
  check("G7 组间分隔（组间 ≥ 组内 2 倍）", gaps.length > 0 && gmin > 0 && gmax >= gmin * 2, "rowGaps=" + JSON.stringify(gaps));
  const gs = m.groupSizes || [];
  check("G8 组界落在行界（除末组外每组项数是列数整数倍）", gs.length > 0 && gs.slice(0, -1).every((n) => n % cols === 0), "groupSizes=" + JSON.stringify(gs));
  for (const l of log) console.log(l);
  console.log(failures.length ? "FAILED: " + failures.length + " 条" : "ALL PASS");
  if (failures.length) process.exit(1);
  return m;
}

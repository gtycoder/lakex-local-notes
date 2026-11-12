// 移动端「编辑面」不变量装置（261014 P0）：把过去只能靠人眼看 GIF 的四条不变量变成可执行断言。
//
// 用法：node scripts/css-audit/drive.mjs <port> scripts/mobile-audit/edit-surface-invariants.mjs [only]   （only = quicknote | document）
//   前置：模拟器 + scripts/emu-cdp.sh 转发（见 scripts/mobile-audit/README.md）。
//
// 五条不变量（两条编辑器各跑一遍）—— 依据是本会话修掉的 5 个真缺陷（HANDOFF §8 · 261014 三批）：
//   I1 几何（261112 重标定）：面板态自身稳定（+1.2s 内不变）+ 收回后内容区高度回原值、滚动位移 ≤2 行
//      （261014 的「键盘⇄面板三态逐项相同」前提已被 261110/261111 的全屏写作卡 + 覆盖式面板取代）；
//   I2 光标存在：面板打开后正文宿主仍是 activeElement、选区还在、inputmode=none（收键盘但留光标）；
//   I3 光标可见：**键盘态与收回后** caret.bottom < 工具栏 top（覆盖式面板打开时光标本就在面板底下，见 §7.7）；
//   I4 无自关/无闪：点＋后面板必须**保持打开**；每次开/关的 resize 次数有上界（一次键盘⇄面板切换 = 1 次）；
//   I5 面板贴视口底：面板打开时 panel.bottom === innerHeight、toolbar.bottom === panel.top。
//      （261020 回归：路由层常驻 will-change:transform 会把 fixed 包含块改成 layer 盒 ⇒ 面板整体上移一个键盘高，
//        下方空一片；该断言与"为什么"解耦，任何让面板脱离视口的改动都会红。）
//
// 退出码：0 = 全部通过；1 = 有不变量失败（逐条打印）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
async function click(x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function touch(x, y) {
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await sleep(60);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
/** 第一个**可见**元素的中心（keep-alive 隐藏视图仍在 DOM 里，必须过滤，否则量到的是隐藏实例）。 */
const Q = (sel) => '(function(){var e=[].slice.call(document.querySelectorAll(' + JSON.stringify(sel) + ')).filter(function(x){return x.getBoundingClientRect().width>0;})[0];if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()';
/** 按 aria-label/title/textContent 命中第一个可见元素。 */
const QT = (sel, t) => '(function(){var t=' + JSON.stringify(t) + ';var e=[].slice.call(document.querySelectorAll(' + JSON.stringify(sel) + ')).filter(function(x){return ((x.getAttribute("aria-label")||x.title||x.textContent||"")).indexOf(t)>=0 && x.getBoundingClientRect().width>0;})[0];if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()';
/** 正文宿主（可见的那个）：小记用 .quick-note-editor 里的、文档用 .mobile-doc-body 里的。 */
const CE = '(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var scopes=[".quick-note-editor",".mobile-doc-body"];for(var i=0;i<scopes.length;i++){var s=[].slice.call(document.querySelectorAll(scopes[i])).filter(vis)[0];if(!s)continue;var ce=[].slice.call(s.querySelectorAll("[contenteditable=true]")).filter(vis)[0];if(ce)return ce;}return [].slice.call(document.querySelectorAll("[contenteditable=true]")).filter(vis)[0]||null;})()';
/** 采样：编辑面几何 + 光标 + 面板/输入法状态。 */
const SAMPLE = '(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var ce=' + CE + ';var tb=[].slice.call(document.querySelectorAll(".med-toolbar")).filter(vis)[0]||null;var dock=[].slice.call(document.querySelectorAll(".mobile-editor-dock")).filter(vis)[0]||null;var panels=[].slice.call(document.querySelectorAll(".med-panel")).filter(vis);var kern=[].slice.call(document.querySelectorAll(".ne-editor-wrap-content")).filter(vis)[0]||null;var eng=[].slice.call(document.querySelectorAll(".ne-engine")).filter(vis)[0]||null;var first=eng?eng.querySelector("*"):null;var sel=document.getSelection();var caret=null;try{var rc=sel.getRangeAt(0).getBoundingClientRect();if(rc&&(rc.height||rc.width))caret=[Math.round(rc.top),Math.round(rc.bottom)];}catch(e){}return {ih:innerHeight,im:ce?ce.getAttribute("inputmode"):null,active:(document.activeElement||{}).className||null,range:sel?sel.rangeCount:-1,mode:dock?dock.getAttribute("data-panel"):null,panels:panels.length,open:panels[0]?panels[0].getAttribute("data-open"):null,kernCh:kern?Math.round(kern.clientHeight):-1,kernSt:kern?Math.round(kern.scrollTop):-1,firstY:first?Math.round(first.getBoundingClientRect().top):-1,tbTop:tb?Math.round(tb.getBoundingClientRect().top):-1,tbBottom:tb?Math.round(tb.getBoundingClientRect().bottom):-1,pTop:panels[0]?Math.round(panels[0].getBoundingClientRect().top):-1,pBottom:panels[0]?Math.round(panels[0].getBoundingClientRect().bottom):-1,caret:caret};})()';
const snap = () => page.evaluate(SAMPLE);
/** 记录一段窗口内的 resize 次数（一次键盘⇄面板切换应为 1 次）。 */
const armResizeCounter = () => page.evaluate('(function(){window.__rs=0;window.__rsStop=false;if(window.__rsOn)window.removeEventListener("resize",window.__rsOn);window.__rsOn=function(){window.__rs++;};window.addEventListener("resize",window.__rsOn);return true;})()');
const readResizeCounter = () => page.evaluate('(function(){var n=window.__rs||0;if(window.__rsOn){window.removeEventListener("resize",window.__rsOn);window.__rsOn=null;}return n;})()');
const out = { quicknote: null, document: null };
const failures = [];
const check = (scope, name, ok, detail) => {
  const line = (ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : "");
  (out[scope].log = out[scope].log || []).push(line);
  if (!ok) failures.push(scope + " · " + name + (detail ? "  " + detail : ""));
};
/**
 * I1a 面板态稳定：面板打开后 1.2s 内几何**不得继续变化**（防自滚 / 抖动 / 二次撑开）。
 * 261112 重标定：261014 的原断言要求「键盘态 ⇄ 面板态几何逐项相同」，前提是**面板与键盘同高、键盘收起⇒内容区等量缩短**；
 * 261110/261111 改成**全屏写作卡 + 覆盖式面板**（键盘收起后内容区变高、面板盖在正文上）⇒ 该前提不再成立，
 * 保留的语义变成「面板态自身稳定 + 收回后恢复」。
 */
function assertPanelStable(scope, a, b) {
  const near = (x, y) => Math.abs(x - y) <= 1;
  check(scope, "I1 面板态稳定[点＋ → +1.2s]", near(a.kernCh, b.kernCh) && near(a.kernSt, b.kernSt) && near(a.firstY, b.firstY),
    "ch " + a.kernCh + "→" + b.kernCh + " · st " + a.kernSt + "→" + b.kernSt + " · firstY " + a.firstY + "→" + b.firstY);
}
/**
 * I1b 收回后回到键盘态：① 内容区高度必须**严格**回原值（面板覆盖不得改变正文可视区）；
 * ② 滚动/首块允许「把光标带回视口」的位移，但不得超过 120px —— 否则就是整屏跳（回归）。
 * （实测：写作卡 26px、文档 74px；74 来自文档编辑态外壳 chrome 在收键盘时的重排，不是正文区变高。）
 */
function assertBackToKeyboard(scope, keyboard, back) {
  const near = (x, y) => Math.abs(x - y) <= 1;
  check(scope, "I1 收回后内容区高度回原值", near(back.kernCh, keyboard.kernCh), "ch " + keyboard.kernCh + "→" + back.kernCh);
  check(scope, "I1 收回后滚动/首块位移 ≤120px",
    Math.abs(back.kernSt - keyboard.kernSt) <= 120 && Math.abs(back.firstY - keyboard.firstY) <= 120,
    "st " + keyboard.kernSt + "→" + back.kernSt + " · firstY " + keyboard.firstY + "→" + back.firstY);
}
/** I3 光标可见：只在**键盘态**严格断言 —— 覆盖式面板打开时光标本就在面板底下（261112 截图复核：不是明显遮挡）。 */
function assertCaretVisible(scope, tag, s) {
  check(scope, "I3 光标在工具栏上方[" + tag + "]", s.caret ? s.caret[1] < s.tbTop : false,
    s.caret ? ("caret.bottom " + s.caret[1] + " < tb.top " + s.tbTop) : "无光标矩形");
}
/** I5：面板必须贴住视口底（fixed 包含块 = 视口），工具栏紧贴其上沿。 */
function assertPanelAnchored(scope, tag, s) {
  check(scope, "I5 面板贴视口底[" + tag + "]", Math.abs(s.pBottom - s.ih) <= 1 && Math.abs(s.tbBottom - s.pTop) <= 1,
    "panel.bottom " + s.pBottom + " vs innerHeight " + s.ih + " · toolbar.bottom " + s.tbBottom + " vs panel.top " + s.pTop);
}
/** I2：面板态必须「焦点还在正文 + 选区还在 + inputmode=none」。 */
function assertCaretKept(scope, tag, s) {
  const isEditor = /ne-engine|quick-note|mobile-doc/.test(String(s.active || ""));
  check(scope, "I2 面板态光标存在[" + tag + "]", isEditor && s.range >= 1 && s.im === "none",
    "active=" + String(s.active).slice(0, 24) + " range=" + s.range + " inputmode=" + s.im);
}
/** 场景 A：小记（标签页路径；写作卡 + dock）。 */
async function scenarioQuickNote() {
  const scope = "quicknote";
  const tapQ = async (sel, t, wait) => { const p = await page.evaluate(t ? QT(sel, t) : Q(sel)); if (p) await click(p[0], p[1]); await sleep(wait || 1500); };
  await page.evaluate("location.reload()");
  await sleep(7000);
  for (let i = 0; i < 20; i++) { if (await page.evaluate('Boolean(document.querySelector(".mb-home-dock__item"))')) break; await sleep(1000); }
  await tapQ(".mb-home-dock__item", "小记", 1800);
  // 261014/261110：首页「＋」已由底栏项改为**中央悬浮** .mb-home-fab（aria-label「新建（长按上滑可速记）」，短按开新建面板）——装置跟着改，别按旧文案找。
  await tapQ(".mb-home-fab", "新建", 3000);
  await sleep(800);
  await tapQ(".mb-create__tile", String.fromCharCode(0x7a7a, 0x767d, 0x5c0f, 0x8bb0), 2500);   // 「空白小记」→ 写作卡
  const ed = await page.evaluate('(function(){var e=[].slice.call(document.querySelectorAll(".ne-engine")).filter(function(x){return x.getBoundingClientRect().width>0;})[0];if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+40)];})()');
  if (ed) { await touch(ed[0], ed[1]); await sleep(1500); }
  await page.send("Input.insertText", { text: Array.from({ length: 30 }, (_, i) => "第 " + (i + 1) + " 行：编辑面不变量探针（长内容）。").join("\n") }).catch(() => {});
  await sleep(1500);
  await armResizeCounter();
  const s1 = await snap();
  await tapQ('.med-btn[aria-label="插入"]', null, 2200);
  const resizesOpen = await readResizeCounter();
  const s2 = await snap();
  await sleep(1200);
  const s2b = await snap();
  await armResizeCounter();
  await tapQ('.med-btn[aria-label="插入"]', null, 2600);
  const resizesClose = await readResizeCounter();
  const s3 = await snap();
  out[scope].samples = { s1, s2, s2b, s3 };
  out[scope].resizes = { open: resizesOpen, close: resizesClose };
  assertPanelStable(scope, s2, s2b);
  assertCaretVisible(scope, "键盘态", s1);
  assertBackToKeyboard(scope, s1, s3);
  assertCaretVisible(scope, "收回键盘", s3);
  out[scope].panelCaret = { bottom: s2.caret && s2.caret[1], panelTop: s2.pTop, toolbarTop: s2.tbTop };
  assertCaretKept(scope, "点＋", s2);
  assertPanelAnchored(scope, "点＋", s2);
  assertPanelAnchored(scope, "点＋+1.2s", s2b);
  check(scope, "I4 面板不自关（点＋后 1.2s 仍打开）", !!(s2b.mode && s2b.mode !== "none" && s2b.panels === 1), "mode=" + s2b.mode + " panels=" + s2b.panels);
  check(scope, "I4 开面板 resize ≤1", resizesOpen <= 1, "resize=" + resizesOpen);
  check(scope, "I4 关面板 resize ≤1", resizesClose <= 1, "resize=" + resizesClose);
  await tapQ("button", "取消", 1600);
}

/** 场景 B：文档编辑器（自建探针文档，跑完移入回收站）。 */
async function scenarioDocument() {
  const scope = "document";
  const TITLE = "probe-invariants-261014";
  const id = await page.evaluate('(async function(){var n=await window.lakeNative.createNote("' + TITLE + '", null);return n.id;})()');
  try {
    const tapQ = async (sel, t, wait) => { const p = await page.evaluate(t ? QT(sel, t) : Q(sel)); if (p) await click(p[0], p[1]); await sleep(wait || 1500); };
    await page.evaluate("location.reload()");
    await sleep(7000);
    for (let i = 0; i < 20; i++) { if (await page.evaluate('Boolean(document.querySelector(".mb-home-dock__item"))')) break; await sleep(1000); }
    await tapQ(".mb-home-dock__item", "知识库", 1800);
    await tapQ(".nb-row, .nb-shelf-card", null, 2200);
    const opened = await page.evaluate('Boolean([].slice.call(document.querySelectorAll(".side-panel--left.on .mb-row, .side-panel--left.on .ln-row")).filter(function(e){return e.getBoundingClientRect().width>0;}).length)');
    if (!opened) await tapQ(".mobile-bottom-bar__item", "文档树", 1500);
    const row = await page.evaluate('(function(){var t="' + TITLE + '";var rows=[].slice.call(document.querySelectorAll(".side-panel--left .mb-row, .side-panel--left .ln-row, .mobile-workspace .mb-row, .mobile-workspace .ln-row")).filter(function(e){return e.getBoundingClientRect().width>0;});for(var i=0;i<rows.length;i++){if((rows[i].textContent||"").indexOf(t)<0)continue;var r=rows[i].getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];}return null;})()');
    if (row) { await click(row[0], row[1]); await sleep(3000); }
    if (await page.evaluate('(function(){var m=document.querySelector(".side-mask");return !!m&&m.getBoundingClientRect().width>0;})()')) await tapQ(".side-mask", null, 1200);
    const edit = await page.evaluate('(function(){var els=[].slice.call(document.querySelectorAll("button,[role=button]"));for(var i=0;i<els.length;i++){var lab=(els[i].getAttribute("aria-label")||els[i].title||els[i].textContent||"").trim();if(lab!=="编辑")continue;var r=els[i].getBoundingClientRect();if(r.width<=0)continue;var x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);var h=document.elementFromPoint(x,y);if(!h||!(h===els[i]||els[i].contains(h)||h.contains(els[i])))continue;return [x,y];}return null;})()');
    if (edit) { await click(edit[0], edit[1]); await sleep(2200); }
    const ed = await page.evaluate('(function(){var e=[].slice.call(document.querySelectorAll(".ne-engine")).filter(function(x){return x.getBoundingClientRect().width>0;})[0];if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+40)];})()');
    if (ed) { await touch(ed[0], ed[1]); await sleep(1500); }
    await page.send("Input.insertText", { text: Array.from({ length: 18 }, (_, i) => "第 " + (i + 1) + " 行：文档编辑面不变量探针。").join("\n") }).catch(() => {});
    await sleep(1500);
    await armResizeCounter();
    const s1 = await snap();
    await tapQ('.med-btn[aria-label="插入"]', null, 2200);
    const resizesOpen = await readResizeCounter();
    const s2 = await snap();
    await sleep(1200);
    const s2b = await snap();
    await armResizeCounter();
    await tapQ('.med-btn[aria-label="插入"]', null, 2600);
    const resizesClose = await readResizeCounter();
    const s3 = await snap();
    out[scope].samples = { s1, s2, s2b, s3 };
    out[scope].resizes = { open: resizesOpen, close: resizesClose };
    assertPanelStable(scope, s2, s2b);
    assertCaretVisible(scope, "键盘态", s1);
    assertBackToKeyboard(scope, s1, s3);
    assertCaretVisible(scope, "收回键盘", s3);
    out[scope].panelCaret = { bottom: s2.caret && s2.caret[1], panelTop: s2.pTop, toolbarTop: s2.tbTop };
    assertCaretKept(scope, "点＋", s2);
  assertPanelAnchored(scope, "点＋", s2);
  assertPanelAnchored(scope, "点＋+1.2s", s2b);
    check(scope, "I4 面板不自关（点＋后 1.2s 仍打开）", !!(s2b.mode && s2b.mode !== "none" && s2b.panels === 1), "mode=" + s2b.mode + " panels=" + s2b.panels);
    check(scope, "I4 开面板 resize ≤1", resizesOpen <= 1, "resize=" + resizesOpen);
    check(scope, "I4 关面板 resize ≤1", resizesClose <= 1, "resize=" + resizesClose);
  } finally {
    try { await page.evaluate('(async function(){await window.lakeNative.trashNote("' + id + '" + "");})()'); } catch { /* 忽略 */ }
  }
}
export default async function run(ctx) {
  page = ctx.page;
  // ⚠️ 场景参数走 ctx.args（drive.mjs 传的是 process.argv.slice(4)）——
  //    直接读 process.argv[3] 会拿到**脚本路径**，两个场景都不跑却打印 ALL PASS（261014 实测的假绿）。
  const ONLY = String((ctx.args && ctx.args[0]) || "").trim();
  const wantQn = !ONLY || ONLY === "quicknote";
  const wantDoc = !ONLY || ONLY === "document";
  if (!wantQn && !wantDoc) { console.log("FAILED: 未选中任何场景（ONLY=" + ONLY + "）"); process.exit(2); }
  for (let i = 0; i < 30; i++) { if (await page.evaluate("Boolean(window.lakeNative && window.lakeNative.getQuickNotePage)")) break; await sleep(1000); }
  if (wantQn) { out.quicknote = { log: [] }; await scenarioQuickNote(); }
  if (wantDoc) { out.document = { log: [] }; await scenarioDocument(); }
  console.log("== 移动端编辑面不变量 ==");
  for (const scope of ["quicknote", "document"]) {
    if (!out[scope]) continue;
    console.log("-- " + scope + " --");
    for (const l of out[scope].log) console.log(l);
  }
  console.log(failures.length ? ("FAILED: " + failures.length + " 条") : "ALL PASS");
  if (failures.length) process.exit(1);
  return out;
}

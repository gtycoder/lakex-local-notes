// 面板开合编辑区稳定复现/守门装置（261119 点单：点＋展开插入面板正文跳位）。
//
// 用法：node scripts/css-audit/drive.mjs 9336 scripts/mobile-audit/dock-panel-stability.mjs [title]
//   前置：模拟器 + scripts/emu-cdp.sh 9336 转发；文档（默认 Gghhh，dev 库带图文档）必须存在。
//
// 断言（用户口径 = 「面板开合前后 scrollTop 稳定 + 编辑器不重挂」）：
//   S1 滚动稳定：键盘态 → 面板态 → 键盘态 → 面板态，滚动口 scrollTop 位移 ≤2px（I1b 放宽到 120px 以内也算不跳整屏，
//      这里按 261014 收口目标态「三态逐项相同」取 ≤2px；面板开合不许改滚动位置）；
//   S2 几何恒定：滚动口 clientHeight 面板态 == 键盘态（外壳高 --mb-app-h 必须钉住；261119 回归 = 面板态漏写该变量
//      ⇒ 外壳回退 100% ⇒ 滚动口长高 ⇒ Chrome 把 scrollTop 钳到新下限 ⇒ 整屏跳）；
//   S3 不重挂：面板开合前后 .ne-engine 根节点**同一实例**（isConnected + 引用相等）且卡片数不归零；
//   S4 变量在位：面板态 --mb-app-h 必须显式等于（稳定外壳高 − 面板占用），不能靠 100% 兜底。
//
// 退出码：0 = 全部通过；1 = 有断言失败（逐条打印原始读数，供回归比对）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
const TITLE = "Gghhh";

async function click(x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function touch(x, y) {
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await sleep(60);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const Q = (sel) => '(function(){var e=[].slice.call(document.querySelectorAll(' + JSON.stringify(sel) + ')).filter(function(x){return x.getBoundingClientRect().width>0;})[0];if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()';
const QT = (sel, t) => '(function(){var t=' + JSON.stringify(t) + ';var e=[].slice.call(document.querySelectorAll(' + JSON.stringify(sel) + ')).filter(function(x){return ((x.getAttribute("aria-label")||x.title||x.textContent||"")).indexOf(t)>=0 && x.getBoundingClientRect().width>0;})[0];if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()';

/** 采样：滚动口几何 + 外壳变量 + 内核根节点身份 + 媒体缩放扫描器残留（守卫批取证）。 */
const SAMPLE = '(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var pick=function(sel){var e=[].slice.call(document.querySelectorAll(sel)).filter(vis)[0];if(!e)return null;return {ch:Math.round(e.clientHeight),st:Math.round(e.scrollTop),sh:Math.round(e.scrollHeight)};};var eng=[].slice.call(document.querySelectorAll(".ne-engine")).filter(vis)[0]||null;var first=eng?eng.querySelector("*"):null;var appH=getComputedStyle(document.documentElement).getPropertyValue("--mb-app-h").trim();var boxes=[].slice.call(document.querySelectorAll(".lake-media-resize-box"));return {ih:innerHeight,appH:appH||("(none)"),body:pick(".mobile-doc-body"),wrap:pick(".ne-editor-wrap-content"),engSame:eng?eng===window.__kroot:false,engConnected:window.__kroot?window.__kroot.isConnected:false,cards:document.querySelectorAll("ne-card").length,firstY:first?Math.round(first.getBoundingClientRect().top):-1,resizeBoxes:boxes.length};})()';

const failures = [];
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failures.push(name + "  " + detail);
};

async function openDoc(title) {
  // 已在编辑态（App 恢复上次标签）⇒ 不再导航（否则找不到行会误抛）。
  const already = await page.evaluate('(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};return Boolean([].slice.call(document.querySelectorAll(".ne-engine")).filter(vis)[0]&&[].slice.call(document.querySelectorAll(".med-toolbar")).filter(vis)[0]);})()');
  if (already) return;
  await page.evaluate("location.reload()");
  await sleep(7000);
  for (let i = 0; i < 20; i++) { if (await page.evaluate('Boolean(document.querySelector(".mb-home-dock__item"))')) break; await sleep(1000); }
  const tapQ = async (sel, t, wait) => { const p = await page.evaluate(t ? QT(sel, t) : Q(sel)); if (p) await click(p[0], p[1]); await sleep(wait || 1500); return !!p; };
  await tapQ(".mb-home-dock__item", "知识库", 1800);
  // 逐本翻找目标文档（首页第一本 ≠ 目标所在本时，单点第一本会找不到行）。
  let row = null;
  for (let nb = 0; nb < 6 && !row; nb++) {
    const nbs = await page.evaluate('(function(){return [].slice.call(document.querySelectorAll(".nb-row, .nb-shelf-card")).filter(function(e){return e.getBoundingClientRect().width>0;}).map(function(e){var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];});})()');
    if (!nbs[nb]) break;
    await click(nbs[nb][0], nbs[nb][1]);
    await sleep(2200);
    row = await page.evaluate('(function(){var t=' + JSON.stringify(title) + ';var rows=[].slice.call(document.querySelectorAll(".side-panel--left .mb-row, .side-panel--left .ln-row, .mobile-workspace .mb-row, .mobile-workspace .ln-row")).filter(function(e){return e.getBoundingClientRect().width>0;});for(var i=0;i<rows.length;i++){if((rows[i].textContent||"").trim().indexOf(t)<0)continue;var r=rows[i].getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];}return null;})()');
    if (row) break;
    if (await page.evaluate('(function(){var m=document.querySelector(".side-mask");return !!m&&m.getBoundingClientRect().width>0;})()')) await tapQ(".side-mask", null, 1200);
  }
  if (row) { await click(row[0], row[1]); await sleep(3500); }
  if (await page.evaluate('(function(){var m=document.querySelector(".side-mask");return !!m&&m.getBoundingClientRect().width>0;})()')) await tapQ(".side-mask", null, 1200);
  const edit = await page.evaluate('(function(){var els=[].slice.call(document.querySelectorAll("button,[role=button]"));for(var i=0;i<els.length;i++){var lab=(els[i].getAttribute("aria-label")||els[i].title||els[i].textContent||"").trim();if(lab!=="编辑")continue;var r=els[i].getBoundingClientRect();if(r.width<=0)continue;var x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);var h=document.elementFromPoint(x,y);if(!h||!(h===els[i]||els[i].contains(h)||h.contains(els[i])))continue;return [x,y];}return null;})()');
  if (edit) { await click(edit[0], edit[1]); await sleep(2500); }
  if (!row && !edit) throw new Error("未找到文档 " + title + "（或已在编辑态）");
}

export default async function run(ctx) {
  page = ctx.page;
  const title = (ctx.args && ctx.args[0]) || TITLE;
  await openDoc(title);
  // 复现路径 = 用户点单口径：点正文出键盘 → 光标落在**底部编辑区**（日期卡下方的末尾空块，用户 GIF j_001）。
  // ⚠️ 光标必须与视口一致（点在末尾空块且滚进视口）：光标与视口脱节时，面板开合的滚动是**合法的光标跟滚**，
  // 会把跳位误诊/漏诊（261119 取证教训：点引擎顶部再滚走 ≠ 用户现场）。
  const spot = await page.evaluate('(function(){var vis=function(x){return !!x&&x.getBoundingClientRect().width>0;};var b=[].slice.call(document.querySelectorAll(".mobile-doc-body")).filter(vis)[0];var eng=[].slice.call(document.querySelectorAll(".ne-engine")).filter(vis)[0];if(!b||!eng)return null;var blk=null;for(var i=eng.children.length-1;i>=0;i--){var k=eng.children[i];if(!(k.textContent||"").trim()&&k.getBoundingClientRect().height<60){blk=k;break;}}if(!blk)blk=eng.lastElementChild;if(!blk)return null;var r=blk.getBoundingClientRect();var br=b.getBoundingClientRect();var docY=r.top-br.top+b.scrollTop;var want=Math.max(0,Math.min(b.scrollHeight-b.clientHeight,Math.round(docY-br.height*0.55)));b.scrollTop=want;var r2=blk.getBoundingClientRect();return [Math.round(r2.x+30),Math.round(r2.y+r2.height/2)];})()');
  await sleep(500);
  if (!spot) { console.log("FAILED: 文档编辑器未挂载"); process.exit(1); }
  await touch(spot[0], spot[1]);
  await sleep(1800);
  // 现场校验：光标必须在视口内（否则复现状态不忠实，断言无意义）。
  // 折叠光标在空块里 range rect 恒为 0×0（内核实测）⇒ 与 resolveCaretRect 同口径退到锚点块的 rect 判视口。
  const caretInView = await page.evaluate('(function(){var b=[].slice.call(document.querySelectorAll(".mobile-doc-body")).filter(function(x){return x.getBoundingClientRect().width>0;})[0];if(!b)return false;var s=document.getSelection();if(!s||!s.rangeCount)return false;var range=s.getRangeAt(0);var r=range.getBoundingClientRect();if(!r||(r.top===0&&r.bottom===0)){var a=s.anchorNode?(s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement):null;if(a)r=a.getBoundingClientRect();}if(!r||(r.top===0&&r.bottom===0))return false;var br=b.getBoundingClientRect();return r.top>=br.top-2&&r.bottom<=br.bottom+2;})()');
  console.log("光标在视口内:", caretInView);
  if (!caretInView) { console.log("FAILED: 光标不在视口内（复现状态不忠实）"); process.exit(1); }
  // 内核根节点身份基线（重挂判据）
  await page.evaluate('(function(){window.__kroot=[].slice.call(document.querySelectorAll(".ne-engine")).filter(function(x){return x.getBoundingClientRect().width>0;})[0]||null;return !!window.__kroot;})()');
  const s1 = await page.evaluate(SAMPLE);
  await sleep(600);
  const tapPlus = async () => { const p = await page.evaluate(QT('.med-btn', "插入")); if (p) await click(p[0], p[1]); return !!p; };
  await tapPlus();
  await sleep(2400);
  const s2 = await page.evaluate(SAMPLE);
  await sleep(1200);
  const s2b = await page.evaluate(SAMPLE);
  await tapPlus();                       // 收起（＋⇄✕ 同钮）
  await sleep(2600);
  const s3 = await page.evaluate(SAMPLE);
  await tapPlus();                       // 再次展开（j_222 场景）
  await sleep(2400);
  const s4 = await page.evaluate(SAMPLE);

  // 真正的滚动口 = scrollHeight > clientHeight 的那个（文档版式 = .mobile-doc-body；note 版式 = .ne-editor-wrap-content）。
  const scroller = (s) => (s.body && s.body.sh > s.body.ch + 2 ? s.body : (s.wrap && s.wrap.sh > s.wrap.ch + 2 ? s.wrap : (s.body || s.wrap)));
  const st = (s) => scroller(s).st;
  const ch = (s) => scroller(s).ch;
  console.log("== 面板开合编辑区稳定（" + title + "）==");
  console.log("样本 s1 键盘态  :", JSON.stringify(s1));
  console.log("样本 s2 面板态  :", JSON.stringify(s2));
  console.log("样本 s2b +1.2s :", JSON.stringify(s2b));
  console.log("样本 s3 收回态  :", JSON.stringify(s3));
  console.log("样本 s4 再展开  :", JSON.stringify(s4));
  check("S2 几何恒定[键盘态→面板态] clientHeight 不变", Math.abs(ch(s1) - ch(s2)) <= 2, "ch " + ch(s1) + "→" + ch(s2));
  check("S2 几何恒定[面板态→收回态] clientHeight 回原值", Math.abs(ch(s3) - ch(s1)) <= 2, "ch " + ch(s3) + " vs " + ch(s1));
  check("S1 滚动稳定[开面板] scrollTop 位移 ≤2px", Math.abs(st(s2) - st(s1)) <= 2, "st " + st(s1) + "→" + st(s2));
  check("S1 滚动稳定[收面板] scrollTop 位移 ≤2px", Math.abs(st(s3) - st(s1)) <= 2, "st " + st(s1) + "→" + st(s3));
  check("S1 滚动稳定[再展开] scrollTop 位移 ≤2px", Math.abs(st(s4) - st(s1)) <= 2, "st " + st(s1) + "→" + st(s4));
  check("S3 不重挂[面板态] .ne-engine 同一实例", s2.engSame && s2.engConnected && s2.cards > 0, "same=" + s2.engSame + " connected=" + s2.engConnected + " cards=" + s2.cards);
  check("S3 不重挂[收回态] .ne-engine 同一实例", s3.engSame && s3.engConnected && s3.cards > 0, "same=" + s3.engSame + " connected=" + s3.engConnected + " cards=" + s3.cards);
  check("S3 不重挂[再展开] .ne-engine 同一实例", s4.engSame && s4.engConnected && s4.cards > 0, "same=" + s4.engSame + " connected=" + s4.engConnected + " cards=" + s4.cards);
  check("S4 变量在位[面板态] --mb-app-h 显式钉住外壳高", s2.appH !== "(none)", "appH=" + s2.appH);
  check("S4 变量在位[面板态稳定] +1.2s 无自滚/自变", Math.abs(ch(s2b) - ch(s2)) <= 2 && Math.abs(st(s2b) - st(s2)) <= 2 && s2b.firstY === s2.firstY, "ch " + ch(s2) + "→" + ch(s2b) + " st " + st(s2) + "→" + st(s2b) + " firstY " + s2.firstY + "→" + s2b.firstY);
  console.log(failures.length ? ("FAILED: " + failures.length + " 条") : "ALL PASS");
  if (failures.length) process.exit(1);
  return { s1, s2, s2b, s3, s4 };
}

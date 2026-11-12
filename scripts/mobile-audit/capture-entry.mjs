/**
 * 移动端「速记 capture 入口」设备装置（261112 补 P0 空白）。
 *
 * 入口 = 首页中央＋ **长按 ≥260ms + 上滑 ≥36px 松手** ⇒ 直接进小记写作卡（速记）；点「取消」回首页。
 * 常量单一来源 = \`src/mobile/ui/createPress.ts\`（CREATE_LONG_PRESS_MS / CREATE_SLIDE_PX）。
 *
 * 用法：node scripts/css-audit/drive.mjs <port> scripts/mobile-audit/capture-entry.mjs
 * 判据：
 *   ① 短按（<260ms）不进写作卡（长按易误触 ⇒ 短按只开新建面板/交给自己）；
 *   ② 长按到点 ⇒ ＋ 进入 is-revealed；上滑过线 ⇒ is-armed；松手 ⇒ .mobile-qn-screen 打开且编辑器聚焦；
 *   ③ 点「取消」⇒ 写作卡关闭、回首页，且没有新建小记（列表条数不变）。
 * 前置：干净首页（本装置自己 reload + 关掉可能残留的新建面板，避免 scrim 盖住 ＋）。
 * 退出码：0 = 全通过；1 = 有条目失败。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
const failures = [];
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failures.push(name + (detail ? "  " + detail : ""));
};
const pt = (x, y) => [{ x, y, id: 0, radiusX: 2, radiusY: 2, force: 1 }];
const touchStart = (x, y) => page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x, y) });
const touchMove = (x, y) => page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x, y) });
const touchEnd = () => page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const click = async (x, y) => {
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const fabInfo = () => page.evaluate('(function(){var e=[].slice.call(document.querySelectorAll(".mb-home-fab")).filter(function(x){return x.getBoundingClientRect().width>0;})[0];if(!e)return null;var r=e.getBoundingClientRect();var x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return {x:x,y:y};})()');
const fabClass = () => page.evaluate('(document.querySelector(".mb-home-fab")||{}).className || ""');
const composerOpen = () => page.evaluate('(function(){var e=document.querySelector(".mobile-qn-screen");return !!e && e.getBoundingClientRect().width>0;})()');
const noteCount = () => page.evaluate('document.querySelectorAll("[data-quick-note-id]").length');
/** 先把首页收拾干净：reload + 用 scrim 关掉可能残留的「新建」面板。 */
const prepareHome = async () => {
  await page.evaluate("location.reload()");
  await sleep(7000);
  for (let i = 0; i < 30; i += 1) { if (await page.evaluate('Boolean(document.querySelector(".mb-home-fab"))')) break; await sleep(800); }
  for (let i = 0; i < 3; i += 1) {
    const open = await page.evaluate('(function(){var e=document.querySelector(".mb-sheet--create");return !!e && e.getBoundingClientRect().height>0;})()');
    if (!open) break;
    const scrim = await page.evaluate('(function(){var e=document.querySelector(".mb-scrim");if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()');
    if (!scrim) break;
    await click(scrim[0], scrim[1]);
    await sleep(900);
  }
};
const cancelComposer = async () => {
  const p = await page.evaluate('(function(){var els=[].slice.call(document.querySelectorAll(".mobile-qn-screen button, .mobile-qn-screen [role=button]"));for(var i=0;i<els.length;i++){if(((els[i].textContent||"").trim())!=="取消")continue;var r=els[i].getBoundingClientRect();if(r.width<=0)continue;return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];}return null;})()');
  if (!p) return false;
  await click(p[0], p[1]);
  await sleep(1200);
  return true;
};

export default async function run(ctx) {
  page = ctx.page;
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await prepareHome();
  const before = await noteCount();
  const fab = await fabInfo();
  if (!fab) { check("首页中央 ＋ 存在", false); console.log("FAILED: " + failures.length + " 条"); process.exit(1); }
  check("首页中央 ＋ 存在", true, "at [" + fab.x + "," + fab.y + "]");

  // ① 短按：按下 120ms 就松手 ⇒ 不进写作卡（也不该进 is-revealed）。
  await touchStart(fab.x, fab.y);
  await sleep(120);
  const shortClass = await fabClass();
  await touchEnd();
  await sleep(900);
  check("短按（120ms）不浮出 is-revealed", shortClass.indexOf("is-revealed") < 0, shortClass);
  check("短按不进写作卡", !(await composerOpen()));

  // ② 长按到点 + 上滑过线 + 松手 ⇒ 写作卡。
  await prepareHome();
  const fab2 = await fabInfo();
  await touchStart(fab2.x, fab2.y);
  await sleep(420);
  const revealed = await fabClass();
  check("长按（420ms）浮出 is-revealed", revealed.indexOf("is-revealed") >= 0, revealed);
  await touchMove(fab2.x, fab2.y - 90);
  await sleep(180);
  const armed = await fabClass();
  check("上滑 90px 进入 is-armed", armed.indexOf("is-armed") >= 0, armed);
  await touchEnd();
  let opened = false;
  for (let i = 0; i < 20; i += 1) { await sleep(300); if (await composerOpen()) { opened = true; break; } }
  check("长按+上滑松手 ⇒ 写作卡打开", opened);
  if (opened) {
    const focused = await page.evaluate('(function(){var a=document.activeElement;return !!a && (a.getAttribute("contenteditable")==="true" || !!a.closest(".ne-engine"));})()');
    check("写作卡内编辑器获得焦点", focused);
    check("写作卡可取消", await cancelComposer());
    await sleep(800);
    check("取消后回到首页（写作卡消失）", !(await composerOpen()));
    check("取消后没有新建小记（列表条数不变）", (await noteCount()) === before, before + " → " + (await noteCount()));
  } else {
    console.log("  info 兜底：长按+上滑未打开写作卡，回到首页重试一次");
  }
  console.log(failures.length ? ("FAILED: " + failures.length + " 条") : "ALL PASS");
  if (failures.length) process.exit(1);
  return { ok: true };
}

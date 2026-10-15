// ⌨ 键盘开合不变量装置（261015）：用户报「有键盘能收、没键盘点不出」⇒ 把**两个方向**都变成可执行断言。
//
// 用法：node scripts/css-audit/drive.mjs <port> scripts/mobile-audit/keyboard-toggle.mjs
//   前置：模拟器 + scripts/emu-cdp.sh（9335）。不在编辑态时本装置会**自己开一张空白小记**。
//   **状态驱动**：不假设初始有没有键盘 —— 先把状态归一到「键盘弹起」，再从那里跑「收 → 展 → 收」。
//
// 根因（261015 实测）：收键盘走 suppressIme() —— 它给正文宿主写 `inputmode="none"`（这是"留住光标"的关键）；
// 展开时**没摘掉**该属性 ⇒ 系统认定这个宿主不接受软键盘，focus() 也不会弹（修复前实测：两轮点击后 ih 仍 842、inputmode 仍 none）。
// 不变量：
//   K1 有键盘 + 点 ⌨ ⇒ 收起，且 **inputmode="none" 且 activeElement 仍在正文**（光标留住，不退回 blur 了事）；
//   K2 无键盘 + 点 ⌨ ⇒ 弹起，且 **inputmode 已摘除**（先 restoreIme 再聚焦 + 原生兜底）；
//   K3 再点 ⇒ 又收起（可反复开合，不是一次性）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
const failures = [];
const log = [];
const check = (name, ok, detail) => {
  log.push((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failures.push(name + (detail ? "  " + detail : ""));
};
const STATE = '(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};' +
  'var ce=[].slice.call(document.querySelectorAll("[contenteditable=true]")).filter(vis)[0]||null;' +
  'var tb=[].slice.call(document.querySelectorAll(".med-toolbar .med-btn")).filter(vis);var last=tb[tb.length-1];' +
  'var ae=document.activeElement;' +
  'return {ih:innerHeight, kb:innerHeight<700, inputmode:ce?ce.getAttribute("inputmode"):null, ' +
  'activeEditor:!!(ae&&ae.closest&&ae.closest("[contenteditable=true]")), label:last?last.getAttribute("aria-label"):null};})()';
const CENTER = (sel, text) => '(function(){var t=' + JSON.stringify(text || "") + ';var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var els=[].slice.call(document.querySelectorAll(' + JSON.stringify(sel) + ')).filter(vis);for(var i=0;i<els.length;i++){if(t&&((els[i].getAttribute("aria-label")||els[i].title||els[i].textContent||"")).indexOf(t)<0)continue;var r=els[i].getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];}return null;})()';
async function click(sel, text) {
  const c = await page.evaluate(CENTER(sel, text));
  if (!c) return false;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: c[0], y: c[1], button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c[0], y: c[1], button: "left", clickCount: 1 });
  return true;
}
const hasDock = () => page.evaluate('Boolean([].slice.call(document.querySelectorAll(".med-toolbar")).filter(function(e){return e.getBoundingClientRect().width>0;}).length)');
export default async function run(ctx) {
  page = ctx.page;
  for (let i = 0; i < 30; i++) { if (await page.evaluate("Boolean(window.lakeNative)")) break; await sleep(1000); }
  for (let i = 0; i < 20; i++) { if (await page.evaluate('Boolean(document.querySelector(".mobile-htab"))')) break; await sleep(1000); }
  if (!(await hasDock())) {
    await click('button[aria-label="新建"]'); await sleep(1500);
    await click(".mb-create-item, .mb-create button, button", "空白小记"); await sleep(3000);
  }
  for (let i = 0; i < 10; i++) { if (await hasDock()) break; await sleep(1000); }
  if (!(await hasDock())) { console.log("FAILED: 进不了编辑态（dock 没挂上）"); process.exit(2); }
  const T = () => page.evaluate(STATE);
  const tapKb = async () => { await click(".med-toolbar .med-btn:last-child"); await sleep(1300); };
  console.log("== ⌨ 键盘开合 ==");
  let s = await T();
  console.log("  初始 ih=" + s.ih + "（" + (s.kb ? "弹起" : "收起") + "）inputmode=" + s.inputmode + " 按钮=" + s.label);
  if (!s.kb) {                                   // 归一到「键盘弹起」这个已知起点：无键盘 ⇒ 点一下应该能弹
    await tapKb(); s = await T();
    check("K2 无键盘时点 ⌨ ⇒ 弹起 + inputmode 已摘除", s.kb && s.inputmode === null, "ih=" + s.ih + " inputmode=" + s.inputmode);
  }
  await tapKb(); const down = await T();
  check("K1 有键盘时点 ⌨ ⇒ 收起 + 光标留住（inputmode=none 且 activeElement 仍在正文）",
    !down.kb && down.inputmode === "none" && down.activeEditor, "ih=" + down.ih + " inputmode=" + down.inputmode + " activeEditor=" + down.activeEditor);
  await tapKb(); const up = await T();
  check("K2' 收起后点 ⌨ ⇒ 再弹起 + inputmode 摘除", up.kb && up.inputmode === null, "ih=" + up.ih + " inputmode=" + up.inputmode);
  await tapKb(); const down2 = await T();
  check("K3 可反复开合（又收起，光标仍在）", !down2.kb && down2.inputmode === "none" && down2.activeEditor, "ih=" + down2.ih);
  for (const l of log) console.log(l);
  console.log(failures.length ? "FAILED: " + failures.length + " 条" : "ALL PASS");
  if (failures.length) process.exit(1);
  return { down, up, down2 };
}

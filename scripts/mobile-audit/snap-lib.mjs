// 移动端快照装置的共享导航/静默工具（261030 抽出，供 6 态整页快照与多维表专项快照共用）。
// 口径与阈值原样来自 scripts/mobile-audit/mobile-snap.mjs（抽出时不改任何数字/等待时长）。
export const waitHome = async (page, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let ok = false;
    try { ok = await page.evaluate("!!document.querySelector('.mobile-htab')"); } catch (e) { ok = false; }
    if (ok) return true;
    await page.sleep(250);
  }
  return false;
};

// 等 DOM 静默（元素数 + 高度和稳定）—— 对齐桌面 stylesnap 的 settle（避免拿到中间态）
// 261012（P2 实测）：首页态会因**启动后的自动同步**在 1~2s 内再渲染一次（实测 home-library 连拍两份
// 1784 / 1755 元素，差 29 ≈ 三个文档卡）⇒ 判据从「3 次稳定 × 200ms」收紧到「6 次稳定 × 300ms」
// 并额外要求「没有瞬时提示条」——提示条出现过就说明还有异步动作在跑。
export const settle = async (page) => {
  let lastN = -1, lastH = -1, stable = 0;
  for (let i = 0; i < 30; i++) {
    const r = await page.evaluate("(function(){var els=document.querySelectorAll('body *');var s=0;for(var i=0;i<els.length;i++)s+=Math.round(els[i].getBoundingClientRect().height);var t=document.querySelector('.mb-toast,.mobile-toast');return [els.length,s,t?1:0];})()");
    const n = r[0], h = r[1], toast = r[2];
    if (n === lastN && h === lastH && !toast) { if (++stable >= 6) break; } else { stable = 0; lastN = n; lastH = h; }
    await page.sleep(300);
  }
};

// 261014：改成**真实点按**（与 tapSel/tapByLabel 同口径）—— 首页「＋」按 pointerdown/up 判定，
// el.click() 对它无效；tab / 设置按钮用真实输入也更接近人手。
export const clickText = async (page, sel, text) => {
  const p = await page.evaluate("(function(){var el=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(function(e){return ((e.getAttribute('aria-label')||e.title||e.textContent||'')).indexOf(" + JSON.stringify(text) + ")>=0 && e.getBoundingClientRect().width>0;});if(!el)return null;var r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()");
  if (!p) return false;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.sleep(800);
  return true;
};

// 书架/列表是**持久化**的 localStorage 偏好 ⇒ 不钉住的话，上一态把视图切了、下一态读到的是另一个视图：
// 实测 261013 前：按钮文案在「列表」视图下是"切换到书架"，而 home-library-list 找的是"切换到列表"
// ⇒ clickText 静默 no-op，home-library-list 与 home-library 是**同一个态**（元素数完全相同）。
export const setLibraryView = async (page, view) =>
  page.evaluate("(function(){try{localStorage.setItem('lakex-local-notes-mobile.libraryView'," + JSON.stringify(view) + ");}catch(e){}return true;})()");

// 261013：**清掉工作区标签持久化**（lakex-local-notes-mobile.tabs.<notebookId>）。
// App 会恢复上次打开的标签，而整页快照把 keep-alive 的**隐藏 pane 也算进元素数** ⇒ 同一份代码在不同
// 历史下会得到不同计数（实测 home-library 1784/1755 抖动、home-doc 2943/2937/2926 漂移，都是这个原因）。
// 门禁要的是可复现：每态都从"零标签"起步，活动 pane 也就只有本次导航打开的那一个。
export const clearTabs = async (page) =>
  page.evaluate("(function(){try{var ks=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('lakex-local-notes-mobile.tabs.')===0)ks.push(k);}ks.forEach(function(k){localStorage.removeItem(k);});return ks.length;}catch(e){return -1;}})()");

/** 每态都从"冷启动首页"开始：清标签 + 钉住视图 → reload → 等 .mobile-htab → 导航 → 等静默 */
export const reload = async (page, view) => {
  await clearTabs(page);
  if (view) await setLibraryView(page, view);
  await page.send("Page.reload", { ignoreCache: false });
  await page.sleep(1200);
  await waitHome(page);
  await settle(page);
};

/** 真实点按（WebView 里 el.click() 对 <button> 不触发导航，HANDOFF §8 已记）。 */
export const tapSel = async (page, sel, waitMs) => {
  const p = await page.evaluate("(function(){var el=document.querySelector(" + JSON.stringify(sel) + ");if(!el)return null;var r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()");
  if (!p) return false;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.sleep(waitMs || 1200);
  return true;
};

/** 按 aria-label 精确点按（首页顶栏有「设置」「排序/视图」「云同步」三枚 ⇒ 取首个会点错，必须按 aria-label）。 */
export const tapByLabel = async (page, sel, label, waitMs) => {
  const p = await page.evaluate("(function(){var el=[].slice.call(document.querySelectorAll(" + JSON.stringify(sel) + ")).find(function(e){return (e.getAttribute('aria-label')||e.title||'')===" + JSON.stringify(label) + ";});if(!el)return null;var r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()");
  if (!p) return false;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.sleep(waitMs || 1200);
  return true;
};

/** 按可见文案点按（多维表视图页签 / 选项磁贴这类按钮没有 aria-label）。 */
export const tapByText = async (page, sel, text, waitMs) => {
  const p = await page.evaluate("(function(){var els=[].slice.call(document.querySelectorAll(" + JSON.stringify(sel) + "));var el=els.find(function(e){return ((e.textContent||'').trim()).indexOf(" + JSON.stringify(text) + ")>=0 && e.getBoundingClientRect().width>0;});if(!el)return null;var r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()");
  if (!p) return false;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.sleep(waitMs || 1000);
  return true;
};

/** 每态自断言：到达不了目标屏就**抛错**，不要静默沿用上一屏（这是本次修掉的三处静默失效的共同成因）。 */
export const expectOn = async (page, expr, what) => {
  if (!(await page.evaluate(expr))) throw new Error("态未到达目标屏：" + what);
};


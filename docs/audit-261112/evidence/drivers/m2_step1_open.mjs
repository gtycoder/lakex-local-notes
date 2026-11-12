/** M2 步骤1：打开一条小记的编辑器（真实点按 Input.dispatchMouseEvent），返回编辑器/保存按钮现场。
 *  口径：简单激活用 click（MOBILE-OPS §6：点按走 Input.dispatchMouseEvent；touch 只用于长按/手势）。
 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const pick = await ev('(async()=>{const p=await window.lakeNative.getQuickNotePage();return p.items.map(q=>({id:q.id,previewText:q.previewText||""}));})()');
  const target = pick.find((q) => q.previewText.indexOf("夹具小记 3") >= 0) || pick[0];
  if (!target) return { error: "no quick notes", pick };
  const info = await ev('(()=>{const el=document.querySelector(\'[data-quick-note-id="' + target.id + '"]\');if(!el)return null;const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,r:{x:r.x,y:r.y,w:r.width,h:r.height},hitCls:hit?String(hit.className||hit.tagName).slice(0,60):null};})()');
  if (!info) return { error: "card not found", target };
  await page.click(info.x, info.y);
  await page.sleep(1500);
  const snap = await ev('(()=>{const vis=(el)=>{if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=="hidden";};const saveBtn=[...document.querySelectorAll("button")].find(b=>vis(b)&&(b.textContent||"").trim()==="保存");const rect=saveBtn?saveBtn.getBoundingClientRect():null;return {editorEls:document.querySelectorAll(".quick-note-editor").length,screenEls:document.querySelectorAll(".mobile-qn-screen").length,saveRect:rect?{x:rect.x+rect.width/2,y:rect.y+rect.height/2,w:rect.width,h:rect.height}:null,activeEl:document.activeElement?String(document.activeElement.className||document.activeElement.tagName).slice(0,60):null,editorText:(document.querySelector(".quick-note-editor")||document.body).innerText.slice(0,300)};})()');
  return { target, info, snap };
};
/** M2 步骤2：在「小记已被删除」的陈旧编辑器里改字并点保存（真实输入/点按）。
 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const ce = await ev('(()=>{const els=[...document.querySelectorAll("[contenteditable=true]")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});const e=els[0];if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+Math.min(40,r.height/2))};})()');
  if (!ce) return { error: "no contenteditable" };
  await page.click(ce.x, ce.y);
  await page.sleep(300);
  await page.send("Input.insertText", { text: " [M2审计编辑]" });
  await page.sleep(500);
  const edited = await ev('(()=>{const e=document.querySelector(".ne-engine");return e?e.innerText.slice(0,120):null;})()');
  const save = await ev('(()=>{const vis=(b)=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0;};const b=[...document.querySelectorAll("button")].find(x=>vis(x)&&(x.textContent||"").trim()==="保存");if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
  if (!save) return { error: "no save button", edited };
  await page.click(save.x, save.y);
  await page.sleep(1600);
  const after = await ev('(()=>({editorOpen:document.querySelectorAll(".quick-note-editor").length,text:(document.body.innerText||"").slice(0,160)}))()');
  return { ce, edited, save, after };
};
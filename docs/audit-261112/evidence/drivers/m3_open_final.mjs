/** M3：从已打开的文档树抽屉点「M3锁定测试」→ 打开后记录只读标识/可编辑性。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const row = await ev('(()=>{for(const e of document.querySelectorAll("button,[role=button]")){const t=(e.textContent||"").trim();if(t!=="M3锁定测试")continue;const r=e.getBoundingClientRect();if(r.width<=0||r.x<0)continue;return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}return null;})()');
  if (!row) return { error: "row gone" };
  await page.click(row.x, row.y);
  await page.sleep(1800);
  const state = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const titleInput=document.querySelector(".toolbar__title");return {title:titleInput?titleInput.value:null,readonlyTitle:titleInput?titleInput.classList.contains("toolbar__title--readonly"):null,lockWords:((document.body.innerText||"").match(/锁定|只读/g)||[]),buttons:[...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>({al:b.getAttribute("aria-label")||"",t:(b.textContent||"").trim().slice(0,10)})).filter(x=>x.al||x.t).slice(0,20),ce:document.querySelectorAll("[contenteditable=true]").length,viewer:document.querySelectorAll(".ne-viewer").length,engine:document.querySelectorAll(".ne-engine").length,text:(document.body.innerText||"").slice(0,180)};})()');
  return { row, state };
};
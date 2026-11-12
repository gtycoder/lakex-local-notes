/** M3 v4：工作区底部胶囊 → 文档树 → 打开「M3锁定测试」。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const capBtns = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>({al:b.getAttribute("aria-label")||"",t:(b.textContent||"").trim().slice(0,10),cls:String(b.className).slice(0,40)})).filter(x=>x.al||x.t);})()');
  const treeHit = await ev('(()=>{const al=["文档树","文档","目录"];const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};for(const e of [...document.querySelectorAll("button,[role=button]")].filter(vis)){const a=e.getAttribute("aria-label")||"";if(al.some(x=>a.indexOf(x)>=0)){const r=e.getBoundingClientRect();if(r.x<0||r.x>innerWidth)continue;return {al:a,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}}return null;})()');
  if (!treeHit) return { error: "no tree capsule", capBtns };
  await page.click(treeHit.x, treeHit.y);
  await page.sleep(900);
  const row = await ev('(()=>{for(const e of document.querySelectorAll("button,[role=button],div,span")){const t=(e.textContent||"").trim();if(t!=="M3锁定测试")continue;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;const cx=r.x+r.width/2,cy=r.y+r.height/2;if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)continue;const top=document.elementFromPoint(cx,cy);if(!top||!(top===e||e.contains(top)))continue;return {x:Math.round(cx),y:Math.round(cy),cls:String(e.className).slice(0,40)};}return null;})()');
  if (!row) return { error: "row not clickable after tree open", treeHit };
  await page.click(row.x, row.y);
  await page.sleep(1800);
  const state = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return {title:(document.querySelector(".toolbar__title")||{}).value||null,text:(document.body.innerText||"").slice(0,220),lockWords:((document.body.innerText||"").match(/锁定|只读/g)||[]),ce:document.querySelectorAll("[contenteditable=true]").length,viewer:document.querySelectorAll(".ne-viewer").length,engine:document.querySelectorAll(".ne-engine").length,buttons:[...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>({al:b.getAttribute("aria-label")||"",t:(b.textContent||"").trim().slice(0,10)})).filter(x=>x.al||x.t).slice(0,22)};})()');
  return { treeHit, row, state };
};
/** M3 步骤2：在文档树里点「M3锁定测试」打开（命中测试 + 最小面积匹配），返回打开后的现场。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const hit = await ev('(()=>{const all=[...document.querySelectorAll("button,[role=button],div,span,li,a")];let best=null;for(const e of all){const t=(e.textContent||"").trim();if(t!=="M3锁定测试")continue;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;const cx=r.x+r.width/2,cy=r.y+r.height/2;if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)continue;const top=document.elementFromPoint(cx,cy);if(!top)continue;if(!(top===e||e.contains(top)))continue;const area=r.width*r.height;if(!best||area<best.area)best={x:Math.round(cx),y:Math.round(cy),area,cls:String(e.className).slice(0,50)};}return best;})()');
  if (!hit) return { error: "doc row not found" };
  await page.click(hit.x, hit.y);
  await page.sleep(1600);
  const state = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return {hit,text:(document.body.innerText||"").slice(0,320),lockWords:((document.body.innerText||"").match(/锁定|只读/g)||[]),buttons:[...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>({t:(b.textContent||"").trim().slice(0,12),al:b.getAttribute("aria-label")||""})).filter(x=>x.t||x.al).slice(0,24),ce:document.querySelectorAll("[contenteditable=true]").length,viewer:document.querySelectorAll(".ne-viewer").length,engine:document.querySelectorAll(".ne-engine").length};})()');
  return state;
};
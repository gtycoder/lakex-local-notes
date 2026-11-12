/** M3 步骤2b：用产品内「搜索」打开锁定文档（搜索命中 → openNote 路径）。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const rect = (sel) => ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
  const searchBtn = await ev('(()=>{const b=[...document.querySelectorAll("button")].find(x=>(x.getAttribute("aria-label")||"")==="搜索"&&x.getBoundingClientRect().width>0);if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
  if (!searchBtn) return { error: "no search button" };
  await page.click(searchBtn.x, searchBtn.y);
  await page.sleep(700);
  const input = await ev('(()=>{const i=document.querySelector("input[type=search],input.mb-search-input,.mb-sheet input");if(!i)return null;const r=i.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),cls:String(i.className)};})()');
  if (!input) return { error: "no search input" };
  await page.click(input.x, input.y);
  await page.sleep(250);
  await page.send("Input.insertText", { text: "M3锁定测试" });
  await page.sleep(1200);
  const results = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll("[role=button],button,div")].filter(vis).map(e=>({t:(e.textContent||"").trim().slice(0,40),cls:String(e.className).slice(0,40)})).filter(x=>x.t.indexOf("M3锁定测试")>=0).slice(0,8);})()');
  const hit = await ev('(()=>{const all=[...document.querySelectorAll("[role=button],button,div")];let best=null;for(const e of all){const t=(e.textContent||"").trim();if(t.indexOf("M3锁定测试")<0||t.length>60)continue;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;const cx=r.x+r.width/2,cy=r.y+r.height/2;if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)continue;const top=document.elementFromPoint(cx,cy);if(!top)continue;if(!(top===e||e.contains(top)))continue;const area=r.width*r.height;if(!best||area<best.area)best={x:Math.round(cx),y:Math.round(cy),area,cls:String(e.className).slice(0,40)};}return best;})()');
  if (!hit) return { error: "no result row", results, input };
  await page.click(hit.x, hit.y);
  await page.sleep(1600);
  const state = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return {text:(document.body.innerText||"").slice(0,260),lockWords:((document.body.innerText||"").match(/锁定|只读/g)||[]),ce:document.querySelectorAll("[contenteditable=true]").length,viewer:document.querySelectorAll(".ne-viewer").length,engine:document.querySelectorAll(".ne-engine").length,buttons:[...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>({t:(b.textContent||"").trim().slice(0,12),al:b.getAttribute("aria-label")||""})).filter(x=>x.t||x.al).slice(0,20)};})()');
  return { searchBtn, input, hit, state };
};
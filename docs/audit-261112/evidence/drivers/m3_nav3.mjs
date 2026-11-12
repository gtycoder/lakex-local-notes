/** M3 导航 v3：直接点 .nb-shelf-card → 工作区；打印工作区顶栏/胶囊按钮，供下一步定位「文档树」。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const rectOf = (sel) => ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};})()');
  const nb = await rectOf(".nb-shelf-card");
  if (!nb) return { error: "no nb card" };
  await page.click(nb.x, nb.y);
  await page.sleep(1400);
  const state = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return {text:(document.body.innerText||"").slice(0,260),buttons:[...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>({t:(b.textContent||"").trim().slice(0,14),al:b.getAttribute("aria-label")||"",cls:String(b.className).slice(0,40)})).filter(x=>x.t||x.al).slice(0,30)};})()');
  return { nb, state };
};
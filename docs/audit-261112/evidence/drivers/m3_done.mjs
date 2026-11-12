/** M3：点「完成」退出编辑（触发保存），记录落库前后。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const btn = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const b=[...document.querySelectorAll("button,[role=button]")].find(x=>vis(x)&&((x.getAttribute("aria-label")||"")==="完成"));if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
  if (!btn) return { error: "no done button" };
  await page.click(btn.x, btn.y);
  await page.sleep(1200);
  const state = await ev('(()=>{const i=document.querySelector(".toolbar__title");return {title:i?i.value:null,readonly:i?i.classList.contains("toolbar__title--readonly"):null,lockWords:((document.body.innerText||"").match(/锁定|只读/g)||[])};})()');
  return { btn, state };
};
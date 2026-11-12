/** M3：记录「锁定」字样出处 + 进入编辑 → 输入 → 退出（触发保存）的现场。 */
export default async ({ page }) => {
  const ev = (expr) => page.evaluate(expr);
  const lockSrc = await ev('(()=>{const out=[];for(const e of document.querySelectorAll("*")){if(e.children.length>2)continue;const t=(e.textContent||"").trim();if(!t||t.length>20||t.indexOf("锁定")<0)continue;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;const cx=r.x+r.width/2,cy=r.y+r.height/2;if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)continue;const top=document.elementFromPoint(cx,cy);if(!top||!(top===e||e.contains(top)))continue;out.push({tag:e.tagName,cls:String(e.className).slice(0,50),t});if(out.length>5)break;}return out;})()');
  const topBtns = await ev('(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>{const r=b.getBoundingClientRect();return {al:b.getAttribute("aria-label")||"",t:(b.textContent||"").trim().slice(0,8),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}).filter(x=>(x.x>=0&&x.x<=412&&x.y>=0&&x.y<=120)&&(x.al||x.t));})()');
  const editBtn = topBtns.find((b) => b.al.indexOf("编辑") >= 0 || b.t === "编辑");
  if (!editBtn) return { error: "no edit button", lockSrc, topBtns };
  await page.click(editBtn.x, editBtn.y);
  await page.sleep(1500);
  const editing = await ev('(()=>{const ce=[...document.querySelectorAll("[contenteditable=true]")].map(e=>{const r=e.getBoundingClientRect();return {cls:String(e.className).slice(0,40),x:Math.round(r.x+r.width/2),y:Math.round(r.y+Math.min(60,r.height/2))};}).filter(c=>c.x>=0);const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return {ce,titleEditable:(()=>{const i=document.querySelector(".toolbar__title");return i?{value:i.value,readonly:i.classList.contains("toolbar__title--readonly")}:null;})(),topBtns:[...document.querySelectorAll("button,[role=button]")].filter(vis).map(b=>{const r=b.getBoundingClientRect();return {al:b.getAttribute("aria-label")||"",t:(b.textContent||"").trim().slice(0,8),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}).filter(x=>x.x>=0&&x.x<=412&&x.y>=0&&x.y<=120&&(x.al||x.t))};})()');
  const ce = (editing.ce || [])[0];
  if (!ce) return { error: "no contenteditable after edit", lockSrc, topBtns, editing };
  await page.click(ce.x, ce.y);
  await page.sleep(300);
  await page.send("Input.insertText", { text: " [M3审计编辑]" });
  await page.sleep(900);
  const typed = await ev('(()=>{const e=document.querySelector(".ne-engine, .ne-editor");return e?e.innerText.slice(0,150):null;})()');
  return { lockSrc, topBtns, editBtn, editing, typed };
};